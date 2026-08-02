#!/usr/bin/env node
import { Command } from "commander";
import { isRealNodeProcess } from "./classify.js";
import { getProcessSnapshot } from "./process-list.js";
import { resolveSource } from "./source.js";
import type { ProcessEntry } from "./types.js";
import { runInteractiveList } from "./ui.js";

const program = new Command();

program
    .name("what-the-node")
    .description("Find and inspect real node processes running on your machine, with source attribution.")
    .version("0.1.0")
    .action(async () => {
        const snapshot = await getProcessSnapshot();
        const snapshotMap = new Map<number, ProcessEntry>(snapshot.map((entry) => [entry.pid, entry]));
        const nodeEntries = snapshot.filter((entry) => isRealNodeProcess(entry));

        const displayEntries = await Promise.all(
            nodeEntries.map(async (entry) => ({
                entry,
                source: await resolveSource(entry, snapshotMap),
            })),
        );

        await runInteractiveList(displayEntries);
    });

await program.parseAsync(process.argv);
