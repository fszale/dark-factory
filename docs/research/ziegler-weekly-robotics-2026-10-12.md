# Research note: Lukas M. Ziegler weekly robotics thread, 2026-10-12

Status: **research note, not a plan or an endorsement**. Company facts below are public reports and company claims, not verified results.
Date: 2026-10-12
Related: [DF-PLANT-001 blueprint](../plans/michigan-plant-optimization-blueprint.md), [physical AI startup landscape](../plans/physical-ai-startup-landscape.md), [NVIDIA industrial AI stack](../plans/nvidia-industrial-ai-stack.md)

Source thread: https://x.com/lukas_m_ziegler/status/2109708907543212351

The opening post reads: "Massive week in robotics. I went through everything from XPENG, Boston Dynamics, microagi and even more. Get your coffee and see what happened in robotics space:". The thread then covers six items, summarized below with independent sources.

## Items and factory relevance

| Item | What it is | Relevance to a mid-size plant | Sources |
| --- | --- | --- | --- |
| Mujin and Mujin OS | Japanese robotics company (founded 2011). Mujin OS is a general-purpose platform that controls and coordinates fleets of robots and automation equipment in warehouses and factories. Reported Series D of about $224M with SK Square participating; SK Square cited autonomous fabs as a goal. | Mixed robot, AMR and conveyor fleets need one coordinating layer before cells can run unattended. A reference point for a fleet orchestration decision. US availability for mid-size plants not verified. | [Dealroom](https://dealroom.co/news/161646-japans-mujin-raises-224m-series-d-as-sk-square-bets-on-physical-ai/), [Chosun Biz](https://biz.chosun.com/en/en-it/2026/10/12/E54VTB53X5DK3PNTWXUBATNPLE/) |
| Ultra (Ultra Robotics) | Brooklyn company leasing dual-arm stationary robots for packing, sorting and kitting at third-party logistics sites under a robots-as-a-service model (integration fee, then monthly support). Raised a $50M Series A. | Robots-as-a-service moves a pilot from capital expense to operating expense, which suits a cautious first robotics pilot. | [Dealroom](https://dealroom.co/news/161151-ultra-raises-50m-series-a-to-scale-its-robots-as-a-service-warehouse-bus/), [SiliconANGLE](https://siliconangle.com/2026/10/09/warehouse-robot-maker-ultra-robotics-bags-62m/) |
| Physical Intelligence and the "body and brains" split | Ultra builds the robots; Physical Intelligence supplies vision-language-action models that learn from deployment data. | Keep the robot hardware vendor and the AI model vendor separable, and keep plant data exportable, so either can change. | [Framework Ventures / Fortune](https://www.framework.ventures/writings/ultra-raises-62-million-for-fast-growing-robots-as-a-service-business-announces-tie-up-with-ai-research-firm-physical-intelligence) |
| microagi: Shift and Atlas | Munich company. Shift records first-person video of people doing manual tasks and turns it into robot training data; Atlas fine-tunes control policies in simulation and deploys them on existing third-party robots. A reported $100M annualized run rate is company-reported and not independently verified. | Manual stations (kitting, machine tending, inspection) hold skill that can be captured as demonstration data before automation, with consent. | [Korthos](https://korthosrobotics.com/research/microagi-shift-100-million-arr-six-months), [Humanoids Daily](https://www.humanoidsdaily.com/news/microagi-100-million-revenue-run-rate-six-months) |
| Boston Dynamics and Hyundai | Hyundai-owned Boston Dynamics named Rohit Prasad (formerly Amazon Alexa and AGI) CEO effective 2026-10-07, framed around commercializing physical AI. Hyundai has said it aims to build a factory able to make 30,000 robots a year by 2028 and deploy them across its plants. | Signal that large automotive OEMs are deploying robots in their own plants; suppliers should watch for downstream expectations. | [Boston Dynamics](https://bostondynamics.com/news/boston-dynamics-appoints-rohit-prasad-as-chief-executive-officer/), [Reuters via Investing.com](https://www.investing.com/news/stock-market-news/boston-dynamics-appoints-examazon-executive-rohit-prasad-as-ceo-4935588) |
| XPENG Iron humanoid and Turing chip | XPENG plans Iron humanoid sales in the second half of 2027 after trials in its own stores and offices. Iron runs three in-house Turing chips; the claim of parity with NVIDIA Thor has no published benchmark. | First roles are customer-facing, not factory work. A watch item, not a dependency. | [Humanoid Guide](https://humanoid.guide/xpeng-plans-iron-humanoid-sales-for-second-half-of-2027/), [XPENG](https://www.xpeng.com/news/01a080371029a057bc8e8a02a2c6012b) |
| MNV Humanoids | Per the thread only: German startup with a humanoid for hazardous work such as bomb disposal, built on a Western supply chain. **Not independently verified.** | Supply-chain origin of robots and compute is becoming a buying criterion. | thread only |

## Takeaways

1. Orchestration across mixed equipment is a prerequisite for unattended cells.
2. Robots-as-a-service lowers the barrier for a first pilot.
3. Separating robot hardware from the AI layer, with data the plant owns, reduces lock-in.
4. Human demonstration data is an asset a plant can start collecting now.
5. Humanoids remain a watch item for mid-size plants.

These feed the additions in [DF-PLANT-001](../plans/michigan-plant-optimization-blueprint.md#additions-from-the-2026-10-12-robotics-scan).
