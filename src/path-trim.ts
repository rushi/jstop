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

// The cwd is already shown in the PROJECT column, so a command token living inside it is
// redundant to spell out in full; collapsed to "." to avoid repeating the path on the same line.
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

// A token is "PATH-resolvable" when its directory matches a $PATH entry exactly (the same rule
// the shell uses); collapsing it to basename mirrors what the user would have typed.
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

// An "entry point"-looking token is kept even right after a flag (e.g. "--inspect app.js"),
// since it's more likely the script being run than that flag's value. A bare "." also counts,
// since relativizeToCwd (earlier in the pipeline) collapses a cwd-matching token to exactly ".".
const ENTRY_POINT_EXTENSION_PATTERN = /\.(js|mjs|cjs|ts)$/;
const looksLikeEntryPoint = (token: string): boolean =>
    ENTRY_POINT_EXTENSION_PATTERN.test(token) || token.includes("/") || token === "." || token.startsWith("./");

// A flag's value can't be reliably distinguished from a positional argument without per-CLI
// schema knowledge, so the token after a stripped flag is also stripped unless it looks like an
// entry point - that keeps `--inspect app.js` readable while dropping `--port 3000`.
//
// Accepted false-negative: a boolean flag with no value (e.g. `--silent`) still eats the next
// token (`npm run --silent build` loses "build"); see the pinned test for this exact case.
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

// Collapses segments to their first character from the back (keeping the last segment intact)
// until `fits` is satisfied. `minIndex` can also protect the first segment. Mutates in place.
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

// The package under node_modules is the one thing worth keeping legible; everything before it
// (project path, .pnpm hash dirs) is dropped behind a single "…" instead of collapsed
// segment-by-segment, which would read as garbage (e.g. "n/./@/n/"). The package name itself
// (`node_modules/<name>`, or `@scope/name` / `.bin/<name>` as one unit) is never touched; only
// the subpath after it shrinks further if still needed.
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
