# Production acceptance audit

Audit date: 2026-09-20 (America/Detroit). Scope: bounded, read-only review of the original release evidence and public production endpoint at `https://dark-factory-fszale.replit.app/`. No session was created, no deployment or secret was inspected or changed, no browser automation was used, and no paid provider request was made.

Status meanings: `PASS` means current destination-side evidence directly demonstrates the claim. `PARTIAL` means some required evidence exists but does not close the acceptance item. `NOT RUN` means this audit did not perform the required check. `CONFLICT` means repository claims disagree.

> Historical initial audit: the subsequent same-day [production smoke](production-smoke.json) supersedes the anonymous-access, session-isolation and live-stream gaps below. See [release evidence](../release-evidence.md) for current acceptance status. Authenticated production provider responses remain pending.

## Current production facts

| Item | Status | Evidence observed on 2026-09-20 |
| --- | --- | --- |
| Public application endpoint | PASS | `GET /` returned HTTP 200 over HTTPS with HSTS and the Brickworks production HTML. |
| Public health endpoint | PASS, point-in-time | `GET /api/health` returned HTTP 200 and `ok: true`. At the observation it reported about 2,002 seconds of uptime, 3 active sessions, 3 viewers, and about 5.65 ms tick processing time. These volatile values are observations, not service-level guarantees. |
| Provider configuration and access-code policy flags | PASS, configuration only | Public health reported both Astra and Jev as `configured` and `accessRequired: true`. Per the release skill, a configured flag proves only a nonempty deployment variable; it does not prove a genuine provider response or rejection behavior. |
| Deployed client-build identity | PASS, client scope | The public core application bundle, world bundle, stylesheet, and `assets/studio.env` were downloaded with GET and were byte-for-byte identical to the current local `dist/web` files at repository `main` (`5dab074`). Their content hashes matched locally. Replit injects its analytics script into the served HTML, which is the only observed difference from local `dist/web/index.html`. This does not identify the deployed server bundle or prove that the Replit checkout itself is at that commit. |
| Public runtime shape | PARTIAL | The endpoint and same-origin `/api/health` are reachable, consistent with the one-server design. A public HTTP response cannot prove Reserved VM selection, Node 22, the internal port, or that only one authoritative server process exists. |

## Reconciliation with existing evidence

- Local acceptance is strong and remains valid within its recorded scope: typecheck, build, 107 tests across 12 files, Node 22 production smoke, Docker smoke, browser controls, bounded live-provider checks, and the corrected two-hour server/WebSocket soak.
- `README.md` says the application is published, provider configuration and anonymous AI rejection were verified in production, and authenticated production responses remain pending.
- `docs/release-evidence.md` and `tests/acceptance-checklist.md` still say the Replit Reserved VM was not published or run. Those statements are stale now that the public endpoint is live.
- No durable artifact in the repository records the claimed production anonymous-AI rejection: there is no dated request/response, command transcript, capture, or destination log reference. The README claim is therefore `PARTIAL` as acceptance evidence, even though the server implementation and local tests enforce the boundary.

## Remaining primary-goal production gaps

| Original published-release criterion | Status after this audit | Exact minimal closure check |
| --- | --- | --- |
| Load the full factory, start production, observe receiving and dispatch, and keep the live connection connected | NOT RUN | In one isolated browser session on the public URL, record the initial connected state, start at 10x, observe one receiving/sorting event and one completed vehicle dispatch, then record that the WebSocket indicator remained connected and its sequence advanced monotonically. Preserve a dated text record or short capture. |
| Separate browser sessions are isolated | NOT RUN | Open two isolated browser contexts, create one factory in each, issue a harmless pause or speed command in only one, and record distinct session IDs plus the unchanged snapshot/revision in the other. |
| Anonymous visitors cannot invoke paid AI | PARTIAL, unsupported repository claim | Create one disposable public session without an access code, submit one Astra request and one Jev request without a code, and record HTTP 403 with the generic access-code error. These checks stop before either provider and incur no model charge. Do not record tokens, secrets, or full request headers. |
| Authenticated Astra and Jev work in production | NOT RUN | With the access code entered through the application UI, make one bounded advisory request to each provider. Record provider name, HTTP success, latency, sanitized usage, and whether the returned decision passed validation. Do not expose the access code or provider credentials. This is the only proposed check here that can incur provider cost. |
| Reload/checkpoint recovery on the published service | NOT RUN | Pause a disposable production session at a recognizable simulated time, reload once, and record restoration into the same paused run (or documented replacement-session recovery) with matching scenario/time and a reconnected live stream. |
| Recovery after deployment replacement | NOT RUN | At the next already-authorized release, save an export outside Replit, keep a paused browser checkpoint, republish once, and record browser recovery after the server replacement. Do not trigger a deployment solely for this audit. |
| Published server source and hosting configuration are identified | PARTIAL | In the Replit deployment view, record the deployed commit SHA, Live status, Reserved VM target, Node 22, build/run commands, and one externally served port. Compare the SHA to the intended release commit. No secret values should appear in the evidence. |
| Production logs contain no credentials | NOT RUN | Inspect only a bounded post-check log window after the anonymous and authenticated checks; record that it contains expected request outcomes and no access code, provider key, authorization header, or provider response credential material. Do not copy log contents containing user data or secrets into the repository. |

The primary production goal should be described as **published and healthy, with client assets tied to the accepted local build, but production interaction and authenticated-provider acceptance still incomplete**. Publication alone does not close the original production checklist.

## Secondary evidence gaps

The following remain truthful limitations but are not blockers for the primary public simulation journey: saved browser download content, human audio listening, broader accessibility review, browser presentation of replay errors, long-duration provider quality/cost/stability, and all physical-machine validation. Graphics work has separate approval and acceptance; it does not substitute for the production checks above.

## Documentation follow-up

After the checks above, update `docs/release-evidence.md` and `tests/acceptance-checklist.md` from their stale pre-publication status using only recorded destination-side results. Keep authenticated provider checks, audio, accessibility, durable archive storage, and physical validation explicitly scoped rather than promoting them from local evidence.
