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
| OSH Cut MCP server | **Still not public (2026-10-14)** | Being handed to selected users ("Need to get you on OSH Cut's MCP", [post](https://x.com/OSHBuilt/status/2108698548535767054)). Multi-part Claude + OSH Cut RC plane demo on 2026-10-09 ([post](https://x.com/OSHBuilt/status/2108575419641606636)). oshcut.com `/mcp` and related paths still 404 as of 2026-10-14. |
| SendCutSend static LLM spec files | **Real, public** | [LLM Search Specs](https://sendcutsend.com/llm-search-specs/): ordering guide `.md`, catalog `.json` (178 materials, 151 hardware items, 25 finishes), engineering specs `.json` (tolerances, bend parameters, material properties, joined by SKU), "Updated daily". No live DFM or quote; Caleb's reaction: "Imagine if it could do real DFM and collision checks" ([post](https://x.com/OSHBuilt/status/2108573255380709702)). |
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
3. **Read freely, buy with approval.** Profile, materials, DFM, and quotes are read tools. Creating a cart is a reversible write. Placing an order spends money and needs a human approval token. A model can never place an order on its own, the same way providers cannot mutate the Brickworks world directly. The approval is one explicit yes on a cart, not a human-only form after the quote (see 2026-10-14 note).
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


## Notes from 2026-10-12 watch

1. **A static tier comes before a live endpoint.** SendCutSend already publishes agent-readable files: an ordering guide, a SKU catalog, and engineering specs that join to it. That is a zero-infrastructure first step any shop can ship. The shop endpoint should treat it as tier 0 (`get_catalog`, `get_design_rules` served from versioned files), with live `check_dfm` and `quote` as tier 1. Caleb's point stands: static rules let an agent self-check, but only the shop can run "real DFM and collision checks" on the actual geometry.
2. **Phase 4 does not have to wait for OSH Cut.** SendCutSend's public spec files can feed the reference shop MCP's mock rules today (bend parameters and size limits as rule inputs, labeled `declared`, source and version recorded). Read the files only; no ordering, no scraping of quote flows, and check their terms before reuse.
3. **Quotes need a confidence tier.** Caleb on hard-to-quote work: "an instant quote that sandbags for proto-level jobs, with a requote process for volume that depends on actual data" ([post](https://x.com/OSHBuilt/status/2108950691888898236)). Add `quoteBasis: "instant_proto" | "requote_on_data"` to the quote shape, and let Brickworks record the requote after the first run as `measured`.
4. **Assemblies are the next frontier.** The 2026-10-09 RC plane is a full multi-part design made of individually manufacturable parts. Per-part DFM passed; fit, collision and flight were not checked ("No idea if it would really fly"). That is the open slot for an assembly-level check in DF-LOOP-001.
5. **Process power is the dark factory moat.** Caleb: "There's no reason that "a physical component" is a moat ... Nikita is probably thinking of "process power," but that takes time to create." ([post](https://x.com/OSHBuilt/status/2109644744867688773)). For Brickworks, the compounding asset is the measured record of every DFM reject, requote and delivery, not owning machines.
6. **Protocol layer interest.** Aaron Slodov (@aphysicist) wants "a new foundational protocol for factories to live on" and called Caleb's thesis "a good start for the layer that lives on top"; Caleb asked to chat ([post](https://x.com/OSHBuilt/status/2108947882086961502)). Worth watching before freezing any schema here.

## Notes from 2026-10-13 watch

1. **The moat is reliable high-mix iteration, not machines.** Caleb agreed ("Exactly", [post](https://x.com/OSHBuilt/status/2109742169045237876)) that "Rapid iteration to create complex, high-mix physical things reliably is a moat", while "physical things" alone "almost never" are ([post](https://x.com/OSHBuilt/status/2109741295736623190)). This sharpens note 5 above: the shop endpoint's value is proving reliability over many quick, varied jobs, so delivered-versus-declared history (on-time rate, DFM-pass-to-good-part rate) belongs in the schema, not just capability.
2. **Lanes get added ahead of demand.** On quick-turn wireforming: "Nobody is asking us for it, but we might add it anyway because people SHOULD be asking for it." ([post](https://x.com/OSHBuilt/status/2109730570880368925)). A tool-and-die shop is building instant-quote stamping and drawing (Obie Industries, per @_baldtires's bio). The `process` field in the capability shape should stay an open list (wireform, stamping, deep draw) rather than an enum of sheet, tube and CNC.
3. **Keep CAD out of the shop system.** Caleb's "Don't :-)" to Carbon (open-source ERP) rolling browser CAD into its ERP/MES ([post](https://x.com/OSHBuilt/status/2109814630608707676)) matches this spec's split: the design agent owns geometry, the shop endpoint only checks, prices and schedules it. Brickworks should not grow a CAD layer inside its plant model.

## Notes from 2026-10-14 watch

1. **Quote-to-order must not hit a human-only form.** Caleb: "\"I would still need that form\" is the most triggering phrase ever." ([post](https://x.com/OSHBuilt/status/2110360367830618322)), quoting Connor Kapoor (@connorkapoor, Digital Metal) on buyer friction. Design principle 3 already separates cart review from `place_order`; the form rant reinforces that the only human step after a successful quote is the explicit cart approval token, not a second web form the agent cannot fill.
2. **End-to-end is alluring, not the plan.** On "The factory of the future provides customers with everything they need to make a product - end to end" ([post](https://x.com/10_X_eng/status/2110360647729106979)), Caleb only said "It's an alluring possibility." ([post](https://x.com/OSHBuilt/status/2110366419443654687)). That stays consistent with productized lanes rather than one shop doing everything; Brickworks should keep sourcing against many specialized endpoints.
3. **Work instructions are a different lane.** He cheered Dirac (@DiracInc) past 2 million parts in BuildOS ([post](https://x.com/OSHBuilt/status/2110363367567446385)). Shop DFM does not cover process design or work instructions; those stay out of DF-SHOP-001 and belong closer to DF-LOOP-001 assembly steps if ever modeled.

## Notes from 2026-10-16 watch

1. **Tube and weld prep belong in DFM, not only flat parts.** Caleb's AI-designed swingset: "it nailed the coping cuts to make weld-ready tube parts! AI + OSH Cut's MCP is incredible!" ([post](https://x.com/OSHBuilt/status/2111102658941690079)). The `check_dfm` and capability shapes should carry tube profile, coping or saddle cuts, and weld-prep features, so a design agent can hand off weld-ready parts. Welding itself stays an assembly step outside the shop endpoint, consistent with the assembly gap in the open questions.
2. **Short lead times come from pooled capacity, so quotes should say so.** On how immediate capacity survives demand swings: "The answer is scale and the statistics of random arrivals." ([post](https://x.com/OSHBuilt/status/2111092897781350823)). A lead-time quote is a statistical promise backed by pooled machine capacity. The quote shape should allow a confidence or on-time-rate field next to the lead time, which also feeds the delivered-versus-declared history from the 2026-10-13 notes.
3. **Enterprise terms can be automated at list price.** Asked whether enterprise contractual obligations needed new hires: "Mostly automated, same price." ([post](https://x.com/OSHBuilt/status/2111093044145500477)). A shop endpoint could expose machine-readable account terms (certs, inspection reports, packaging, payment terms) as part of the buyer's authenticated scope, rather than a separate human sales process.
4. **Public release timing.** "Soon! Probably next week." ([post](https://x.com/OSHBuilt/status/2111094888892715274)). If it ships the week of 2026-10-19, record the real tool names and auth model in the tracker and compare them against the draft tool schema sketch before phase 4 of the implementation plan.

## Notes from 2026-10-19 watch

1. **A DFM rejection is the design loop's best signal.** Claude first designed copes needing steep bevels; OSH Cut's API "told it we can't do that, so it redesigned to avoid violating the 45 degree cut constraint." ([post](https://x.com/OSHBuilt/status/2111106900641341564)). `check_dfm` should return the violated constraint as data (feature, limit such as max bevel 45 degrees, measured value), not just pass or fail, so the design agent can fix it in one more iteration. This is the same rule as DF-LOOP-001 steps 2 and 3: the shop's "no" drives simplification.
2. **The buyer agent brings its own geometry.** "pointing it at OSH Cut's MCP. It downloaded a geometric kernel and wrote a python script to use it." and "Claude ended up using Open Cascade." while OSH Cut licenses a commercial kernel ([post](https://x.com/OSHBuilt/status/2111113033003221325), [post](https://x.com/OSHBuilt/status/2111114260168482966)). The endpoint should accept standard STEP from any kernel and validate on the shop side; Brickworks' design agent can stay on open tooling (Open Cascade or build123d) without matching the shop's kernel.
3. **Price is a live function of quantity.** "It's all dynamic, updated in the cart when you change qty." ([post](https://x.com/OSHBuilt/status/2111106600425722071)). The quote shape should support re-pricing by quantity without a new upload, and the sourcing agent should sweep a few quantities before it asks for cart approval.
4. **Category language to borrow.** Caleb's list, including "Closed-loop, manufacturing-constrained generative design" and "Infrastructure connecting AI design to physical manufacturing" ([post](https://x.com/OSHBuilt/status/2112188198634008706)), is a fair one-line description of what DF-SHOP-001 tests. Use it in the README framing only with attribution.
5. **Many narrow lanes, one buyer agent.** "Each lane is limited by design, but if there are 1000 lanes, you can make anything." ([post](https://x.com/OSHBuilt/status/2111468525558862054)) and "Industrial legos." ([post](https://x.com/OSHBuilt/status/2112176653610917922)). Supports keeping Brickworks a multi-supplier buyer that splits a BOM across lanes, not a single-shop integration.

## Notes from 2026-10-20 watch

1. **The MCP is an access layer over automation the shop already has.** "We've had code that automates g-code generation for years. Our MCP/API layer just makes part DFM checks super accessible to AI agents, so they can design and iterate." ([post](https://x.com/OSHBuilt/status/2112535736478281997)). The reference shop MCP should wrap existing deterministic quote and DFM code, not rebuild it; its job is to make checks cheap to call inside a design loop.
2. **Return the price effect of a design change.** A buyer asked for a tool that would "tell me which feature to change and what that does to the price", and Caleb answered "I have good news for you." then "We'll launch our MCP later this week." ([post](https://x.com/OSHBuilt/status/2112296154776076538), [post](https://x.com/OSHBuilt/status/2112325866860765522)). Add per-feature cost drivers or a price delta for each suggested change to the `quote` / `check_dfm` sketch, so the design agent can trade cost against geometry without a second upload.
3. **The human step is an order link.** "it just took care of it and gave me a link to order the parts." ([post](https://x.com/OSHBuilt/status/2112294684425158926)). Matches the cart-approval design: the agent ends with a cart or order link and a human clicks buy.
4. **Small tool surface, revealed on demand.** Caleb found "progressive revelation of skills" for MCP servers plausible ("Interesting. You might be right.", [post](https://x.com/OSHBuilt/status/2112192843825746061)), echoing the earlier "34 tools down to like 5" reply. Keep the endpoint to a few top-level tools and expose detailed DFM rules only when a check fails.
5. **One simple flow for humans and agents.** "If people are using AI agents to get quotes from you it means your quoting process is too complicated." and "simplicity probably makes it more likely an agent can succeed." ([post](https://x.com/OSHBuilt/status/2111973572537389193), [post](https://x.com/OSHBuilt/status/2112192473275703459)). Do not build an agent-only quote path; the virtual Brickworks seller should expose the same simple flow to both.
6. **Assembly and welding stay open.** "Can't do it today." on a 400-part assembly ([post](https://x.com/OSHBuilt/status/2112536337673019408)) and "Better would just be for OSH Cut to offer welding." ([post](https://x.com/OSHBuilt/status/2112537229503672633)). Welding and assembly remain buyer-side steps in DF-LOOP-001 and a candidate next lane for shops; flat-pack shipping matters if parts must ship unwelded.

## Notes from 2026-10-21 watch

1. **Per-part DFM already sums to an assembly quote.** The Saturn V post ("Just $1.77M", "Every component is manufacturable.", "A couple months, but we can deliver weekly batches", [post](https://x.com/OSHBuilt/status/2112674351774630367), [post](https://x.com/OSHBuilt/status/2112685261788454972), [post](https://x.com/OSHBuilt/status/2112685144893210846)) shows the shop can price and schedule a very large BOM part by part. The `quote` sketch should return a BOM-level total plus a batched delivery schedule, not only a single lead time.
2. **Manufacturable is not engineered.** "(designed by AI, not engineered)" ([post](https://x.com/OSHBuilt/status/2112675831759929379)) and the arch-bracing critique on the swingset ([post](https://x.com/OSHBuilt/status/2112675099463798886)) mark the line: shop DFM answers "can it be made", not "will it hold". DF-LOOP-001 needs a separate structural check (FEA or rules) before cart approval; @ATLSloan's agent-run DFM plus FEA/CFD plus ERP routings ([post](https://x.com/ATLSloan/status/2112583591041630474)) is an example of that buyer-side layer.
3. **Near-zero human correction is the benchmark.** "I had it adjust the width of the swing mounting points, but that's all." ([post](https://x.com/OSHBuilt/status/2112637753301340237)). Track human edits per design as a DF-SHOP-001 metric.
4. **The shop stays a shop.** "I sell sheet metal, not software." ([post](https://x.com/OSHBuilt/status/2112575857533591810)) and the "everything for everyone" post ([post](https://x.com/OSHBuilt/status/2112592278984491169)). The MCP is a sales channel for parts, not a product; the reference spec should keep shop scope narrow and leave design tooling to the buyer agent.

## Notes from 2026-10-22 watch

1. **Expedite is a capacity price, so expose it as one.** "Shipping fast requires excess capacity. Excess capacity cost excess dollars. ergo. charging more for speed is a pure economics problem." ([post](https://x.com/OSHBuilt/status/2113272130846470407)). The `quote` sketch should return lead-time tiers with explicit prices (standard, rush, same-day) so a buyer agent can trade speed for cost instead of asking a human for an expedite.
2. **Design for assembly, not only per-part DFM.** What the AI produced on the swingset was "cut and bent tube, perfect cope cuts, slots for welds, alignment holes for 1/4-20 bolts, a kit assembly that can be disassembled and transported" ([post](https://x.com/OSHBuilt/status/2113060034859163734)). Weld slots, alignment holes and knock-down kits are assembly features; DF-LOOP-001 checks should cover fit-up and transport, not only cut and bend limits.
3. **Generate new geometry, do not just pick from a catalog.** Caleb rejects "standardized parts remixed by AI" as the future: "AI is already pretty good at making new shapes in CAD based on user requirements." ([post](https://x.com/OSHBuilt/status/2113269950836269270)). Keep the reference endpoint geometry-in (upload any part, get DFM and price) rather than a parametric catalog only.
4. **Demand is harness-agnostic.** A Grok Bot user asked for OSH Cut's DFM in his bot ([post](https://x.com/jonwerthen/status/2113023670788509727)) and Caleb answered with the MCP date ([post](https://x.com/OSHBuilt/status/2113059267247046774)). The reference spec should stay plain MCP plus an OpenAPI twin so any agent harness can call it.


## Notes from 2026-10-23 watch

1. **The human channel shipped before the agent channel.** OSH Cut's Metal IQ add-in for Autodesk Fusion puts DFM checks, bend simulation, and buying inside the CAD tool ([Autodesk post](https://x.com/adskFusion/status/2113355301172703647); Caleb: "You can buy from the add-in as well :-)" [post](https://x.com/OSHBuilt/status/2113404527890289124)). The MCP is still unreleased ([GIF reply](https://x.com/OSHBuilt/status/2113400370928169229)). The add-in is evidence that the same quote, DFM, and order APIs can sit behind several front ends; DF-SHOP-001 should treat CAD plugin, web app, and MCP as three clients of one shop service, and record which one a test run used.
2. **DFM in the design loop, not after it.** The add-in's pitch, "Catch fabrication issues before they hit the shop floor", matches the DF-SHOP-001 loop where the agent checks manufacturability while it designs. Add a metric for DFM issues caught before quote versus after quote.
3. **High-mix is the shop profile to model.** Caleb: "The solution is high-mix optimized factories" ([post](https://x.com/OSHBuilt/status/2113278703916782058)) and qty 1 "isn't that hard" ([post](https://x.com/OSHBuilt/status/2113280211857092842)). The spec's virtual-seller assumptions should default to qty 1 to low volume, not batch economics.
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
