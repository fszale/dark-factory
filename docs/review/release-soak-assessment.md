# Release soak assessment

Assessment date: 2026-09-19. This is an independent read of the recorded data. It does not alter or replace the original runner result.

## Recorded artifact and source identity

- [`release-soak.json`](release-soak.json) is preserved byte-for-byte with its recorded `failed` status and `Error: WebSocket stream stopped`; its SHA-256 is `f2913e3c96f394c34aa6224fd5a16d309b7050a214e2e9e9bcc03959b5de5bde`.
- [`release-soak-source.json`](release-soak-source.json) records the localhost:3010 runtime, PID 64130, and has SHA-256 `ee5b5c4e62031bc2a3615334007575fa442019554600f7ae80f8b1e552f091fc`.
- The four recorded runtime hashes were independently recomputed from the present artifacts and match: `dist/server/index.js` `f01df09d7dc7723bc0c9c7b413107519bacdcae1a5e15f0e9ab03f543386a051`; `dist/server/experiment-worker.js` `f552479deb5cce6608727198e11cd00c1c117226e15c54d972bb49037aa55204`; `dist/server/replay-worker.js` `20a34af8ace605da6ed0de0fe1031732e19e4d609db3bf27bf3a32c5715478b3`; and `packages/simulation/src/index.ts` `823b656fd1ffcbbde7a4b95a286ced4d4e3a73ff288fdc3093e192791d288789`.

## What the data shows

The file contains 122 observations. The first 121 are the scheduled initial/minute observations, from 0.010 through **7200.024 wall-clock seconds**. Every one of those 121 observations has zero material delta, zero receiving-conservation delta, and zero reported WebSocket errors. Frames increase strictly from 1 to 56,810; the terminal scheduled sample records 1,589 completed and 1,586 dispatched vehicles. All scheduled observations stay at or below the in-memory bounds of 2,000 events and 720 retained samples, and every ten-sample dispatch-progress comparison increases.

The 122nd observation occurred 14 ms later, at 7200.038 seconds. It has the same simulation time, completion/dispatched values, event/sample windows, and frame count (56,810) as the preceding valid terminal observation. It is the only non-increasing frame comparison.

## Failure mechanism and corrected harness

The previous runner sampled at the end of the duration, set `status` to `passed`, and immediately sampled again. The ordinary scheduled-sample guard correctly rejects equal frame counts, but the final duplicate was not a scheduled minute interval and had no opportunity to receive another WebSocket frame. The runner therefore overwrote its report with `failed`.

[`scripts/soak.mjs`](../../scripts/soak.mjs) now writes a passed report using the already-validated terminal sample; its scheduled minute checks are unchanged. `node scripts/soak-finalization-regression.mjs` passed on 2026-09-19. It verifies that a real scheduled frame advance passes, a duplicate scheduled frame remains rejected, and successful finalization preserves the validated sample list without adding an artificial terminal observation. `node scripts/verify-release-soak-record.mjs` also passed: it replays every scheduled record through the unchanged checks, confirms the preserved duplicate still fails, and recomputes all four recorded runtime hashes.

## Evidence status

The data provides a complete observed two-hour interval with the listed data-level checks satisfied. The preserved run remains a **failed artifact**, so this assessment does not relabel it as a harness `PASS` and does not replace a future clean fixed-harness run. It separates the observed two-hour data from the finalization defect so release documentation does not misstate the cause as a stopped live stream.
