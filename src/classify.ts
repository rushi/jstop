import type { ProcessEntry } from "./types.js";

const BLOCKLIST_MARKERS = [".app/Contents", "Electron", "Helper", "app.asar"];

const basename = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

// ps-list reports an empty string (not undefined) when its best-effort path extraction fails,
// and a cmd whose binary lives in a directory with spaces splits into a bogus argv0 token.
// So try every candidate and keep the first whose basename actually looks like the node binary.
const pickBinaryCandidate = (entry: ProcessEntry, expectedName: string): string | null => {
    const candidates = [entry.path, entry.cmd?.split(" ")[0], entry.name];

    return candidates.find((candidate) => !!candidate && basename(candidate).toLowerCase() === expectedName) ?? null;
};

export const isRealNodeProcess = (entry: ProcessEntry, platform: NodeJS.Platform = process.platform): boolean => {
    const expectedName = platform === "win32" ? "node.exe" : "node";
    const binary = pickBinaryCandidate(entry, expectedName);

    if (!binary) return false;

    // Only the binary and the process name are checked: arguments legitimately mention Electron app
    // paths (an MCP server launched by an Electron editor passes that editor's path through).
    const haystack = `${binary} ${entry.name}`;
    return !BLOCKLIST_MARKERS.some((marker) => haystack.includes(marker));
};
