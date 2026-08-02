// src/classify.test.ts
import { describe, expect, it } from "vitest";
import { isRealNodeProcess } from "./classify.js";
import type { ProcessEntry } from "./types.js";

describe("isRealNodeProcess", () => {
    it("accepts a real node process on macOS/Linux (path-based check)", () => {
        const entry: ProcessEntry = {
            pid: 1,
            ppid: 0,
            name: "node",
            cmd: "node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp",
            path: "/opt/homebrew/Cellar/node/24.0.0/bin/node",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(true);
    });

    it("rejects an Electron/VSCode helper whose args merely contain the word node", () => {
        const entry: ProcessEntry = {
            pid: 2,
            ppid: 0,
            name: "Code Helper",
            cmd: "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --type=utility --utility-sub-type=node.mojom.NodeService",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(false);
    });

    it("rejects a process whose argv0 basename is node but is packaged inside an Electron app (blocklist)", () => {
        const entry: ProcessEntry = {
            pid: 3,
            ppid: 0,
            name: "node",
            cmd: "/Applications/Foo.app/Contents/Resources/app.asar.unpacked/node script.js",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(false);
    });

    it("accepts a real node process on Windows using the name field (cmd/path unavailable there)", () => {
        const entry: ProcessEntry = { pid: 4, ppid: 0, name: "node.exe" };
        expect(isRealNodeProcess(entry, "win32")).toBe(true);
    });

    it("rejects a non-node process on Windows", () => {
        const entry: ProcessEntry = { pid: 5, ppid: 0, name: "Electron.exe" };
        expect(isRealNodeProcess(entry, "win32")).toBe(false);
    });

    it("accepts a node process when ps-list reports an empty path but a usable cmd", () => {
        const entry: ProcessEntry = {
            pid: 6,
            ppid: 0,
            name: "node",
            cmd: "/usr/local/bin/node server.js",
            path: "",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(true);
    });

    it("falls through to the name when the cmd's argv0 token is broken by a space in the directory", () => {
        const entry: ProcessEntry = {
            pid: 7,
            ppid: 0,
            name: "node",
            cmd: "/Users/rushi/My Tools/node script.js",
            path: "",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(true);
    });

    it("accepts a name-only entry on darwin when neither cmd nor path is available", () => {
        const entry: ProcessEntry = { pid: 8, ppid: 0, name: "node" };
        expect(isRealNodeProcess(entry, "darwin")).toBe(true);
    });

    it("still rejects a node binary shipped inside an Electron bundle when only the name is generic", () => {
        const entry: ProcessEntry = {
            pid: 9,
            ppid: 0,
            name: "node",
            path: "/Applications/Foo.app/Contents/Resources/node",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(false);
    });

    it("accepts a node process whose arguments merely mention an Electron app path", () => {
        const entry: ProcessEntry = {
            pid: 10,
            ppid: 0,
            name: "node",
            cmd: "/opt/homebrew/bin/node mcp-server.js --host /Applications/Cursor.app/Contents/MacOS/Cursor",
            path: "/opt/homebrew/bin/node",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(true);
    });
});
