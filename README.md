# what-the-node

`ps -ef | grep node` but useful: lists the real node processes running on
your machine, filters out Electron/desktop-app noise (VSCode helpers, Slack,
etc.), trims unreadable paths, and tells you — where possible — which app or
project spawned each one.

## Install

```sh
npm install -g what-the-node
```

## Usage

```sh
what-the-node
```

Or without installing:

```sh
npx what-the-node
```

Pick a process from the interactive list to see its full command, working
directory, and (best-effort) launching app, with an option to kill it.

## Platform notes

- macOS and Linux: full support, including working-directory detection.
- Windows: process listing and killing work; working-directory detection is
  not available (no reliable built-in OS mechanism without extra
  privileges/dependencies) — the tool falls back to naming the nearest
  recognizable launching process instead.

## License

MIT
