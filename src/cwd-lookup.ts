import { readlink } from "node:fs/promises";
import { execa } from "execa";

export const lookupCwd = async (pid: number, platform: NodeJS.Platform = process.platform): Promise<string | null> => {
    if (platform === "win32") return null;

    if (platform === "linux") {
        try {
            return await readlink(`/proc/${pid}/cwd`);
        } catch {
            return null;
        }
    }

    try {
        const { stdout } = await execa("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
        const cwdLine = stdout.split("\n").find((line) => line.startsWith("n"));
        return cwdLine ? cwdLine.slice(1) : null;
    } catch {
        return null;
    }
};
