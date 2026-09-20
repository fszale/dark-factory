# Corrected release soak assessment

Assessment date: 2026-09-20. This records the clean rerun of the wall-clock harness after its terminal-finalization fix.

## Result and measured observations

[`release-soak-corrected.json`](release-soak-corrected.json) records `status: "passed"` for a seed-42 session on localhost port 3010. It contains 121 scheduled observations from 0.007 through **7200.012 wall-clock seconds** at simulation speed 10, ending at 71,011.25 simulated seconds.

- Frames grew strictly from 1 to 56,809; no observation reports a WebSocket error.
- Material and receiving-conservation deltas are zero in all 121 observations.
- Completion grew from 0 to 1,589 and dispatch from 0 to 1,586. Every checked nine-sample dispatch window progressed.
- Retained events reached, but never exceeded, 2,000; retained metric samples reached, but never exceeded, 720.
- Sampled heap use ranged from 27,369,600 to 66,163,408 bytes; sampled RSS ranged from 129,892,352 to 187,564,032 bytes. These are sampled process values, not a leak analysis or a memory limit claim.
- Sampled tick processing ranged from 14.679 to 34.092 ms. Browser rendering is explicitly outside this server/WebSocket soak.

The report’s note confirms that it made no AI calls and used no credentials. It is server/session endurance evidence only; it does not establish provider quality, browser performance, file-download persistence, accessibility, physical behavior, or a hosted deployment.

## Runtime identity

[`release-soak-corrected-source.json`](release-soak-corrected-source.json) records port 3010, PID 47478, soak execution session 94018, and the report timestamp. Its SHA-256 is `582ae18cbd16f2404b8c4959eaa15ff69da131f298bd8aabd33189fe36f24bb2`; the passed report's SHA-256 is `f93d4d9f2187ba3331b7c2b61ca634a8e287928d72e1ec48286e75bef739a141`.

On 2026-09-20, the five manifest digests were independently recomputed and matched the present artifacts: server `f01df09d7dc7723bc0c9c7b413107519bacdcae1a5e15f0e9ab03f543386a051`; experiment worker `f552479deb5cce6608727198e11cd00c1c117226e15c54d972bb49037aa55204`; replay worker `20a34af8ace605da6ed0de0fe1031732e19e4d609db3bf27bf3a32c5715478b3`; simulation source `823b656fd1ffcbbde7a4b95a286ced4d4e3a73ff288fdc3093e192791d288789`; and harness `2824e72c9ae94a6df2534e8a3c69ea858660f844019fe3abd86d619752ecbc4f`.

The earlier [`release-soak.json`](release-soak.json) remains preserved as a failed artifact caused by its extra 14 ms terminal sample; see its [separate assessment](release-soak-assessment.md). The corrected artifact is the current clean wall-clock evidence.
