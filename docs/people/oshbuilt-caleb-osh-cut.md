# Caleb Chamberlain (@OSHBuilt), OSH Cut

Status: **tracking**. Research notes only. No contact made, no relationship implied.
Started: 2026-10-08
Related spec: [DF-SHOP-001, shop-as-MCP sourcing](../plans/shop-mcp-sourcing.md)

## Who he is

| Field | Value | Source |
| --- | --- | --- |
| Name | Caleb Chamberlain | [OSH Cut About](https://www.oshcut.com/about-osh-cut), [The Fabricator author page](https://www.thefabricator.com/author/caleb-chamberlain) |
| Role | CEO and co-founder, OSH Cut (founded July 2018 with his brother Jacom) | [OSH Cut About](https://www.oshcut.com/about-osh-cut) |
| X | [@OSHBuilt](https://x.com/OSHBuilt), id `1260969445263958024`, about 7.4K followers, bio "CEO, OSH Cut.", Utah | X profile, read 2026-10-08 |
| Company X | [@OSHCutInc](https://x.com/OSHCutInc) | X |
| Background | Electrical engineer (MS EE, BYU, UAV path planning). Spent years ordering custom PCBs online with instant DFM, then built the same experience for sheet metal. Writes code himself ("I've been writing code for three decades"). | [BYU seminar](https://www.me.byu.edu/graduate-seminar-caleb-chamberlain-2025-09-22), [The Fabricator profile](https://www.thefabricator.com/thefabricator/article/cadcamsoftware/how-a-utah-fab-shop-automates-quoting-and-order-processing), [Custom Software In Minutes](https://www.oshcut.com/articles/custom-software-in-minutes) |
| Public writing | Monthly column in The Fabricator; Next-Gen Metal Fab podcast guest | [Author page](https://www.thefabricator.com/author/caleb-chamberlain), [podcast preview](https://www.thefabricator.com/thefabricator/blog/shopmanagement/next-generation-metal-fabrication) |

## OSH Cut in one table

| Topic | What is public | Source |
| --- | --- | --- |
| Business | Direct (not a broker) online sheet metal shop: instant quote, instant DFM, laser cutting (flat and tube), brake and tube bending, hardware, powder coat, deburring. Ships to all 50 US states. | [oshcut.com](https://www.oshcut.com/), [capabilities](https://www.oshcut.com/capabilities) |
| Locations | Spanish Fork, UT plus a second facility ("Two locations, nationwide reach") | [oshcut.com](https://www.oshcut.com/) |
| Equipment (as listed) | Several 10 kW Trumpf 3030 fiber lasers, a 7 kW Trumpf 7000 tube laser, an 8 kW Mazak Optiplex | [capabilities](https://www.oshcut.com/capabilities) |
| Software | All in-house: quoting, DFM, 3D unfold, bend simulation in the browser, nesting, NC post-processing, scheduling, inventory, shipping. Chose not to use an off-the-shelf ERP. | [Scaling with custom software](https://www.oshcut.com/old-articles/scaling-a-metal-fabricator-with-custom-software), [Digital-first manufacturing](https://www.thefabricator.com/thefabricator/blog/lasercutting/the-potential-of-digital-first-manufacturing) |
| Automation level | Front office is automated: "We employ zero estimators, but we can quote more than 100,000 parts per week without straining our systems." Shop floor is still operator run (operators program the lasers from auto-generated nests). No evidence found of lights-out production. | [Digital-first manufacturing, Mar 2026](https://www.thefabricator.com/thefabricator/blog/lasercutting/the-potential-of-digital-first-manufacturing), [Fabricator profile](https://www.thefabricator.com/thefabricator/article/cadcamsoftware/how-a-utah-fab-shop-automates-quoting-and-order-processing) |
| Lead time | Standard lead time cut from five days to two for simple parts in late 2024; paid rush dropped 75%, revenue growth accelerated 100%, 2025 margin was a record (his numbers). | [Digital-first manufacturing](https://www.thefabricator.com/thefabricator/blog/lasercutting/the-potential-of-digital-first-manufacturing) |
| Public contact | support@oshcut.com, quote@oshcut.com, 801-850-7584 | [About](https://www.oshcut.com/about-osh-cut), [oshcut.com](https://www.oshcut.com/) |

## API and MCP status (as of 2026-10-08, 12:05 AM ET)

| Item | Status | Evidence |
| --- | --- | --- |
| Internal quote, lead time, and DFM APIs | **Real.** They power the oshcut.com web app. Not publicly documented. | "The MCP just ties into our existing quote, lead, and DFM APIs." ([post](https://x.com/OSHBuilt/status/2107243952642691485)). A developer replied "I don't see any way to use this API publically?" ([post](https://x.com/10_X_eng/status/2107244803411071487)) |
| OSH Cut MCP server | **Test only, not published.** Used by Caleb with Claude to design a swingset, a brontosaurus, and a firepit housing, each ending in an orderable cart. | "OSH Cut's test MCP server" ([post](https://x.com/OSHBuilt/status/2107600784850636954)); "Sorry, MCP isn't published yet." ([post](https://x.com/OSHBuilt/status/2107246239398101006)) |
| Publication date | **Announced, not shipped.** | "We'll publish it within a week." (2026-10-07, 9:56 AM ET, [post](https://x.com/OSHBuilt/status/2107832476970418580)) |
| Public docs on oshcut.com | None found. `/mcp`, `/api`, `/developers`, `/docs`, `/llms.txt`, `/.well-known/mcp.json` all returned 404 on 2026-10-08. Sitemap has no API or MCP page. | Direct HTTP check from the box |
| Scope of DFM | Per-part manufacturability for sheet and tube. Not structural engineering, not assembly. | "Our MCP says whether it can make the parts, and how, but not structural engineering." ([post](https://x.com/OSHBuilt/status/2107662423822094678)); "Assembly is harder. Accurate component-level DFM is easier." ([post](https://x.com/OSHBuilt/status/2107121347910640065)) |

## Key ideas, with exact quotes

All times ET. Quotes are copied verbatim from the linked posts, including original spelling.

### 1. The thesis post (2026-10-07, 6:09 PM ET)

[x.com/OSHBuilt/status/2107956520172528000](https://x.com/OSHBuilt/status/2107956520172528000). About 40K views, 518 likes, 441 bookmarks, 73 replies, 17 quotes at time of capture.

> OK, here's the future of manufacturing in the US. This is how we will Reindustrialize.
>
> - MCP servers become standardized and as ubiquitous as web pages
> - MCP servers fully define shop capabilities, materials, etc.
> - Every shop has an owned API that provides real-time, first principles, shop-specific DFM, prices, and lead-times
> - AI agents design and source by searching for shops with the right combination of capability, speed, and price
>
> Because all of the above requires savvy most legacy shops don't have, they either fade away or pivot. There will be fewer shops, and they'll be at billion-dollar scale.
>
> This will be an ultra-connected, automated, agent-friendly network of shops. It will completely eliminate the need for brokers and marketplaces - the marketplace is the internet, and information is distributed uniformly via MCP and imminently discoverable by AI agents, who handle almost all sourcing and, eventually, design.
>
> Every design becomes manufacturable by default. Prototyping and production speeds skyrocket. Economies of scale reduce costs as a smaller subset of extremely large shops aggregate enough volume to create meaningful efficiency.
>
> This future is created by the organic, inevitable evolution of information-dense MCP servers and the AI agents that use them. Shops that don't have them become irrelevant, and demand concentrates among the shops that do.
>
> This doesn't require new software, or new marketplaces, or shop-to-shop collaboration tools. Not even a little. It requires 1) maturation of agentic physical design, and 2) a small number of highly competent direct manufacturers who lean in and serve this new ecosystem as it develops.

(The hyphen-as-dash inside the quote is Caleb's original text.)

### 2. DFM is the compiler for hardware

- "There's no instant compilation of hardware YET. OSH Cut's instant design review checks are basically compilation for the hardware world. Today, it's limited to sheet metal." ([2026-10-05](https://x.com/OSHBuilt/status/2107115079405846946))
- "AI agents will interrogate APIs across maybe a dozen productized manufacturers to get the "compilation" results you are talking about." ([2026-10-05](https://x.com/OSHBuilt/status/2107115422407680115))
- "Our APIs do, yeah. If a part can't be made, our APIs tell the agent why. It's an insane unlock that allows the agent to iterate." ([2026-10-07](https://x.com/OSHBuilt/status/2107963521606824010))
- "It's slop if you can't tie into a manufacturers API like this. Claude needs design feedback so it can iterate." ([2026-10-07](https://x.com/OSHBuilt/status/2108025496223256684))

### 3. Live demos with the test MCP

- Swingset: "I just used @claudeai and OSH Cut's test MCP server and in a single prompt, had it design a kit swingset for my kids. It uploaded the parts, iterated based on errors and warnings, then produced a cart of parts, ready to order. It took ~ 5 minutes." ([2026-10-06, 6:35 PM ET](https://x.com/OSHBuilt/status/2107600784850636954)); "It asked permission and installed Python and OpenCascade to do the CAD on its own." ([post](https://x.com/OSHBuilt/status/2107601513740992761)); full prompt in [this reply](https://x.com/OSHBuilt/status/2107601055265755394).
- Brontosaurus: "Claude + OSH Cut designed a life-size brontosaurus in 30 minutes. Hundreds of unique parts, 2,248 feet of tube. 100% manufacturable." ([2026-10-06, 10:40 PM ET](https://x.com/OSHBuilt/status/2107662423822094678)). Model noted as "(this is Opus 5.5 on medium effort, btw)" ([post](https://x.com/OSHBuilt/status/2107666782941245559)).
- Firepit: "Watch Claude design a firepit housing for me and give me a link to order it. This is why I'm bullish about this tech. Its first design failed, but our APIs told it why, and it fixed it." ([2026-10-07, 10:00 PM ET](https://x.com/OSHBuilt/status/2108014699619180865))

### 4. MCP is a vehicle; the API and DFM are the substance

- "True. MCP is optional. I think the API layer and rich DFM information are the critical components." ([post](https://x.com/OSHBuilt/status/2107970058375008597))
- "all we really need is a standard so that agents can grab rich information in a uniform way. It doesn't have to be MCP, but it needs to be something. The API layer itself is the more important piece. Agents need the ability to use DFM-enabled APIs to explore the space of manufacturers automatically, at scale." ([post](https://x.com/OSHBuilt/status/2107961502556889290))
- "But MCP isn't critical for this to happen, it's just a vehicle to expose the APIs." ([post](https://x.com/OSHBuilt/status/2108031295595114778))

### 5. Agents talking to shop software, humans approving

- "It's a network of AIs and software automatically conversing, iterating on design, getting prices and lead times, all with no or minimal human involvement. Jobs just show up, ready to go." ([post](https://x.com/OSHBuilt/status/2107969325416259942))
- "We've been doing business this way almost since we started eight years ago. The MCP/API angle just exposes that rich design feedback to agents on the fly." ([post](https://x.com/OSHBuilt/status/2108005330710151237))
- "It's not the agent that has to figure that out, it's the shop, and it communicates all that via API." ([post](https://x.com/OSHBuilt/status/2107997696934199326))

### 6. Concentration, not a long tail

- "Yeah, amazing public APIs are the unlock, and most shops can't do it. That's why I think there will fewer, larger players." ([post](https://x.com/OSHBuilt/status/2108027914193387914))
- "The other massive hurdle is that the API-driven flow I described only works if the shop has serious digital maturity. Today, that would mean in-house software development, deep process knowledge encoded in automated DFM, etc. Most can't do that, but perhaps AI can help resolve that problem as well." ([post](https://x.com/OSHBuilt/status/2108007016321220620))
- On a claim that small automated shops can ship 3x to 5x with the same headcount: "I'm skeptical that there's a 3x to 5x capacity unlock with the same headcount." ([2026-10-04](https://x.com/OSHBuilt/status/2106741418354250114))

### 7. Where he concedes ground

- Trust and delivery history: "Fair. I wonder where that kind of performance history could live." ([post](https://x.com/OSHBuilt/status/2107975365880934801)), replying to "Declared capability with no outcome history is just a broker listing in a new format."
- Directories: "marketplaces might be a nice place to create a curated list of manufacturers so that agents can interrogate a much smaller set of MCPs. It's not a "marketplace" per-se, just a curated directory that's actionable ("try these APIs")" ([post](https://x.com/OSHBuilt/status/2107964084193026081))
- Authentication: "gating core API functions behind authentication might simply disqualify some vendors." ([post](https://x.com/OSHBuilt/status/2107965492849975547))
- Design behavior: "Best pushback so far. Assumes people will change the way they design." ([post](https://x.com/OSHBuilt/status/2108042809349742929))
- Helpers wanted: "I'd love to see someone help shops plug into this environment" ([post](https://x.com/OSHBuilt/status/2108010991720251564))

## Notable replies and quotes on the thread

| Who | Point | Link |
| --- | --- | --- |
| Karan Jagtiani (@karanjagtiani04) | Declared capability needs delivered-outcome history or it is a broker listing in a new format. | [post](https://x.com/karanjagtiani04/status/2107972421760540841) |
| Alex Kranenburg (@Alex_Kranenburg) | "Who eats the remake?" when a 5-day promise arrives three weeks late and out of tolerance. | [post](https://x.com/Alex_Kranenburg/status/2107969076551414021) |
| Stephen (@teewealthdev) | Auth, scoping, and server vetting become the hard part; standard interfaces are a standard attack surface. | [post](https://x.com/teewealthdev/status/2107964349256225003) |
| RobitOverlord (@10_X_eng, SteveCAD) | OpenAPI plus a key may be enough; large MCP tool lists hurt model coherence ("hack the 34 tools ... down to like 5"). | [post](https://x.com/10_X_eng/status/2108038578496250203) |
| Hudzah (@hudzah) | Shops without this get flooded with unmanufacturable AI-generated parts. | [quote](https://x.com/hudzah/status/2107965074191323315) |
| Matthias Wagner (@MatthiasWagner, Flux) | "AI engineers designing directly against the real-time capabilities, inventory, cost, and constraints of automated factories." | [quote](https://x.com/MatthiasWagner/status/2108028100399530431) |
| Sami Belhareth (@SamiBelhareth) | Expects a forward-deployed motion to help manufacturers set up MCP servers. Caleb: "I'd love to see someone help shops plug into this environment". | [quote](https://x.com/SamiBelhareth/status/2108009625991950710) |
| Ken MacDermid (@ken_macdermid) | Says Steady Steel launched MCP connectors for Claude and ChatGPT last week. Not verified. | [quote](https://x.com/ken_macdermid/status/2107980366598336735) |
| Christian Alexander (@C_lxndr) | CMMC level 2 compliance question. Caleb: sensitive data needs authentication. | [post](https://x.com/C_lxndr/status/2107973856518648072) |

## Relevance to Brickworks

1. **Sourcing for the tabletop stage.** DF-LOOP-001 phase 6 builds one exterior gripper for the surviving SKU. Brackets, fixture plates, and frame parts for a tabletop cell are exactly the flat and bent sheet metal OSH Cut's DFM covers. A design agent that checks DFM before it asks for money is the physical version of the deterministic validation Brickworks already uses for provider commands.
2. **DFM as a deletion signal.** A DFM warning, an extra bend, or a price jump is evidence for loop steps 2 and 3. The shop's API becomes an input to "delete" and "simplify", not only to "buy".
3. **The receiving dock gets a real counterpart.** The simulation already models deliveries and a `shortage` scenario. A shop MCP is a supplier that answers with real prices, lead times, and capacity instead of fixed configuration values.
4. **Brickworks as a shop.** The same contract, pointed the other way, is how a future Brickworks plant would expose its own capability, DFM, price, and lead time to buyers' agents.
5. **Trust is an open slot.** Caleb concedes outcome history has no home yet. Brickworks already separates simulated from measured values and keeps lineage per vehicle; a delivered-versus-declared record is a natural extension.

## Outreach angle

- Builder to builder. Filip builds a virtual dark factory in the open and wants to point its design loop at real shop DFM. Ask how Caleb decided what DFM detail to expose to agents, and offer lessons learned.
- No pitch in first touch. A later, separate conversation could be about the gap Caleb himself named ("help shops plug into this environment"), which overlaps with Filip's FDE team work. Do not lead with it.
- Best channel: X DM or a reply on the thread. Email fallback is the public support inbox (support@oshcut.com); no personal address was found and none should be guessed.
- Drafts live outside the repo (`/workspace/oshcut-outreach-2026-10-08.md` on the agent box). Nothing has been sent, liked, followed, or replied to.

## Watch list

- OSH Cut MCP public release (promised "within a week" of 2026-10-07). When it ships, record the endpoint, auth model, tool names, and any terms of use here, then decide whether DF-SHOP-001 phase 3 can run against it read-only.
- Any OSH Cut public API docs or OpenAPI spec.
- Caleb's next Fabricator column, likely on agentic design.
- Whether OSH Cut adds outcome history (on-time rate, defect rate) to what the MCP exposes.

## Log

Append new entries at the bottom. Format: `YYYY-MM-DD (ET): what changed, with links`.

- 2026-10-08 (ET): Started tracking after the thesis post ([link](https://x.com/OSHBuilt/status/2107956520172528000)). Read about 70 of Caleb's posts from 2026-10-02 to 2026-10-07 (built-in X read tools), the thread's notable replies and quotes, oshcut.com, and The Fabricator columns. Findings: internal quote, lead, and DFM APIs are real but undocumented publicly; the MCP is a test server with publication promised within a week of 2026-10-07; no public docs on oshcut.com; no evidence of lights-out production. Added [DF-SHOP-001](../plans/shop-mcp-sourcing.md).
