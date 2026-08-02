import os from "node:os";
import chalk from "chalk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    computeColumnWidths,
    filterEntries,
    formatCommandCell,
    formatHeaderRow,
    formatListLine,
    groupByProject,
    hideChildProcesses,
    matchesKeyword,
    nestChildren,
    padVisible,
    printPlainList,
    resolveTag,
    visibleLength,
} from "./ui.js";
import type { DisplayEntry } from "./ui.js";

// eslint-disable-next-line no-control-regex -- matching the ANSI escape byte is the point
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

describe("visibleLength", () => {
    it("counts plain text length with no ANSI codes", () => {
        expect(visibleLength("hello")).toBe(5);
    });

    it("ignores ANSI SGR escape codes when counting length", () => {
        chalk.level = 3;
        const withColor = chalk.red("hi");
        expect(withColor.length).toBeGreaterThan(2);
        expect(visibleLength(withColor)).toBe(2);
        chalk.level = 1;
    });
});

describe("padVisible", () => {
    it("pads a plain string based on raw length", () => {
        expect(padVisible("ab", 5)).toBe("ab   ");
    });

    it("pads a colored string based on visible length, not raw length", () => {
        chalk.level = 3;
        const colored = chalk.red("ab");
        const padded = padVisible(colored, 5);
        expect(visibleLength(padded)).toBe(5);
        expect(padded.startsWith(colored)).toBe(true);
        chalk.level = 1;
    });

    it("adds no padding when the value already meets or exceeds the width", () => {
        expect(padVisible("abcdef", 3)).toBe("abcdef");
    });
});

describe("resolveTag", () => {
    it("returns MCP for an MCP process", () => {
        const entry = { pid: 1, ppid: 1, name: "node", cmd: "node server.js mcp" };
        expect(resolveTag(entry)).toBe("MCP");
    });

    it("returns BUN for a bun process that is not MCP", () => {
        const entry = { pid: 2, ppid: 1, name: "bun", cmd: "bun run server.ts", path: "/usr/local/bin/bun" };
        expect(resolveTag(entry)).toBe("BUN");
    });

    it("returns DENO for a deno process that is not MCP", () => {
        const entry = {
            pid: 3,
            ppid: 1,
            name: "deno",
            cmd: "deno run --allow-net server.ts",
            path: "/usr/local/bin/deno",
        };
        expect(resolveTag(entry)).toBe("DENO");
    });

    it("returns null for a plain node process with no tag", () => {
        const entry = { pid: 4, ppid: 1, name: "node", cmd: "node script.js" };
        expect(resolveTag(entry)).toBeNull();
    });

    it("prioritizes MCP over BUN when a process matches both", () => {
        const entry = {
            pid: 5,
            ppid: 1,
            name: "bun",
            cmd: "bun run mcp-server.ts",
            path: "/usr/local/bin/bun",
        };
        expect(resolveTag(entry)).toBe("MCP");
    });
});

describe("formatCommandCell", () => {
    it("matches the cleaned, non-truncated command for a short command", () => {
        const display: DisplayEntry = {
            entry: { pid: 6, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: null, launcher: null },
        };
        expect(formatCommandCell(display)).toBe("node script.js");
    });

    it("truncates a long command with an ellipsis by default", () => {
        const display: DisplayEntry = {
            entry: { pid: 7, ppid: 1, name: "node", cmd: `node ${"a".repeat(500)}` },
            source: { cwd: null, launcher: null },
        };
        const cell = formatCommandCell(display);
        expect(cell).toContain("…");
        expect(cell.length).toBeLessThanOrEqual(100);
    });

    it("does not truncate when verbose is true", () => {
        const display: DisplayEntry = {
            entry: { pid: 8, ppid: 1, name: "node", cmd: `node ${"a".repeat(500)}` },
            source: { cwd: null, launcher: null },
        };
        expect(formatCommandCell(display, { verbose: true })).not.toContain("…");
    });

    it("does not truncate when noTruncate is true", () => {
        const display: DisplayEntry = {
            entry: { pid: 9, ppid: 1, name: "node", cmd: `node ${"a".repeat(500)}` },
            source: { cwd: null, launcher: null },
        };
        expect(formatCommandCell(display, { noTruncate: true })).not.toContain("…");
    });

    it("drops the boring project/store prefix behind a single ellipsis, keeping the package name and binary intact", () => {
        const longPath =
            "~/Sites/work/xola/internal-tools/apps/athena/node_modules/.pnpm/@colbymchenry+codegraph-darwin-arm64@1.5.0/node_modules/@colbymchenry/codegraph-darwin-arm64/bin/codegraph-darwin-arm64";
        const display: DisplayEntry = {
            entry: { pid: 24135, ppid: 1, name: "codegraph-darwin-arm64", cmd: longPath },
            source: { cwd: null, launcher: null },
        };
        const cell = formatCommandCell(display);
        expect(cell).toContain("@colbymchenry/codegraph-darwin-arm64");
        expect(cell.startsWith("…/")).toBe(true);
    });

    it("keeps the scoped package name (node_modules/@scope/name) legible in a long command, not just the trailing basename", () => {
        const longPath = "~/Sites/work/xola/internal-tools/apps/athena/node_modules/@rushiv/expect-cli/dist/index.js";
        const display: DisplayEntry = {
            entry: { pid: 40, ppid: 1, name: "node", cmd: `node ${longPath} mcp` },
            source: { cwd: null, launcher: null },
        };
        const cell = formatCommandCell(display);
        expect(cell).toContain("@rushiv/expect-cli");
    });
});

describe("computeColumnWidths", () => {
    it("returns header label widths for an empty entry list, and project/command budgets from the given terminal width", () => {
        expect(computeColumnWidths([], 100)).toEqual({ pid: 3, tag: 3, project: 20, command: 68 });
    });

    it("widens the pid column to fit the longest pid", () => {
        const entries: DisplayEntry[] = [
            { entry: { pid: 123456, ppid: 1, name: "node", cmd: "node a.js" }, source: { cwd: null, launcher: null } },
        ];
        expect(computeColumnWidths(entries).pid).toBe(6);
    });

    it("widens the tag column to fit DENO (4 chars) over the PID header (3 chars)", () => {
        const entries: DisplayEntry[] = [
            {
                entry: { pid: 1, ppid: 1, name: "deno", cmd: "deno run x.ts", path: "/usr/local/bin/deno" },
                source: { cwd: null, launcher: null },
            },
        ];
        expect(computeColumnWidths(entries).tag).toBe(4);
    });

    it("gives both the project and command columns more room on a wider terminal", () => {
        const widths = computeColumnWidths([], 200);
        expect(widths.project).toBe(40);
        expect(widths.command).toBe(148);
    });

    it("never shrinks the project column below its minimum floor on a narrow terminal", () => {
        expect(computeColumnWidths([], 40).project).toBe(15);
    });

    it("never shrinks the command column below the minimum floor on a narrow terminal", () => {
        expect(computeColumnWidths([], 40).command).toBe(20);
    });

    it("falls back to the default terminal width when no terminal width is given (e.g. non-TTY output)", () => {
        expect(computeColumnWidths([]).command).toBeGreaterThanOrEqual(20);
    });
});

describe("formatHeaderRow", () => {
    it("pads pid/tag/project to the given widths and leaves command (last column) unpadded", () => {
        const header = formatHeaderRow({ pid: 6, tag: 4, project: 30, command: 10 });
        expect(header).toBe(`PID     TAG   PROJECT                         COMMAND`);
    });
});

describe("formatListLine", () => {
    // Pin a generous terminalWidth so these tests don't depend on the real terminal the test
    // runner happens to have (computeColumnWidths defaults to process.stdout.columns otherwise)
    // and have enough command-column headroom to stay focused on what each test actually
    // exercises rather than truncation. Dedicated tests below exercise the truncation budget
    // itself.
    const widthsFor = (entries: DisplayEntry[]) => computeColumnWidths(entries, 200);

    it("renders pid, tag, command, and project as separate columns", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);

        expect(line).toContain("42");
        expect(line).toContain("node script.js");
        expect(line).toContain("~/project");
    });

    it("falls back to launcher when cwd is unknown", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: null, launcher: "zsh (pid 1)" },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).toContain("zsh (pid 1)");
    });

    it("renders no indent for depth 0 (the default)", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).not.toContain("└─");
    });

    it("prefixes the command with a tree connector at depth 1", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths, {}, 1);

        expect(stripAnsi(line)).toContain("└─ node script.js");
    });

    it("adds two extra leading spaces per depth level beyond 1", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths, {}, 2);

        expect(stripAnsi(line)).toContain("  └─ node script.js");
    });

    it("blanks a child's tag and project when both match its parent's", () => {
        const parent: DisplayEntry = {
            entry: { pid: 1, ppid: 100, name: "node", cmd: "node parent.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const child: DisplayEntry = {
            entry: { pid: 2, ppid: 1, name: "node", cmd: "node child.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const widths = widthsFor([parent, child]);
        const line = stripAnsi(formatListLine(child, widths, {}, 1, parent));

        expect(line).not.toContain("~/project");
    });

    it("still shows the child's project when it differs from its parent's", () => {
        const parent: DisplayEntry = {
            entry: { pid: 1, ppid: 100, name: "node", cmd: "node parent.js" },
            source: { cwd: "~/project-a", launcher: null },
        };
        const child: DisplayEntry = {
            entry: { pid: 2, ppid: 1, name: "node", cmd: "node child.js" },
            source: { cwd: "~/project-b", launcher: null },
        };
        const widths = widthsFor([parent, child]);
        const line = stripAnsi(formatListLine(child, widths, {}, 1, parent));

        expect(line).toContain("~/project-b");
    });

    it("still shows the child's tag when it differs from its parent's", () => {
        const parent: DisplayEntry = {
            entry: { pid: 1, ppid: 100, name: "node", cmd: "node parent.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const child: DisplayEntry = {
            entry: { pid: 2, ppid: 1, name: "bun", cmd: "bun child.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const widths = widthsFor([parent, child]);
        const line = stripAnsi(formatListLine(child, widths, {}, 1, parent));

        expect(line).toContain("BUN");
    });

    it("does not blank a root entry's (depth 0) tag/project even if a parent argument is passed", () => {
        const parent: DisplayEntry = {
            entry: { pid: 1, ppid: 100, name: "node", cmd: "node parent.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const root: DisplayEntry = {
            entry: { pid: 2, ppid: 300, name: "node", cmd: "node root.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const widths = widthsFor([parent, root]);
        const line = stripAnsi(formatListLine(root, widths, {}, 0, parent));

        expect(line).toContain("~/project");
    });

    it("falls back to an unknown-source label when neither cwd nor launcher is known", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).toContain("unknown source");
    });

    it("falls back to the process name when cmd is unavailable (Windows)", () => {
        const display: DisplayEntry = {
            entry: { pid: 7, ppid: 1, name: "node.exe" },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).toContain("node.exe");
    });

    it("replaces the home directory with ~ in the rendered command", () => {
        const home = os.homedir();
        const display: DisplayEntry = {
            entry: { pid: 8, ppid: 1, name: "node", cmd: `${home}/.nvm/node app.js` },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain("~/.nvm/node app.js");
        expect(line).not.toContain(home);
    });

    it("collapses pnpm store hash segments in the rendered command", () => {
        const display: DisplayEntry = {
            entry: {
                pid: 9,
                ppid: 1,
                name: "node",
                cmd: "node /p/node_modules/.pnpm/vite@5.0.0_@types+node@20.1.0/node_modules/vite/bin/vite.js",
            },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain(".pnpm/vite@5.0.0/node_modules/vite/bin/vite.js");
    });

    it("strips control characters from the rendered command", () => {
        const escapeSequence = `${String.fromCharCode(27)}[31m`;
        const bell = String.fromCharCode(7);
        const display: DisplayEntry = {
            entry: { pid: 10, ppid: 1, name: "node", cmd: `node -e ${escapeSequence}console.log(1)${bell}` },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths, { verbose: true });
        expect(line).not.toContain(escapeSequence);
        expect(line).not.toContain(bell);
        expect(line).toContain("[31mconsole.log(1)");
    });

    it("truncates very long commands with an ellipsis", () => {
        const display: DisplayEntry = {
            entry: { pid: 11, ppid: 1, name: "node", cmd: `node ${"a".repeat(500)}` },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain("…");
        expect(line).not.toContain("a".repeat(200));
    });

    it("does not truncate a long command when verbose mode is enabled", () => {
        const display: DisplayEntry = {
            entry: { pid: 111, ppid: 1, name: "node", cmd: `node ${"a".repeat(500)}` },
            source: { cwd: null, launcher: null },
        };
        const widths = computeColumnWidths([display]);
        const nonVerboseWidths = widthsFor([display]);
        const nonVerboseLine = formatListLine(display, nonVerboseWidths);
        const verboseLine = formatListLine(display, widths, { verbose: true });

        expect(nonVerboseLine).toContain("…");
        expect(verboseLine).not.toContain("…");
        expect(verboseLine).toContain("a".repeat(500));
    });

    it("collapses PATH-resolvable binary paths down to their basename", () => {
        const display: DisplayEntry = {
            entry: {
                pid: 12,
                ppid: 1,
                name: "node",
                cmd: "node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp",
            },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain("node pnpx @rushiv/expect-cli@latest mcp");
        expect(line).not.toContain("/opt/homebrew/bin");
    });

    it("strips literal octal-escape junk (e.g. \\012) rendered by ps on macOS", () => {
        const display: DisplayEntry = {
            entry: {
                pid: 13,
                ppid: 1,
                name: "node",
                cmd: "node -e \\012const fs = require('fs');\\012const parentPid = 1;",
            },
            source: { cwd: null, launcher: null },
        };
        const widths = computeColumnWidths([display]);
        const line = formatListLine(display, widths, { verbose: true });
        expect(line).not.toContain("\\012");
        expect(line).toContain("node -e const fs = require('fs'); const parentPid = 1;");
    });

    it("shows MCP in the tag column for a process whose cmd contains a bare mcp token", () => {
        const display: DisplayEntry = {
            entry: {
                pid: 14,
                ppid: 1,
                name: "node",
                cmd: "node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp",
            },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).toContain("MCP");
    });

    it("shows no tag for a non-MCP, non-runtime-tagged process", () => {
        const display: DisplayEntry = {
            entry: { pid: 15, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).not.toContain("MCP");
    });

    it("shows MCP in the tag column using entry.name when cmd is unavailable (Windows)", () => {
        const display: DisplayEntry = {
            entry: { pid: 17, ppid: 1, name: "mcp-server.exe" },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).toContain("MCP");
    });

    it("hides flag-style tokens by default but keeps positional subcommands", () => {
        const display: DisplayEntry = {
            entry: {
                pid: 18,
                ppid: 1,
                name: "node",
                cmd: "node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp --host 0.0.0.0",
            },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain("node pnpx @rushiv/expect-cli@latest mcp");
        expect(line).not.toContain("0.0.0.0");
        expect(line).not.toContain("--host");
    });

    it("shortens a command path that lives inside the process's own cwd to a leading dot", () => {
        const cwd = "~/Sites/work/xola/internal-tools/apps/athena";
        const display: DisplayEntry = {
            entry: {
                pid: 30,
                ppid: 1,
                name: "node",
                cmd: `node ${cwd}/node_modules/vite/bin/vite.js dev`,
            },
            source: { cwd, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain("node ./node_modules/vite/bin/vite.js dev");
        // Whether or not the project column's width (a percentage of the terminal) is wide enough
        // to fit this cwd in full, truncateProjectPath always keeps the final path segment intact.
        expect(line).toContain("athena");
    });

    it("keeps the entry point when the cwd collapses to a bare '.' right after a flag (non-verbose)", () => {
        const cwd = "~/Sites/proj";
        const display: DisplayEntry = {
            entry: {
                pid: 32,
                ppid: 1,
                name: "node",
                cmd: `node --experimental-strip-types ${cwd}`,
            },
            source: { cwd, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain("node .");
    });

    it("shows BUN in the tag column for a bun process", () => {
        const display: DisplayEntry = {
            entry: { pid: 31, ppid: 1, name: "bun", cmd: "bun run server.ts", path: "/usr/local/bin/bun" },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).toContain("BUN");
    });

    it("shows DENO in the tag column for a deno process", () => {
        const display: DisplayEntry = {
            entry: {
                pid: 32,
                ppid: 1,
                name: "deno",
                cmd: "deno run --allow-net server.ts",
                path: "/usr/local/bin/deno",
            },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        expect(formatListLine(display, widths)).toContain("DENO");
    });

    it("shows neither BUN nor DENO tag for a plain node process", () => {
        const display: DisplayEntry = {
            entry: { pid: 33, ppid: 1, name: "node", cmd: "node script.js", path: "/opt/homebrew/bin/node" },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).not.toContain("BUN");
        expect(line).not.toContain("DENO");
    });

    it("prioritizes MCP over BUN in the tag column for a bun process that is also an MCP server", () => {
        const display: DisplayEntry = {
            entry: {
                pid: 34,
                ppid: 1,
                name: "bun",
                cmd: "bun run mcp-server.ts",
                path: "/usr/local/bin/bun",
            },
            source: { cwd: null, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain("MCP");
        expect(line).not.toContain("BUN");
    });

    it("shows flags when verbose mode is enabled", () => {
        const display: DisplayEntry = {
            entry: {
                pid: 19,
                ppid: 1,
                name: "node",
                cmd: "node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp --host 0.0.0.0",
            },
            source: { cwd: null, launcher: null },
        };
        const widths = computeColumnWidths([display]);
        const line = formatListLine(display, widths, { verbose: true });
        expect(line).toContain("node pnpx @rushiv/expect-cli@latest mcp --host 0.0.0.0");
    });

    it("truncates a long project path to the project column budget", () => {
        // Long enough that even after truncateProjectPath collapses the segment closest to the
        // end, the path still exceeds widthsFor's project budget (60, at its pinned 200-col
        // terminal) and a second segment must collapse too.
        const cwd = `~/${"a".repeat(30)}/${"b".repeat(30)}/${"c".repeat(30)}/project`;
        const display: DisplayEntry = {
            entry: { pid: 40, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd, launcher: null },
        };
        const widths = widthsFor([display]);
        const line = formatListLine(display, widths);
        expect(line).toContain("project");
        expect(line).not.toContain("b".repeat(30));
    });

    it("keeps columns visually aligned across rows with different pid widths and colored cells", () => {
        chalk.level = 3;
        const short: DisplayEntry = {
            entry: { pid: 1, ppid: 1, name: "node", cmd: "node a.js" },
            source: { cwd: "~/a", launcher: null },
        };
        const long: DisplayEntry = {
            entry: { pid: 123456, ppid: 1, name: "node", cmd: "node b.js mcp" },
            source: { cwd: "~/b", launcher: null },
        };
        const widths = computeColumnWidths([short, long]);
        const shortLine = formatListLine(short, widths);
        const longLine = formatListLine(long, widths);

        const projectColumnStart = (line: string) => visibleLength(line.slice(0, line.indexOf("~/")));
        expect(projectColumnStart(shortLine)).toBe(projectColumnStart(longLine));
        chalk.level = 1;
    });
});

describe("groupByProject", () => {
    it("keeps entries from the same project adjacent, in first-seen cluster order", () => {
        const a1: DisplayEntry = { entry: { pid: 1, ppid: 1, name: "node" }, source: { cwd: "~/a", launcher: null } };
        const b1: DisplayEntry = { entry: { pid: 2, ppid: 1, name: "node" }, source: { cwd: "~/b", launcher: null } };
        const a2: DisplayEntry = { entry: { pid: 3, ppid: 1, name: "node" }, source: { cwd: "~/a", launcher: null } };

        expect(groupByProject([a1, b1, a2])).toEqual([[a1, a2], [b1]]);
    });

    it("keeps two unknown-source entries in separate single-entry clusters", () => {
        const u1: DisplayEntry = { entry: { pid: 1, ppid: 1, name: "node" }, source: { cwd: null, launcher: null } };
        const u2: DisplayEntry = { entry: { pid: 2, ppid: 1, name: "node" }, source: { cwd: null, launcher: null } };

        expect(groupByProject([u1, u2])).toEqual([[u1], [u2]]);
    });

    it("returns an empty array for an empty entry list", () => {
        expect(groupByProject([])).toEqual([]);
    });

    it("falls back to launcher as the grouping key when cwd is null", () => {
        const l1: DisplayEntry = {
            entry: { pid: 1, ppid: 1, name: "node" },
            source: { cwd: null, launcher: "zsh (pid 1)" },
        };
        const l2: DisplayEntry = {
            entry: { pid: 2, ppid: 1, name: "node" },
            source: { cwd: null, launcher: "zsh (pid 1)" },
        };
        const other: DisplayEntry = {
            entry: { pid: 3, ppid: 1, name: "node" },
            source: { cwd: null, launcher: "bash (pid 2)" },
        };

        expect(groupByProject([l1, other, l2])).toEqual([[l1, l2], [other]]);
    });
});

describe("matchesKeyword", () => {
    it("matches a keyword found in the command", () => {
        const display: DisplayEntry = {
            entry: { pid: 1, ppid: 1, name: "node", cmd: "node vite/bin/vite.js dev --port 3000" },
            source: { cwd: "~/project", launcher: null },
        };
        expect(matchesKeyword(display, "vite")).toBe(true);
    });

    it("matches a keyword found in the cwd", () => {
        const display: DisplayEntry = {
            entry: { pid: 1, ppid: 1, name: "node", cmd: "node index.js" },
            source: { cwd: "~/Sites/athena", launcher: null },
        };
        expect(matchesKeyword(display, "athena")).toBe(true);
    });

    it("matches a keyword found in the launcher when cwd is null", () => {
        const display: DisplayEntry = {
            entry: { pid: 1, ppid: 1, name: "node", cmd: "node index.js" },
            source: { cwd: null, launcher: "zsh (pid 1)" },
        };
        expect(matchesKeyword(display, "zsh")).toBe(true);
    });

    it("is case-insensitive", () => {
        const display: DisplayEntry = {
            entry: { pid: 1, ppid: 1, name: "node", cmd: "node Vite.js" },
            source: { cwd: null, launcher: null },
        };
        expect(matchesKeyword(display, "VITE")).toBe(true);
    });

    it("returns false when the keyword is not found anywhere", () => {
        const display: DisplayEntry = {
            entry: { pid: 1, ppid: 1, name: "node", cmd: "node index.js" },
            source: { cwd: "~/project", launcher: null },
        };
        expect(matchesKeyword(display, "nuxt")).toBe(false);
    });
});

describe("filterEntries", () => {
    const a: DisplayEntry = {
        entry: { pid: 1, ppid: 1, name: "node", cmd: "node vite/bin/vite.js dev" },
        source: { cwd: "~/project-a", launcher: null },
    };
    const b: DisplayEntry = {
        entry: { pid: 2, ppid: 1, name: "node", cmd: "node index.js" },
        source: { cwd: "~/project-b", launcher: null },
    };

    it("returns only entries matching the keyword", () => {
        expect(filterEntries([a, b], "vite")).toEqual([a]);
    });

    it("returns all entries unchanged when the keyword is undefined", () => {
        expect(filterEntries([a, b], undefined)).toEqual([a, b]);
    });

    it("returns all entries unchanged when the keyword is empty or whitespace", () => {
        expect(filterEntries([a, b], "   ")).toEqual([a, b]);
    });

    it("returns an empty array when nothing matches", () => {
        expect(filterEntries([a, b], "nuxt")).toEqual([]);
    });
});

describe("hideChildProcesses", () => {
    const makeEntry = (pid: number, ppid: number): DisplayEntry => ({
        entry: { pid, ppid, name: "node" },
        source: { cwd: null, launcher: null },
    });

    it("hides a child whose ppid matches another listed entry's pid", () => {
        const parent = makeEntry(1, 100);
        const child = makeEntry(2, 1);
        expect(hideChildProcesses([parent, child])).toEqual([parent]);
    });

    it("keeps an entry whose ppid is not in the list", () => {
        const a = makeEntry(1, 100);
        const b = makeEntry(2, 200);
        expect(hideChildProcesses([a, b])).toEqual([a, b]);
    });

    it("hides a grandchild whose ppid matches an already-hidden child, as long as the child is still in the input list", () => {
        const grandparent = makeEntry(1, 100);
        const parent = makeEntry(2, 1);
        const child = makeEntry(3, 2);
        expect(hideChildProcesses([grandparent, parent, child])).toEqual([grandparent]);
    });

    it("returns an empty array for an empty entry list", () => {
        expect(hideChildProcesses([])).toEqual([]);
    });

    it("does not treat an entry as its own child when ppid happens to equal pid", () => {
        const entry = makeEntry(1, 1);
        expect(hideChildProcesses([entry])).toEqual([entry]);
    });
});

describe("nestChildren", () => {
    const makeEntry = (pid: number, ppid: number): DisplayEntry => ({
        entry: { pid, ppid, name: "node" },
        source: { cwd: null, launcher: null },
    });

    it("gives every root entry depth 0 and no parent when there are no parent/child relationships", () => {
        const a = makeEntry(1, 100);
        const b = makeEntry(2, 200);
        expect(nestChildren([a, b])).toEqual([
            { display: a, depth: 0, parent: null },
            { display: b, depth: 0, parent: null },
        ]);
    });

    it("nests a child directly after its parent at depth 1, with parent set to the parent display", () => {
        const parent = makeEntry(1, 100);
        const child = makeEntry(2, 1);
        const other = makeEntry(3, 300);

        expect(nestChildren([parent, other, child])).toEqual([
            { display: parent, depth: 0, parent: null },
            { display: child, depth: 1, parent },
            { display: other, depth: 0, parent: null },
        ]);
    });

    it("nests a grandchild at depth 2 directly after its parent, with parent set to its immediate parent", () => {
        const grandparent = makeEntry(1, 100);
        const parent = makeEntry(2, 1);
        const child = makeEntry(3, 2);

        expect(nestChildren([grandparent, parent, child])).toEqual([
            { display: grandparent, depth: 0, parent: null },
            { display: parent, depth: 1, parent: grandparent },
            { display: child, depth: 2, parent },
        ]);
    });

    it("does not treat an entry as its own child when ppid happens to equal pid", () => {
        const entry = makeEntry(1, 1);
        expect(nestChildren([entry])).toEqual([{ display: entry, depth: 0, parent: null }]);
    });

    it("returns an empty array for an empty entry list", () => {
        expect(nestChildren([])).toEqual([]);
    });
});

describe("printPlainList", () => {
    it("prints a header row, then entries clustered by project with a blank line between clusters", () => {
        const a1: DisplayEntry = {
            entry: { pid: 20, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const b1: DisplayEntry = {
            entry: { pid: 21, ppid: 1, name: "node", cmd: "node other.js" },
            source: { cwd: "~/other", launcher: null },
        };
        const a2: DisplayEntry = {
            entry: { pid: 22, ppid: 1, name: "node", cmd: "node third.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        printPlainList([a1, b1, a2]);

        const calls = logSpy.mock.calls.map((call) => call[0] as string);
        expect(calls).toHaveLength(5);
        expect(calls[0]).toContain("PID");
        expect(calls[1]).toContain("~/project");
        expect(calls[2]).toContain("~/project");
        expect(calls[3]).toBe("");
        expect(calls[4]).toContain("~/other");

        logSpy.mockRestore();
    });

    it("prints a single no-processes-found line for an empty list", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        printPlainList([]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith("No processes found.");

        logSpy.mockRestore();
    });

    it("never truncates, even when verbose is false/omitted", () => {
        const display: DisplayEntry = {
            entry: { pid: 23, ppid: 1, name: "node", cmd: `node ${"a".repeat(500)}` },
            source: { cwd: null, launcher: null },
        };
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        printPlainList([display]);

        expect(logSpy).toHaveBeenCalledTimes(2);
        const [, line] = logSpy.mock.calls.map((call) => call[0] as string);
        expect(line).not.toContain("…");
        expect(line).toContain("a".repeat(500));

        logSpy.mockRestore();
    });

    it("keeps the PROJECT column aligned across rows even when a command exceeds the truncation limit", () => {
        const short: DisplayEntry = {
            entry: { pid: 1, ppid: 1, name: "node", cmd: "node a.js" },
            source: { cwd: "~/a", launcher: null },
        };
        const long: DisplayEntry = {
            entry: { pid: 2, ppid: 1, name: "node", cmd: `node ${"a".repeat(200)}` },
            source: { cwd: "~/b", launcher: null },
        };
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        printPlainList([short, long]);

        const lines = logSpy.mock.calls.map((call) => call[0] as string).filter((line) => line.includes("~/"));
        const projectColumnStart = (line: string) => visibleLength(line.slice(0, line.indexOf("~/")));
        expect(lines).toHaveLength(2);
        expect(projectColumnStart(lines[0] as string)).toBe(projectColumnStart(lines[1] as string));

        logSpy.mockRestore();
    });

    it("does not throw and requires no interactive input", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const entries: DisplayEntry[] = [
            {
                entry: { pid: 22, ppid: 1, name: "node", cmd: "node script.js --verbose" },
                source: { cwd: null, launcher: null },
            },
        ];

        expect(() => printPlainList(entries, { verbose: true })).not.toThrow();

        logSpy.mockRestore();
    });
});

describe("chalk.level forcing (plain-mode no-color guarantee)", () => {
    afterEach(() => {
        chalk.level = 1;
    });

    it("emits no ANSI escape sequences once chalk.level is forced to 0, mirroring cli.ts's plain-mode guard", () => {
        chalk.level = 3;
        expect(chalk.red("x")).toContain("\x1b[");

        chalk.level = 0;
        const display: DisplayEntry = {
            entry: { pid: 200, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: "~/project", launcher: null },
        };
        const widths = computeColumnWidths([display]);
        const line = formatListLine(display, widths);

        expect(line).not.toContain("\x1b[");
    });
});
