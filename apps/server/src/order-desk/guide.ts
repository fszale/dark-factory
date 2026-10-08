import { VIRTUAL_DISCLAIMER } from "../../../../packages/contracts/src/orders.ts";

/** Short how-to for agents. Served as brickworks://docs/ordering-guide and inside /llms.txt. */
export const ORDERING_GUIDE = `## Ordering a virtual robotaxi

${VIRTUAL_DISCLAIMER}

1. Call \`list_vehicle_configs\` to see the buildable model and which option values are offered.
2. Call \`get_capabilities\` for destination zones, limits and the live simulated floor status.
3. Call \`quote_vehicle\` with a config, a quantity of 1 to 3 and a destination zone. Read \`feasibility.issues\`; errors mean the order cannot be placed, warnings mean the lead time is at risk. Each lead option carries a forecast \`shipBySimTime\`, \`deliverBySimTime\` and a virtual price in \`BWC-VIRTUAL\`.
4. Call \`place_order\` with the \`quoteId\`, a quoted \`leadOption\` and your own \`idempotencyKey\` (8 to 64 characters). Retrying with the same key returns the same order with \`replayed: true\`.
5. Follow the order with \`get_order_updates\` (cursor paging, optional \`waitSeconds\` long poll up to 20 seconds) or \`get_order\`. Updates are ordered by \`seq\` and every factory-sourced update links the factory event that caused it.
6. \`cancel_order\` works until the first unit is committed to final assembly.

Times are simulated seconds on the shared order floor clock. Station progress before a unit is committed is labeled \`projected\`; after commitment it is \`bound\` to real module ids. Never send payment, address or contact data: the schemas reject unknown fields.
`;
