import { describe, expect, it } from "vitest";
import { normalizeProcessEntries } from "./process-list.js";

describe("normalizeProcessEntries", () => {
    it("maps raw ps-list entries (macOS/Linux shape) to ProcessEntry", () => {
        const raw = [
            {
                pid: 123,
                ppid: 1,
                name: "node",
                cmd: "node script.js",
                path: "/usr/local/bin/node",
                cpu: 0.1,
                memory: 1.5,
                uid: 501,
                startTime: new Date("2026-01-01T00:00:00.000Z"),
            },
        ];

        expect(normalizeProcessEntries(raw)).toEqual([
            {
                pid: 123,
                ppid: 1,
                name: "node",
                cmd: "node script.js",
                path: "/usr/local/bin/node",
                startTime: new Date("2026-01-01T00:00:00.000Z"),
            },
        ]);
    });

    it("maps raw ps-list entries with Windows shape (no cmd/path/startTime) to ProcessEntry", () => {
        const raw = [{ pid: 456, ppid: 1, name: "node.exe" }];

        expect(normalizeProcessEntries(raw)).toEqual([
            { pid: 456, ppid: 1, name: "node.exe", cmd: undefined, path: undefined, startTime: undefined },
        ]);
    });
});
