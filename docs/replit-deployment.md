# Publish Brickworks on Replit

## Import and preview

1. Sign in to the intended Replit account and import the GitHub repository. Keep the existing npm workspace and `.replit` configuration.
2. Run `npm ci` and `npm run build`, then start with `npm start`. The preview must serve the factory and `/api/health` from the same port.
3. In Replit Secrets, configure `OPENAI_API_KEY`, `TYPESAFE_API_KEY`, and a private `BRICKWORKS_ACCESS_CODE`. Add these to the published application's secrets too; workspace availability alone is not proof that deployment has them. Never import the local `.env` into Git.

## Publish

Use the Publishing tool's deployment settings to select **Reserved VM**, configured as a web server. This matches the single authoritative process and continuing simulation. Choose machine capacity and review the displayed recurring price before confirming a paid deployment.

| Setting | Value |
| --- | --- |
| Runtime | Node.js 22 |
| Build | `npm ci && npm run build` |
| Run | `npm start` |
| Listening address | `0.0.0.0` |
| Internal port | `3000` |
| Public port | `80` |
| `PUBLIC_MODE` | `true` |
| `PORT` | `3000` |
| `AI_GLOBAL_TOKEN_LIMIT` | `100000` per process-hour by default |

The world and manual simulation are available without paid model access. Live model calls require the private access code. Do not publish with `PUBLIC_MODE=false`. A configured provider badge only means a nonempty server-side key; verify a real authorized request after deployment.

## Acceptance on the published URL

- Load the full factory, start production, observe receiving and dispatch, and confirm the live connection stays connected.
- Confirm `/api/health` returns HTTP 200. Open another browser session and verify its controls do not affect the first factory.
- Check that a visitor without an access code cannot make a live AI call, then verify an authorized request.
- Reload to confirm session/checkpoint recovery. Save exported checkpoints outside the deployment before replacing it.
- Confirm logs contain no credentials. Keep `.data/archives` private: deployment replacement can lose local files, and durable external archive storage is future work.

## Virtual order desk (DF-ORDER-001): keep off until Filip says yes

The order desk is implemented but **not deployed**. `.replit` sets `ORDER_DESK_ENABLED = "false"`, and the server also defaults to off. Do not change that, issue agent keys, or list the server in any MCP registry without Filip's explicit yes.

When Filip approves a publish with the desk on:

1. Add `BRICKWORKS_AGENT_KEYS` as a deployment secret. It holds hashes only. Each bearer key is generated offline, handed to its agent, and never stored. Set `ORDER_DESK_ENABLED=true` and `PUBLIC_BASE_URL=https://<published host>`. Decide `ORDER_FLOOR_PUBLIC_VIEW` and `ORDER_DESK_ANON_READ` explicitly, and set `TRUST_PROXY=true` behind Replit's proxy so per-IP limits see real clients.
2. Keep one Reserved VM process with no replicas: the floor and desk live in memory.
3. `.data/orders` can be lost on republish. Save the floor first with `GET /api/order-floor/export` (header `x-access-code`) and restore it with `POST /api/order-floor/import`.
4. Re-run `scripts/agent-order-soak.mjs` locally before publishing, and compare memory against the corrected soak.
5. Published-URL acceptance:
   - discovery documents show the https public URL;
   - `/mcp` without a key returns 401 for tools that need a key;
   - with a dedicated QA key, an agent quotes, orders and sees delivery, then the QA key is revoked;
   - SSE and long polling survive the proxy;
   - logs contain no keys.
6. Emergency stop without a redeploy: `POST /api/order-floor/kill-switch` with `{ "accessCode": "...", "thrown": true }`. Removing `ORDER_DESK_ENABLED` and restarting turns the desk off permanently.

## Updates

Commit tested changes to GitHub, pull the chosen commit into the Replit project, rebuild, and republish. A GitHub push alone does not promise automatic Replit publication. Republish replaces the server process; clients restore their saved checkpoints into new paused sessions. Review the published URL after every release.

References: [Replit deployment types](https://docs.replit.com/features/publishing/deployment-types), [Git integration](https://docs.replit.com/replit-workspace/workspace-features/version-control). Hosting prices and account entitlements are determined by the current publishing screen.
