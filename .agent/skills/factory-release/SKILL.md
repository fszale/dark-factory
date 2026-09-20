---
name: factory-release
description: Build, verify or publish Brickworks to its existing Replit Reserved VM and maintain truthful deployment evidence and GitHub release continuity.
---

# Factory Release

Read `docs/replit-deployment.md`, `.replit` and `docs/release-evidence.md`. Paths are relative to the repository root. Verify current settings instead of treating old prices or test counts as permanent facts.

Destinations: `https://github.com/fszale/dark-factory` and `https://dark-factory-fszale.replit.app/`. Replit workspace: `https://replit.com/@fszale/Dark-Factory`. The chosen hosting shape is one small Reserved VM; do not switch to autoscaling/multiple authoritative processes without handling session state explicitly.

- Keep Node 22, one externally served port, `0.0.0.0`, frontend/API/WebSockets together and `PUBLIC_MODE=true`.
- OPENAI_API_KEY, TYPESAFE_API_KEY and BRICKWORKS_ACCESS_CODE belong in private server deployment secrets. Do not print them, commit them, send them in URLs, or confuse development secrets with published secrets.
- A configured provider flag only proves a nonempty variable. Test anonymous AI rejection separately from an authenticated genuine provider response. Report NOT RUN/BLOCKED where credentials or user action prevent a test.
- Validate the chosen source commit and relevant checks, push only intended files, update the Replit checkout, then build/republish within the user's authorization. GitHub push alone is not automatic Replit deployment.
- Verify destination-side Live status, health, running simulation and WebSocket connection. Check browser checkpoint recovery after replacement, and preserve a rollback commit.
- Local archive disk can be replaced on deployment. Preserve important exports before replacement; browser checkpoint recovery is not durable server archival.
- Avoid duplicate paid deployments. Existing authorization persists; request additional approval only for a new material cost, destination, secret transfer or other required boundary.
- When browser profiles differ, verify the signed-in Replit account before mutation. A native Chrome window may differ from the extension-connected profile. Refresh state after focus changes; never type into a stale target.

Keep `docs/release-evidence.md` and the README accurate: distinguish local tests, production checks, credential-dependent work and future milestones. Custom DNS is separate from app publication; do not configure the proposed factory.datareaktor.ai address without user direction.
