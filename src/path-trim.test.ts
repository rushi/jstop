import { describe, expect, it } from "vitest";
import { collapsePackageStorePath, trimHome } from "./path-trim.js";

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
