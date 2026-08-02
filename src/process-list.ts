import psList from "ps-list";
import type { ProcessEntry } from "./types.js";

interface RawProcessEntry {
    pid: number;
    ppid: number;
    name: string;
    cmd?: string;
    path?: string;
    startTime?: Date;
}

export const normalizeProcessEntries = (raw: RawProcessEntry[]): ProcessEntry[] =>
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
