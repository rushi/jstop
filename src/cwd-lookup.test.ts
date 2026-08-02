import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
    readlink: vi.fn(),
}));

vi.mock("execa", () => ({
    execa: vi.fn(),
}));

const { readlink } = await import("node:fs/promises");
const { execa } = await import("execa");
const { lookupCwd } = await import("./cwd-lookup.js");

describe("lookupCwd", () => {
    it("returns null immediately on win32 without touching fs or execa", async () => {
        const result = await lookupCwd(1, "win32");
        expect(result).toBeNull();
        expect(readlink).not.toHaveBeenCalled();
        expect(execa).not.toHaveBeenCalled();
    });

    it("reads /proc/<pid>/cwd on linux", async () => {
        vi.mocked(readlink).mockResolvedValueOnce("/home/user/project");
        const result = await lookupCwd(42, "linux");
        expect(result).toBe("/home/user/project");
        expect(readlink).toHaveBeenCalledWith("/proc/42/cwd");
    });

    it("returns null on linux when the /proc read fails", async () => {
        vi.mocked(readlink).mockRejectedValueOnce(new Error("EACCES"));
        const result = await lookupCwd(42, "linux");
        expect(result).toBeNull();
    });

    it("parses the n-prefixed line from lsof -Fn output on darwin", async () => {
        vi.mocked(execa).mockResolvedValueOnce({ stdout: "p42\nfcwd\nn/Users/rushi/project" } as never);
        const result = await lookupCwd(42, "darwin");
        expect(result).toBe("/Users/rushi/project");
        expect(execa).toHaveBeenCalledWith("lsof", ["-a", "-p", "42", "-d", "cwd", "-Fn"]);
    });

    it("returns null on darwin when lsof fails", async () => {
        vi.mocked(execa).mockRejectedValueOnce(new Error("no such process"));
        const result = await lookupCwd(42, "darwin");
        expect(result).toBeNull();
    });
});
