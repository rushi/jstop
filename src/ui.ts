import * as clack from "@clack/prompts";
import chalk from "chalk";
import { detectRuntime, isMcpProcess } from "./classify.js";
import { forceTerminateProcess, terminateProcess } from "./kill.js";
import {
    collapsePackageStorePath,
    collapsePathBinaries,
    relativizeToCwd,
    stripFlags,
    trimHomeInCommand,
    truncateCommandPath,
    truncateProjectPath,
} from "./path-trim.js";
import type { SourceInfo } from "./source.js";
import type { ProcessEntry } from "./types.js";

export interface DisplayEntry {
    entry: ProcessEntry;
    source: SourceInfo;
}

export interface DisplayOptions {
    verbose?: boolean;
    // Plain-mode output is meant to be piped into a file or further processing, so it must never
    // truncate - distinct from `verbose`, which also gates whether flags are stripped.
    noTruncate?: boolean;
}

const MAX_LIST_COMMAND_LENGTH = 100;
// PROJECT scales with the terminal instead of a fixed width so it gets more room on a wide
// terminal without eating into COMMAND's share too much.
const PROJECT_COLUMN_PERCENT = 0.2;
const MIN_PROJECT_WIDTH = 15;
// Used when there's no real terminal to measure (piped/non-TTY output) or the command column
// would otherwise be squeezed unreasonably small on a narrow terminal.
const DEFAULT_TERMINAL_WIDTH = 100;
const MIN_COMMAND_WIDTH = 20;
const COLUMN_GAP_WIDTH = 2;

// Command lines can carry raw escape sequences (e.g. from `node -e` inline scripts); rendering
// them unfiltered would let a process repaint the terminal.
// eslint-disable-next-line no-control-regex -- matching control chars is the point, not a mistake
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/g;

// On macOS, ps-list/ps render an embedded control byte as the literal 4-character sequence
// "\" + 3 octal digits (e.g. "\012" for a newline) rather than the raw byte itself, so
// CONTROL_CHARACTER_PATTERN never sees it. Strip that literal text pattern too, then collapse
// the whitespace it leaves behind.
const OCTAL_ESCAPE_PATTERN = /\\[0-3][0-7]{2}/g;
const MULTIPLE_SPACES_PATTERN = / {2,}/g;

// Chalk's SGR ("Select Graphic Rendition") codes are the only ANSI sequences this codebase ever
// emits (via chalk.dim/chalk.gray/etc.) - stripping just that pattern is enough to recover the
// on-screen width of a colored cell for column alignment purposes.
// eslint-disable-next-line no-control-regex -- matching the ANSI escape byte is the point
const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g;

export const visibleLength = (value: string): number => value.replace(ANSI_SGR_PATTERN, "").length;

export const padVisible = (value: string, width: number): string =>
    value + " ".repeat(Math.max(0, width - visibleLength(value)));

export type Tag = "MCP" | "BUN" | "DENO";

// MCP takes priority over the runtime tag when a process matches both (e.g. a Bun-hosted MCP
// server) - which tool a process is running as matters more here than which runtime hosts it.
export const resolveTag = (entry: ProcessEntry): Tag | null => {
    if (isMcpProcess(entry.cmd ?? entry.name)) return "MCP";

    const runtime = detectRuntime(entry);
    if (runtime === "bun") return "BUN";
    if (runtime === "deno") return "DENO";

    return null;
};

export const formatCommandCell = (
    display: DisplayEntry,
    options: DisplayOptions = {},
    maxLength: number = MAX_LIST_COMMAND_LENGTH,
): string => {
    const cleaned = cleanCommand(display, options);
    const shouldTruncate = !options.verbose && !options.noTruncate;

    return shouldTruncate ? truncateCommandCell(cleaned, maxLength) : cleaned;
};

export interface ColumnWidths {
    pid: number;
    tag: number;
    project: number;
    command: number;
}

const HEADER_LABELS = { pid: "PID", tag: "TAG", project: "PROJECT", command: "COMMAND" } as const;

// COMMAND is the last column, so it's never padded - "command" here is a truncation budget
// (how much room is left for it), not a padding width like pid/tag/project. terminalWidth
// defaults to the real terminal's column count so wide terminals show more of both PROJECT and
// COMMAND instead of wasting the extra space on fixed caps; it falls back to
// DEFAULT_TERMINAL_WIDTH when there's no TTY to measure (piped/non-TTY output).
export const computeColumnWidths = (
    entries: DisplayEntry[],
    terminalWidth: number = process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH,
): ColumnWidths => {
    const pidWidths = entries.map((display) => String(display.entry.pid).length);
    const tagWidths = entries.map((display) => (resolveTag(display.entry) ?? "").length);

    const pid = Math.max(HEADER_LABELS.pid.length, ...pidWidths);
    const tag = Math.max(HEADER_LABELS.tag.length, ...tagWidths);
    const project = Math.max(MIN_PROJECT_WIDTH, Math.round(terminalWidth * PROJECT_COLUMN_PERCENT));
    const reservedWidth = pid + COLUMN_GAP_WIDTH + tag + COLUMN_GAP_WIDTH + project + COLUMN_GAP_WIDTH;

    return {
        pid,
        tag,
        project,
        command: Math.max(MIN_COMMAND_WIDTH, terminalWidth - reservedWidth),
    };
};

export const formatHeaderRow = (widths: ColumnWidths): string =>
    `${HEADER_LABELS.pid.padEnd(widths.pid)}  ${HEADER_LABELS.tag.padEnd(widths.tag)}  ${HEADER_LABELS.project.padEnd(widths.project)}  ${HEADER_LABELS.command}`;

const locationOf = (display: DisplayEntry, fallback = "unknown source"): string =>
    display.source.cwd ?? display.source.launcher ?? fallback;

export const groupByProject = (entries: DisplayEntry[]): DisplayEntry[][] => {
    const order: string[] = [];
    const clusters = new Map<string, DisplayEntry[]>();

    for (const display of entries) {
        // An entry with neither cwd nor launcher has nothing identifying it as sharing a project
        // with any other such entry, so it's keyed by its own (always-unique) pid instead of a
        // shared "unknown source" literal - otherwise unrelated processes would wrongly cluster.
        const key = locationOf(display, `unknown:${display.entry.pid}`);
        const cluster = clusters.get(key);

        if (cluster) {
            cluster.push(display);
        } else {
            clusters.set(key, [display]);
            order.push(key);
        }
    }

    return order.map((key) => clusters.get(key) as DisplayEntry[]);
};

// Matches the same command text shown in the COMMAND column (untruncated, flags included so a
// keyword like a port number or subcommand still hits) plus the PROJECT column's cwd/launcher -
// the two columns a user visually scans to recognize a process.
export const matchesKeyword = (display: DisplayEntry, keyword: string): boolean => {
    const needle = keyword.toLowerCase();
    const command = cleanCommand(display, { verbose: true }).toLowerCase();
    const location = locationOf(display, "").toLowerCase();

    return command.includes(needle) || location.includes(needle);
};

export const filterEntries = (entries: DisplayEntry[], keyword: string | undefined): DisplayEntry[] => {
    const trimmed = keyword?.trim();
    if (!trimmed) return entries;

    return entries.filter((display) => matchesKeyword(display, trimmed));
};

// A process whose parent is itself in the list is almost always a wrapper/launcher for the
// entry that actually matters (e.g. a shell script's node child, or a watcher's respawned
// worker) - the parent is enough to identify and act on that project's process, so the child
// is redundant noise by default.
// A pid can never equal its own ppid on a real OS, but test fixtures elsewhere in this file use
// ppid as an unused filler value that happens to match pid - guarding against that keeps such an
// entry from being wrongly treated as its own child/parent.
const isOwnChild = (display: DisplayEntry): boolean => display.entry.ppid === display.entry.pid;

export const hideChildProcesses = (entries: DisplayEntry[]): DisplayEntry[] => {
    const pids = new Set(entries.map((display) => display.entry.pid));

    return entries.filter((display) => isOwnChild(display) || !pids.has(display.entry.ppid));
};

export interface NestedEntry {
    display: DisplayEntry;
    depth: number;
    parent: DisplayEntry | null;
}

// Moves each child (an entry whose ppid matches another listed entry's pid) to directly follow
// its parent, indented one level deeper - so --all's output reads as a tree instead of the
// child appearing as an unrelated row wherever it happened to fall in process-list order.
// Entries with no in-list parent ("roots") keep their relative order (e.g. groupByProject's
// cluster order); a root with no children in the list is unaffected (depth 0, same position).
export const nestChildren = (entries: DisplayEntry[]): NestedEntry[] => {
    const pids = new Set(entries.map((display) => display.entry.pid));
    const childrenByPpid = new Map<number, DisplayEntry[]>();
    const roots: DisplayEntry[] = [];

    for (const display of entries) {
        if (isOwnChild(display) || !pids.has(display.entry.ppid)) {
            roots.push(display);
            continue;
        }

        const siblings = childrenByPpid.get(display.entry.ppid);
        if (siblings) {
            siblings.push(display);
        } else {
            childrenByPpid.set(display.entry.ppid, [display]);
        }
    }

    const result: NestedEntry[] = [];
    const visit = (display: DisplayEntry, depth: number, parent: DisplayEntry | null): void => {
        result.push({ display, depth, parent });
        for (const child of childrenByPpid.get(display.entry.pid) ?? []) visit(child, depth + 1, display);
    };

    for (const root of roots) visit(root, 0, null);

    return result;
};

const KILL_ERROR_MESSAGES: Record<string, string> = {
    EPERM: "permission denied (the process belongs to another user)",
    ESRCH: "the process no longer exists",
};

const describeKillError = (error: unknown): string => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code && KILL_ERROR_MESSAGES[code]) return KILL_ERROR_MESSAGES[code];

    return error instanceof Error ? error.message : String(error);
};

const cleanCommand = (display: DisplayEntry, options: DisplayOptions = {}): string => {
    const raw = display.entry.cmd ?? display.entry.name;
    const stripped = raw.replace(CONTROL_CHARACTER_PATTERN, " ").replace(OCTAL_ESCAPE_PATTERN, " ").trim();

    // collapsePathBinaries must run on the still-absolute (untrimmed) path: its match pattern
    // requires a leading "/" or drive letter, so running it after trimHome would leave any
    // PATH directory under $HOME (fnm/nvm/volta shims, ~/.bun/bin, ~/.local/bin, ...) uncollapsed.
    const collapsedBinaries = collapsePathBinaries(stripped);
    const collapsedStore = collapsePackageStorePath(collapsedBinaries);
    const trimmed = trimHomeInCommand(collapsedStore);
    // relativizeToCwd must run after trimHomeInCommand: SourceInfo.cwd is already ~-trimmed (see
    // resolveSource), so the command needs to be ~-trimmed too before the two can be compared.
    const relativized = relativizeToCwd(trimmed, display.source.cwd);
    const flagsHandled = options.verbose ? relativized : stripFlags(relativized);

    return flagsHandled.replace(MULTIPLE_SPACES_PATTERN, " ").trim();
};

const truncate = (value: string, maxLength: number): string =>
    value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

// A long command is almost always one long path token (a node_modules/.pnpm-nested binary)
// alongside a few short flags/args - right-truncating the whole string cuts off exactly the
// informative tail (the actual package/binary name) while keeping the boring shared prefix.
// Middle-collapsing just the longest token with truncateCommandPath keeps the package name
// (node_modules/<name>) legible - falling back to plain right-truncation only if even that
// still doesn't fit (e.g. a single unsplittable segment with no node_modules in it at all).
const truncateCommandCell = (cmdStr: string, maxLength: number): string => {
    if (cmdStr.length <= maxLength) return cmdStr;

    const tokens = cmdStr.split(" ");
    const longestIndex = tokens.reduce(
        (maxIdx, token, idx) => (token.length > (tokens[maxIdx] ?? "").length ? idx : maxIdx),
        0,
    );
    const longestToken = tokens[longestIndex] as string;
    const budget = maxLength - (cmdStr.length - longestToken.length);

    if (budget > 0 && budget < longestToken.length) {
        tokens[longestIndex] = truncateCommandPath(longestToken, budget);
    }

    const collapsed = tokens.join(" ");
    return collapsed.length > maxLength ? truncate(collapsed, maxLength) : collapsed;
};

const colorizeTag = (tag: Tag | null): string => {
    if (tag === "MCP") return chalk.magenta("MCP");
    if (tag === "BUN") return chalk.yellow("BUN");
    if (tag === "DENO") return chalk.cyan("DENO");

    return "";
};

// depth > 0 means this entry's parent process is also in the list (only possible under --all,
// since hideChildProcesses drops these by default) - a tree connector makes that relationship
// visible instead of the child just looking like an unrelated sibling row.
const indentCommand = (commandCell: string, depth: number): string =>
    depth > 0 ? `${"  ".repeat(depth - 1)}${chalk.dim("└─")} ${commandCell}` : commandCell;

export const formatListLine = (
    display: DisplayEntry,
    widths: ColumnWidths,
    options: DisplayOptions = {},
    depth = 0,
    parent: DisplayEntry | null = null,
): string => {
    const location = locationOf(display);
    const tag = resolveTag(display.entry);
    // A child sharing its parent's tag/project (the common case - inherited from the same
    // launch) repeats information the parent row directly above it already shows, so it's
    // blanked out here to keep the eye on what's actually different: the child's own command.
    const sameAsParent = depth > 0 && parent !== null;
    const showTag = !(sameAsParent && tag === resolveTag(parent.entry));
    const showProject = !(sameAsParent && location === locationOf(parent));

    const pidCell = padVisible(chalk.dim(String(display.entry.pid)), widths.pid);
    const tagCell = padVisible(showTag ? colorizeTag(tag) : "", widths.tag);
    const projectCell = padVisible(
        showProject ? chalk.gray(truncateProjectPath(location, widths.project)) : "",
        widths.project,
    );
    const commandCell = indentCommand(formatCommandCell(display, options, widths.command), depth);

    return `${pidCell}  ${tagCell}  ${projectCell}  ${commandCell}`;
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

const showDetail = async (display: DisplayEntry, options: DisplayOptions = {}): Promise<void> => {
    clack.log.info(
        [
            `pid: ${display.entry.pid}`,
            `ppid: ${display.entry.ppid}`,
            `command: ${cleanCommand(display, options)}`,
            `cwd: ${display.source.cwd ?? "unknown"}`,
            `launched via: ${display.source.launcher ?? "unknown"}`,
        ].join("\n"),
    );

    const shouldKill = await clack.confirm({ message: "Kill this process?", initialValue: false });
    if (clack.isCancel(shouldKill) || !shouldKill) return;

    await attemptKill(display.entry.pid);
};

export const runInteractiveList = async (entries: DisplayEntry[], options: DisplayOptions = {}): Promise<void> => {
    clack.intro("what-the-node");

    if (entries.length === 0) {
        clack.outro("No processes found.");
        return;
    }

    const orderedEntries = groupByProject(entries).flat();
    const nestedEntries = nestChildren(orderedEntries);
    const widths = computeColumnWidths(orderedEntries);
    // nestedEntries/widths never change across loop iterations (no filter/resize happens between
    // process detail views), so the option list is built once rather than reformatted every time
    // the user returns from showDetail.
    const autocompleteOptions = nestedEntries.map(({ display, depth, parent }) => ({
        value: display.entry.pid,
        label: formatListLine(display, widths, options, depth, parent),
    }));

    for (;;) {
        // autocomplete (rather than select) gives a built-in "type to filter" search box, so a
        // long process list can be narrowed live without any custom keypress handling.
        const selected = await clack.autocomplete({
            // Each option row is prefixed with a bar + 2 spaces + a radio glyph + a space (5 chars)
            // before its label. Unlike select() (which re-prefixes every message line with the bar
            // via wrapTextWithPrefix), autocomplete's message is interpolated raw - a continuation
            // line gets none of that prefix from clack - so all 5 characters have to be reproduced
            // here as literal spaces for the header's column labels to line up with the rows below.
            message: `Found ${entries.length} process${entries.length === 1 ? "" : "es"}\n     ${formatHeaderRow(widths)}`,
            placeholder: "Type to filter…",
            options: autocompleteOptions,
        });

        if (clack.isCancel(selected)) {
            clack.outro("Bye");
            return;
        }

        const display = orderedEntries.find((item) => item.entry.pid === selected);
        if (!display) {
            clack.outro("Bye");
            return;
        }

        await showDetail(display, options);
    }
};

export const printPlainList = (entries: DisplayEntry[], options: DisplayOptions = {}): void => {
    if (entries.length === 0) {
        console.log("No processes found.");
        return;
    }

    // Plain mode always renders untruncated rows (see the noTruncate: true below), so widths must
    // be computed with the same option or long commands overflow their padded cell and drag every
    // row after them out of alignment with the PROJECT column.
    const renderOptions: DisplayOptions = { ...options, noTruncate: true };
    const clusters = groupByProject(entries);
    const widths = computeColumnWidths(entries);
    console.log(formatHeaderRow(widths));

    clusters.forEach((cluster, index) => {
        if (index > 0) console.log("");

        for (const { display, depth, parent } of nestChildren(cluster)) {
            console.log(formatListLine(display, widths, renderOptions, depth, parent));
        }
    });
};
