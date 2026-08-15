# jstop

`ps -ef | grep node` but useful. Lists the real node, bun, and deno processes running on your machine, filters out Electron/desktop-app noise (VS Code helpers, Slack, etc.), trims unreadable paths, and tells you, where possible, which app or project spawned each one.

## Usage

Try it without installing:

```sh
npx jstop
```

This opens an interactive, searchable list of every real node/bun/deno process on your machine. Type to filter, pick one to see its full command, working directory, and (best-effort) launching app, with an option to kill it.

Verify it works:

```sh
npx jstop --plain
```

This prints a static list instead of the interactive UI, useful for confirming output or piping into another tool.

## Table of Contents

- [jstop](#jstop)
  - [Usage](#usage)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Features](#features)
  - [Platform notes](#platform-notes)
  - [License](#license)

## Installation

```sh
npm install -g @rushiv/jstop
```

Then run it directly:

```sh
jstop
```

Requires Node.js 20 or later.

## Configuration

All options are CLI flags, no config file needed.

| Flag                     | Description                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `-v, --verbose`          | Show the full command including flags.                                                           |
| `--plain`                | Print a plain list instead of the interactive UI. Auto-enabled when stdout is not a TTY.         |
| `-k, --filter <keyword>` | Only show processes whose command or project path contains this keyword.                         |
| `-a, --all`              | Also show child processes whose parent is already in the list, instead of nesting them under it. |

Examples:

```sh
jstop --verbose
jstop --filter my-project
jstop --all
jstop --plain --filter mcp
```

## Features

- Filters out Electron/desktop-app helper processes so you only see real node/bun/deno work.
- Tags processes as `MCP`, `BUN`, or `DENO` where detected.
- Resolves and trims each process's working directory or project path (best-effort).
- Nests child processes under their parent by default, so a dev server and its subprocesses read as one entry (`--all` disables this).
- Interactive autocomplete filtering: type to search the running list live.
- Kill a process from the interactive view. Sends `SIGTERM` first; if it survives, offers to escalate to `SIGKILL` (macOS/Linux only, single-strategy on Windows).

## Platform notes

- macOS and Linux: full support, including working-directory detection.
- Windows: process listing and killing work; working-directory detection is not available (no reliable built-in OS mechanism without extra privileges/dependencies). The tool falls back to naming the nearest recognizable launching process instead.

## License

MIT
