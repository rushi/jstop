import * as clack from "@clack/prompts";
import chalk from "chalk";
import { forceTerminateProcess, terminateProcess } from "./kill.js";
import { collapsePackageStorePath, trimHome } from "./path-trim.js";
import type { SourceInfo } from "./source.js";
import type { ProcessEntry } from "./types.js";

export interface DisplayEntry {
    entry: ProcessEntry;
    source: SourceInfo;
}

const MAX_LIST_COMMAND_LENGTH = 100;

// Command lines can carry raw escape sequences (e.g. from `node -e` inline scripts); rendering
// them unfiltered would let a process repaint the terminal.
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/g;

const KILL_ERROR_MESSAGES: Record<string, string> = {
    EPERM: "permission denied (the process belongs to another user)",
    ESRCH: "the process no longer exists",
};

const describeKillError = (error: unknown): string => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code && KILL_ERROR_MESSAGES[code]) return KILL_ERROR_MESSAGES[code];

    return error instanceof Error ? error.message : String(error);
};

const trimHomeInCommand = (command: string): string =>
    command
        .split(" ")
        .map((token) => trimHome(token))
        .join(" ");

const cleanCommand = (display: DisplayEntry): string => {
    const raw = display.entry.cmd ?? display.entry.name;
    return collapsePackageStorePath(trimHomeInCommand(raw.replace(CONTROL_CHARACTER_PATTERN, " ")));
};

const truncate = (value: string, maxLength: number): string =>
    value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

export const formatListLine = (display: DisplayEntry): string => {
    const location = display.source.cwd ?? display.source.launcher ?? "unknown source";
    const command = truncate(cleanCommand(display), MAX_LIST_COMMAND_LENGTH);

    return `${chalk.dim(`[${display.entry.pid}]`)} ${command}  ${chalk.gray(`(${location})`)}`;
};

const escalate = async (pid: number): Promise<void> => {
    const shouldEscalate = await clack.confirm({
        message: "Process still running. Send SIGKILL?",
        initialValue: false,
    });

    if (clack.isCancel(shouldEscalate) || !shouldEscalate) {
        clack.log.warn(`Left pid ${pid} running.`);
        return;
    }

    try {
        const forced = await forceTerminateProcess(pid);
        if (forced.stillAlive) {
            clack.log.error(`pid ${pid} is still running after SIGKILL.`);
            return;
        }

        clack.log.success(`Killed pid ${pid} with SIGKILL.`);
    } catch (error) {
        clack.log.error(`Could not force-kill pid ${pid}: ${describeKillError(error)}`);
    }
};

const attemptKill = async (pid: number): Promise<void> => {
    try {
        const { stillAlive, canEscalate } = await terminateProcess(pid);

        if (!stillAlive) {
            clack.log.success(`Killed pid ${pid}.`);
            return;
        }

        if (!canEscalate) {
            clack.log.error(`pid ${pid} is still running.`);
            return;
        }

        await escalate(pid);
    } catch (error) {
        clack.log.error(`Could not kill pid ${pid}: ${describeKillError(error)}`);
    }
};

const showDetail = async (display: DisplayEntry): Promise<void> => {
    clack.log.info(
        [
            `pid: ${display.entry.pid}`,
            `ppid: ${display.entry.ppid}`,
            `command: ${cleanCommand(display)}`,
            `cwd: ${display.source.cwd ?? "unknown"}`,
            `launched via: ${display.source.launcher ?? "unknown"}`,
        ].join("\n"),
    );

    const shouldKill = await clack.confirm({ message: "Kill this process?", initialValue: false });
    if (clack.isCancel(shouldKill) || !shouldKill) return;

    await attemptKill(display.entry.pid);
};

export const runInteractiveList = async (entries: DisplayEntry[]): Promise<void> => {
    clack.intro("what-the-node");

    if (entries.length === 0) {
        clack.outro("No node processes found.");
        return;
    }

    for (;;) {
        const selected = await clack.select({
            message: `Found ${entries.length} node process${entries.length === 1 ? "" : "es"}`,
            options: entries.map((display) => ({ value: display.entry.pid, label: formatListLine(display) })),
        });

        if (clack.isCancel(selected)) {
            clack.outro("Bye");
            return;
        }

        const display = entries.find((item) => item.entry.pid === selected);
        if (!display) {
            clack.outro("Bye");
            return;
        }

        await showDetail(display);
    }
};
