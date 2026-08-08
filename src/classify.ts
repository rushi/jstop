import type { ProcessEntry } from "./types.js";

const BLOCKLIST_MARKERS = [".app/Contents", "Electron", "Helper", "app.asar"];

// node, bun, and deno are the JS/TS runtimes this tool cares about; all three commonly host
// MCP servers and other long-running scripts a developer would want to find and inspect.
const EXPECTED_RUNTIME_NAMES = ["node", "bun", "deno"];

const basename = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Stops at the first whitespace-bounded match instead of scanning the whole cmd, so a real
// node process whose *arguments* happen to mention an Electron path (e.g. --host <path>) isn't
// wrongly rejected.
const extractCmdBinaryPrefix = (cmd: string, expectedNames: string[]): string => {
    const alternation = expectedNames.map(escapeRegExp).join("|");
    const match = new RegExp(`^.*?(?:${alternation})(?=\\s|$)`, "i").exec(cmd);

    return match ? match[0] : cmd;
};

const expectedNamesFor = (platform: NodeJS.Platform): string[] =>
    platform === "win32" ? EXPECTED_RUNTIME_NAMES.map((name) => `${name}.exe`) : EXPECTED_RUNTIME_NAMES;

// entry.path can be empty and entry.name can be a bogus argv0 token (e.g. "Application" from a
// path with spaces, like fnm's "~/Library/Application Support/fnm/..."), so cmd is scanned via
// extractCmdBinaryPrefix as a fallback that finds the runtime name regardless of spaces.
const pickBinaryCandidate = (entry: ProcessEntry, expectedNames: string[]): string | null => {
    const candidates = [entry.path, entry.cmd ? extractCmdBinaryPrefix(entry.cmd, expectedNames) : null, entry.name];

    return (
        candidates.find((candidate) => !!candidate && expectedNames.includes(basename(candidate).toLowerCase())) ?? null
    );
};

export type Runtime = "node" | "bun" | "deno";

const runtimeFromBinary = (binary: string | null, expectedNames: string[]): Runtime | null => {
    if (!binary) return null;

    const matchedIndex = expectedNames.indexOf(basename(binary).toLowerCase());
    return matchedIndex === -1 ? null : (EXPECTED_RUNTIME_NAMES[matchedIndex] as Runtime);
};

// Surfaces which runtime matched instead of collapsing to a boolean, since the UI tags bun/deno
// distinctly from the default node case.
export const detectRuntime = (entry: ProcessEntry, platform: NodeJS.Platform = process.platform): Runtime | null => {
    const expectedNames = expectedNamesFor(platform);
    return runtimeFromBinary(pickBinaryCandidate(entry, expectedNames), expectedNames);
};

const isBlocklisted = (entry: ProcessEntry, binary: string | null, expectedNames: string[]): boolean => {
    const cmdBinaryPrefix = entry.cmd ? extractCmdBinaryPrefix(entry.cmd, expectedNames) : "";

    // Scans binary, name, path, and cmd prefix together (not just the candidate that matched
    // above) so an Electron-packaged node binary can't slip through via a space-mangled argv0.
    const haystack = `${binary ?? ""} ${entry.name} ${entry.path ?? ""} ${cmdBinaryPrefix}`;
    return BLOCKLIST_MARKERS.some((marker) => haystack.includes(marker));
};

export const isRealNodeProcess = (entry: ProcessEntry, platform: NodeJS.Platform = process.platform): boolean => {
    const expectedNames = expectedNamesFor(platform);
    const binary = pickBinaryCandidate(entry, expectedNames);

    return runtimeFromBinary(binary, expectedNames) !== null && !isBlocklisted(entry, binary, expectedNames);
};

// Whole-word match on "mcp" (not substring), so "somemcpthing" isn't flagged. Uses an explicit
// [^a-z0-9] boundary instead of \b, since \b treats "_" as a word char and would miss "mcp_server.js".
const MCP_WORD_PATTERN = /(?:^|[^a-z0-9])mcp(?:$|[^a-z0-9])/i;

export const isMcpProcess = (cmd?: string): boolean => !!cmd && MCP_WORD_PATTERN.test(cmd);
