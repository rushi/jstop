import { lookupCwd } from "./cwd-lookup.js";
import { trimHome } from "./path-trim.js";
import { findAncestorLauncher } from "./ppid-walk.js";
import type { ProcessEntry } from "./types.js";

export interface SourceInfo {
    cwd: string | null;
    launcher: string | null;
}

interface ResolveSourceDeps {
    lookupCwd: typeof lookupCwd;
}

export const resolveSource = async (
    entry: ProcessEntry,
    snapshot: Map<number, ProcessEntry>,
    deps: ResolveSourceDeps = { lookupCwd },
): Promise<SourceInfo> => {
    const cwd = await deps.lookupCwd(entry.pid);
    const ancestor = findAncestorLauncher(entry.pid, snapshot);

    return {
        cwd: cwd ? trimHome(cwd) : null,
        launcher: ancestor ? `${ancestor.name} (pid ${ancestor.pid})` : null,
    };
};
