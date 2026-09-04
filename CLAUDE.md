## Commands

- `npm run dev` - run the CLI directly via tsx, no build step.
- `npm run test` - vitest run (use `npm run test:watch` while iterating).
- `npm run typecheck` - tsc --noEmit, run after any multi-file change.
- `npm run lint` - eslint.
- `npm run build` - tsup bundle to `dist/cli.js`, marks it executable.

## Rules

- Node floor is 20, set by `ps-list@9` which is the only version exposing `path` and `startTime` on `ProcessDescriptor`. Don't downgrade `ps-list` to chase a lower node floor, `classify.ts` binary detection and the project-path column depend on `path`.
- `--plain` forces `chalk.level = 0` explicitly in `cli.ts` rather than relying on chalk's own TTY detection, because chalk misses `FORCE_COLOR` set in CI and `--plain` requested while still attached to a real TTY (pty wrappers). Keep that explicit override if touching output-mode logic.
- Child-process nesting under a parent (default behavior, disabled by `--all`) is computed in `ui.ts`'s `hideChildProcesses`/`groupByProject`. Don't reintroduce a flat list by default, it's the reason `--all` exists as an escape hatch.
- `terminateProcess` sends SIGTERM only and reports whether the process survived; it never escalates to SIGKILL on its own. Escalation is a user-confirmed action in the interactive UI. Don't have any code path auto-kill -9.
- MCP/BUN/DENO tagging in `classify.ts` uses whole-word regex matches (e.g. `MCP_WORD_PATTERN`), not substring checks, to avoid false positives on paths that merely contain "mcp" as part of another word.
- Path display substitution (`trimPath`/`trimEnvPaths` in `path-trim.ts`) rewrites auto-detected env-var directory prefixes to `$NAME` (e.g. `$X2/checkout`) before falling back to `~`. Detection requires the value to be a single existing directory (delimiter lists like PATH and files like SHELL are excluded, HOME keeps `~`), and longest match wins so nested vars beat shorter prefixes.
- Windows has no working-directory detection (no reliable OS mechanism without extra privileges). Code paths that resolve project path/cwd must degrade to naming the nearest recognizable launching process instead of throwing.
- Interactive list labels (`interactive: true` in `DisplayOptions`) drop dim/gray styling: clack highlights the active row by wrapping the whole label in `inverse`, and dim/gray segments invert to muddy tones. The TAG's saturated color (magenta/yellow/cyan) is kept on purpose - it inverts into a readable colored chip. Don't re-add dim/gray to interactive labels; `--plain` output keeps full styling.
