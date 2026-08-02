import os from "node:os";

export const trimHome = (pathStr: string, home: string = os.homedir()): string => {
    if (!home) return pathStr;
    if (pathStr === home) return "~";
    if (pathStr.startsWith(`${home}/`)) return `~${pathStr.slice(home.length)}`;

    return pathStr;
};

const PNPM_STORE_HASH_PATTERN = /(\.pnpm\/[^/]+?@\d+\.\d+\.\d+(?:-[\w.]+)?)_[^/]+(?=\/)/g;
const BIN_PARENT_TRAVERSAL_PATTERN = /node_modules\/\.bin\/\.\.\//g;

export const collapsePackageStorePath = (pathStr: string): string =>
    pathStr.replace(PNPM_STORE_HASH_PATTERN, "$1").replace(BIN_PARENT_TRAVERSAL_PATTERN, "node_modules/");
