# NVIDIA Industrial AI Stack for a Mid-Size Plant

Status: **research note**. Nothing here is used by or integrated into the Brickworks simulation. Plans and notes do not authorize implementation.
Date: 2026-10-11 (sources checked that day)
Repo: [fszale/dark-factory](https://github.com/fszale/dark-factory) (Brickworks)
Related: [Michigan Plant Optimization Blueprint, DF-PLANT-001](michigan-plant-optimization-blueprint.md), [physical AI startup landscape](physical-ai-startup-landscape.md), [architecture](../architecture.md)

NVIDIA describes physical AI as three computers: train and simulate in the data center (Omniverse, Isaac Sim and Isaac Lab, Cosmos), run at the edge (Jetson, IGX), and add vision and agent services (Metropolis blueprints, NIM, cuOpt). This note maps each piece to a concrete use in an existing mid-size plant and to a stage of [DF-PLANT-001](michigan-plant-optimization-blueprint.md).

## The pieces

| Piece | What it is | Use in an existing mid-size plant | Blueprint stage |
| --- | --- | --- | --- |
| Omniverse and OpenUSD | libraries for physically based digital twins | line layout, takt and bottleneck what-ifs before moving equipment | B |
| Mega Omniverse Blueprint | blueprint for robot-fleet and, since 2025-10-28, factory-scale digital twins; Siemens digital twin software is the first ISV to support it; FANUC and Foxconn Fii supply OpenUSD robot models | test a new robot cell or AMR route in the twin first; for a mid-size plant this is most realistic through an ISV rather than custom code | B, C |
| Isaac Sim and Isaac Lab | robot simulation and reinforcement learning | validate a cell (for example a pick or an insertion) before install; Isaac Manipulator and cuMotion for grasping and motion planning | C |
| Isaac GR00T (N1.7) | open humanoid vision-language-action model | watch only; not a first-year need for an existing plant | none |
| Cosmos | world foundation models for synthetic data and reasoning | synthetic defect and scenario data; alert verification inside the video search and summarization blueprint | B |
| Metropolis VSS blueprint 3.3 | video search and summarization agents: camera ingest, detection and tracking, VLM alert verification, natural-language video search, shift and incident reports | likely the fastest win: cameras already on the line become a searchable record and an automatic shift report draft | B, D |
| Jetson Orin and Thor, IGX Thor | edge AI computers | run vision models at the line; an Orin Nano class device is enough for a single-station defect detector | B |
| NIM microservices | containerized model inference | host language and vision models on premises when plant data must stay in the plant | D |
| cuOpt | GPU optimization solver | scheduling, changeover and routing proposals for a human scheduler | D |

## How a mid-size plant actually adopts it

Mid-size plants rarely adopt raw Omniverse directly. The realistic path is through ISVs and robot OEMs that embed it (Siemens, FANUC ROBOGUIDE, Intrinsic Flowstate, InOrbit) and through blueprints such as VSS that ship as containers. Start with cameras and edge inference, then simulation through the robot vendor's tools, and only then a plant-wide twin.

## Public reference adopters

- NVIDIA named Belden, Caterpillar, Lucid Motors, Toyota (Georgetown, Kentucky), TSMC, Wistron and Foxconn Houston as industrial adopters on 2025-10-28.
- GM and NVIDIA announced a collaboration on 2025-03-18 that includes Omniverse with Cosmos for assembly-line digital twins and robot training.
- FANUC announced on 2026-03-16 that Jetson, Isaac Sim and Omniverse are integrated with ROBOGUIDE, with ROS 2 and Python support and FANUC robots as SimReady assets. FANUC America is based in Rochester Hills, Michigan.
- Hyundai presented Omniverse virtual commissioning at GTC 2026 (session S82271).

## Relation to Brickworks

Brickworks is built with Babylon.js and an XState simulation, not Omniverse ([architecture](../architecture.md)). The note is here because the "simulate first" idea is the same: try a change in a virtual factory before touching a real one. No NVIDIA integration is planned in this repository.

## Sources

- NVIDIA industrial sector: https://www.nvidia.com/en-us/industries/industrial-sector/
- NVIDIA US manufacturing and physical AI announcement (2025-10-28): https://nvidianews.nvidia.com/news/nvidia-us-manufacturing-robotics-physical-ai
- Mega Omniverse Blueprint: https://blogs.nvidia.com/blog/mega-omniverse-blueprint/
- Mega for industrial digital twins: https://blogs.nvidia.com/blog/mega-omniverse-blueprint-industrial-digital-twins/
- VSS blueprint 3.3: https://developer.nvidia.com/blog/lower-the-cost-of-building-and-running-visual-ai-agents-with-nvidia-vss-blueprint-3-3/
- Video analytics AI agents: https://www.nvidia.com/en-us/use-cases/video-analytics-ai-agents/
- Jetson Thor availability: https://nvidianews.nvidia.com/news/nvidia-blackwell-powered-jetson-thor-now-available-accelerating-the-age-of-general-robotics
- GR00T N1.7: https://huggingface.co/blog/nvidia/gr00t-n1-7 and https://developer.nvidia.com/isaac/gr00t
- Intrinsic Flowstate with Isaac Manipulator: https://developer.nvidia.com/blog/automating-smart-pick-and-place-with-intrinsic-flowstate-and-nvidia-isaac-manipulator/
- GM and NVIDIA collaboration: https://nvidianews.nvidia.com/news/general-motors-and-nvidia-collaborate-on-ai-for-next-generation-vehicle-experience-and-manufacturing
- FANUC and NVIDIA: https://www.prnewswire.com/news-releases/fanuc-accelerates-physical-ai-in-industrial-robotics-leveraging-nvidia-technologies-302714972.html
- GTC 2026 session S82271: https://www.nvidia.com/en-us/on-demand/session/gtc26-s82271/
- Foxglove agentic data platform (Cosmos search): https://foxglove.dev/blog/introducing-the-agentic-data-platform-for-physical-ai
