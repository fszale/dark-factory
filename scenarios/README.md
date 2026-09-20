# Session scenarios

These JSON request bodies can be submitted to `POST /api/sessions` or selected from the application scenario control. Each starts seed 42; change the seed to examine variation. `empty` starts without opening stock. Other cases use explicitly recorded opening kits.

`shortage`, `congestion`, `assembly-outage` and `dispatch-blockage` set sustained disruptions; repair them through the site controls to observe recovery. `slow-exterior` changes the exterior cycle profile and `gripper` starts degraded equipment. Use station maintenance to recover the gripper and an operating profile change to rebalance the slow line.
