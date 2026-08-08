import type { ProcessEntry } from "./types.js";

const BLOCKLIST_MARKERS = [".app/Contents", "Electron", "Helper", "app.asar"];

// node, bun, and deno are the JS/TS runtimes this tool cares about; all three commonly host
// MCP servers and other long-running scripts a developer would want to find and inspect.
const EXPECTED_RUNTIME_NAMES = ["node", "bun", "deno"];

const basename = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Cutting the raw cmd at the first whitespace-bounded occurrence of the expected binary name
// (rather than scanning the entire cmd, arguments included) keeps legitimate cases working: a
// real node process whose *arguments* happen to mention an Electron app's path (e.g. an MCP
// server passed its caller's path via --host) must not be rejected just because that path shows
// up later in the string.
const extractCmdBinaryPrefix = (cmd: string, expectedNames: string[]): string => {
    const alternation = expectedNames.map(escapeRegExp).join("|");
    const match = new RegExp(`^.*?(?:${alternation})(?=\\s|$)`, "i").exec(cmd);

    return match ? match[0] : cmd;
};

const expectedNamesFor = (platform: NodeJS.Platform): string[] =>
    platform === "win32" ? EXPECTED_RUNTIME_NAMES.map((name) => `${name}.exe`) : EXPECTED_RUNTIME_NAMES;

// ps-list reports an empty string (not undefined) when its best-effort path extraction fails,
// and naively splitting cmd on the first space truncates a binary path that lives in a directory
// with spaces (e.g. fnm installs under "~/Library/Application Support/fnm/...") into a bogus
// argv0 token - "Application", not "node". entry.name inherits that same bogus token from
// ps-list, so it's not a safe fallback either. Scanning the full cmd string for the runtime name
// via extractCmdBinaryPrefix (the same logic the blocklist already relies on) finds "node" no
// matter how many spaces precede it in the path.
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

// Runs the same candidate-resolution/basename-matching logic isRealNodeProcess always relied on,
// but surfaces which specific runtime matched instead of collapsing all three down to a boolean
// - the UI wants to tag bun/deno processes distinctly from the (default, uncalled-out) node case.
export const detectRuntime = (entry: ProcessEntry, platform: NodeJS.Platform = process.platform): Runtime | null => {
    const expectedNames = expectedNamesFor(platform);
    return runtimeFromBinary(pickBinaryCandidate(entry, expectedNames), expectedNames);
};

const isBlocklisted = (entry: ProcessEntry, binary: string | null, expectedNames: string[]): boolean => {
    const cmdBinaryPrefix = entry.cmd ? extractCmdBinaryPrefix(entry.cmd, expectedNames) : "";

    // The blocklist always scans the resolved binary, the process name, the raw path, and the
    // cmd's binary-path prefix - independent of which candidate matched above - so an Electron-
    // packaged node binary can't slip through just because its argv0 token was mangled by a space.
    const haystack = `${binary ?? ""} ${entry.name} ${entry.path ?? ""} ${cmdBinaryPrefix}`;
    return BLOCKLIST_MARKERS.some((marker) => haystack.includes(marker));
};

export const isRealNodeProcess = (entry: ProcessEntry, platform: NodeJS.Platform = process.platform): boolean => {
    const expectedNames = expectedNamesFor(platform);
    const binary = pickBinaryCandidate(entry, expectedNames);

    return runtimeFromBinary(binary, expectedNames) !== null && !isBlocklisted(entry, binary, expectedNames);
};

// A whole-word, case-insensitive match on "mcp" - not a substring match - so a real MCP server
// invocation (a bare "mcp" argument, e.g. `pnpx @foo/expect-cli mcp`) is flagged while incidental
// substrings like "mcpfoo" or "somemcpthing" are not. `_` is a \w character, so a plain \b would
// not fire between "mcp" and "_" and would miss snake_case names like "mcp_server.js" - the
// explicit [^a-z0-9] boundary treats underscores and hyphens as delimiters too.
const MCP_WORD_PATTERN = /(?:^|[^a-z0-9])mcp(?:$|[^a-z0-9])/i;

export const isMcpProcess = (cmd?: string): boolean => !!cmd && MCP_WORD_PATTERN.test(cmd);
