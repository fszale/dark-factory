# Michigan Plant Optimization Blueprint

Status: **plan, not implemented**. Nothing in this document is built into the Brickworks simulation, deployed at a plant, or backed by a partner agreement. Plans do not authorize implementation.
Date: 2026-10-11
Repo: [fszale/dark-factory](https://github.com/fszale/dark-factory) (Brickworks)
ID: `DF-PLANT-001`
Related: [NVIDIA industrial AI stack notes](nvidia-industrial-ai-stack.md), [physical AI startup landscape](physical-ai-startup-landscape.md), [robotics scan 2026-10-12](../research/ziegler-weekly-robotics-2026-10-12.md), [Joint Design Loop, DF-LOOP-001](spacex-design-loop.md), [architecture](../architecture.md), [simulation behavior](../simulation.md), [station adapter boundary](../station-adapters.md), [release evidence](../release-evidence.md)

This plan describes how the ideas behind Brickworks could be applied to one existing mid-size manufacturing plant in Michigan: start from a measured baseline, add a digital twin and vision quality checks on one line, run a bounded robotics pilot, add an agent operations layer that keeps humans in charge, and only then work toward an unattended cell. It is a public, vendor-neutral outline, not an offer, a commitment or evidence of results.

## The problem

Many small and mid-size suppliers are being asked to retool, reshore and launch new lines with fewer skilled people. The robots and AI tools exist: NVIDIA's physical AI stack is in use at large automotive plants, and a wave of startups now sell vision inspection and robot skills that run on cameras and arms a plant already owns. What a mid-size plant usually lacks is someone who connects the data, picks the right tools, runs the change and keeps people in control. The gap is integration and operations, not robots.

## Principles

1. **Question before optimizing.** Delete or simplify first, automate second, add robots last. This is the same order as [DF-LOOP-001](spacex-design-loop.md).
2. **One plant, one line, measured weekly.** Every stage has a baseline and a scoreboard. A change stays only if the scoreboard moves.
3. **Humans approve every consequential action.** Agents read, summarize, draft and propose. Supervisors, quality engineers, maintenance leads and buyers approve. Agents never write to PLCs or robot controllers.
4. **Simulate before you spend.** A robot cell or a layout change is tried in a twin first, through the robot OEM's tools where possible.
5. **Declared is not measured.** Vendor claims and simulated results stay separate from plant measurements, the same rule the [station adapter boundary](../station-adapters.md) applies to simulated and measured observations.

## Stages

Timeline in weeks from kickoff. Stages overlap on purpose.

| Stage | When | What happens | Output |
| --- | --- | --- | --- |
| A. Assessment | weeks 0 to 2 | Question each step first (see below), then OEE baseline per line, downtime Pareto, scrap and quality escapes, and a data access map (MES, ERP, historian, CMMS, cameras) | baseline scoreboard and **one** constraint to attack first; go or no-go |
| B. Digital twin and vision QA pilot | weeks 3 to 12 | On one line: video search and summarization agents on existing cameras for shift and incident summaries; a CAD-trained defect detector on an edge computer at one station; a lightweight line twin for bottleneck what-ifs | scrap and escapes compared with the stage A baseline; a per-unit inspection log |
| C. Robotics pilot | weeks 8 to 20 | One or two vetted vendors: machine tending on an existing arm, or autonomous material flow between cells; the cell is validated in simulation first, then installed by a local integrator | cell or spindle utilization, labor hours moved to higher-value work, safety sign-off |
| D. Agent operations layer | week 2 onward | Grok Bot agents, read-only first, then drafting, then human-approved actions (see below) | weekly outcome scoreboard |
| E. Path toward lights-out cells | months 6 to 12 | One product family, one cell: an unattended third shift with an on-call human, then scale only what the scoreboard supports | unattended hours per week, OEE of that cell |

### Stage A: question before optimizing

For each bottleneck, first ask whether the step, inspection, handoff or report should exist at all. If it should not, delete it. If it must stay, simplify it. Only then consider automation, and add robots last. Many plant bottlenecks are an approval loop, a duplicate inspection or a report nobody reads, and those are cheaper to remove than to automate.

The assessment ends with **one** constraint to attack first, not a long priority list. Stages B and C start from that constraint. Michigan's manufacturing extension partner offers a free technology assessment that can feed this stage (see [public programs](#public-funding-and-support-programs)).

## Agent operations layer

A small fleet of agents runs the plant's operating rhythm, with named human approval on anything consequential.

| Agent | Reads | Proposes | Human approver |
| --- | --- | --- | --- |
| Shift report | MES or historian, video summaries, andon events | shift handoff report | supervisor |
| Quality | inspection logs, SPC | drift alerts, containment and 8D starts | quality engineer (any hold, release or customer notice) |
| Maintenance | CMMS, alarms, machine data | preventive and repair work orders ranked by downtime impact | maintenance lead |
| Scheduling | ERP orders, capacity | next schedule and changeover order | scheduler |
| Supplier | purchase orders, inbound status | supplier follow-ups, vendor watchlist updates | buyer (every send and purchase) |
| Chief of staff | all of the above, shared plant memory | weekly review and next experiments | plant manager |

**Weekly outcome scoreboard:** OEE, scrap rate, unplanned downtime minutes, quality escapes and on-time delivery. Each agent proposes at most one experiment per week. The plant manager adopts or rejects it based on the measured result.

**Guardrails:** agents never write to PLCs or robot controllers. Any action that touches machines, quality disposition, customers, suppliers or money needs a named human approval. Data that must stay in the plant is served by on-premises models.

## Additions from the 2026-10-12 robotics scan

Source: [research note](../research/ziegler-weekly-robotics-2026-10-12.md). All five are **plan, not implemented**.

1. **Fleet orchestration decision (stages B and C).** Before a second robot vendor arrives, decide between vendor-native controllers and one orchestration layer for arms, AMRs and conveyors (Mujin OS, Formant or InOrbit class), and model that layer in the line twin.
2. **Robots-as-a-service pilot terms (stage C).** Prefer pilots with an integration fee plus monthly support over a large purchase, with uptime and throughput targets tied to the stage A baseline and a clean exit at the go or no-go.
3. **Operator demonstration data program (stage A onward).** With worker consent and any labor agreement in place, record manual stations as training data for future robot skills and as examples for vision QA.
4. **Model portability and data ownership (all stages).** Keep robot hardware and AI model vendors separable, and require that plant sensor, robot and inspection data stay exportable. The agent operations layer reads this data under the same human-approval guardrails.
5. **Vendor scorecard fields.** Record supply-chain origin for robots and compute, and keep humanoids on a separate watchlist outside committed scope.

## Roles

- Plant sponsor (plant manager or COO): owns the scoreboard and approves experiments.
- Engagement lead: runs the assessment, picks tools, coordinates vendors and the agent layer.
- Quality engineer, maintenance lead, scheduler and buyer: approvers for their agents.
- Controls or IT/OT engineer: data access, network segmentation and cybersecurity.
- Local robot integrator: installs and signs off any robot cell.
- Vendor engineers: support for the vision and robotics pilots.
- Grok Bot agents: read, summarize, draft and propose.

## Risks

- OT data access on older machines can be slow or impossible without new sensors.
- Pilot purgatory: pilots that never scale. Mitigation: one constraint, one scoreboard, a go or no-go at each stage.
- Workforce and union concerns. Mitigation: people approve, agents propose, and labor hours move to higher-value work.
- Robot safety sign-off must go through a qualified integrator. A simulation does not prove safety.
- Quality system requirements (IATF 16949 and customer-specific requirements) when an inspection method changes.
- Early-stage vendor risk: startups can pivot, get acquired or fail.
- Cybersecurity of newly connected lines.

## Public funding and support programs

Program terms and windows change. Check the official page before relying on any of these.

- **Michigan Manufacturing Technology Center (MMTC), the state's NIST MEP center:** free Technology Opportunity Assessment for small and mid-size manufacturers, plus implementation support. https://www.the-center.org/Our-Services/Advanced-Technology/Technology-Opportunity-Assessment and https://www.nist.gov/mep
- **MEDC Industry 4.0 Technology Implementation Grant:** reimburses up to half of eligible Industry 4.0 technology costs for small Michigan manufacturers, up to a program cap; requires an MMTC assessment or a documented technology strategy and Automation Alley membership. The application showed as closed when checked on 2026-10-11. https://www.michiganbusiness.org/industry4-0/grant/
- **Automation Alley membership** (a prerequisite for the grant above): https://www.automationalley.com/become-a-member
- **Michigan Supplier Conversion Grant (LEO):** federally funded grants for small and mid-size auto suppliers retooling toward electrified and other qualified vehicle supply chains; the 2026 round was awarded in September 2026. https://www.michigan.gov/leo/bureaus-agencies/economic-transition/michigan-supplier-conversion-grant-program

## Relation to Brickworks

Brickworks is a virtual factory. It is where the ideas in this plan can be tried without a plant. What exists today is described in [architecture](../architecture.md), [simulation behavior](../simulation.md) and [release evidence](../release-evidence.md). Everything in the right-hand column below is **plan, not implemented**.

| Plan element | What Brickworks has today | Planned connection (not implemented) |
| --- | --- | --- |
| Baseline and scoreboard | Simulated metrics for throughput, yield, scrap, waits and lead time; paired seed experiments ([simulation](../simulation.md#experiments-and-comparison)) | A weekly scoreboard view built from the same metrics |
| Question before optimizing | [DF-LOOP-001](spacex-design-loop.md) proposes delete and simplify passes | Use the loop as the assessment checklist |
| Vision QA | Simulated inspection and rework history per module ([simulation](../simulation.md#inspection-and-rework-history)) | A simulated per-unit inspection feed shaped like a real vision log |
| Agents with human approval | Astra and Jev make bounded decisions validated by deterministic controllers ([architecture](../architecture.md)) | Agents that draft proposals for human approval instead of acting |
| Hardware boundary | A future `EquipmentAdapter` contract with no network or actuator implementation ([station adapters](../station-adapters.md)) | Unchanged: no plant connection is planned in this repository |

A simulation result is a way to learn faster. It is not proof that a real plant will see the same gains.

## Open questions

- Which single constraint is most common across mid-size plants: a machine, a handoff or an approval loop?
- How much of stage B can run on cameras a plant already has?
- Which robot OEM and integrator tools are best for simulating a cell before install?
