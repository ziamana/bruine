# Real terminal tests

Run `pnpm test:e2e` with installed dependencies. The suite builds the application first, runs every scenario sequentially, and continues after failures. `pnpm test` excludes this directory. Local loopback listening and PTY access are required.

Each scenario launches the real `dist/bin.js` in node-pty at 100×30 and feeds all terminal bytes into headless xterm. Homes and projects are temporary and removed after each scenario. Installed bruine and dsh-base bundles are linked into the isolated profile without package downloads. Windows uses directory junctions and node-pty's ConPTY backend. The fake model server only listens on loopback, records all completion requests, and tracks aborted responses.

The status bar is three rows — the place and the mode badges, the readings and the route, the throughput when it fitted — so a test never counts rows from the bottom: `Harness.statusBarRows()` finds them by what they say, and `terminal.test.ts` reads `turnRow`, `placeRow`, `badges`, `effortOf` and `barCell(row, label)` from it. A cell is read in the row it belongs to, because the mode badge and the effort slot can print the same word.

`__screens__/` contains key moments and a separate failure dump. Failure output includes the entire visible screen. CI uploads the dumps for each OS/Node combination. The modes test records each failed checkpoint and still exercises subsequent transitions. Any future platform-specific skip must print its concrete reason.

See [REPORT.md](REPORT.md) for the recorded run and known bug. All scenarios run even when a product bug is found, per the updated user instruction.
