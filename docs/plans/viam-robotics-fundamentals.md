# Viam Robotics Fundamentals (101 and 102): Ideation Note

Status: **research note**. Viam is not a partner, vendor or integration of Brickworks, and nothing here is built into the simulation. Plans and notes do not authorize implementation.
Date: 2026-10-11 (sources checked that day)
Repo: [fszale/dark-factory](https://github.com/fszale/dark-factory) (Brickworks)
Related: [Michigan Plant Optimization Blueprint, DF-PLANT-001](michigan-plant-optimization-blueprint.md), [NVIDIA industrial AI stack](nvidia-industrial-ai-stack.md), [physical AI startup landscape](physical-ai-startup-landscape.md), [Joint Design Loop, DF-LOOP-001](spacex-design-loop.md), [simulation behavior](../simulation.md), [station adapter boundary](../station-adapters.md), [architecture](../architecture.md)

## Source

Ilir Aliu (@IlirAliu_) posted on X on 2026-10-11 that Viam had put part 2 of its Robotics Fundamentals courses online: free, no hardware required, 120 minutes and 12 lessons, following a 101 course that builds a palletizing robot in simulation. Credit for the find belongs to him: https://x.com/IlirAliu_/status/2109344041045213364

The link in the post resolves to the post's own image, a screenshot of Viam's "Viam 102" video playlist on YouTube showing a simulated palletizing cell (arm, gripper, conveyors, pallet, guarding and a stack light). The image is not reproduced here; see the original post. Everything below comes from Viam's official course pages and documentation, linked in [Sources](#sources).

## What the two courses teach

Both courses are free, self-paced and run entirely in simulation in the browser, so no robot and no hardware are needed. Viam lists coding fundamentals, Linux terminal basics and comfort reading JSON as the recommended skills, and says prior robotics experience is not required.

### Viam 101: build a palletizing cell in simulation

90 minutes, 18 lessons. The learner builds a palletizing application from scratch: a robot arm that picks boxes from a station and stacks them on a pallet.

Official outline: 1 Overview, 2 Create your machine, 3 Run viam-server, 4 The Machine You're Going to Build, 5 Add the Arm and Gripper, 6 The Frame System and Geometry, 7 Place the Arm and Gripper, 8 Scaffold the Program, 9 Add the Work Cell, 10 Poses, 11 Move, 12 Pick, 13 Place, 14 Run, 15 Obstacles and Worldstate, 16 Avoid Place Boxes, 17 Model the Held Box, 18 Recap.

Stated outcomes: configure hardware in Viam (arm, gripper and work cell), write control logic in a familiar language, use motion planning and Viam services to automate a work cell, and run the same application on different arms and grippers with minimal changes.

### Viam 102: make the robot keep running on its own

120 minutes, 12 lessons. The course turns the control script from 101 into a production-grade Viam module that viam-server runs, supervises and restarts, so the cell keeps working when the developer's laptop is closed.

Official outline: 1 Overview, 2 The CLI and your machine, 3 Create your module, 4 Release your module, 5 DoCommand, 6 Add a dependency, 7 Write place, 8 Write pack, 9 Attributes and validation, 10 GitHub and cloud build, 11 Pack on its own, 12 Recap.

Stated outcomes: a module that viam-server supervises and restarts; a DoCommand API so any caller can drive the logic through documented verbs; dependencies and configurable attributes so behavior comes from configuration instead of hardcoded values; releases and over-the-air updates, first locally and then from GitHub with a cloud build for every platform; and sensors plus a scheduled job so the cell runs unattended.

The playlist in the post's image shows short videos titled "Course Overview - Build and Publish a Viam Module", "Generating a Module", "DoCommand and the Generic Service", "Attributes and Validation" and "Write the Place Verb". These are video titles, not the course outline above.

Viam's registration page also says a Viam 103 is "coming October 2026". Its topic was not stated on the pages checked.

## Platform concepts beyond the courses

The courses stop at an unattended simulated cell. Viam's documentation describes the rest of the platform a plant would meet next. These are vendor descriptions, not tested claims.

| Concept | What Viam's docs describe |
| --- | --- |
| Data capture and sync | configure which components to record and how often; data buffers locally when offline and syncs when the connection returns; query with SQL or MQL, export, build dashboards |
| ML training | build datasets from captured images, label them (with model-assisted auto-annotation), train in the cloud, deploy the model back to machines, repeat |
| Vision service | one API for detection, classification and 3D point cloud segmentation, backed by an ML model, a color detector or a depth-based segmenter |
| Fleet deployment | fragments as configuration templates, versioned modules and models in a registry, version pinning, fragment tags for staged rollouts, and maintenance windows that hold updates until a sensor says it is safe |
| Scheduled jobs | call a component or service method, including DoCommand, on an interval, a cron schedule or continuously |
| Monitoring | fleet status dashboard, data dashboards, alerts on sensor thresholds, machine online or offline, and error logs, plus remote teleoperation |
| Agent access | CLI, SDK and an MCP server; Viam's agent guide says to look before moving, plan motion through the motion service, verify by observation, and give an agent a machine-scoped key; the MCP server includes destructive live-machine tools |
| Quality inspection tutorial | a separate 55-minute Gazebo tutorial that builds a PASS or FAIL camera station for a simulated canning line, with data capture, a module and an operator dashboard |

## Mapping to DF-PLANT-001 stages

| DF-PLANT-001 stage | Course or platform concept | How it could help (idea, not a plan of record) |
| --- | --- | --- |
| A. Assessment, question before optimizing | none directly | The courses teach how to automate a step; the blueprint's rule still comes first: ask whether the palletizing or packing step should exist, then simplify, then automate. |
| B. Digital twin and vision QA pilot | quality inspection tutorial, data capture, ML training, vision service | A no-hardware rehearsal of a single camera inspection station, and a concrete picture of the capture, label, train and redeploy loop before buying anything. |
| C. Robotics pilot, simulation-first palletizing | Viam 101 frame system, work cell, obstacles and world state, motion planning, pick and place | End-of-line palletizing is a common first cell. 101 rehearses the exact pattern in simulation: model the cell geometry and obstacles, then plan collision-checked moves. A local integrator still owns the real install and the safety sign-off. |
| C to E. Autonomy and reliability | Viam 102 supervised module, restarts, configuration-driven attributes, scheduled jobs, "pack on its own" | 102 is the clearest public walkthrough of the gap between a demo script and a cell that runs unattended, which is the step before any lights-out hours in stage E. |
| D. Agent operations layer | data dashboards, alerts, triggers and webhooks, MCP server, read access to fleet status | Machine status, alerts and captured data could feed the shift report, quality and maintenance agents. Under the blueprint's guardrails an agent would use read-only access, never a destructive live-machine tool, and never write to PLCs or robot controllers. |
| E. Path toward lights-out cells | fleet fragments, staged rollouts, maintenance windows, over-the-air updates | Updates held until a maintenance window opens, and promoted from one cell to more only when the scoreboard supports it, fit the one-cell-first rule. |

## Relation to Brickworks

Brickworks is a browser-based virtual factory built with Babylon.js and an XState simulation ([architecture](../architecture.md)). It models material flow across a whole site; Viam 101 models one robot cell with real kinematics and motion planning. They work at different levels and are complementary.

| Brickworks today | Viam course concept | Idea for later (not implemented) |
| --- | --- | --- |
| `gripper` fault scenario and cart handling as simulation controls ([simulation](../simulation.md#scenarios)) | pick, place, "Model the Held Box", verify by observation | Study how a real cell detects a dropped part before modeling richer gripper faults |
| Future `EquipmentAdapter` contract: operations with IDs, revisions, acknowledgements, and simulated versus measured observations; no network or actuator code ([station adapters](../station-adapters.md)) | DoCommand verbs, module attributes and validation, supervised restarts | Compare the adapter contract with a documented-verbs pattern such as DoCommand when the tabletop stage arrives |
| Paired seed experiments compare a baseline and candidate configuration ([simulation](../simulation.md#experiments-and-comparison)) | attributes move behavior into configuration | The same "configuration, not code" idea, applied to a real cell |
| `stop` is a local stop request and a remote API is not an emergency stop ([station adapters](../station-adapters.md)) | Viam's agent guide: StopAll, session heartbeats, and the note that motion-service moves can continue after a client disappears | Keep the boundary rule as written: no remote API is a safety system |
| Stage 3 physical tabletop factory, planned | Viam's hardware tutorials with a desktop SO-101 arm, including a miniature palletizing tutorial | A candidate path for the first tabletop cell, if a small arm is chosen |

No Viam integration is planned in this repository.

## Learning path idea

Because both courses are free, browser-based and need no hardware, they could become a shared first step for anyone involved in a DF-PLANT-001 style pilot.

1. Filip takes Viam 101 and 102 to understand the full arc from a simulated cell to an unattended one.
2. Plant staff who will approve or maintain a cell (controls engineer, maintenance lead, a quality engineer) take Viam 101, about 90 minutes, so the team shares words like frame, pose, obstacle and motion plan before a vendor demo.
3. A controls or IT/OT engineer takes Viam 102 and the quality inspection tutorial to see what supervised modules, data capture, alerts and over-the-air updates look like in practice.
4. The team writes down what it learned against the plant's single stage A constraint: would a palletizing or inspection cell actually move the scoreboard?

This builds shared vocabulary only. It does not qualify anyone to commission or sign off a real robot cell.

## Open questions

- Which language and which simulation tool do the courses use? The course pages list these as FAQ questions, but the answers were not visible in the text that was checked.
- Can course code run unchanged on a real arm from the vendors a Michigan plant already owns? Viam claims the same application runs on different arms and grippers with minimal changes; that is a vendor claim.
- How does a Viam-managed cell coexist with an existing PLC, safety PLC and line controls? This needs a controls engineer and an integrator, not a course.
- What are Viam's data residency and offline behavior when plant data must stay on premises, and how does that fit the blueprint's on-premises rule?
- What will Viam 103 cover?
- Would Brickworks gain anything from a Viam-style cell view for one station, or should it stay a site-level material-flow model?

## Sources

- Post by Ilir Aliu (2026-10-11): https://x.com/IlirAliu_/status/2109344041045213364
- Viam 101 course page: https://www.viam.com/education/viam-101
- Viam 102 course page: https://www.viam.com/education/viam-102
- Free Viam courses: https://docs.viam.com/try/courses/
- Try Viam pathways: https://docs.viam.com/try/overview/
- Course registration (mentions Viam 103): https://learn.viam.com/register
- Build and deploy modules: https://docs.viam.com/build-modules/overview/
- Manage data: https://docs.viam.com/data/overview/
- Train ML models: https://docs.viam.com/train/overview/
- Computer vision: https://docs.viam.com/vision/overview/
- Fleet deployment: https://docs.viam.com/fleet/overview/
- Manage versions and rollouts: https://docs.viam.com/fleet/manage-versions/
- Schedule jobs: https://docs.viam.com/fleet/schedule-jobs/
- Monitor and operate: https://docs.viam.com/monitor/overview/
- Set up alerts: https://docs.viam.com/monitor/alert/
- Use Viam from an AI agent: https://docs.viam.com/build-apps/use-viam-from-an-agent/
- Viam MCP server: https://docs.viam.com/reference/mcp/
- Quality inspection tutorial: https://docs.viam.com/try/quality-inspection/overview/
