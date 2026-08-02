import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { forceTerminateProcess, isProcessAlive, pickKillStrategy, terminateProcess } from "./kill.js";

describe("pickKillStrategy", () => {
    it("returns single (no escalation) on windows", () => {
        expect(pickKillStrategy("win32")).toBe("single");
    });

    it("returns escalating on macOS and linux", () => {
        expect(pickKillStrategy("darwin")).toBe("escalating");
        expect(pickKillStrategy("linux")).toBe("escalating");
    });
});

describe("isProcessAlive", () => {
    it("returns false for a pid that is very unlikely to exist", () => {
        expect(isProcessAlive(999_999)).toBe(false);
    });
});

describe("terminateProcess", () => {
    it("terminates a real running child process", async () => {
        const child = execa("node", ["-e", "setTimeout(() => {}, 10_000)"]);
        child.catch(() => {
            // Expected: the process is killed below, so the execa promise rejects.
            // Attached immediately so the rejection is never briefly "unhandled".
        });

        // Let the child fully start before checking/killing it.
        await new Promise((resolve) => setTimeout(resolve, 200));

        const pid = child.pid;
        if (!pid) throw new Error("child process has no pid");

        expect(isProcessAlive(pid)).toBe(true);

        const result = await terminateProcess(pid);

        expect(result).toEqual({ stillAlive: false, canEscalate: false });
        expect(isProcessAlive(pid)).toBe(false);
    }, 10_000);

    it.skipIf(process.platform === "win32")(
        "reports a SIGTERM-ignoring child as still alive and escalatable, and force-kills it on request",
        async () => {
            const child = execa("node", ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 10_000)"]);
            child.catch(() => {
                // Expected: the process is force-killed below, so the execa promise rejects.
            });

            await new Promise((resolve) => setTimeout(resolve, 200));

            const pid = child.pid;
            if (!pid) throw new Error("child process has no pid");

            const result = await terminateProcess(pid);
            expect(result).toEqual({ stillAlive: true, canEscalate: true });

            const forced = await forceTerminateProcess(pid);
            expect(forced.stillAlive).toBe(false);
            expect(isProcessAlive(pid)).toBe(false);
        },
        10_000,
    );
});
