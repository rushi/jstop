import type { ProcessEntry } from "./types.js";

const WRAPPER_NAMES = new Set(["node", "npm", "npx", "pnpm", "pnpx", "sh"]);

const EXECUTABLE_SUFFIX_PATTERN = /\.(exe|cmd|bat)$/;

// Windows reports names like "node.exe" and "npm.cmd" for the same wrappers POSIX calls "node"/"npm".
const isWrapperName = (name: string): boolean =>
    WRAPPER_NAMES.has(name.toLowerCase().replace(EXECUTABLE_SUFFIX_PATTERN, ""));

export const findAncestorLauncher = (pid: number, snapshot: Map<number, ProcessEntry>): ProcessEntry | null => {
    const start = snapshot.get(pid);
    if (!start) {
        return null;
    }

    const visited = new Set<number>([pid]);
    let currentPpid = start.ppid;

    while (currentPpid && !visited.has(currentPpid)) {
        const ancestor = snapshot.get(currentPpid);
        if (!ancestor) {
            return null;
        }
        if (!isWrapperName(ancestor.name)) {
            return ancestor;
        }

        visited.add(currentPpid);
        currentPpid = ancestor.ppid;
    }

    return null;
};
