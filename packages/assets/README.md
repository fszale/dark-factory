# Original design package

`src/design.ts` owns the reference recipe, station footprints, material ports, capabilities, expected operations, cycle assumptions, acceptance checks and shared brick scale. The simulation consumes station timing and the renderer consumes line layout/color through shared contracts; neither an AI provider nor a renderer may create manufacturing results.

The original procedural geometry remains in `apps/web/src/world.ts`; it can be replaced with glTF assemblies while retaining the same station ports and logical identifiers. Timing and layout are intentionally expressed separately from visual mesh creation.

A physical adapter must implement the shared `StationAdapter` observation/acknowledgement contract. It must map the listed operations to local equipment interlocks, retain material ownership until transfer acknowledgement, reject unsupported commands, and return measured observations. A model recommendation is never an actuator instruction. Hardware commissioning, travel limits, guarding, watchdogs, real sensors, electrical design and emergency stop remain separate work. This package is a simulation reference, not hardware certification.
