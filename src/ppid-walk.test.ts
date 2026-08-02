import { describe, expect, it } from "vitest";
import { findAncestorLauncher } from "./ppid-walk.js";
import type { ProcessEntry } from "./types.js";

const toSnapshot = (entries: ProcessEntry[]): Map<number, ProcessEntry> =>
    new Map(entries.map((entry) => [entry.pid, entry]));

describe("findAncestorLauncher", () => {
    it("skips generic script-runner wrappers and returns the first real ancestor", () => {
        const snapshot = toSnapshot([
            { pid: 100, ppid: 90, name: "node" },
            { pid: 90, ppid: 80, name: "node" },
            { pid: 80, ppid: 70, name: "sh" },
            { pid: 70, ppid: 1, name: "zsh" },
        ]);

        const result = findAncestorLauncher(100, snapshot);
        expect(result).toEqual({ pid: 70, ppid: 1, name: "zsh" });
    });

    it("returns null when every ancestor up to the root is a wrapper", () => {
        const snapshot = toSnapshot([
            { pid: 200, ppid: 190, name: "node" },
            { pid: 190, ppid: 1, name: "npm" },
        ]);

        expect(findAncestorLauncher(200, snapshot)).toBeNull();
    });

    it("returns null when an ancestor pid is missing from the snapshot (orphaned chain)", () => {
        const snapshot = toSnapshot([{ pid: 300, ppid: 290, name: "node" }]);

        expect(findAncestorLauncher(300, snapshot)).toBeNull();
    });

    it("returns null when the starting pid itself isn't in the snapshot", () => {
        const snapshot = toSnapshot([{ pid: 1, ppid: 0, name: "launchd" }]);

        expect(findAncestorLauncher(999, snapshot)).toBeNull();
    });

    it("recognises Windows wrapper names with executable suffixes", () => {
        const snapshot = toSnapshot([
            { pid: 400, ppid: 390, name: "node.exe" },
            { pid: 390, ppid: 380, name: "node.exe" },
            { pid: 380, ppid: 370, name: "npm.cmd" },
            { pid: 370, ppid: 1, name: "cmd.exe" },
        ]);

        expect(findAncestorLauncher(400, snapshot)).toEqual({ pid: 370, ppid: 1, name: "cmd.exe" });
    });

    it("does not infinite-loop on a cyclic ppid chain", () => {
        const snapshot = toSnapshot([
            { pid: 10, ppid: 20, name: "node" },
            { pid: 20, ppid: 10, name: "node" },
        ]);

        expect(findAncestorLauncher(10, snapshot)).toBeNull();
    });
});
