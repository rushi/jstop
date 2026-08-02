import { describe, expect, it } from "vitest";
import { resolveSource } from "./source.js";
import type { ProcessEntry } from "./types.js";

const toSnapshot = (entries: ProcessEntry[]): Map<number, ProcessEntry> =>
    new Map(entries.map((entry) => [entry.pid, entry]));

describe("resolveSource", () => {
    it("returns the cwd (trimmed) and the launcher label when both are found", async () => {
        const target: ProcessEntry = { pid: 100, ppid: 90, name: "node" };
        const snapshot = toSnapshot([target, { pid: 90, ppid: 80, name: "node" }, { pid: 80, ppid: 1, name: "zsh" }]);

        const result = await resolveSource(target, snapshot, {
            lookupCwd: async () => "/tmp/project",
        });

        expect(result).toEqual({ cwd: "/tmp/project", launcher: "zsh (pid 80)" });
    });

    it("returns null cwd when the lookup fails, and still resolves the launcher", async () => {
        const target: ProcessEntry = { pid: 200, ppid: 190, name: "node" };
        const snapshot = toSnapshot([target, { pid: 190, ppid: 1, name: "bash" }]);

        const result = await resolveSource(target, snapshot, { lookupCwd: async () => null });

        expect(result).toEqual({ cwd: null, launcher: "bash (pid 190)" });
    });

    it("returns null launcher when no recognizable ancestor is found", async () => {
        const target: ProcessEntry = { pid: 300, ppid: 290, name: "node" };
        const snapshot = toSnapshot([target, { pid: 290, ppid: 1, name: "npm" }]);

        const result = await resolveSource(target, snapshot, { lookupCwd: async () => "/tmp/x" });

        expect(result).toEqual({ cwd: "/tmp/x", launcher: null });
    });
});
