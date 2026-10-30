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

## API and MCP status (as of 2026-10-20, 10:35 AM ET)

| Item | Status | Evidence |
| --- | --- | --- |
| Internal quote, lead time, and DFM APIs | **Real.** They power the oshcut.com web app. Not publicly documented. | "The MCP just ties into our existing quote, lead, and DFM APIs." ([post](https://x.com/OSHBuilt/status/2107243952642691485)). A developer replied "I don't see any way to use this API publically?" ([post](https://x.com/10_X_eng/status/2107244803411071487)) |
| OSH Cut MCP server | **Still not public; launch now announced for "later this week" (week of 2026-10-19).** On 2026-10-19, 7:31 PM ET, asked for a demo of design change vs price impact, Caleb replied "We'll launch our MCP later this week. You can just try it :-)". He describes it as an access layer: "Our MCP/API layer just makes part DFM checks super accessible to AI agents, so they can design and iterate." Swingset welded 2026-10-19 using parts Claude designed through the MCP. oshcut.com still has no public endpoint. | ["later this week"](https://x.com/OSHBuilt/status/2112325866860765522) (2026-10-19, 7:31 PM ET); ["MCP/API layer"](https://x.com/OSHBuilt/status/2112535736478281997) (2026-10-20, 9:25 AM ET); ["Soon! Probably next week."](https://x.com/OSHBuilt/status/2111094888892715274) (2026-10-16, 10:00 AM ET); [swingset parts](https://x.com/OSHBuilt/status/2111102658941690079) (2026-10-16); "I tested Claude with OSH Cut's new MCP" ([2026-10-08, 3:53 PM ET](https://x.com/OSHBuilt/status/2108284738121465978)); [Mammoth reply](https://x.com/OSHBuilt/status/2108698548535767054); [RC plane](https://x.com/OSHBuilt/status/2108575419641606636); earlier "Sorry, MCP isn't published yet." ([post](https://x.com/OSHBuilt/status/2107246239398101006)) |
| Publication date | **Overdue against his first estimate; now "later this week" (by about 2026-10-23).** Promised "within a week" of 2026-10-07; on 2026-10-08 night he said DFM APIs are "releasing them soon." On 2026-10-16 he said "Probably next week." On 2026-10-19 he said "We'll launch our MCP later this week." | ([within a week](https://x.com/OSHBuilt/status/2107832476970418580)); ([releasing soon](https://x.com/OSHBuilt/status/2108349510619652220)); ([probably next week](https://x.com/OSHBuilt/status/2111094888892715274)); ([later this week](https://x.com/OSHBuilt/status/2112325866860765522)) |
| Public docs on oshcut.com | Still none. `/mcp`, `/api`, `/developers`, `/docs/api`, `/api/docs`, `/llms.txt`, `/.well-known/mcp.json`, `/mcp.json`, `/agents.json` all 404 on 2026-10-16 (same result on 2026-10-15, 2026-10-14, 2026-10-13, 2026-10-12 and 2026-10-09). | Direct HTTP check from the box |
| Scope of DFM | Per-part manufacturability for sheet and tube. Not structural engineering, not assembly. Simple designs "solved"; assemblies are not. | "Simple designs are solved. Assemblies aren't." ([post](https://x.com/OSHBuilt/status/2108284738121465978)); structural limit ([post](https://x.com/OSHBuilt/status/2107662423822094678)) |

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

### 8. New posts since tracker start (2026-10-08 afternoon through 2026-10-09 morning)

#### Productized manufacturing lanes, not another broker (2026-10-08, 10:22 AM ET)

[x.com/OSHBuilt/status/2108201450279154013](https://x.com/OSHBuilt/status/2108201450279154013). About 7.1K views, 120 likes, 56 bookmarks at capture.

> This is an exciting future. A Cambrian explosion of new designs, enabled by a relatively small set of scaled, agent-friendly manufacturing businesses.
>
> Under the hood, the buildout is less hyped and sexy. It requires manufacturers that can crank out parts, and that's very much NOT an AI play. At least, not yet.
>
> Manufacturing processes must be highly productized and scalable, so that APIs can provide first-principles DFM that matches reality. When parts are ordered, they have to just flow.
>
> We need dozens of productized manufacturing "lanes." Today, OSH Cut and a few other newer manufactures provide sheet metal in this productized way. But we need probably a dozen additional lanes for different types of CNC machining, tolerance requirements, mold creation, textiles, plastics, etc.
>
> This isn't going to be created by some new AI venture, it'll be a bunch of factories operated by people. It's machine maintenance, capacity management, training, hiring, customer support, risk management, marketing, shipping. It's a decades-long grind.
>
> The AI-friendly API layer is a tiny and comparatively easy component of what makes the whole engine function.
>
> So if you believe that what I've described is possible and likely, the best way to participate is not to write yet another API broker catalog. It's to identify a productizeable manufacturing service that doesn't exist yet, build it, serve people directly, tie in APIs, and participate in the coming boom.

Follow-on reply in the same thread ([post](https://x.com/OSHBuilt/status/2108202950611116509)): "And if for some reason the AI boom doesn't revolutionize design the way we all thought it would... well then, you've created a great, profitable, scalable manufacturing business in an era of deep need. Success."

#### "New MCP" demo post (2026-10-08, 3:53 PM ET)

[x.com/OSHBuilt/status/2108284738121465978](https://x.com/OSHBuilt/status/2108284738121465978). About 2.7K views, 95 likes, 22 bookmarks at capture.

> Imagine a world where you design by chatting with an AI agent, and finished parts show up on your doorstep in 24 hours.
>
> Stop imagining, this is already possible! I didn't know it until yesterday, but I tested Claude with OSH Cut's new MCP, and it works better than I could have imagined.
>
> The unlock is two-fold
>
> 1. Agents need a manufacturer that can provide real, first-principles DFM instantly, through APIs. This is critical, because agents today make design misrakes. An API that reports them allows the agent to iterate. This is a massive unlock.
>
> OSH Cut does this, but so far we only support sheet metal and tube. We need more.
>
> 2. Manufacturers need to be set up to handle high mix jobs at scale. Again, OSH Cut does this, though at 100 percent growth year over year, we may bump into capacity constraints. We are expanding capacity as fast as we can.
>
> As more productized services become fully supported and accessible via API, it's going to change how things are designed. I wouldn't have said this last week, but what I saw Claude + OSH Cut accomplish together in the last few days opened my eyes.
>
> Simple designs are solved. Assemblies aren't. Still lots of work to do.

(Spelling "misrakes" and "manufactures" above is Caleb's original text.)

#### Feedback loop / DFM APIs "releasing soon" (2026-10-08, 8:11 PM ET)

[x.com/OSHBuilt/status/2108349510619652220](https://x.com/OSHBuilt/status/2108349510619652220). About 1.9K views, 58 likes at capture.

> AI is great at software because it gets immediate feedback. Does it work, or not? Fast feedback means fast improvement.
>
> AI will become good at physical design for the same reason. It will accelerate when it can ask an actual factory whether the part it just designed can be made.
>
> OSH Cut's DFM APIs prove this. It's already amazing, and it's just getting started. Stay tuned, we are releasing them soon.

#### Skipped

- 2026-10-09 morning RT of @c0nst linking an article titled "Stuck at $3 Million" ([post](https://x.com/OSHBuilt/status/2108566448792859061)): not on manufacturing automation / MCP / dark factories.

### 9. New posts 2026-10-09 late morning through 2026-10-12 morning

Read with the built-in X read tools on 2026-10-12. About 60 posts and replies; most were off topic (see Skipped).

#### Claude + OSH Cut designs a whole RC plane (2026-10-09, 11:08 AM ET)

[x.com/OSHBuilt/status/2108575419641606636](https://x.com/OSHBuilt/status/2108575419641606636). About 7.9K views, 95 likes at capture.

> Here's a design by Claude + OSH Cut working together. It's a radio controlled Edge 540, made from aluminum sheet.
>
> All parts manufacturable and orderable at https://t.co/MuSYSGMDPc.

Follow-on ([post](https://x.com/OSHBuilt/status/2108575873914093761)): "No idea if it would really fly. Should we try? :-) This was prompted by one of our software engineers." Asked whether the display was a Claude-generated GUI, he answered "Yep, in a web browser." ([post](https://x.com/OSHBuilt/status/2108595549947715914)). A reply noted "the Claude to OSH Cut handoff usually breaks on kerf. seeing every part flagged manufacturable means the dfm check ran." ([@RibiryS](https://x.com/RibiryS/status/2108610346579583270)).

This is the first multi-part assembly demo; earlier he said "Simple designs are solved. Assemblies aren't."

#### Static LLM spec files vs live DFM (2026-10-09, 11:00 AM ET)

em m0shouris (@emm0sh) posted: "if you're designing sheet metal, give this page to your agent and it will answer questions for you ... you can set it up as a skill as well" ([post](https://x.com/emm0sh/status/2108571528543752601)), linking SendCutSend's [LLM Search Specs](https://sendcutsend.com/llm-search-specs/) page. Caleb replied:

> Imagine if it could do real DFM and collision checks 🤔

([post](https://x.com/OSHBuilt/status/2108573255380709702))

The SendCutSend page (checked 2026-10-12) offers "Three files for AI agents, integrations, and tools", "Updated daily": an ordering guide (`.md`), a catalog (`.json`, "178 materials, 151 hardware items, and 25 finishes") and engineering specs (`.json`, "Tolerances, bend parameters, and material properties for design validation. Joins to the catalog by SKU."). File URLs: [ordering guide](https://cdn.sendcutsend.com/specs/sendcutsend-ordering-guide.md), [catalog v1.2](https://cdn.sendcutsend.com/specs/sendcutsend-catalog-v1.2.json), [specs v1.2](https://cdn.sendcutsend.com/specs/sendcutsend-specs-v1.2.json).

#### "Need to get you on OSH Cut's MCP" (2026-10-09, 7:18 PM ET)

Reply to Eric (@Mammoth, runs @McMasterDaily), whose post read "Claude's really ambitious on press brake capabilities. Time for some DFM rules." ([post](https://x.com/Mammoth/status/2108681555191181427)):

> Need to get you on OSH Cut's MCP

([post](https://x.com/OSHBuilt/status/2108698548535767054)). Suggests the MCP is being handed to selected users before public release. Same evening he cheered an "AI designed this laser cut tube" post from Clay (@SCH_Clay, "Trying to reindustrialize America. Mostly via brackets."): "Let's go! So awesome." ([post](https://x.com/OSHBuilt/status/2108724868246286784)).

#### Instant quoting that sandbags prototypes (2026-10-10, 12:00 PM ET)

Reply to Jason Premo (@JasonPremoMFG), a Swiss lathe shop owner arguing instant AI quoting fails on tiny burr-prone parts ([post](https://x.com/JasonPremoMFG/status/2108942447455641902)):

> Super interesting, actually. I love insight from guys with tons of experience.
>
> Maybe the answer is an instant quote that sandbags for proto-level jobs, with a requote process for volume that depends on actual data.
>
> eg. "Let's make some and find out."

([post](https://x.com/OSHBuilt/status/2108950691888898236))

#### Open to a factory protocol conversation (2026-10-10, 11:48 AM ET)

Aaron Slodov (@aphysicist; bio: "Building the future of manufacturing: @atomic_inc, @reindsummit, @newindustrials") quoted Caleb's thesis post: "here's a good start for the layer that lives on top of what i described" ([post](https://x.com/aphysicist/status/2108946441276412171)), pointing back to his own call for "a new foundational protocol for factories to live on" ([post](https://x.com/aphysicist/status/2107829801683951776)). Caleb:

> I'd love to chat about what you have in mind. Or read an article about it. :-)

([post](https://x.com/OSHBuilt/status/2108947882086961502))

#### AI drafts, it does not engineer (2026-10-10, 11:54 AM ET)

> Agreed! If you teel AI exactly what you are looking for, it handles it just fine. Up to a limit, which is growing faster than ever.
>
> Vague prompts create vague outcomes.
>
> That might change, but for now, drafting is the task it's good at, not engineering.

([post](https://x.com/OSHBuilt/status/2108949390258036887); "teel" is his original spelling). On AI checking engineering for liability, he told a story of a stamped beam drawing sized wrong and concluded: "I don't know if I'd in general trust AI, but it can also be hard to trust humans." ([post](https://x.com/OSHBuilt/status/2109020233587737013))

#### Small shops and revenue per employee (2026-10-11, 11:09 AM ET)

Quoting Thaaat Colin's (@ThaaatColin) "This is why we have so many of these small shops. They are the unappreciated backbone of Americas supply chain" chart post ([post](https://x.com/ThaaatColin/status/2109250116007973030)):

> Every shop owner should understand this graph.

([post](https://x.com/OSHBuilt/status/2109300282375188626); about 5K views, 40 bookmarks). A shop owner replied that the in-between headcount "will burn you out" ([post](https://x.com/Manufacture_IT/status/2109621252390318551)); Caleb: "Same. It gets harder, then easier." ([post](https://x.com/OSHBuilt/status/2109642784307294649))

#### A physical component is not a moat (2026-10-12, 9:57 and 10:13 AM ET)

Quoting a viral post (about 1.1M views) that said the only moats left are "Proprietary data", "Network effects" and "A physical component" ([post](https://x.com/i/status/2109497987055640958)):

> There's no reason that "a physical component" is a moat.
>
> Helmer's "Seven Powers" is a really great way to look at this. Nikita is probably thinking of "process power," but that takes time to create.

([post](https://x.com/OSHBuilt/status/2109644744867688773)). Then:

> Let's not all get misty-eyed about physical businesses. It's not a "moat" just to do things that AI can't yet touch.
>
> The world is crammed with physical businesses. There are still plenty of humans more than willing to compete if your business is good. Arbitrage is real.

([post](https://x.com/OSHBuilt/status/2109648607360282670)). Replying to "Capex is a moat.": "If your business is amazing, your margins are better than average, and your market is significant, capex is not a barrier at all. If your business is average or mediocre or your market is tiny, it doesn't matter if you have a moat." ([post](https://x.com/OSHBuilt/status/2109657748283777046))

#### Bot spam warning (2026-10-09, 1:34 PM ET)

> Started posting about AI and manufacturing, and now my posts are getting spammed by random bots.

([post](https://x.com/OSHBuilt/status/2108611961697243167)). Any reply from Filip must read as clearly human and specific.

#### Skipped

- Software "engineer" title and PE license debate, 2026-10-10 (many replies, e.g. [post](https://x.com/OSHBuilt/status/2108956018600550549)).
- AI consciousness debate with @robleclerc, 2026-10-10.
- Collapsing yard culvert, 2026-10-09 ([post](https://x.com/OSHBuilt/status/2108636228849680792)), and small talk replies.
- Pointing a larger-order customer to support@oshcut.com ("tell them Caleb said to reach out"), 2026-10-11 ([post](https://x.com/OSHBuilt/status/2109321529670701432)): sales routing, not automation.

### 10. New posts 2026-10-12 late morning through 2026-10-13 10:45 AM ET

Read with the built-in X read tools on 2026-10-13. 30 posts and replies; most continued the moat argument or were off topic (see Skipped). No MCP or API release.

#### Physical things are not a moat; reliable high-mix iteration is (2026-10-12, 4:21 PM ET)

[x.com/OSHBuilt/status/2109741295736623190](https://x.com/OSHBuilt/status/2109741295736623190). About 4.7K views, 179 likes, 23 bookmarks at capture.

> Only a guy who doesn't make physical products would say, generically, that physical things are a moat.
>
> It can be. It almost never is.
>
> That is the entire reason manufacturing has generally failed to attract venture capital in the US.

Peter Holderith (@_baldtires; bio "Tool and die. Developing instant-quote sheet metal stamping/drawing at Obie Industries", New Hampshire) replied: "Rapid iteration to create complex, high-mix physical things reliably is a moat, but there's a gaping chasm between that and just "physical things"" ([post](https://x.com/_baldtires/status/2109741886256931007)). Caleb:

> Exactly

([post](https://x.com/OSHBuilt/status/2109742169045237876))

Earlier in the same argument, to @aphysicist: "I'm obviously pro manufacturing, but we have to be real here. There's no instrinsic "moat" in physical things. Most manufacturers are low margin, commodity businesses. The opposite of a business with a moat. Protected from AI, sure. But no default moat." ([post](https://x.com/OSHBuilt/status/2109670067600560605); "instrinsic" is his original spelling). To "Switching costs" framing from @bradwatton ("already being an approved supplier and actually answering the phone"): "Switching costs!" ([post](https://x.com/OSHBuilt/status/2109661829437993262)). On regulation: "regulatory barriers may protect from overseas competition, but it does not protect you from other US manufacturers." ([post](https://x.com/OSHBuilt/status/2109745221257015596)). On copycats: "They WILL if your market is meaningful and your margins are attractive. There are more copycats than innovators." ([post](https://x.com/OSHBuilt/status/2109753009148444953)). On speed: "You can't rely on execution savvy as a moat - brilliant people are everywhere, and if your business is attractive, it'll attract brilliant operates who compete with it." ([post](https://x.com/OSHBuilt/status/2109675069249376568); "operates" is his original text).

#### A new lane nobody asked for: quick-turn wireforming (2026-10-12, 3:38 PM ET)

Michael Kornuta (@Michaelkornuta; NORAMARK, sourcing from US manufacturers) asked "is there a market for quick turn wireforming? ... so much of this work goes straight to production quantities" ([post](https://x.com/Michaelkornuta/status/2109729553350611052)). Caleb:

> Nobody is asking us for it, but we might add it anyway because people SHOULD be asking for it.

([post](https://x.com/OSHBuilt/status/2109730570880368925)). First hint of OSH Cut adding a productized lane beyond sheet and tube.

#### CAD inside the ERP/MES: "Don't" (2026-10-12, 9:13 PM ET)

Brad Barbin (@barbinbrad, co-founder of @carbon_ms, "a next-gen, open-source manufacturing ERP") asked: "engineers, thoughts on us rolling CAD into the ERP/MES? ... We could make it essentially free, browser based and CMMC compliant and tied directly to the configurator" ([post](https://x.com/barbinbrad/status/2109808789771706499)). Caleb:

> Don't :-)

([post](https://x.com/OSHBuilt/status/2109814630608707676)), then "Also, don't mind me, I don't know anything. Just hard to be good at everything." ([post](https://x.com/OSHBuilt/status/2109819039782707661)). Barbin later listed @OSHBuilt among "some of my favorite founders from the manufacturing world" ([post](https://x.com/barbinbrad/status/2110011582424232403)); Caleb: "Flattered :-)" ([post](https://x.com/OSHBuilt/status/2110015460574167545)).

#### Small DFM asides

- On a machined bracket: "Woah! Should have been fabricated tube. :-)" (2026-10-13, 10:42 AM ET, [post](https://x.com/OSHBuilt/status/2110018405495693551)).
- @OSHCutInc posted a customer-style build video, "We designed and built a set of custom steel dumbbells using OSH Cut's services" (Caleb RT, [post](https://x.com/OSHBuilt/status/2109677414171476336)).

#### Skipped

- Recruiter and PE cold-outreach complaints: "Yup" to "5 gazillion recruiting firms ... cold email you" ([post](https://x.com/OSHBuilt/status/2109707579995910346)) and "So tiring and endless. This isn't the kind of rando search PE firm you want to do business with." ([post](https://x.com/OSHBuilt/status/2109805814286622799)). Not on topic, but it reinforces: no cold pitch, nothing that reads like a search firm.
- Garry Tan "maximal agentic loops" profitability post: "Good advice, thank you." ([post](https://x.com/OSHBuilt/status/2109780939140452505)).
- Video game, RPG, software-developer title, "affine, technically" and "Silver Tsunami" course jokes, and small talk, 2026-10-12 to 2026-10-13.

### 11. New posts 2026-10-13 10:45 AM ET through 2026-10-14 10:35 AM ET

Read with the built-in X read tools on 2026-10-14. 22 posts and replies; mostly off topic (see Skipped). No MCP or API release, and a keyword search of his posts for MCP, API, DFM, agent, quoting and manufacturing in this window returned nothing.

#### Buying friction: "I would still need that form" (2026-10-14, 9:21 AM ET)

Quoting Connor Kapoor (@connorkapoor; bio "Founder @digitalmetalinc, CAD enthusiast, fastest castings in the west!"), who posted "please please please just let me pay you for your goods and services please!" ([post](https://x.com/connorkapoor/status/2110151808924495898)). Caleb:

> "I would still need that form" is the most triggering phrase ever.

([post](https://x.com/OSHBuilt/status/2110360367830618322)). Earlier reply to the same post: "God save us" ([post](https://x.com/OSHBuilt/status/2110170895394456008)). The point for DF-SHOP-001: a quote is only useful to an agent if it can turn into an order without a human-only form in between. The approval gate should be one explicit yes on a cart, not paperwork.

#### End-to-end factory (2026-10-14, 9:45 AM ET)

RobitOverlord (@10_X_eng; "US Army Vet || prev Red Hat / Intel") posted "The factory of the future provides customers with everything they need to make a product - end to end." ([post](https://x.com/10_X_eng/status/2110360647729106979)). Caleb:

> It's an alluring possibility.

([post](https://x.com/OSHBuilt/status/2110366419443654687)). Noncommittal, which fits his earlier view that the future is many productized lanes, not one shop doing everything.

#### Work instructions at scale (2026-10-14, 9:33 AM ET)

Fil Aronshtein (@FilArons, CEO of @DiracInc, "Automating Work Instructions and Process Design") posted "We @DiracInc have passed 2 Million Parts uploaded to BuildOS by our customers." ([post](https://x.com/FilArons/status/2110349301700264233)). Caleb:

> A billion parts is an amazing goal!!

([post](https://x.com/OSHBuilt/status/2110363367567446385)). Dirac is a name to watch for the assembly and work-instruction side of a dark factory, which shop DFM does not cover.

#### Small quantities of wireforms (2026-10-13, 10:21 PM ET)

In the wireforming thread, @Michaelkornuta asked "what do people do for small quantities now? just buy off the shelf?" ([post](https://x.com/Michaelkornuta/status/2110193818779992447)). Caleb: "Clamp it in a machine vice and crank on it until it bends. Probably." ([post](https://x.com/OSHBuilt/status/2110194357655744749)). No sign yet that OSH Cut has started the lane.

#### Skipped

- Yard culvert follow-ups (city meeting, "Definitely going to do the cheapest option and kick the can on the full repair."), 2026-10-13 to 2026-10-14.
- Smoking post and replies, 2026-10-13.
- "Sophisticated." lol image (a court exhibit of a hidden recording device), Unity licensing, indie game studios, C Corp vs LLC, and small talk.

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
- Caleb complained on 2026-10-09 that AI and manufacturing posts draw bot spam ([post](https://x.com/OSHBuilt/status/2108611961697243167)). A reply must be short, specific and obviously from a person; no link footer in a public reply.
- Best channel: X DM or a reply on the thread. Email fallback is the public support inbox (support@oshcut.com); no personal address was found and none should be guessed.
- Drafts live outside the repo (`/workspace/oshcut-outreach-2026-10-08.md` on the agent box). Nothing has been sent, liked, followed, or replied to.

## Watch list

- OSH Cut MCP / DFM API public release (promised "within a week" of 2026-10-07; on 2026-10-08 he said "releasing them soon"; on 2026-10-16 "Probably next week"; on 2026-10-19 "We'll launch our MCP later this week."; on 2026-10-21 evening "Single-digit days."). Still 404 on oshcut.com as of 2026-10-22. When it ships, record the endpoint, auth model, tool names, and any terms of use here, flag it to Filip, then decide whether DF-SHOP-001 phase 4 can run against it read-only.
- Any OSH Cut public API docs or OpenAPI spec.
- Caleb's next Fabricator column, likely on agentic design.
- His promised post on what changed in 2025 ("A few things. I'll post about it later.", 2026-10-16).
- Whether OSH Cut adds outcome history (on-time rate, defect rate) to what the MCP exposes.
- Whether Caleb and Aaron Slodov (@aphysicist, Atomic / Reindustrialize) publish anything on a factory protocol layer.
- Whether OSH Cut ships static LLM spec files like SendCutSend's, or a tiered prototype vs volume quote.
- Whether OSH Cut adds wireforming as a new productized lane, and whether Obie Industries (@_baldtires) ships instant-quote stamping.
- Dirac (@DiracInc, BuildOS work instructions) and Digital Metal (@connorkapoor, fast castings) as adjacent lanes.

## Log

Append new entries at the bottom. Format: `YYYY-MM-DD (ET): what changed, with links`.

- 2026-10-08 (ET): Started tracking after the thesis post ([link](https://x.com/OSHBuilt/status/2107956520172528000)). Read about 70 of Caleb's posts from 2026-10-02 to 2026-10-07 (built-in X read tools), the thread's notable replies and quotes, oshcut.com, and The Fabricator columns. Findings: internal quote, lead, and DFM APIs are real but undocumented publicly; the MCP is a test server with publication promised within a week of 2026-10-07; no public docs on oshcut.com; no evidence of lights-out production. Added [DF-SHOP-001](../plans/shop-mcp-sourcing.md).

- 2026-10-09 (ET): Weekday watch (prior scheduled run on 2026-10-08 failed). New relevant posts since tracker start: productized "lanes" / anti-broker call ([link](https://x.com/OSHBuilt/status/2108201450279154013) + [follow-on](https://x.com/OSHBuilt/status/2108202950611116509)); "new MCP" Claude demo and high-mix unlock ([link](https://x.com/OSHBuilt/status/2108284738121465978)); DFM-as-feedback-loop with "releasing them soon" ([link](https://x.com/OSHBuilt/status/2108349510619652220)). Skipped RT of "Stuck at $3 Million". Re-checked oshcut.com MCP/API paths: still 404. Updated API/MCP status table and DF-SHOP-001 notes on productized lanes.

- 2026-10-12 (ET): Weekday watch covering 2026-10-09 late morning to 2026-10-12 11:00 AM (built-in X read tools; no run on the weekend). Relevant: Claude + OSH Cut RC plane assembly demo ([link](https://x.com/OSHBuilt/status/2108575419641606636)); "Imagine if it could do real DFM and collision checks" on SendCutSend's static LLM spec files ([link](https://x.com/OSHBuilt/status/2108573255380709702)); "Need to get you on OSH Cut's MCP" to @Mammoth ([link](https://x.com/OSHBuilt/status/2108698548535767054)); sandbagged proto quote plus data-driven requote ([link](https://x.com/OSHBuilt/status/2108950691888898236)); open to chat with @aphysicist on a factory protocol layer ([link](https://x.com/OSHBuilt/status/2108947882086961502)); "drafting is the task it's good at, not engineering" ([link](https://x.com/OSHBuilt/status/2108949390258036887)); small-shop graph ([link](https://x.com/OSHBuilt/status/2109300282375188626)); "a physical component" is not a moat, process power is ([link](https://x.com/OSHBuilt/status/2109644744867688773)); bot spam complaint ([link](https://x.com/OSHBuilt/status/2108611961697243167)). MCP still not public; oshcut.com paths still 404. Updated DF-SHOP-001 with a static spec tier, tiered quotes and the process power note.

- 2026-10-13 (ET): Weekday watch covering 2026-10-12 11:00 AM to 2026-10-13 10:45 AM (built-in X read tools, 30 posts). Relevant: "physical things" are almost never a moat ([link](https://x.com/OSHBuilt/status/2109741295736623190)) and "Exactly" to reliable high-mix iteration being the real moat ([link](https://x.com/OSHBuilt/status/2109742169045237876)); might add quick-turn wireforming "because people SHOULD be asking for it" ([link](https://x.com/OSHBuilt/status/2109730570880368925)); "Don't" to Carbon rolling CAD into its ERP/MES ([link](https://x.com/OSHBuilt/status/2109814630608707676)); "Should have been fabricated tube" ([link](https://x.com/OSHBuilt/status/2110018405495693551)). New names in threads: Peter Holderith (@_baldtires, tool and die, instant-quote stamping at Obie Industries, NH) and Brad Barbin (@barbinbrad, Carbon open-source ERP). MCP still not public; no MCP/API/DFM posts from @OSHBuilt or @OSHCutInc; oshcut.com paths still 404. Added 2026-10-13 notes to DF-SHOP-001.

- 2026-10-14 (ET): Weekday watch covering 2026-10-13 10:45 AM to 2026-10-14 10:35 AM (built-in X read tools, 22 posts). Relevant but minor: "I would still need that form" is the most triggering phrase ever, on buyer friction ([link](https://x.com/OSHBuilt/status/2110360367830618322)); "It's an alluring possibility." to an end-to-end factory of the future ([link](https://x.com/OSHBuilt/status/2110366419443654687)); "A billion parts is an amazing goal!!" to Dirac passing 2 million parts in BuildOS ([link](https://x.com/OSHBuilt/status/2110363367567446385)); small-quantity wireform reply ([link](https://x.com/OSHBuilt/status/2110194357655744749)). MCP still not public; oshcut.com paths (including `/mcp.json` and `/agents.json`) still 404. Possible DF-SHOP-001 note, not yet applied: keep the quote-to-order path free of human-only forms, so the only human step is the explicit cart approval. No outreach opening today.

- 2026-10-15 (ET): Weekday watch covering 2026-10-14 10:35 AM to 2026-10-15 10:40 AM (built-in X read tools, 7 posts). Relevant: "This is huge!" quoting Formlabs' Form Studio 1, a $699 professional resin printer ([link](https://x.com/OSHBuilt/status/2110382524434440261)); "Really insightful. I was wondering." quoting István Csanády (@istvan_csanady) on NVIDIA open-sourcing the SMlib b-rep kernel ([link](https://x.com/OSHBuilt/status/2110494245627080846)), a CAD-kernel thread worth reading for agentic design. Outreach signal: Caleb publicly called out @ZanderioAI for overnight emails claiming to be "synchronizing" data from OSH Cut, "Whatever you are doing, stop. This uninvited spam sales tactic is slimy." ([link](https://x.com/OSHBuilt/status/2110380901964399030)). That reinforces the no-pitch, human, specific first touch, and argues against any automated or bulk email to OSH Cut. Skipped: Intel pivot, distribution vs product, indie game marketing, and a robotics progress reply. MCP still not public; oshcut.com paths (`/mcp`, `/api`, `/developers`, `/mcp.json`, `/agents.json`, `/.well-known/mcp.json`, `/llms.txt`) still 404. Possible DF-SHOP-001 note, not yet applied: a shop MCP should make agent identity and consent explicit (who is asking, on whose behalf), so legitimate buyer agents are distinguishable from scrapers like the one Caleb called out. No outreach opening today.

- 2026-10-16 (ET): Weekday watch covering 2026-10-15 10:40 AM to 2026-10-16 10:40 AM (built-in X read tools, about 40 posts). **MCP release now dated:** asked by @photoncmndr "Is access public yet?", Caleb: "Soon! Probably next week." ([link](https://x.com/OSHBuilt/status/2111094888892715274)). **New agentic design demo:** "Parts for the AI-designed swingset. The most impressive part is that it nailed the coping cuts to make weld-ready tube parts! AI + OSH Cut's MCP is incredible!" ([link](https://x.com/OSHBuilt/status/2111102658941690079)), closing out his 2026-10-07 "I'll build this and let you know how it goes." Growth: "OSH Cut is accelerating. We're on track to double revenue this year, and we're adding capacity as fast as we can to keep lead times short!" ([link](https://x.com/OSHBuilt/status/2110824482348859531)); "~ $0 raised, btw. Cash flow positive in month three, no outside investment except $180k from my Dad and a HELOC on my house to buy our first laser." ([link](https://x.com/OSHBuilt/status/2110834925956149271)); "most of our revenue comes from enterprises across hundreds of industries" ([link](https://x.com/OSHBuilt/status/2110834387436839359)); "we have two factories now, more on the way" ([link](https://x.com/OSHBuilt/status/2110848912412287092)). What changed in 2025: marketing director, "We dropped our default lead-time to just 2 days (for simple parts)", service improvements, enterprise relationships ([link](https://x.com/OSHBuilt/status/2111084958353895618)); enterprise contract obligations "Mostly automated, same price." ([link](https://x.com/OSHBuilt/status/2111093044145500477)); immediate capacity under rising demand: "The answer is scale and the statistics of random arrivals." ([link](https://x.com/OSHBuilt/status/2111092897781350823)); competitors "had enough cash to operate at a loss for two years, then raised $6 million, then raised $100 million" ([link](https://x.com/OSHBuilt/status/2111094044860227654)). Market size: "Today, online-native manufacturers handle around 1% of the addressable high-mix metal fab market. I think it might get as high as 30% in the next decade." ([link](https://x.com/OSHBuilt/status/2110753018643882462)) and "we are collectively growing 50% per year, compared to low single-digit growth nationwide. Volume is shifting." ([link](https://x.com/OSHBuilt/status/2110754473908068744)). Reindustrialization, quoting Aaron Slodov (@aphysicist): "\"What China does, but in the USA\" is not a strategy! Understand that." ([link](https://x.com/OSHBuilt/status/2110780211465953652)); "The imperative to reindustrialize is real, but it takes more than saying \"this is important!\" to survive." ([link](https://x.com/OSHBuilt/status/2110783898405966281)); "We need a compelling value-add besides just price to survive. We can't count on gov't intervention to rescue us." ([link](https://x.com/OSHBuilt/status/2110786125480783893)). Outreach signal: he told a stranger asking to bounce ideas "Sure, shoot me a message." ([link](https://x.com/OSHBuilt/status/2110875426365284855)), so his DMs are open to specific, human asks. Skipped: loan rates, the OSH acronym, waterjet ("We might"), Google ad complaint, thanks and small talk. oshcut.com MCP/API paths still 404. Added 2026-10-16 notes to DF-SHOP-001 (tube and weld-prep DFM, capacity pooling behind lead-time quotes, machine-readable enterprise terms). Outreach opening flagged to Filip; nothing posted, liked, followed, or sent.

- 2026-10-19 (ET): Weekday watch covering 2026-10-16 10:40 AM to 2026-10-19 10:30 AM (built-in X read tools, 53 posts; no weekend runs). **DFM API as a design constraint, in his words:** "AI designed these parts with coping cuts that couldn't be made. OSH Cut automatic DFM APIs said it wouldn't work. AI fixed it and made the coping cuts perfect and weld-ready." ([link](https://x.com/OSHBuilt/status/2111112147820581031)); "Yes, up to 45 degree bevels. Claude (the AI) originally designed the copes that required extremely steep angles. Our API told it we can't do that, so it redesigned to avoid violating the 45 degree cut constraint. Super crazy." ([link](https://x.com/OSHBuilt/status/2111106900641341564)); "good, laser-ready coping cuts are *hard* to model correctly. Claude didn't break a sweat." ([link](https://x.com/OSHBuilt/status/2111114795533611172)). **How the demo was built:** "Literally just chatting with Claude Code and pointing it at OSH Cut's MCP. It downloaded a geometric kernel and wrote a python script to use it." ([link](https://x.com/OSHBuilt/status/2111113033003221325)); "We license one of the big commercial geometric kernels for our APIs. Claude ended up using Open Cascade." ([link](https://x.com/OSHBuilt/status/2111114260168482966)); pricing "It's all dynamic, updated in the cart when you change qty." ([link](https://x.com/OSHBuilt/status/2111106600425722071)). **MCP release:** asked "is that mcp out yet", "Hopefully next week." ([link](https://x.com/OSHBuilt/status/2111115420619169987)) on 2026-10-16, so the target is the week of 2026-10-19; "I'm thinking so." to MCP accelerating tube bending orders ([link](https://x.com/OSHBuilt/status/2111112518450233704)). **Positioning language (2026-10-19):** "Phrases to watch: - \"Closed-loop, manufacturing-constrained generative design\" - \"Manufacturing execution layer for AI-generated hardware\" - \"Infrastructure connecting AI design to physical manufacturing\" - \"Manufacturing infrastructure for autonomous hardware design\"" ([link](https://x.com/OSHBuilt/status/2112188198634008706)); on @KamStaszewski's "A cutting-edge metal part factory at your fingertips": "That's the best one :-)" ([link](https://x.com/OSHBuilt/status/2112189017743851581)). **Productized lanes:** "This got me thinking..." quoting @c0nst's 28-year history of productized lanes ([link](https://x.com/OSHBuilt/status/2111458627831963916)); "Each lane is limited by design, but if there are 1000 lanes, you can make anything." to @aphysicist ([link](https://x.com/OSHBuilt/status/2111468525558862054)); "The point of productizing a limited service is to eliminate spreadsheets and guesswork." ([link](https://x.com/OSHBuilt/status/2111472709658124789)); "Industrial legos." on a build sourced from SendCutSend, OSH Cut, RMFG and McMaster-Carr ([link](https://x.com/OSHBuilt/status/2112176653610917922)); tube flaring "No flaring yet (but I want to add it)." ([link](https://x.com/OSHBuilt/status/2111468234537099726)); same-day shipping is already a rush option ([link](https://x.com/OSHBuilt/status/2111115385672225174)); "speed requires excess capacity, but the bigger you get, the less excess capacity you need. The enabler is scale." ([link](https://x.com/OSHBuilt/status/2111195989021503779)). **Outreach signal:** he called out an AI-written reply from @DavidCrysler, "Bro, why the AI? Can't we just have a conversation?" ([link](https://x.com/OSHBuilt/status/2111184349190336928)) and "Tell me this doesn't read like AI" ([link](https://x.com/OSHBuilt/status/2111195018497319394)). Any reply or DM must be short, plain and obviously human. Skipped: Tesla FSD, supercar thrusters, controls-compute banter, trolls, dinosaur diner, small talk. oshcut.com paths (`/mcp`, `/api`, `/developers`, `/mcp.json`, `/agents.json`, `/.well-known/mcp.json`, `/llms.txt`) still 404. Added 2026-10-19 notes to DF-SHOP-001. Flagged the fresh positioning post to Filip with a draft reply; nothing posted, liked, followed, or sent.

- 2026-10-20 (ET): Weekday watch covering 2026-10-19 10:30 AM to 2026-10-20 10:30 AM (built-in X read tools, 36 posts). **MCP launch announced:** to @ludwim_i, who asked for a demo showing a design change and its price impact side by side, "We'll launch our MCP later this week. You can just try it :-)" ([link](https://x.com/OSHBuilt/status/2112325866860765522), 2026-10-19 7:31 PM ET), after "I have good news for you." to "would love it to just tell me which feature to change and what that does to the price" ([link](https://x.com/OSHBuilt/status/2112296154776076538)). **What the MCP is, in his words:** "We've had code that automates g-code generation for years. Our MCP/API layer just makes part DFM checks super accessible to AI agents, so they can design and iterate." ([link](https://x.com/OSHBuilt/status/2112535736478281997)). **Swingset built, and his post went wide (about 13.4K views, 438 likes when read):** "I don't know what's going to happen to CAD software. But Claude Code downloaded Python and OpenCascade and just designed what I wanted on its own. Probably nothing." ([link](https://x.com/OSHBuilt/status/2112296675285090705)); "Literally none! I asked Claude to design it using OSH Cut's MCP, and it just took care of it and gave me a link to order the parts. It downloaded and used Python and OpenCascade." on what CAD he used ([link](https://x.com/OSHBuilt/status/2112294684425158926)); "Welding this AI-designed swingset together now. Pretty hefty build!" ([link](https://x.com/OSHBuilt/status/2112239071942815861)); "AI-designed swingset, nearing completion." ([link](https://x.com/OSHBuilt/status/2112292431593161187)); "it designed the coping cuts wrong, in a way that the tube laser couldn't handle (extreme cut angles). Our APIs flagged the issue, and it *correctly* figured out how to model the coping cuts so it'd just go together. Mind blowing." ([link](https://x.com/OSHBuilt/status/2112242680919110026)). **Limits he concedes:** "Can't do it today. We'll see what it can do tomorrow." to a 400-part assembly where one broken mate cascades ([link](https://x.com/OSHBuilt/status/2112536337673019408)); "Better would just be for OSH Cut to offer welding." when asked about rivets for people who can't weld ([link](https://x.com/OSHBuilt/status/2112537229503672633)); "Great point. That'd be important for productizing it." on flat-pack shipping ([link](https://x.com/OSHBuilt/status/2112542488363930087)). **Closing the loop:** "Does FreeCAD plug into factory and machine-specific APIs to close the loop on manufacturability?" ([link](https://x.com/OSHBuilt/status/2112302857634648120)); "The factory." to who owns the feedback loop between factory floor and AI model ([link](https://x.com/OSHBuilt/status/2112296955045109973)). **MCP design:** "Interesting. You might be right." to @waynenilsen arguing progressive revelation of skills beats big skills for MCP servers ([link](https://x.com/OSHBuilt/status/2112192843825746061)). **Simplicity vs agents:** his 2026-10-18 8:11 PM ET post "If people are using AI agents to get quotes from you it means your quoting process is too complicated. The underlying problem is over-complexity, not a lack of automation." ([link](https://x.com/OSHBuilt/status/2111973572537389193)) and follow-up "Agent use is probably mostly decoupled from sales webpages. In fact, simplicity probably makes it more likely an agent can succeed." ([link](https://x.com/OSHBuilt/status/2112192473275703459)); "If you could instant quote (and could absorb a little risk if the software makes mistakes), you could scale like crazy on the back of the simplicity." ([link](https://x.com/OSHBuilt/status/2112544952593117379)). **Shop economics and reindustrialization:** on micro shops, "Fewer than 8 people, $2M laser that cuts super fast, owned building, only takes large production jobs for big OEMs. So it's definitely possible. But I suspect that such opportunities are few and have limited lifetime." ([link](https://x.com/OSHBuilt/status/2112193698050290014)) and "Main issue is that great financials attract competitors. People are smart and motivated." ([link](https://x.com/OSHBuilt/status/2112204323090559339)); "Anyone who owns a factory that's already standalone profitable without AI." on who isn't larping in manufacturing ([link](https://x.com/OSHBuilt/status/2112293341870374921)); "In the interim, manufacturing will be a scarce resource as demand exceeds capacity." to one person renting a factory ([link](https://x.com/OSHBuilt/status/2112537092609995251)). Skipped: trust-fund policy, VC runway meme, Tesla hardware, OSH Cut trophies retweet, Autodesk license thread, swing strength, thanks and small talk. oshcut.com paths (`/mcp`, `/api`, `/developers`, `/mcp.json`, `/agents.json`, `/.well-known/mcp.json`, `/llms.txt`) still 404. Added 2026-10-20 notes to DF-SHOP-001. Not flagged to Filip today (yesterday's flag still stands; the launch itself is the next trigger); nothing posted, liked, followed, or sent.

- 2026-10-21 (ET): Weekday watch covering 2026-10-20 10:30 AM to 2026-10-21 10:25 AM (built-in X read tools, 24 posts). **End-to-end AI build done:** "Went together super well! The entire assembly was designed by AI, made by OSH Cut." ([link](https://x.com/OSHBuilt/status/2112619961684472049)); "I had it adjust the width of the swing mounting points, but that's all." on whether he corrected dimensions before sending files ([link](https://x.com/OSHBuilt/status/2112637753301340237)); "This is 1020 DOM. 2\" OD, with 1.75\" OD sleeves so the tubes can slot together. It's about $1500 in parts. Definitely more expensive than a mass produced swingset from China." ([link](https://x.com/OSHBuilt/status/2112625232569897304)); "I guess if I just asked for a swingset, it could have sent me a link to something for $500, made in China, sold on Amazon. But instead I asked it to design one using parts made at oshcut.com :-)" ([link](https://x.com/OSHBuilt/status/2112672342241591508)); "You'd have to ask Claude, it designed it, not me ;-)" ([link](https://x.com/OSHBuilt/status/2112644672673956242)); "With AI, yep. We've built some pretty cool stuff over the years." to "first end to end build" ([link](https://x.com/OSHBuilt/status/2112663131545894990)). **Assembly-scale quote:** "Oh look, a full-scale Saturn V rocket made out of OSH Cut parts. Just $1.77M. Can your sheet metal vendor quote something like this? ;-)" ([link](https://x.com/OSHBuilt/status/2112674351774630367)), "(designed by AI, not engineered)" ([link](https://x.com/OSHBuilt/status/2112675831759929379)), "Yep! Every component is manufacturable." to "can you manufacture it?" ([link](https://x.com/OSHBuilt/status/2112685261788454972)), "A couple months, but we can deliver weekly batches :-)" on lead time ([link](https://x.com/OSHBuilt/status/2112685144893210846)). **Positioning:** "I sell sheet metal, not software." ([link](https://x.com/OSHBuilt/status/2112575857533591810)); "Conversion of manufacturable parts to g-code is a relatively easy closed-form problem." to skipping 3D modeling for direct g-code ([link](https://x.com/OSHBuilt/status/2112570231013151043)); "The temptation to be everything for everyone kills the best businesses. Don't compete in markets where you aren't special. Don't offer services that don't fit your model. Keep your cost structure low and your operations simple." ([link](https://x.com/OSHBuilt/status/2112592278984491169)) and "You can do whatever you want if you preserve efficiency, good execution, and operational simplicity." ([link](https://x.com/OSHBuilt/status/2112598856378839133)). Thread note: @ATLSloan had an agent take the swingset post to "a full DFM, drawing package, FEA/CFD, and ERP routings" ([link](https://x.com/ATLSloan/status/2112583591041630474)); @Jedi_Beasticles flagged missing arch bracing, Caleb: "Designed to mount on footings." ([link](https://x.com/OSHBuilt/status/2112675099463798886)). Skipped: Cheesecake Factory revenue side thread, Mercor joke, small talk. No MCP launch post yet ("later this week" from 2026-10-19 still pending); oshcut.com paths (`/mcp`, `/api`, `/developers`, `/mcp.json`, `/agents.json`, `/.well-known/mcp.json`, `/llms.txt`) still 404. Added 2026-10-21 notes to DF-SHOP-001. Not flagged to Filip (the launch is the trigger); nothing posted, liked, followed, or sent.

- 2026-10-22 (ET): Weekday watch covering 2026-10-21 10:25 AM to 2026-10-22 10:32 AM (built-in X read tools, 10 posts, all replies or quotes). **MCP launch slipped from "later this week" to "single-digit days":** to @jonwerthen, whose post read "I need my Grok Bot to have the DFM capabilities of @OSHBuilt." ([link](https://x.com/jonwerthen/status/2113023670788509727)), Caleb: "MCP coming very, very soon. Single-digit days." ([link](https://x.com/OSHBuilt/status/2113059267247046774), 2026-10-21 8:06 PM ET); "Single-digit days until release! :-)" to @PaulJMcCain asking "Can we (customers) use MCP yet?" ([link](https://x.com/OSHBuilt/status/2113060435910181346)); "Single-digit days. Soon." to @jalabran25 ([link](https://x.com/OSHBuilt/status/2113059469890576578)). Note the demand is now coming from Grok Bot users too, not only Claude users. **What the AI actually designed on the swingset:** "In fairness, there are only so many ways to build a swingset. What it designed, specifically, are the CAD models for the cut and bent tube, perfect cope cuts, slots for welds, alignment holes for 1/4-20 bolts, a kit assembly that can be disassembled and transported, and all" ([link](https://x.com/OSHBuilt/status/2113060034859163734), text truncated by the API). **Future of CAD:** to @markessien's "the future of CAD will be standardized parts that can be remixed by AI", Caleb: "I don't think so. There are infinite possible shapes and infinite applications. And AI is already pretty good at making new shapes in CAD based on user requirements." ([link](https://x.com/OSHBuilt/status/2113269950836269270)). **Venture scale in mature manufacturing:** "In fairness, the market size isn't in question. It's whether you can reasonably capture venture-scale share in an already-mature market. They need to see some kind of unlock. In the case of SCS and Nox, it's a new business model, enabled by customized SW, and aided by a ..." ([link](https://x.com/OSHBuilt/status/2113057789912465525), quoting @coltonblack on electronics manufacturing); "For sure. But \"what China has, but here\" also isn't a venture bet." ([link](https://x.com/OSHBuilt/status/2113243817545756750)). **Expedite pricing:** "- Shipping fast requires excess capacity. - Excess capacity cost excess dollars. ergo. charging more for speed is a pure economics problem. It's not a moral problem." ([link](https://x.com/OSHBuilt/status/2113272130846470407)). Skipped: "I remember this. Great article." and "Fair, I'm not familiar with what you are doing specifically." oshcut.com paths (`/mcp`, `/api`, `/developers`, `/mcp.json`, `/agents.json`, `/.well-known/mcp.json`, `/llms.txt`) still 404. Added 2026-10-22 notes to DF-SHOP-001. Not flagged to Filip (a slipped date is not the launch); nothing posted, liked, followed, or sent.

- 2026-10-23 (ET): Weekday watch covering 2026-10-22 10:32 AM to 2026-10-23 10:25 AM (built-in X read tools, 19 posts, two reads). **New OSH Cut product: Metal IQ add-in for Autodesk Fusion.** Autodesk Fusion announced it on 2026-10-22, 3:42 PM ET: "The new @OSHCutInc Metal IQ add-in for Autodesk Fusion brings DFM checks and bend simulation into your design workflow" and showed it at FABTECH, OSH Cut booth North Hall N9120 ([post](https://x.com/adskFusion/status/2113355301172703647), [Autodesk blog](https://www.autodesk.com/products/fusion-360/blog/osh-cut-metal-iq-add-in-for-fusion/)). Caleb quoted it: "Check it out! OSH Cut's bend simulation software right inside Autodesk Fusion!" ([post](https://x.com/OSHBuilt/status/2113383078001570105), 178 likes). Asked for a "Buy Now" add-in, he replied "You can buy from the add-in as well :-)" ([post](https://x.com/OSHBuilt/status/2113404527890289124)), so DFM, quote, and order now live inside the CAD tool for humans. **MCP still not public:** to @10_X_eng's "Is the MCP public yet?" ([post](https://x.com/10_X_eng/status/2113384286933917847)) Caleb answered only with a "We get there when we get there" GIF ([post](https://x.com/OSHBuilt/status/2113400370928169229)). The "later this week" date (week of 2026-10-19) has effectively slipped again. **High-mix factories:** to @markessien's "Manufacturing still requires scale", Caleb: "The solution is high-mix optimized factories (like OSH Cut and others)." ([post](https://x.com/OSHBuilt/status/2113278703916782058)) and "I've designed far too many things to think replacing bespoke design with legos would actually work and produce better outcomes. It's not that hard to make qty 1 of something, and when you ramp up to 1000+, the \"you need scale\" problem is solved." ([post](https://x.com/OSHBuilt/status/2113280211857092842)). **Moats in reindustrialization ventures** (continuing the @coltonblack thread): "Execution isn't a moat ;-) There might be one in there, though." ([post](https://x.com/OSHBuilt/status/2113620638984515708)) and "In significant markets, great businesses invite competition, and there are a lot of smart, motivated, experienced operators out there. Good execution is the table stakes." ([post](https://x.com/OSHBuilt/status/2113627653479772511)). Skipped: AI cybersecurity replies, the @coltonblack back-and-forth on tone, and an emoji reply. oshcut.com paths (`/mcp`, `/api`, `/developers`, `/llms.txt`, `/.well-known/mcp.json`) still 404. Added 2026-10-23 notes to DF-SHOP-001. Not flagged to Filip (the add-in is a CAD plugin, not the API or MCP launch); nothing posted, liked, followed, or sent.

- 2026-10-26 (ET): Weekday watch covering 2026-10-23 10:25 AM to 2026-10-26 10:30 AM (built-in X read tools, two reads: 25 most recent posts plus a search of his original posts back to 2026-10-23; older replies from 10-23 to 10-25 not read). **Agent-friendly manufacturers thesis, in his words:** quoting Dylan Morris (@Dylan_Morri) "SUPPLY CHAIN IS A SEARCH PROBLEM", Caleb: "Agreed. This is why a future of agent-friendly manufacturers will tend to soak up demand. When every modern shop offers descriptive capability details, quote automation, and DFM through API, search will be easy." ([link](https://x.com/OSHBuilt/status/2113996522480378093), 2026-10-24). **Agentic design demos:** "Hexapod with 200 lb payload capacity. Took Claude an hour to design, complete with parts list and link to OSH Cut to buy the parts." ([link](https://x.com/OSHBuilt/status/2113747184499978569), 47.5K views); "AI isn't yet very good at complex assemblies and moving parts. But damn, it's persistent. Give it a relatively simple challenge with an impossible constraint, and watch it crank." ([link](https://x.com/OSHBuilt/status/2114022356633145386)); "when I asked an AI agent to design something \"impossible.\" It just kept going until it found a way." ([link](https://x.com/OSHBuilt/status/2114046186869108854)). **New tube tool in progress:** "Modeling laser and weld-ready coping cuts in CAD is super tricky. I'm not even sure how to do it, tbh. But we are cooking up something to help. Check out the three way miter and coping cuts in this design." ([link](https://x.com/OSHBuilt/status/2114389819828920492)); "Nothing off the shelf designs miters and copes for a tube laser that can do +/-45 degree bevel cuts." ([link](https://x.com/OSHBuilt/status/2114436219665072427)); "Just tinkering with a tube assembly designer to make tube assemblies easier." ([link](https://x.com/OSHBuilt/status/2114481407515070733)); on its cost estimate: "Right now, it's what OSH Cut would charge you to order all the component parts as designed. No welding yet." ([link](https://x.com/OSHBuilt/status/2114411525352153132)); "No tab slot yet, but I'll add it." ([link](https://x.com/OSHBuilt/status/2114421309346349243)); "Just testing auto-cope design." ([link](https://x.com/OSHBuilt/status/2114443729373388986)); a customer building hardtail kits said they had been playing with the tool ([link](https://x.com/OSHBuilt/status/2114391817068458235) is Caleb's reply). Built with "Claude, Opus 5.5." ([link](https://x.com/OSHBuilt/status/2114460921976521046)); "It's 1:30 AM and I'm sitting here building new software with Claude and Opus 5.5. It's addictive. Like playing Factorio." ([link](https://x.com/OSHBuilt/status/2114620954735431937)). **Grok Bot CAD sighting:** Caleb replied "Damn." ([link](https://x.com/OSHBuilt/status/2114600875247522171)) to @M3NT8L, whose Grok Bot took dims and photos of a part and split the CAD job across several Grok Build CLI agents ([link](https://x.com/M3NT8L/status/2114211044071715319)). **Moats:** "If your only \"moat\" is that there aren't other skilled operators out there, I have bad new for you." ([link](https://x.com/OSHBuilt/status/2114533277826724070)) and "Jack needs to read \"7 Powers\" by Hamilton Helmer." ([link](https://x.com/OSHBuilt/status/2114564604630311056)). Skipped: VC/cash-flow meme, vulnerabilities, playground, small talk, customer RT. No MCP or API launch post; oshcut.com paths (`/mcp`, `/api`, `/developers`, `/llms.txt`, `/.well-known/mcp.json`) still 404. Added 2026-10-26 notes to DF-SHOP-001. Nothing posted, liked, followed, or sent.

- 2026-10-27 (ET): Weekday watch covering 2026-10-26 10:30 AM to 2026-10-27 10:35 AM (built-in X read tools, one read, 11 posts). **Agent-made CAD showing up at shops:** to @KennethCassel's "seeing a whole lot of Open CASCADE STEP translator 7.8 1 part names lately" ([link](https://x.com/KennethCassel/status/2114785811099189577)), Caleb replied "Probably nothing" ([link](https://x.com/OSHBuilt/status/2114786158333002021)). Open CASCADE is the kernel under code-CAD tools that agents tend to use, so this reads as a wry nod to AI-generated parts arriving in volume (interpretation, not confirmed). **Machine downtime is the lights-out limiter:** Kenneth's laser went down when a "bearing block caught fire" and he got a Bosch factory opened overnight for parts ([link](https://x.com/KennethCassel/status/2114722059804635413)); Caleb: "Oof, I feel this deeply. It's so disruptive when machines go down, and they do break. These days, we have a standing weekly meeting with Trumpf to discuss what's currently broken (we have a lot of their machines)." ([link](https://x.com/OSHBuilt/status/2114758560303472999)). **Order-path features:** "Pro-tip : you can white-label ship this with your own custom \"company name\" and \"logo.\"" ([link](https://x.com/OSHBuilt/status/2114741525691458004), 150 likes) and "You can set up white-label shipping options in your account settings." ([link](https://x.com/OSHBuilt/status/2114746392791126320)); on content limits: "We don't have a formal policy, but there's a limit to what we'll want to make." ([link](https://x.com/OSHBuilt/status/2114744851975880847)). Skipped: "physical AI layer" quote-tweet (link only), Microducks quote, small talk. No MCP or API launch post; oshcut.com paths (`/mcp`, `/api`, `/developers`, `/llms.txt`, `/.well-known/mcp.json`) still 404. Added 2026-10-27 notes to DF-SHOP-001. Nothing posted, liked, followed, or sent.

- 2026-10-28 (ET): Weekday watch covering 2026-10-27 10:35 AM to 2026-10-28 10:30 AM (built-in X read tools, one read, 25 posts; a few posts between about 10:35 AM and 1:19 PM on 10-27 may be past that page and were not read). **Auto-cope tool is live-ish and framed as upload DFM:** "Modeling perfect coping cuts is so hard in CAD. That's been a constant challenge: it means we get bad part uploads constantly. Finally fixing this. This tool takes your part, infers the mating surface, then makes laser-cuttable coping cuts perfectly matched to it." ([link](https://x.com/OSHBuilt/status/2115147648135245934), 2:24 PM, 176 likes); "It finds anything that the tube laser can't cut and fixes it. And it supports three different coping strategies (normalized, \"tight\" fit, and \"groove\" for welding)" ([link](https://x.com/OSHBuilt/status/2115216270874275892)); "1) Normalized - the laser cuts normal to the tube surface, and selects a profile that makes contact with the target tube(s) everywhere 2) Tight - leverages the +/- 45 degree cuts of the tube laser to stay as close to the target tube as..." ([link](https://x.com/OSHBuilt/status/2115225006397329578)); on the target angle: "Can be anything you choose to target. Eg. 45 degrees, 90 degrees, anything in between. It'll do its best to get as close to that number as possible, constrained by the laser." ([link](https://x.com/OSHBuilt/status/2115268319175708761)). Thread on why it is hard: "These problems are deceptively complex, because the laser has to transition from the inner wall to the outer during the cut" ([link](https://x.com/OSHBuilt/status/2115255843910545807), 7.5K views); "And the number of ways files can be broken is innumerable." ([link](https://x.com/OSHBuilt/status/2115256585065041959)); "And when a cope-cut involves 4+ tubes, it gets pretty gnarly." ([link](https://x.com/OSHBuilt/status/2115256915496448161)); "Oh, don't forget about correcting cope cuts that mate with bent tubes." ([link](https://x.com/OSHBuilt/status/2115257301657632876)); "You have to fix the coping cuts but leave tabs in place." ([link](https://x.com/OSHBuilt/status/2115258024550072743)); "Sometimes tubes are bent. Have to deal with that." ([link](https://x.com/OSHBuilt/status/2115258317958426639)). On alternatives: "Wire EDM - job done next year sometime. Band saw - can't do anything complex. Tube laser - super fast, but tubes have to be designed right." ([link](https://x.com/OSHBuilt/status/2115282777264574522)). **Agent purchasing hint:** to @c0nst's "@bot just bought me a movie ticket. all on its own. buying a piece of metal shouldn't much harder." ([link](https://x.com/c0nst/status/2115199581504041040)), Caleb: "I have good news" ([link](https://x.com/OSHBuilt/status/2115235443663122735)). Reads as the MCP being close, but no launch post. **AI-native factories:** to @zachglabman's three most common manufacturing decks (CNC rollups, supplier marketplaces, AI-native quoting/ERP/factory OS) ([link](https://x.com/zachglabman/status/2115231247345868889)), Caleb: "rollup: meh / marketplace: f-off / ai-native: show me your factory" ([link](https://x.com/OSHBuilt/status/2115236695448932566), 38 likes); on "venture equity is the wrong way to fund a factory": "Pretty big statement, considering recent high-profile, unicorn-valuation venture raises. I tend to agree, but I'm of course biased." ([link](https://x.com/OSHBuilt/status/2115230251890659361)). **PO and payment terms:** on a shop owner whose risk audit ranked PO entry as the top operational risk after a customer silently changed net 30 to net 60 ([link](https://x.com/c0nst/status/2115195321366327759)), Caleb: "Quick fact - if customers ask for anything > net 60, we decline to offer terms at all." ([link](https://x.com/OSHBuilt/status/2115225504488001904)) and explained net terms as enterprise purchasing at scale: "POs require internal approvals, which vary based on vendor and check size. Ordered goods are received at the dock, generating \"receipts\". Invoices are received from the vendor." ([link](https://x.com/OSHBuilt/status/2115284140438495397)). Skipped: laser slat cleaning and slat hog small talk, Noahpinion, candy truck, carbon fiber reply, Saturn V joke. No MCP or API launch post. Added 2026-10-28 notes to DF-SHOP-001. Nothing posted, liked, followed, or sent.

- 2026-10-29 (ET): Weekday watch covering 2026-10-28 10:00 AM to 2026-10-29 10:26 AM (built-in X read tools, two reads: 20 posts plus a search for MCP posts from @OSHBuilt or @OSHCutInc since 10-28 10 PM, which returned none). **MCP launch looks imminent:** to @BarkNyrk's "yo u got that mcp up yet" ([link](https://x.com/i/status/2115597849631314328)), Caleb: "I think it's going out tomorrow." ([link](https://x.com/OSHBuilt/status/2115606789412839717), 10-28 8:48 PM). That points to 2026-10-29 as launch day; no launch post yet at 10:26 AM, and oshcut.com paths (`/mcp`, `/api`, `/developers`, `/llms.txt`, `/.well-known/mcp.json`) still 404. **Against AI quoting:** quoting a shop that found AI auto-quotes 200-500% high on eight 304ss lathe parts ([link](https://x.com/i/status/2115460195933430175)), Caleb: "1) Don't use \"AI\" quoting. AI can help write software, but don't involve an AI agent in quoting component parts. 2) Quote from first-principle using actual toolpaths on your actual machines. 3) Profit." ([link](https://x.com/OSHBuilt/status/2115479925507645805), 102 likes, 30 bookmarks). **Auto-cope tool going public:** "We'll probably make this software public and free, once we've proven it works." ([link](https://x.com/OSHBuilt/status/2115473280685781020)) and "It's not, but we'll probably make it public and free." ([link](https://x.com/OSHBuilt/status/2115473372717171147), on whether it is open source). **Capacity / reindustrialization:** "Welp. Opened a factory in Cincinnati, moved all midwest/east volume over there. Aaand the Utah factory is at capacity again." ([link](https://x.com/OSHBuilt/status/2115583050000351354), 10.3K views, 426 likes); "New laser in Cincinnati today." ([link](https://x.com/OSHBuilt/status/2115472995154337894)); "Oh, this was definitely a brag, not even trying to be humble." ([link](https://x.com/OSHBuilt/status/2115589991669850237)). **Positioning:** quote-tweeting the Karp "better to be feared" clip: "If you get metal from anywhere besides OSH Cut, your competitors will beat you by being faster, more economical, more agile, more innovative." ([link](https://x.com/OSHBuilt/status/2115619609202360576)); "It's the 8th power." ([link](https://x.com/OSHBuilt/status/2115623464472318418), on whether OSH Cut as a supplier is one of the 7 Powers). Skipped: city question, emoji replies, moped weld compliment, hammer drill, RT of OSH Cut Halloween ad. Added 2026-10-29 notes to DF-SHOP-001. Nothing posted, liked, followed, or sent.

- 2026-10-30 (ET): Weekday watch covering 2026-10-29 10:20 AM to 2026-10-30 10:25 AM (built-in X read tools, three reads: 2 posts since the last run, a search for OSH Cut MCP/API/agent posts since 10-28, and one lookup of the quoted post). **MCP did not visibly ship on 10-29:** the search found no launch post from @OSHBuilt or about OSH Cut since the "going out tomorrow" reply; treat it as slipped, still pending. **Shop CAD data as AI training data:** Michael Davidson (@mike_revenue) posted "We have $20M to spend next month on CAD ... Manufacturing and industrial equipment makers ... If they have CAD, we want them" ([link](https://x.com/mike_revenue/status/2115578598241579168), 62K views, 403 bookmarks). @peteoxenham quoted it asking what share of the CAD bought from shops is "at best ethically dubious to obtain, and at worst illegal" ([link](https://x.com/i/status/2115831063608242271)); Mike replied that "primary concern for every deal is always the legal process around data rights" ([link](https://x.com/i/status/2115832329340125611)). Caleb: "Legal percentage uncertain. Almost 100% unethical." ([link](https://x.com/i/status/2116168116262863117)) and to Mike: "Might be \"legal,\" still likely unethical." ([link](https://x.com/i/status/2116168248148513235)). Read: shops hold customer CAD they do not own, and Caleb sees selling it as a breach of customer trust. Added 2026-10-30 note to DF-SHOP-001. Nothing posted, liked, followed, or sent.
