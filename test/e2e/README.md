# Real terminal tests

Run `pnpm test:e2e` with installed dependencies. The suite builds the application first, runs eight independent tests sequentially, and continues after failures. The Ask-label test uses `it.fails` for the known T23 bug; its setup and cleanup remain outside the expected-failure body. `pnpm test` excludes this directory. Local loopback listening and PTY access are required.

Each scenario launches the real `dist/bin.js` in node-pty at 100×30 and feeds all terminal bytes into headless xterm. Homes and projects are temporary and removed after each scenario. Installed kumo and dsh-base bundles are linked into the isolated profile without package downloads. Windows uses directory junctions and node-pty's ConPTY backend. The fake model server only listens on loopback, records all completion requests, and tracks aborted responses.

`__screens__/` contains key moments and a separate failure dump. Failure output includes the entire visible screen. CI uploads the dumps for each OS/Node combination. The modes test records each failed checkpoint and still exercises subsequent transitions. Any future platform-specific skip must print its concrete reason.

See [REPORT.md](REPORT.md) for the recorded run and known bug. All scenarios run even when a product bug is found, per the updated user instruction.
