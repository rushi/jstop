import os from "node:os";
import { describe, expect, it } from "vitest";
import { formatListLine } from "./ui.js";
import type { DisplayEntry } from "./ui.js";

describe("formatListLine", () => {
    it("prefers cwd over launcher when both are known", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: "~/project", launcher: "zsh (pid 1)" },
        };
        expect(formatListLine(display)).toContain("~/project");
        expect(formatListLine(display)).toContain("node script.js");
        expect(formatListLine(display)).toContain("42");
    });

    it("falls back to launcher when cwd is unknown", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: null, launcher: "zsh (pid 1)" },
        };
        expect(formatListLine(display)).toContain("zsh (pid 1)");
    });

    it("falls back to an unknown-source label when neither cwd nor launcher is known", () => {
        const display: DisplayEntry = {
            entry: { pid: 42, ppid: 1, name: "node", cmd: "node script.js" },
            source: { cwd: null, launcher: null },
        };
        expect(formatListLine(display)).toContain("unknown source");
    });

    it("falls back to the process name when cmd is unavailable (Windows)", () => {
        const display: DisplayEntry = {
            entry: { pid: 7, ppid: 1, name: "node.exe" },
            source: { cwd: null, launcher: null },
        };
        expect(formatListLine(display)).toContain("node.exe");
    });

    it("replaces the home directory with ~ in the rendered command", () => {
        const home = os.homedir();
        const display: DisplayEntry = {
            entry: { pid: 8, ppid: 1, name: "node", cmd: `${home}/.nvm/node app.js` },
            source: { cwd: null, launcher: null },
        };

        const line = formatListLine(display);
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

        const line = formatListLine(display);
        expect(line).toContain(".pnpm/vite@5.0.0/node_modules/vite/bin/vite.js");
    });

    it("strips control characters from the rendered command", () => {
        const escapeSequence = `${String.fromCharCode(27)}[31m`;
        const bell = String.fromCharCode(7);
        const display: DisplayEntry = {
            entry: { pid: 10, ppid: 1, name: "node", cmd: `node -e ${escapeSequence}console.log(1)${bell}` },
            source: { cwd: null, launcher: null },
        };

        const line = formatListLine(display);
        expect(line).not.toContain(escapeSequence);
        expect(line).not.toContain(bell);
        expect(line).toContain("[31mconsole.log(1)");
    });

    it("truncates very long commands with an ellipsis", () => {
        const display: DisplayEntry = {
            entry: { pid: 11, ppid: 1, name: "node", cmd: `node ${"a".repeat(500)}` },
            source: { cwd: null, launcher: null },
        };

        const line = formatListLine(display);
        expect(line).toContain("…");
        expect(line).not.toContain("a".repeat(200));
    });
});
