import os from "node:os";
import path from "node:path";

export const trimHome = (pathStr: string, home: string = os.homedir()): string => {
    if (!home) return pathStr;
    if (pathStr === home) return "~";
    if (pathStr.startsWith(`${home}/`)) return `~${pathStr.slice(home.length)}`;

    return pathStr;
};

const mapTokens = (cmdStr: string, fn: (token: string) => string): string => cmdStr.split(" ").map(fn).join(" ");

export const trimHomeInCommand = (command: string): string => mapTokens(command, (token) => trimHome(token));

// The process's cwd is already shown alongside the command (see formatListLine's PROJECT
// column), so any command token that lives inside that cwd is redundant to spell out in full -
// collapsing it to "." makes clear the process runs from that folder without repeating the path
// twice on the same line.
export const relativizeToCwd = (cmdStr: string, cwd: string | null): string => {
    if (!cwd) return cmdStr;

    return mapTokens(cmdStr, (token) => {
        if (token === cwd) return ".";
        if (token.startsWith(`${cwd}/`)) return `.${token.slice(cwd.length)}`;

        return token;
    });
};

const PNPM_STORE_HASH_PATTERN = /(\.pnpm\/[^/]+?@\d+\.\d+\.\d+(?:-[\w.]+)?)_[^/]+(?=\/)/g;
const BIN_PARENT_TRAVERSAL_PATTERN = /node_modules\/\.bin\/\.\.\//g;

export const collapsePackageStorePath = (pathStr: string): string =>
    pathStr.replace(PNPM_STORE_HASH_PATTERN, "$1").replace(BIN_PARENT_TRAVERSAL_PATTERN, "node_modules/");

const ABSOLUTE_PATH_PATTERN = /^([a-zA-Z]:\\|\/)/;

// A token is "PATH-resolvable" when its directory exactly matches one of the directories on
// $PATH (the same rule the shell itself uses to find a binary by bare name). Collapsing those
// tokens to their basename mirrors what the user would have typed at a prompt.
export const collapsePathBinaries = (
    cmdStr: string,
    pathDirs: string[] = (process.env.PATH ?? "").split(path.delimiter),
): string => {
    const normalizedPathDirs = new Set(pathDirs.map((dir) => path.normalize(dir).replace(/[\\/]+$/, "")));

    return mapTokens(cmdStr, (token) => {
        if (!ABSOLUTE_PATH_PATTERN.test(token)) return token;

        const dir = path.normalize(path.dirname(token)).replace(/[\\/]+$/, "");
        return normalizedPathDirs.has(dir) ? path.basename(token) : token;
    });
};

// Matches a leading "-" or "--" followed by a letter, e.g. "--host", "-v" (a bare negative
// number like "-1" does not match, since digits aren't letters).
const FLAG_TOKEN_PATTERN = /^--?[a-zA-Z]/;

// An "entry point"-looking token is kept even when it directly follows a flag, since it's more
// likely to be the actual script being run (e.g. "--inspect app.js") than that flag's value.
// A bare "." or a "./"-prefixed token also counts: relativizeToCwd (which runs earlier in the
// pipeline) collapses a cwd-matching token down to exactly ".", and without this check that
// token would otherwise look like a droppable flag value here, erasing the entry point entirely.
const ENTRY_POINT_EXTENSION_PATTERN = /\.(js|mjs|cjs|ts)$/;
const looksLikeEntryPoint = (token: string): boolean =>
    ENTRY_POINT_EXTENSION_PATTERN.test(token) || token.includes("/") || token === "." || token.startsWith("./");

// A flag's value (e.g. "3000" following "--port") has no reliable way to be distinguished from
// a positional argument without knowing the specific CLI's argument schema. As a heuristic, the
// token immediately following a stripped flag is also stripped, unless it looks like an entry
// point (ends in .js/.mjs/.cjs/.ts, or contains a "/"); that keeps `--inspect app.js` readable
// while dropping `--port 3000`, `--host 0.0.0.0`, etc.
//
// Known false-negative, accepted as a tradeoff: a boolean flag with no value (e.g. `--silent`)
// still eats the next token even though it isn't that flag's argument (`npm run --silent build`
// loses "build"). Fixing this would require per-CLI knowledge of which flags take values, which
// is out of scope; see the pinned test for this exact case.
export const stripFlags = (cmdStr: string): string => {
    const tokens = cmdStr.split(/\s+/).filter((token) => token.length > 0);
    const kept: string[] = [];

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token === undefined) continue;

        if (!FLAG_TOKEN_PATTERN.test(token)) {
            kept.push(token);
            continue;
        }

        const next = tokens[i + 1];
        const nextIsValue = next !== undefined && !FLAG_TOKEN_PATTERN.test(next) && !looksLikeEntryPoint(next);
        if (nextIsValue) i += 1;
    }

    return kept.join(" ");
};

// Walks `segments` backward starting from `segments.length - 2`, collapsing each non-empty
// segment to its first character, until `fits` is satisfied - shrinking the middle of a path
// while always keeping its last segment intact. `minIndex` also keeps the first segment (index 0)
// untouched when set to 1. Mutates and returns `segments` in place.
const shrinkSegmentsToFit = (segments: string[], fits: (segments: string[]) => boolean, minIndex = 0): string[] => {
    for (let i = segments.length - 2; i >= minIndex; i -= 1) {
        const segment = segments[i];
        if (segment === undefined || segment.length === 0) continue;

        segments[i] = segment[0] as string;
        if (fits(segments)) break;
    }

    return segments;
};

export const truncateProjectPath = (pathStr: string, maxWidth: number): string => {
    if (pathStr.length <= maxWidth) return pathStr;

    const segments = shrinkSegmentsToFit(pathStr.split("/"), (segs) => segs.join("/").length <= maxWidth, 1);

    return segments.join("/");
};

const buildEllipsizedPackagePath = (anchor: string[], tail: string[]): string => `…/${[...anchor, ...tail].join("/")}`;

// The npm/pnpm package that a long command path is actually running is the one thing worth
// keeping legible - everything before it (the project path, already shown in the PROJECT
// column, plus the .pnpm store's hash directories) is pure noise once a package's location is
// known, and collapsing it segment-by-segment into single letters (e.g. "n/./@/n/") reads as
// garbage rather than a meaningful abbreviation. So instead of shrinking that prefix, it's
// dropped entirely behind a single "…". `node_modules/<name>` becomes the anchor - a scoped
// name ("@scope/name") or a `.bin/<name>` shim counts as one two-segment unit - and is never
// touched. Only the (usually short) subpath after the package, if any, still shrinks
// segment-by-segment when needed, the same backward-from-the-end way truncateProjectPath does,
// always keeping its own last segment intact.
export const truncateCommandPath = (pathStr: string, maxWidth: number): string => {
    if (pathStr.length <= maxWidth) return pathStr;

    const segments = pathStr.split("/");
    const lastIndex = segments.length - 1;
    const nodeModulesIndex = segments.lastIndexOf("node_modules");

    if (nodeModulesIndex === -1 || nodeModulesIndex + 1 > lastIndex) {
        return truncateProjectPath(pathStr, maxWidth);
    }

    const afterNodeModules = segments[nodeModulesIndex + 1];
    const packageEnd =
        (afterNodeModules === ".bin" || afterNodeModules?.startsWith("@")) && nodeModulesIndex + 2 <= lastIndex
            ? nodeModulesIndex + 2
            : nodeModulesIndex + 1;

    const anchor = segments.slice(nodeModulesIndex + 1, packageEnd + 1);
    const tail = shrinkSegmentsToFit(
        segments.slice(packageEnd + 1),
        (segs) => buildEllipsizedPackagePath(anchor, segs).length <= maxWidth,
    );

    return buildEllipsizedPackagePath(anchor, tail);
};
