#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import { isRealNodeProcess } from "./classify.js";
import { getProcessSnapshot } from "./process-list.js";
import { resolveSource } from "./source.js";
import type { ProcessEntry } from "./types.js";
import { filterEntries, hideChildProcesses, printPlainList, runInteractiveList } from "./ui.js";

const program = new Command();

program
    .name("jstop")
    .description("Find and inspect real node/bun/deno processes running on your machine, with source attribution.")
    .version("0.1.0")
    .option("-v, --verbose", "show full command including flags")
    .option("--plain", "print a plain list instead of the interactive UI (auto-enabled when stdout is not a TTY)")
    .option("-k, --filter <keyword>", "only show processes whose command or project path contains this keyword")
    .option("-a, --all", "also show child processes whose parent is already in the list")
    .action(async (options: { verbose?: boolean; plain?: boolean; filter?: string; all?: boolean }) => {
        const snapshot = await getProcessSnapshot();
        const snapshotMap = new Map<number, ProcessEntry>(snapshot.map((entry) => [entry.pid, entry]));
        const nodeEntries = snapshot
            .filter((entry) => isRealNodeProcess(entry))
            .filter((entry) => entry.pid !== process.pid);

        const allDisplayEntries = await Promise.all(
            nodeEntries.map(async (entry) => ({
                entry,
                source: await resolveSource(entry, snapshotMap),
            })),
        );
        const withoutHiddenChildren = options.all ? allDisplayEntries : hideChildProcesses(allDisplayEntries);
        const displayEntries = filterEntries(withoutHiddenChildren, options.filter);

        const verbose = Boolean(options.verbose);
        const isPlain = Boolean(options.plain) || !process.stdout.isTTY;

        if (isPlain) {
            // chalk's own TTY auto-detection only covers the vanilla non-TTY case; it misses
            // FORCE_COLOR being set (common in CI) or --plain being requested while still
            // attached to a real TTY (e.g. via a pty wrapper). Plain output is meant to be
            // machine/file-consumable, so force color off regardless of environment state.
            chalk.level = 0;
            printPlainList(displayEntries, { verbose });
            return;
        }

        await runInteractiveList(displayEntries, { verbose });
    });

await program.parseAsync(process.argv);
