# Brickworks Dark Factory

Brickworks is an interactive, end-to-end simulation of a brick-built autonomous factory. Delivery trucks supply five parallel module lines: front structure, rear structure, battery and floor, interior, and exterior. Carts deliver material kits to the lines; inspected modules converge on joining, then each gold robotaxi moves through testing, driving, parking, and dispatch.

It is a software simulation and visual storytelling environment. It does not control machinery, validate physical equipment, or make production decisions outside the in-memory session.

## Run locally

Use Node.js 22 or later.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The web development server proxies `/api` and WebSocket traffic to the Fastify server on port 3000. Production builds place the browser app in `dist/web` and bundle the server plus experiment and replay workers under `dist/server`:

```sh
npm run build
npm start
```

`npm start` reads `.env` when it exists. The server listens on `0.0.0.0`; use `PORT` to select its port (default: 3000).

## Explore and verify

Use the [guided tour](docs/guided-tour.md) to follow receiving, module production, final joining, faults, and dispatch. [Release evidence](docs/release-evidence.md) separates passed local checks from credential-dependent and deployment checks. [Graphics review](docs/graphics-review.md) includes measured 1080p performance.

Run `npm test` for deterministic engine, provider-boundary, audio, and API checks. Open `/benchmark.html` for the explicit synthetic rendering stress scene. Run `BRICKWORKS_TEST_URL=http://localhost:3000 node scripts/soak.mjs` against a production server for the two-hour wall-clock server/WebSocket check.

The final local source passed typecheck, production build, and **107 tests across 12 files**. The preserved two-hour local runtime artifact is [`docs/review/release-soak.json`](docs/review/release-soak.json): its 121 scheduled samples reached 7,200 seconds, while a duplicate finalization sample caused the recorded harness failure. The [independent assessment](docs/review/release-soak-assessment.md) records the observed data and corrected harness without relabeling that artifact as passed. Replit publication follows local acceptance and account setup.

## AI providers and privacy

The server can use OpenAI GPT-6 Astra through the Responses API and TypeSafe Jev through its SDK. `OPENAI_API_KEY` and `TYPESAFE_API_KEY` belong only in the server environment; neither key is sent to the browser, exported in a run, or committed. Without keys, provider-backed advice and live adaptive-policy comparison remain unavailable while the deterministic simulation still runs. Authorized local checks exercised both live adapters, Astra autonomous repair, and a genuine twenty-decision Jev adaptive comparison; [release evidence](docs/release-evidence.md) keeps those bounded results separate from fixture coverage and broader provider certification.

See [configuration](docs/configuration.md), [the architecture](docs/architecture.md), [simulation behavior](docs/simulation.md), and [test strategy](docs/test-strategy.md).

## Operating modes

Manual mode applies only user-issued commands. Advisory mode asks a provider for recommendations and leaves them for review. Autonomous mode may apply valid, schema-checked simulation commands within the active session. All decisions are captured with provider, command, revision, status, latency, and token metadata.

The runnable JSON checkpoint keeps a bounded working trace so it stays practical to import. A separate authenticated NDJSON history download preserves the session's complete event, command-outcome, and finished-vehicle lineage stream on server disk, subject to the documented retention and explicit quota marker. An authenticated replay request reconstructs a new paused graphical session at a requested simulation time in the latest reset epoch; it rejects truncated history. See [configuration](docs/configuration.md) for archive paths and limits.

## Scope and attribution

The scene geometry, procedural materials/audio, application code, and documentation are original MIT-licensed work. The visual language is generic brick-built industrial design: it uses no LEGO, Tesla, or other third-party logos, brands, trade dress, or brand-derived source assets. The sole non-original runtime asset is Babylon.js `studio.env`, served locally as lighting/reflection data under CC BY 4.0 with in-app attribution; see the asset inventory below. The system design is informed at a high level by public material-flow concepts, including [WO2024182432A1](https://patents.google.com/patent/WO2024182432A1/en), but does not reproduce Tesla's implementation, claims, drawings, or terminology. See [source and asset policy](docs/source-and-assets.md) and the [asset inventory](docs/assets/README.md).
