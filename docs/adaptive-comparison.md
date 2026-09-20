# Adaptive AI comparison boundary

`packages/simulation/src/adaptive-experiments.ts` exports `adaptivePairedExperiment`, `AdaptiveExperimentResult`, `AdaptiveComparisonInput`, `AdaptiveOptions`, `AdaptiveDecisionRequest`, `AdaptiveProposal`, `AdaptiveProgress`, and `AdaptiveComparisonError`.

The runner compares ten paired seeds from identical factory configuration for 1,800 simulated seconds per policy. The baseline receives no decisions. The candidate pauses simulated time at each configured decision checkpoint and requests a fresh judgment about its own evolving state. Defaults are 300 and 900 seconds; the hard limit is three checkpoints per seed, thirty requests per comparison. No existing recorded-action schedule is substituted for a missing provider.

## Server-owned admission

The injected `decide` callback is the sole provider boundary. It receives the existing `operationalView`, seed, checkpoint index, source revision/epoch, simulation time, and an AbortSignal. Hidden equipment wear, random streams, and internal ledgers are not exposed. The runner constructs no provider client and reads no credentials.

The server authenticates the session, requires live-AI access authorization, applies the same per-session/global request and token limits as interactive operation, reserves/releases token capacity, and enforces provider concurrency. `POST /api/sessions/:id/adaptive-experiments` creates a bounded asynchronous job; authenticated `GET` and `DELETE` routes expose progress or cancel it. Admission waits within the job timeout rather than bypassing a limit. Jobs cancel on explicit cancel, manual takeover, reset, session expiration, or server close. One job may run per session and two globally; five terminal results are retained per live session. The default twenty Astra calls need roughly ten minutes at two per minute, while Jev allows twelve per minute.

Callback proposals contain provider, source (`live-provider` or `test-fixture`), summary, at most six commands, and reported tokens; model and decision ID are optional. Server adapters supply provenance, and injected adapters default to `test-fixture` rather than being promoted to live evidence. Live source labels are server attestations backed by the configured adapter boundary.

## Validation and fair comparison

Every proposed action is validated and passed through authoritative engine commands. Allowed actions are operating profile, material or production-order priority, buffer size, maintenance, and bounded replenishment/release/dispatch/loader configuration. Playback controls, reset, new demand, layout changes, and recursive experiments are rejected and counted. Source revision/epoch mismatches are rejected. Safe commands in the same decision receive fresh sequential revisions; prior commands cannot invalidate an entire otherwise consistent batch merely by incrementing the revision.

Committed materials and jobs remain subject to normal engine constraints. A proposal may therefore receive mixed applied/rejected outcomes, all retained in its trace. Candidate simulation time is frozen during inference and admission waiting; latency is reported separately and does not model production loss from real-time inference delay. Physical economics exclude provider API charges; token usage is reported separately.

## Results and failure

Completed results use `policySource: live-adaptive-ai` only when every callback proposal reports live provenance. Any fixture yields `adaptive-test-fixture`. The result contains ten per-seed metric pairs and deltas, population standard deviations for baseline/candidate/paired differences, applied/rejected action counts, full bounded sanitized observations and action receipts, decision IDs, providers, optional reported model names, latency, and token totals. Regressions are retained without filtering. This is synthetic comparison evidence, not proof of real-world manufacturing performance.

Provider refusal, malformed responses, cancellation, or timeout ends the job without policy substitution. `AdaptiveComparisonError.progress` preserves completed-pair and attempted/completed-decision counts. Default decision timeout is 90 seconds, configurable from one to 120 seconds; cancellation and timeout abort the callback signal. There is never more than one callback in flight. Callbacks must honor cancellation so their underlying request stops and server reservations can be released.

## Verification

`npx vitest run --root . tests/adaptive-experiments.test.ts` passes seven runner tests. The server suite separately covers job isolation, configured-provider/access checks, genuine-vs-fixture provenance, and cancellation on takeover, explicit cancel, and expiration.

On 2026-09-19, an authenticated Jev job completed all twenty live decisions across ten paired seeds and the default 300/900-second checkpoints in 62.672 seconds, respecting the twelve-per-minute bound. Every decision selected hold, so no command was applied or rejected and all sixteen candidate metrics exactly matched baseline: zero improvements and zero regressions. The result reported 40,435 usage tokens and `policySource: live-adaptive-ai`. Sanitized evidence is preserved in [`review/live-adaptive-jev.json`](review/live-adaptive-jev.json). This verifies the live bounded pathway and an honest no-action outcome; it does not establish that Jev improves production.
