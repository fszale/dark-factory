import { parentPort, workerData } from "node:worker_threads";
import type { RunExport } from "../../../packages/contracts/src/index.ts";
import { runForecast, type ForecastRequest } from "../../../packages/orders/src/forecast.ts";

// DF-ORDER-001: a forecast forks the order floor checkpoint and runs it ahead off the main thread.
const data = workerData as { run: RunExport; request: ForecastRequest };
parentPort?.postMessage(runForecast(data.run, data.request));
