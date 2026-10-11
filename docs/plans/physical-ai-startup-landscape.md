# Physical AI Startup Landscape: Factory Triage

Status: **research note**. No company listed here is a partner, vendor or integration of Brickworks. Plans and notes do not authorize implementation.
Date: 2026-10-11 (sources checked that day)
Repo: [fszale/dark-factory](https://github.com/fszale/dark-factory) (Brickworks)
Related: [Michigan Plant Optimization Blueprint, DF-PLANT-001](michigan-plant-optimization-blueprint.md), [NVIDIA industrial AI stack](nvidia-industrial-ai-stack.md)

## Source map

The starting point is Lukas M. Ziegler's map of Bay Area robotics and physical AI companies, posted on X on 2026-10-11: https://x.com/lukas_m_ziegler/status/2109201193855529333. Credit for the map belongs to him. The image is not reproduced here; see the original post.

This note triages the companies on that map with one question: which ones could help optimize an existing mid-size manufacturing plant, as in the robotics pilot stage of [DF-PLANT-001](michigan-plant-optimization-blueprint.md)? Facts come from the public sources linked below. Vendor performance claims are labeled as claims.

## Layers that matter on a factory floor

1. Inspection and quality
2. Robot skills for existing arms (machine tending, assembly)
3. Intralogistics (carts, pallets, inventory)
4. Fleet operations and observability
5. Robot foundation models and simulation

Sensors (lidar, depth cameras) sit under all of them.

**Deployment model is the key filter.** For a mid-size plant, software that runs on robots and cameras it already owns beats a new hardware fleet. Robots-as-a-service lowers up-front capital.

## Factory-relevant companies

| Company | Layer | What they do | Deployment model | NVIDIA tie | Why it matters for a plant |
| --- | --- | --- | --- | --- | --- |
| Bucket Robotics | inspection | CAD-native defect detection: synthetic data from STEP files trains a detector for scratches, dents, cracks and burrs, plus assembly verification; logs per unit to MES or ERP | software on existing industrial or USB cameras; time-boxed pilot on a real part | edge toolkit for Jetson or x86, ONNX export | vision QA without collecting thousands of defect images; the per-unit log feeds a quality agent |
| Trener Robotics | robot skills | pre-trained skills and natural-language control for industrial arms; main application is high-mix CNC machine tending | through integrators; cells with ABB and Universal Robots, FANUC listed as coming | none found | machine tending on arms a plant may already own |
| Intrinsic (Alphabet) | robot skills, simulation | Flowstate development environment and AI skills; FANUC integration including CRX cobots | platform for integrators and solution builders | Isaac Manipulator grasp models; Omniverse twin connection | simulate and program FANUC cells before install |
| Flexiv | assembly | force-controlled adaptive arms for contact-rich assembly, insertion and polishing | robot hardware plus software | supported in Isaac Sim and Isaac Lab | contact-rich tasks; published automotive adhesive primer case study |
| Skild AI | foundation model | general robot model deployed with NVIDIA and Foxconn on assembly lines | through ABB, Universal Robots and MiR portfolios | built on Isaac Lab, Cosmos, Jetson | may reach plants through robot OEMs they already buy from |
| Figure | humanoid | humanoid robots; public BMW Spartanburg sheet-metal loading deployment | direct with large OEMs | NVIDIA collaboration | proof point at automotive scale; not a mid-size fit yet |
| Cobot (Collaborative Robotics) | material handling | Proxie mobile cobot moves carts; second generation adds two-handed manipulation | robots in manufacturing and logistics | Jetson on robot; Isaac Sim and Omniverse | cart moves between cells without fixed infrastructure |
| Cartken | material handling | indoor and outdoor AMR for loads between production and warehouse | AMR fleet | none found | public auto-parts plant reference (ZF LIFETEC Mesa) |
| Mytra | material handling | software-defined 3D storage for pallets and cases, positioned for WIP and finished goods | installed system | none found | dense WIP storage near lines |
| Robust.AI | material handling | Carter collaborative cart robot for picking and transport | AMR fleet | none found | collaborative transport in mixed human areas |
| Corvus Robotics | inventory | autonomous drones scan pallet locations with no infrastructure changes | drone fleet | none found | cycle counts without stopping operations |
| Dexterity | material handling | dual-arm truck and trailer loading | robots as a service | Foresight model optimized on NVIDIA hardware | shipping dock only |
| Formant | fleet ops | multi-vendor fleet orchestration: one telemetry stream, incident workflow, approval thresholds | cloud plus edge agent | Jetson edge processing | one view once a plant has more than one robot vendor; approval thresholds match the human-approval principle |
| InOrbit | fleet ops | define a robot mission once, test in simulation, deploy to real robots | cloud platform | Isaac Sim integration | simulate-first fleet operations |
| Foxglove | observability | robotics data logging, visualization and curation | SaaS | Cosmos-powered semantic search | debugging and evidence for robot pilots |
| Chef Robotics | assembly (food) | robots for high-mix food assembly | robots as a service | Isaac Sim, Omniverse, cuMotion | food plants only; useful as a robots-as-a-service model |
| Physical Intelligence | foundation model | open-weight pi0 and pi0.5 models (openpi) | research models to fine-tune | none found | watch for research use |
| Generalist | foundation model | embodied models trained on large interaction datasets | proprietary | none found | watch only; no named factory customer found |
| Dyna Robotics | foundation model | robot models deployed in service and logistics settings | robots plus model | none found | watch only |
| Genesis AI | simulation, model | open-source Genesis physics simulator and a manipulation model | full stack | none found | open simulator worth tracking |
| OpenMind | robot OS | open-source hardware-agnostic robot runtime | open source | supports Jetson Thor | watch only |
| RealSense | sensors | depth cameras, spun out of Intel in 2025 | hardware | Jetson Thor and Isaac Sim collaboration | common depth sensor for cells |
| Ouster | sensors | digital lidar for industrial automation | hardware | Jetson, Isaac ROS, Isaac Sim | safety and localization sensing |
| NVIDIA | platform | see [NVIDIA industrial AI stack](nvidia-industrial-ai-stack.md) | | | common simulation and edge layer under most of the above |

**Best first fits for an existing mid-size plant** are the software-on-existing-hardware plays: CAD-trained vision QA (Bucket Robotics class), machine tending skills on existing arms (Trener Robotics or Intrinsic class), and a multi-vendor fleet layer (Formant or InOrbit class) once there is more than one robot vendor. These are examples of categories, not endorsements or engagements.

## Not relevant to a plant optimization

Home robots (Weave Robotics, The Bot Company, 1X, Sunday, Matic Robots); autonomous vehicles and trucks (Zoox, Waymo, Tesla, Gatik, Plus AI); delivery (Starship Technologies, Serve Robotics, Zipline); restaurant service (Bear Robotics); agriculture (Agtonomy, Bonsai Robotics); construction and survey (Built Robotics, Bedrock Robotics, Civ Robotics, Dusty); security, defense and drones (Knightscope, Scout AI, Skydio); aviation (Reliable Robotics); retail shelf scanning (Simbe Robotics); e-commerce fulfillment and parcel sorting (Nimble Robotics, Ambi Robotics: adjacent but warehouse only). One logo on the map was not identified.

## Open questions

- Which of these companies already have Michigan customers or integrators? None verified.
- When will FANUC support land for Trener Robotics?

## Sources

- Map post (Lukas M. Ziegler): https://x.com/lukas_m_ziegler/status/2109201193855529333
- Bucket Robotics: https://www.bucket.bot/ and https://www.ycombinator.com/companies/bucket-robotics
- Trener Robotics: https://trener.ai/applications
- Intrinsic and NVIDIA: https://www.intrinsic.ai/blog/posts/intrinsic-and-nvidia-deepen-platform-integrations-for-intelligent-robotics
- Intrinsic and FANUC: https://www.intrinsic.ai/blog/posts/accelerating-physical-ai-fanuc-integrates-with-intrinsic-and-flowstate
- Flexiv in Isaac: https://www.flexiv.com/news/Rizon-4-Adaptive-Robot-Now-Supported-in-NVIDIA-Isaac
- Flexiv automotive case: https://www.flexiv.com/partner/case/Automated_Adhesive_Primer_Application_in_Automotive_Assembly
- Skild AI with NVIDIA and Foxconn: https://www.reuters.com/business/media-telecom/skild-ai-nvidia-deploy-robot-brain-blackwell-assembly-lines-2026-03-16/
- Figure at BMW: https://www.press.bmwgroup.com/global/article/detail/T0458778EN/bmw-group-advances-the-use-of-physical-ai-in-production-with-figure-03-project-in-spartanburg?language=en
- Cobot and Isaac: https://www.co.bot/news/cobot-develops-ai-driven-collaborative-robots-with-nvidia-isaac
- Cobot Proxie Gen 2: https://www.therobotreport.com/cobots-proxie-gen-2-robot-adds-autotasking-mobile-manipulation/
- Cartken Hauler: https://www.cartken.com/press-release/cartken-launches-cartken-hauler---autonomous-robot-for-seamless-indoor-and-outdoor-material-handling
- Cartken at ZF LIFETEC Mesa: https://www.linkedin.com/posts/gocartken_testimonial-how-zf-lifetec-mesa-automated-activity-7396931457086021633-luzg
- Mytra: https://www.automatedwarehouseonline.com/mytra-launches-with-new-automated-warehouse-storage-system/
- Robust.AI and Foxconn: https://www.robust.ai/robustai-partners-with-foxconn-to-accelerate-and-scale-manufacturing
- Corvus Robotics: https://www.corvus-robotics.com/case-study-lapp
- Dexterity: https://dexterity.ai/blog/nvidia-acceleration
- Formant: https://www.formant.ai/fleet-orchestration
- InOrbit: https://www.inorbit.ai/blog/robops-to-sim
- Foxglove: https://foxglove.dev/blog/introducing-the-agentic-data-platform-for-physical-ai
- Chef Robotics: https://www.chefrobotics.ai/solutions/robotics-as-a-service
- Physical Intelligence openpi: https://www.physicalintelligence.company/blog/openpi
- Generalist GEN-0: https://generalistai.com/blog/gen-0
- Dyna Robotics: https://www.dyna.co/research/scaling-customer-deployments
- Genesis AI: https://techcrunch.com/2026/05/06/khosla-backed-robotics-startup-genesis-ai-has-gone-full-stack-demo-shows/
- OpenMind on Jetson Thor: https://docs.openmind.com/robots-hardware/nvidia_thor
- Ouster: https://investors.ouster.com/news-releases/news-release-details/ouster-brings-support-rev8-digital-lidar-robotics-and-edge-ai
- NVIDIA physical AI announcement: https://nvidianews.nvidia.com/news/nvidia-us-manufacturing-robotics-physical-ai
