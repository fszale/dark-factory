# Station and future hardware boundary

The reference recipe is validated by `recipeSchema` in the design package. Its five accepted component families, one kit per component, joining sequence, and inspections are inspectable data. Station definitions supply footprints, ports, capabilities, cycle assumptions, material unit, motion paths/envelopes, original visual assembly identity, and acceptance rules. The reference engine retains five named lines; introducing a different equipment topology also requires corresponding controller and renderer adapters.

`packages/contracts/src/station-adapter.ts` defines the future asynchronous `EquipmentAdapter` boundary with runtime-validated operations, observations, and acknowledgements. This is separate from the existing synchronous simulation `StationAdapter`. It contains no network connection or actuator implementation.

A controller submits a logical operation with a unique ID, expected revision, specific material IDs, and source/destination ports. An adapter may acknowledge acceptance before physical work completes. Material ownership stays with the sending station until both stations acknowledge the transfer; acceptance alone must never consume or duplicate material. Duplicate operation IDs must return the original acknowledgement. A mismatched revision or unsupported operation is rejected. The controller must wait for completion and fresh observation before advancing production.

An adapter exposes whether its independently implemented local interlocks are satisfied. Condition observations carry units and explicitly distinguish simulated from measured values. Models receive the normalized operational view, not a hardware transport, raw actuator commands, or permission to override interlocks. `stop` requests a local stop; a remote API is not an emergency-stop safety system.

Physical integration requires a separate commissioning program for electrical systems, guarding, safety-rated stops, watchdogs, torque, gripping, tolerances, sensor calibration, actual failure distributions, and human access. No simulation check proves those properties.
