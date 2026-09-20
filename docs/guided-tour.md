# Guided visual tour

These captures document the software scene in its local review environment. They are visual evidence of rendering and composition, not proof of physical factory operation, performance on another host, or collision/safety validation.

1. [Site overview](review/site-1080p.png) — factory footprint, roads, receiving approach, five-line building, and parking context.
2. [Receiving](review/receiving-1080p.png) — truck approach and receiving/dock area.
3. [Storage](review/storage-1080p.png) — inventory and material staging.
4. [Gold robotaxi](review/robot-1080p.png) — completed vehicle visual treatment.
5. [Parking](review/parking-1080p.png) — the single accessible twelve-bay parking row and shared-road context.
6. [Fault view](review/fault-1080p.png) — fault overlay review state.
7. [Assembly](review/assembly-1080p.png) — assembly-area capture from the earlier 1080p review.
8. [Dusk](review/dusk-1080p.png) — readable operating site under the dusk treatment.
9. [Exploded vehicle](review/exploded-1080p.png) — the five separated vehicle modules and their inspection state.
10. [Stress scene](review/stress-1080p.png) — the synthetic 20-moving/12-parked vehicle graphics load.
11. [Controls](review/controls.png) — isolated development-session controls, metrics, and replay surface.

The 1080p operational and stress captures have been reviewed at the local production application. [Graphics review](graphics-review.md) records the reviewed set and measured on-host benchmark details. This visual review does not establish quality or performance on other devices, browser audio quality, accessibility, or physical-build validity.

The scene uses original procedural geometry and materials. Its one non-original runtime environment asset is the locally served Babylon.js `studio.env`, credited under CC BY 4.0 in [the asset inventory](assets/README.md) and application footer.

## Receiving and sorting detail

Choose **Camera → Receiving** to see the inbound truck and five colored brick pallets. **Camera → Sorting** centers the sorting spine and rack branches. Accepted shipments unload, pass inspection, then spend 14 simulated seconds moving to the matching storage lanes; warehouse stock becomes usable only at the end. Rejected lots reverse the unloading transfer and return on their truck. Carts then carry the released line-specific kits to the corresponding assembly lines. The guided camera tour includes receiving, sorting, and storage as separate 12-second shots.

For a clear startup demonstration select **Empty start**, reset, then start at 1×: no production begins before the first shipment has been unloaded, inspected, sorted, and distributed. Warm-start mode is labelled with 80 initial kits so its immediate work is not mistaken for newly delivered inventory. See `review/delivery-arrival-1080p.png` and `review/sorting-1080p.png`.
