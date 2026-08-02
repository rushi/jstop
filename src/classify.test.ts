// src/classify.test.ts
import { describe, expect, it } from "vitest";
import { detectRuntime, isMcpProcess, isRealNodeProcess } from "./classify.js";
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

    it("rejects an Electron-bundled node when the argv0 split is broken by a space in an app-bundle path (N1)", () => {
        const entry: ProcessEntry = {
            pid: 11,
            ppid: 0,
            name: "node",
            cmd: "/Applications/Visual Studio Code.app/Contents/Resources/app/node ext.js",
            path: "",
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

    it("accepts a real bun process", () => {
        const entry: ProcessEntry = {
            pid: 12,
            ppid: 0,
            name: "bun",
            cmd: "bun run server.ts",
            path: "/usr/local/bin/bun",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(true);
    });

    it("accepts a real deno process", () => {
        const entry: ProcessEntry = {
            pid: 13,
            ppid: 0,
            name: "deno",
            cmd: "deno run --allow-net server.ts",
            path: "/usr/local/bin/deno",
        };
        expect(isRealNodeProcess(entry, "darwin")).toBe(true);
    });

    it("accepts a real bun process on Windows using the name field", () => {
        const entry: ProcessEntry = { pid: 14, ppid: 0, name: "bun.exe" };
        expect(isRealNodeProcess(entry, "win32")).toBe(true);
    });
});

describe("detectRuntime", () => {
    it("returns 'node' for a real node process", () => {
        const entry: ProcessEntry = {
            pid: 20,
            ppid: 0,
            name: "node",
            cmd: "node script.js",
            path: "/opt/homebrew/bin/node",
        };
        expect(detectRuntime(entry, "darwin")).toBe("node");
    });

    it("returns 'bun' for a real bun process", () => {
        const entry: ProcessEntry = {
            pid: 21,
            ppid: 0,
            name: "bun",
            cmd: "bun run server.ts",
            path: "/usr/local/bin/bun",
        };
        expect(detectRuntime(entry, "darwin")).toBe("bun");
    });

    it("returns 'deno' for a real deno process", () => {
        const entry: ProcessEntry = {
            pid: 22,
            ppid: 0,
            name: "deno",
            cmd: "deno run --allow-net server.ts",
            path: "/usr/local/bin/deno",
        };
        expect(detectRuntime(entry, "darwin")).toBe("deno");
    });

    it("returns null for a non-runtime entry", () => {
        const entry: ProcessEntry = { pid: 23, ppid: 0, name: "Electron.exe" };
        expect(detectRuntime(entry, "win32")).toBeNull();
    });

    it("returns the matching runtime for Windows .exe variants", () => {
        expect(detectRuntime({ pid: 24, ppid: 0, name: "node.exe" }, "win32")).toBe("node");
        expect(detectRuntime({ pid: 25, ppid: 0, name: "bun.exe" }, "win32")).toBe("bun");
        expect(detectRuntime({ pid: 26, ppid: 0, name: "deno.exe" }, "win32")).toBe("deno");
    });

    it("still returns the runtime when the binary is blocklisted, since detectRuntime ignores the blocklist", () => {
        // detectRuntime only reports candidate matching, not blocklist status - this case still
        // returns a runtime name even though isRealNodeProcess would reject it as Electron-bundled.
        const entry: ProcessEntry = {
            pid: 27,
            ppid: 0,
            name: "node",
            path: "/Applications/Foo.app/Contents/Resources/node",
        };
        expect(detectRuntime(entry, "darwin")).toBe("node");
    });
});

describe("isMcpProcess", () => {
    it("flags the design spec's own MCP example command", () => {
        expect(isMcpProcess("node /opt/homebrew/bin/pnpx @rushiv/expect-cli@latest mcp")).toBe(true);
    });

    it("does not flag a non-MCP process", () => {
        expect(isMcpProcess("node script.js --flag")).toBe(false);
    });

    it("does not flag 'mcp' as a substring of a longer word", () => {
        expect(isMcpProcess("node mcpfoo.js")).toBe(false);
        expect(isMcpProcess("node somemcpthing.js")).toBe(false);
    });

    it("flags snake_case and kebab-case mcp file names", () => {
        expect(isMcpProcess("node mcp_server.js")).toBe(true);
        expect(isMcpProcess("node mcp-server.js")).toBe(true);
    });
});
