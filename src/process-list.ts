import psList from "ps-list";
import type { ProcessDescriptor } from "ps-list";
import type { ProcessEntry } from "./types.js";

export const normalizeProcessEntries = (raw: ProcessDescriptor[]): ProcessEntry[] =>
    raw.map((proc) => ({
        pid: proc.pid,
        ppid: proc.ppid,
        name: proc.name,
        cmd: proc.cmd,
        path: proc.path,
        startTime: proc.startTime,
    }));

export const getProcessSnapshot = async (): Promise<ProcessEntry[]> => {
    const raw = await psList();
    return normalizeProcessEntries(raw);
};
