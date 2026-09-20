# Brickworks dark factory

An original React/Babylon.js brick-built factory with a Fastify authoritative simulation. The five component lines join into gold robotaxis. Preserve material conservation, session isolation, server-side model credentials, validated commands, and honest simulation/AI provenance.

## Run and publish

- Node 22; install with `npm ci`; build with `npm run build`; run with `npm start`.
- One server serves frontend, API, and WebSocket traffic on `0.0.0.0:3000`.
- Use one Reserved VM web server. Active sessions are in memory, so do not put independent replicas behind a load balancer.
- `.replit` enables `PUBLIC_MODE=true`; keep this enabled for internet access.
- Set `OPENAI_API_KEY`, `TYPESAFE_API_KEY`, and `BRICKWORKS_ACCESS_CODE` using Replit Secrets and deployment secrets. Never place values in this file, source code, chat prompts, or client environment variables.
- The factory runs without model keys. Public live AI remains locked without a configured access code.
- Check `/api/health`, the production loop, a second isolated visitor session, and the authenticated WebSocket after publishing.
- Verify with `npm test`, `npm run typecheck`, and `npm run build` before deploying changes.

See `docs/replit-deployment.md` for deployment and update steps. This is an independent educational simulation, not LEGO/Tesla engineering or physical-machine commissioning evidence.
