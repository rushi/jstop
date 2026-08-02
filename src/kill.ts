export type KillStrategy = "single" | "escalating";

export interface TerminateResult {
    stillAlive: boolean;
    canEscalate: boolean;
}

const TERMINATION_GRACE_MS = 500;
const FORCE_GRACE_MS = 200;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const pickKillStrategy = (platform: NodeJS.Platform = process.platform): KillStrategy =>
    platform === "win32" ? "single" : "escalating";

export const isProcessAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

// Sends SIGTERM only. Escalation to SIGKILL is a user decision, so this reports whether the
// process survived instead of force-killing behind the user's back.
export const terminateProcess = async (
    pid: number,
    platform: NodeJS.Platform = process.platform,
): Promise<TerminateResult> => {
    process.kill(pid, "SIGTERM");
    await wait(TERMINATION_GRACE_MS);

    const stillAlive = isProcessAlive(pid);
    return { stillAlive, canEscalate: stillAlive && pickKillStrategy(platform) === "escalating" };
};

export const forceTerminateProcess = async (pid: number): Promise<TerminateResult> => {
    process.kill(pid, "SIGKILL");
    await wait(FORCE_GRACE_MS);

    return { stillAlive: isProcessAlive(pid), canEscalate: false };
};
