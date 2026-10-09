# Shop-as-MCP Sourcing

Status: **proposed spec**. Not implemented in the simulation. No external service is called.
Date: 2026-10-08
Repo: [fszale/dark-factory](https://github.com/fszale/dark-factory) (Brickworks)
ID: `DF-SHOP-001`
Related: [Vehicle Order MCP, DF-ORDER-001](vehicle-order-mcp.md) (seller-side counterpart), [Joint Design Loop, DF-LOOP-001](spacex-design-loop.md), [station adapter boundary](../station-adapters.md), [people tracker: Caleb Chamberlain, OSH Cut](../people/oshbuilt-caleb-osh-cut.md)

This document adds a sourcing building block to the dark factory: every shop is an endpoint that tells an agent, in machine-readable form, what it can make, whether a specific part is manufacturable, what it costs, and when it ships. Brickworks design agents source against that endpoint instead of against a broker or a human estimator.

## Where the idea comes from

Caleb Chamberlain, CEO of OSH Cut (online sheet metal shop, Utah), posted the thesis on 2026-10-07 ([post](https://x.com/OSHBuilt/status/2107956520172528000)):

> - MCP servers become standardized and as ubiquitous as web pages
> - MCP servers fully define shop capabilities, materials, etc.
> - Every shop has an owned API that provides real-time, first principles, shop-specific DFM, prices, and lead-times
> - AI agents design and source by searching for shops with the right combination of capability, speed, and price

He endorsed a reply's shorthand for it: '"Every shop is an API endpoint" has a nice ring to it.' ([post](https://x.com/OSHBuilt/status/2107963692822548991))

He is clear that the protocol matters less than the data: "MCP is optional. I think the API layer and rich DFM information are the critical components." ([post](https://x.com/OSHBuilt/status/2107970058375008597))

On 2026-10-08 he sharpened the buildout: the hard part is productized manufacturing "lanes" (sheet metal, CNC, molds, textiles, plastics, and more), not another API broker catalog. The AI-friendly API layer is "a tiny and comparatively easy component" next to running factories ([post](https://x.com/OSHBuilt/status/2108201450279154013)). He also restated the feedback-loop thesis: agents get good at physical design when they can ask a real factory whether a part can be made ([post](https://x.com/OSHBuilt/status/2108349510619652220)).

Full notes, quotes, and counterpoints are in the [people tracker](../people/oshbuilt-caleb-osh-cut.md).

## What is real and what is proposed

| Item | Status | Notes |
| --- | --- | --- |
| Instant DFM, quote, and lead time for sheet and tube parts at OSH Cut | **Real, in production** | Web app at oshcut.com. Backed by internal APIs. |
| OSH Cut internal quote, lead, and DFM APIs | **Real, not public** | Caleb: "The MCP just ties into our existing quote, lead, and DFM APIs." No public docs found on 2026-10-08. |
| OSH Cut MCP server | **Still not public (2026-10-09)** | Demos continue (Claude + "new MCP"). Caleb says DFM APIs are "releasing them soon." oshcut.com `/mcp` and related paths still 404. |
| A standard shop MCP schema across shops | **Does not exist** | Nobody has published one that we found. The sketch below is our draft, not a standard. |
| Brickworks as a buyer of shop parts | **Proposed** | This spec. |
| Brickworks as a shop that exposes its own MCP | **Proposed, virtual only** | Seller-side counterpart spec: [DF-ORDER-001](vehicle-order-mcp.md). Virtual orders against the simulated factory; no payments or shipping. A real-plant seller endpoint stays out of scope until there is a physical plant. |
| Outcome history (did the shop deliver what it declared) | **Open problem** | Raised on the thread; Caleb: "I wonder where that kind of performance history could live." |

## Seller-side counterpart

This spec covers Brickworks as a buyer. [DF-ORDER-001, Vehicle Order MCP](vehicle-order-mcp.md) covers the other direction: the dark factory exposes its own MCP server so outside agents can quote, order, and track the vehicle being manufactured, all virtual. The two specs share the feasibility issue shape, the idempotency rules, and the "few tools" ceiling, so an agent that learns one side can read the other.

## Why it is a dark factory building block

A dark factory removes people from the loop where a machine can carry the decision safely. Sourcing is one of the loudest human loops left: email a drawing, wait for a quote, wait for a DFM comment, redesign, wait again. Caleb's point is that the shop, not the agent, owns the manufacturing truth, and it should answer instantly: "It's not the agent that has to figure that out, it's the shop, and it communicates all that via API." ([post](https://x.com/OSHBuilt/status/2107997696934199326))

For Brickworks that matters in three places:

1. **Design loop input.** DFM errors, bend counts, and price are evidence for DF-LOOP-001 steps 2 (delete) and 3 (simplify). A shop that says "this flange is too short for our tooling" is telling the loop which feature costs the most.
2. **Tabletop stage (DF-LOOP-001 phase 6).** The first physical parts (gripper brackets, fixture plates, a small frame) are flat and bent sheet metal. That is exactly what shop DFM covers today.
3. **Receiving.** The simulation already has deliveries and a `shortage` scenario. A shop endpoint gives receiving a supplier that answers with prices, lead times, and capacity instead of fixed configuration.

## Design principles

1. **DFM is the compiler.** Caleb: "OSH Cut's instant design review checks are basically compilation for the hardware world." ([post](https://x.com/OSHBuilt/status/2107115079405846946)) A DFM result must be actionable by a model: a code, the feature it applies to, the measured value, the limit, and a suggested fix. "Not manufacturable" with no reason is useless to an agent.
2. **Declared is not measured.** Same rule as the [station adapter boundary](../station-adapters.md): observations say whether a value is simulated or measured. A shop's lead time is declared. A delivered date is measured. Keep them in different fields and never merge them.
3. **Read freely, buy with approval.** Profile, materials, DFM, and quotes are read tools. Creating a cart is a reversible write. Placing an order spends money and needs a human approval token. A model can never place an order on its own, the same way providers cannot mutate the Brickworks world directly.
4. **Idempotent and versioned.** Every write carries an idempotency key. Quotes carry an id, a currency, and an expiry. Orders reference a quote id, not a recomputed price.
5. **Few tools.** Builders on the thread report model coherence dropping with large tool lists (one cut 34 CAM tools down to about 5). Target 8 or fewer tools, with detail in resources.
6. **Protocol neutral.** MCP is one transport. The same contract should be expressible as OpenAPI so a shop can serve both.

## What a shop endpoint should expose

| Tool or resource | Kind | Purpose | Key fields |
| --- | --- | --- | --- |
| `shop://profile` | resource | Who the shop is, processes, locations, shipping regions, certifications, auth model | name, processes[], regions[], certifications[], contact |
| `shop://materials` | resource | Material catalog with stock status | id, family, alloy, temper, thickness or tube profile, sheet or stick size, in_stock |
| `shop://machines` | resource | Machine envelopes per process | process, max_part_size, max_thickness by material, bend tonnage and length, tube OD range, tolerance class |
| `check_dfm` | tool, read | Run shop-specific DFM on one part | part file or geometry, material id, process options → issues[] with code, severity, feature ref, measured, limit, suggestion |
| `quote` | tool, read | Price and lead options for a set of parts | parts[], quantities, finish options → quote id, line prices, lead options (ship date, price), expires_at |
| `get_capacity` | tool, read | Coarse availability by process and date | process, date range → slots or load percentage, declared |
| `create_cart` | tool, write (reversible) | Hold a quote as a cart a human can review | quote id, idempotency key → cart id, review url |
| `place_order` | tool, write (irreversible) | Convert a cart to an order | cart id, approval token, idempotency key → order id |
| `get_order_status` | tool, read | Track an order and report measured outcomes | order id → status, promised ship date, actual ship date, inspection notes |

Outcome history is not a shop tool in this draft. If it lives anywhere neutral, it belongs to the buyer's records (Brickworks lineage) or a third party, not to the shop grading itself.

## Draft tool schema sketch

Sketch only. Zod style to match `packages/contracts`. Not added to the codebase in this commit.

```ts
import { z } from "zod";

export const valueSource = z.enum(["declared", "measured", "simulated"]);

export const dfmIssue = z.object({
  code: z.string(),                 // e.g. "FLANGE_TOO_SHORT"
  severity: z.enum(["error", "warning", "info"]),
  featureRef: z.string().nullable(),// face, edge, hole, or bend id in the uploaded geometry
  measured: z.number().nullable(),
  limit: z.number().nullable(),
  unit: z.enum(["mm", "in", "deg"]).nullable(),
  message: z.string(),
  suggestion: z.string().nullable(),// machine-actionable fix, e.g. "increase flange to >= 6.4 mm"
});

export const checkDfmInput = z.object({
  part: z.object({
    format: z.enum(["step", "dxf", "svg", "json-flat"]),
    uri: z.string(),                // uploaded file reference, never raw bytes in the prompt
    units: z.enum(["mm", "in"]),
  }),
  materialId: z.string(),
  process: z.enum(["laser-flat", "laser-tube", "brake-bend", "tube-bend"]).array().min(1),
});

export const checkDfmOutput = z.object({
  manufacturable: z.boolean(),      // false if any error
  issues: dfmIssue.array(),
  derived: z.object({
    bendCount: z.number().int(),
    cutLength: z.number(),
    flatArea: z.number(),
    unit: z.enum(["mm", "in"]),
  }),
  shopRulesVersion: z.string(),
});

export const quoteInput = z.object({
  lines: z.object({ part: checkDfmInput.shape.part, materialId: z.string(), quantity: z.number().int().positive() }).array().min(1),
  shipTo: z.object({ country: z.string(), postalCode: z.string() }),
});

export const quoteOutput = z.object({
  quoteId: z.string(),
  currency: z.string(),
  expiresAt: z.string(),            // ISO 8601
  lines: z.object({ unitPrice: z.number(), total: z.number(), issues: dfmIssue.array() }).array(),
  leadOptions: z.object({ name: z.string(), shipDate: z.string(), price: z.number(), source: valueSource }).array(),
});

export const placeOrderInput = z.object({
  cartId: z.string(),
  approvalToken: z.string(),        // issued to a human reviewer, never minted by a model
  idempotencyKey: z.string(),
});
```

## How DF-LOOP-001 agents source against it

Rule: sourcing never skips the loop. An agent may only check DFM or quote parts for a recipe that already has written results for steps 1 to 3.

1. **Question and delete first.** The design agent receives the surviving recipe from DF-LOOP-001 (one exterior panel SKU, one kit, one grip, one inspection).
2. **Draft parts.** For phase 6, the agent drafts the parts for one exterior gripper: a mounting bracket, a finger plate, a fixture plate. Geometry is generated in code (for example OpenCascade, which Caleb's agent installed on its own in the swingset demo).
3. **Compile against the shop.** Call `check_dfm` per part. Errors go back to the agent with feature references. Warnings are logged.
4. **Feed the loop.** Every DFM error the agent fixes by adding a feature (a relief, a gusset, a second part) is logged as a step 3 candidate: can the feature be deleted instead? Every part whose price is dominated by bends or setup is flagged for simplification.
5. **Quote.** Once all parts compile, call `quote` against one or more shops. Store quote id, prices, and lead options with `source: "declared"`.
6. **Stop for approval.** The agent may call `create_cart`. It may not call `place_order`. Phase 6 already requires "its own yes before parts are purchased"; this spec keeps that gate.
7. **Record outcomes.** After delivery, record actual ship date, fit at assembly, and rework as `source: "measured"` beside the declared values. That record is Brickworks' own answer to the trust question raised on the thread.

## Experiment: reference shop MCP

Goal: learn whether a design agent converges faster and produces simpler parts when it has a shop that explains failures, before any real shop or money is involved.

**What to build (small, local, mock data):**

- `experiments/shop-mcp/` (not created yet), a TypeScript MCP server over stdio using the official MCP TypeScript SDK.
- Mock data: one shop profile, about 10 materials (mild steel, 5052 aluminum, 304 stainless in 3 gauges), one laser and one press brake envelope.
- A deterministic DFM rule set for flat and single-axis bent parts: sheet envelope, minimum hole diameter versus thickness, hole-to-edge and hole-to-bend distance, minimum flange length versus thickness and die, inside bend radius, relief at bend ends. Each rule returns the `dfmIssue` shape above.
- A transparent price model: material area plus cut length plus pierces plus bends plus a setup charge per part. Lead options from a mock capacity calendar. All values labeled `declared` and clearly mock.
- `create_cart` writes a JSON file. `place_order` always refuses without a token and there is no way to mint one in the experiment.

**Harness:**

- Task prompt: design the bracket and finger plate for the DF-LOOP-001 exterior gripper from a short written spec.
- Two arms: the agent gets `check_dfm` with full issue detail, versus the agent gets only pass or fail.
- Measure: iterations to zero errors, total parts, total bends, mock price, wall time, and how many fixes added features versus removed them.

**Then, only if it earns it:**

- Add a second mock shop with a different envelope and price curve; check whether the agent picks a shop for the right reason.
- When OSH Cut publishes its MCP, read its terms and point the same harness at it in read-only mode (DFM and quote only, no cart, no order). Compare its issue detail to the mock rules. Do not scrape or automate the oshcut.com web quote flow; wait for the sanctioned endpoint.

**What it would prove:** whether actionable DFM detail shortens agent design loops and pushes toward deletion, on a toy problem.
**What it would not prove:** real shop accuracy, real prices, structural adequacy, or delivery reliability. Caleb's own MCP does not cover structural engineering, and neither does this.

## Implementation plan

No application code in this commit.

| Phase | What changes | Done when |
| --- | --- | --- |
| 0 | This spec and the people tracker. | Merged. |
| 1 | Add the schema sketch as Zod objects in `packages/contracts` behind no runtime path. | Typecheck and existing tests pass. |
| 2 | Build the reference shop MCP with mock data and the deterministic DFM rules. Unit tests per rule. | Each rule has a passing and a failing fixture. |
| 3 | Run the two-arm harness on the DF-LOOP-001 gripper parts. | A short note in `docs/review/` with measured iteration counts. No dollar claim. |
| 4 | Optional: read-only run against a published real shop endpoint, if its terms allow. | Side-by-side table of issue codes; no orders. |
| 5 | Simulation hook: a receiving scenario that draws lead times from a shop quote file instead of fixed config. | Scenario loads; deterministic replays still match. |
| 6 | Tabletop purchase. Uses the approval gate already in DF-LOOP-001 phase 6. | Human approves a cart; measured outcomes recorded. |

## Open questions and counterpoints

- **Trust.** Declared capability without outcome history "is just a broker listing in a new format" ([post](https://x.com/karanjagtiani04/status/2107972421760540841)). Who holds the history?
- **Liability.** "Who eats the remake?" ([post](https://x.com/Alex_Kranenburg/status/2107969076551414021)). Caleb's answer: nothing changes versus email. Brickworks should still record it.
- **Security.** Auth, scoping, and server vetting; standard interfaces are a standard attack surface ([post](https://x.com/teewealthdev/status/2107964349256225003)). Compliance regimes such as CMMC level 2 need authenticated access ([post](https://x.com/C_lxndr/status/2107973856518648072)).
- **MCP versus OpenAPI or agent skills.** Several replies argue a public OpenAPI spec plus a key is enough. This spec stays protocol neutral.
- **Concentration.** Caleb predicts fewer, larger shops. Others expect tooling to let small shops publish their own endpoints. Brickworks does not need to pick a side to run the experiment.
- **Assembly.** Per-part DFM is the easy half. Joint count, welding, and fixturing are not covered by any shop endpoint we found. Caleb (2026-10-08): "Simple designs are solved. Assemblies aren't."
- **Lanes vs brokers.** Caleb argues participation means building a productizable manufacturing service and tying in APIs, not writing another API broker catalog ([post](https://x.com/OSHBuilt/status/2108201450279154013)). Brickworks stays a buyer + virtual seller experiment; it should not become a shop directory.

## Out of scope

- Contacting OSH Cut or any shop from code.
- Placing real orders.
- Changing the live Replit deployment.
- Publishing a "standard". This is a draft for discussion.
