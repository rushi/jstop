export interface ProcessEntry {
    pid: number;
    ppid: number;
    name: string;
    cmd?: string;
    path?: string;
    startTime?: Date;
}
