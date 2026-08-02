import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    collapsePackageStorePath,
    collapsePathBinaries,
    relativizeToCwd,
    stripFlags,
    trimHome,
    truncateCommandPath,
    truncateProjectPath,
} from "./path-trim.js";

describe("trimHome", () => {
    it("replaces an exact home dir match with ~", () => {
        expect(trimHome("/Users/rushi", "/Users/rushi")).toBe("~");
    });

    it("replaces a home dir prefix with ~", () => {
        expect(trimHome("/Users/rushi/Sites/project/index.js", "/Users/rushi")).toBe("~/Sites/project/index.js");
    });

    it("leaves paths outside the home dir untouched", () => {
        expect(trimHome("/opt/homebrew/bin/node", "/Users/rushi")).toBe("/opt/homebrew/bin/node");
    });
});

describe("collapsePackageStorePath", () => {
    it("collapses a pnpm store hash segment down to package@version", () => {
        const input =
            "/Users/rushi/Library/Caches/pnpm/dlx/abc123/node_modules/.pnpm/@rushiv+expect-cli@0.1.5_express@5.2.1_ioredis@5.11.1_scheduler@0.27.0/node_modules/@rushiv/expect-cli/dist/index.js";
        const expected =
            "/Users/rushi/Library/Caches/pnpm/dlx/abc123/node_modules/.pnpm/@rushiv+expect-cli@0.1.5/node_modules/@rushiv/expect-cli/dist/index.js";
        expect(collapsePackageStorePath(input)).toBe(expected);
    });

    it("drops redundant node_modules/.bin/../ traversal", () => {
        const input = "/project/node_modules/.bin/../vite/bin/vite.js";
        expect(collapsePackageStorePath(input)).toBe("/project/node_modules/vite/bin/vite.js");
    });

    it("leaves a path with no pnpm hash or .bin traversal untouched", () => {
        const input = "/project/node_modules/execa/index.js";
        expect(collapsePackageStorePath(input)).toBe(input);
    });
});

describe("collapsePathBinaries", () => {
    const pathDirs = ["/opt/homebrew/bin", "/usr/bin"];

    it("collapses a PATH-resolvable absolute binary token to its basename", () => {
        const input = "node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp";
        const expected = "node pnpx @rushiv/expect-cli@latest mcp";
        expect(collapsePathBinaries(input, pathDirs)).toBe(expected);
    });

    it("leaves a token untouched when its directory is not in PATH", () => {
        const input = "node /opt/other/bin/tool script.js";
        expect(collapsePathBinaries(input, pathDirs)).toBe(input);
    });

    it("leaves a cmdStr with no absolute-path tokens untouched", () => {
        const input = "node script.js --flag";
        expect(collapsePathBinaries(input, pathDirs)).toBe(input);
    });

    it("collapses a binary whose PATH directory lives under $HOME (e.g. ~/.bun/bin)", () => {
        const bunBinDir = path.join(os.homedir(), ".bun", "bin");
        const input = `${path.join(bunBinDir, "bun")} run server.ts`;
        const expected = "bun run server.ts";
        expect(collapsePathBinaries(input, [bunBinDir])).toBe(expected);
    });
});

describe("relativizeToCwd", () => {
    it("collapses a token whose prefix matches cwd down to a leading dot", () => {
        const input = "node ~/Sites/work/xola/internal-tools/apps/athena/node_modules/vite/bin/vite.js dev";
        const cwd = "~/Sites/work/xola/internal-tools/apps/athena";
        expect(relativizeToCwd(input, cwd)).toBe("node ./node_modules/vite/bin/vite.js dev");
    });

    it("leaves a token untouched when it does not start with cwd", () => {
        const input = "node /opt/homebrew/bin/pnpx mcp";
        expect(relativizeToCwd(input, "~/Sites/work/project")).toBe(input);
    });

    it("returns the command unchanged when cwd is null", () => {
        const input = "node ~/Sites/project/index.js";
        expect(relativizeToCwd(input, null)).toBe(input);
    });

    it("returns the command unchanged when cwd is an empty string", () => {
        const input = "node ~/Sites/project/index.js";
        expect(relativizeToCwd(input, "")).toBe(input);
    });

    it("collapses a token that is an exact match for cwd (no suffix) to just a dot", () => {
        const cwd = "~/Sites/project";
        expect(relativizeToCwd(`node ${cwd}`, cwd)).toBe("node .");
    });
});

describe("stripFlags", () => {
    it("removes flag tokens and their positional-looking mcp subcommand stays visible", () => {
        // "mcp" is not preceded by a flag, so the new value-stripping logic must not touch it.
        const input = "node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp --host 0.0.0.0";
        const expected = "node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp";
        expect(stripFlags(input)).toBe(expected);
    });

    it("strips both single-dash and double-dash flags along with their values", () => {
        expect(stripFlags("node script.js -v --port 7576")).toBe("node script.js");
    });

    it("leaves a bare negative number untouched (not treated as a flag)", () => {
        expect(stripFlags("node script.js -1")).toBe("node script.js -1");
    });

    it("leaves a command with no flags untouched", () => {
        expect(stripFlags("node script.js")).toBe("node script.js");
    });

    it("strips a flag's value token (--port 3000)", () => {
        expect(stripFlags("node app.js --port 3000")).toBe("node app.js");
    });

    it("strips a flag's value token (--host 0.0.0.0)", () => {
        expect(stripFlags("node app.js --host 0.0.0.0")).toBe("node app.js");
    });

    it("keeps an entry-point-looking token after a flag instead of stripping it", () => {
        expect(stripFlags("node --inspect app.js")).toBe("node app.js");
    });

    it("documents the known false-negative: a boolean flag with no value still eats the next token", () => {
        // --silent takes no value, but the heuristic can't tell that without per-CLI schema
        // knowledge, so "build" is incorrectly stripped too. Pinned intentionally.
        expect(stripFlags("npm run --silent build")).toBe("npm run");
    });

    it("keeps a bare '.' entry point after a flag instead of stripping it (relativizeToCwd regression)", () => {
        // relativizeToCwd runs before stripFlags in the pipeline and can collapse a cwd-matching
        // token down to exactly ".". Without treating "." as entry-point-like, this token would
        // look like a droppable flag value here, erasing the entry point entirely.
        expect(stripFlags("node --experimental-strip-types .")).toBe("node .");
    });
});

describe("truncateProjectPath", () => {
    it("returns the path unchanged when shorter than the width budget", () => {
        expect(truncateProjectPath("~/project", 30)).toBe("~/project");
    });

    it("returns the path unchanged when exactly at the width budget", () => {
        const path = `~/${"a".repeat(28)}`; // length 30
        expect(truncateProjectPath(path, 30)).toBe(path);
    });

    it("collapses only the segment closest to the end when that alone makes it fit", () => {
        const input =
            "~/Library/Caches/pnpm/dlx/710b29a7584b8b7d3857c36d4f3d1c0039164d62e3ba8413c79be1b9c24abb1f/foo/bar/bat";
        const expected =
            "~/Library/Caches/pnpm/dlx/710b29a7584b8b7d3857c36d4f3d1c0039164d62e3ba8413c79be1b9c24abb1f/foo/b/bat";
        expect(truncateProjectPath(input, 101)).toBe(expected);
    });

    it("collapses two trailing-middle segments when one collapse isn't enough", () => {
        const input =
            "~/Library/Caches/pnpm/dlx/710b29a7584b8b7d3857c36d4f3d1c0039164d62e3ba8413c79be1b9c24abb1f/foo/bar/bat";
        const expected =
            "~/Library/Caches/pnpm/dlx/710b29a7584b8b7d3857c36d4f3d1c0039164d62e3ba8413c79be1b9c24abb1f/f/b/bat";
        expect(truncateProjectPath(input, 99)).toBe(expected);
    });

    it("collapses every trailing-middle segment down to initials when needed to fit", () => {
        const input =
            "~/Library/Caches/pnpm/dlx/710b29a7584b8b7d3857c36d4f3d1c0039164d62e3ba8413c79be1b9c24abb1f/foo/bar/bat";
        const expected = "~/Library/Caches/pnpm/dlx/7/f/b/bat";
        expect(truncateProjectPath(input, 40)).toBe(expected);
    });

    it("returns the best-effort fully-collapsed path unchanged when even full collapse can't fit the budget", () => {
        const input =
            "~/Library/Caches/pnpm/dlx/710b29a7584b8b7d3857c36d4f3d1c0039164d62e3ba8413c79be1b9c24abb1f/foo/bar/bat";
        const expected = "~/L/C/p/d/7/f/b/bat";
        expect(truncateProjectPath(input, 1)).toBe(expected);
    });

    it("leaves a single-segment string (no slashes) untouched even if over budget", () => {
        expect(truncateProjectPath("unknown source", 5)).toBe("unknown source");
    });
});

describe("truncateCommandPath", () => {
    it("returns the path unchanged when shorter than the width budget", () => {
        expect(truncateCommandPath("~/project/node_modules/foo/index.js", 100)).toBe(
            "~/project/node_modules/foo/index.js",
        );
    });

    it("drops everything before the package behind a single ellipsis, keeping the scoped package name intact", () => {
        const input = "~/Sites/proj/node_modules/@rushiv/expect-cli/dist/index.js";
        const expected = "…/@rushiv/expect-cli/d/index.js";
        expect(truncateCommandPath(input, 40)).toBe(expected);
    });

    it("collapses the trailing subpath's non-last segments before giving up further", () => {
        const input = "~/Sites/proj/node_modules/@rushiv/expect-cli/dist/index.js";
        const expected = "…/@rushiv/expect-cli/d/index.js";
        expect(truncateCommandPath(input, 25)).toBe(expected);
    });

    it("protects an unscoped package name, dropping the prefix behind an ellipsis", () => {
        const input = "~/proj/node_modules/expect-cli/dist/index.js";
        const expected = "…/expect-cli/d/index.js";
        expect(truncateCommandPath(input, 20)).toBe(expected);
    });

    it("protects both '.bin' and the binary name as a unit under node_modules/.bin", () => {
        const input = "~/some/deeply/nested/project/node_modules/.bin/expect-cli";
        const expected = "…/.bin/expect-cli";
        expect(truncateCommandPath(input, 25)).toBe(expected);
    });

    it("falls back to truncateProjectPath's collapsing behavior when there's no node_modules at all", () => {
        const input = "~/Library/Caches/pnpm/dlx/some-long-cache-directory-name/bin/tool";
        const expected = "~/Library/Caches/pnpm/dlx/s/b/tool";
        expect(truncateCommandPath(input, 40)).toBe(expected);
    });

    it("keeps the ellipsized form even when the anchor itself makes it exceed the budget (never collapses the package name)", () => {
        const input =
            "/Users/rushi/Sites/work/xola/internal-tools/apps/athena/node_modules/.pnpm/@colbymchenry+codegraph-darwin-arm64@1.5.0/node_modules/@colbymchenry/codegraph-darwin-arm64/node";
        const expected = "…/@colbymchenry/codegraph-darwin-arm64/node";
        expect(truncateCommandPath(input, 30)).toBe(expected);
    });
});
