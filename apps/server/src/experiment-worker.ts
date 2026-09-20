import {parentPort, workerData} from 'node:worker_threads';
import {pairedExperiment, type ExperimentInput} from '../../../packages/simulation/src/experiments.ts';
parentPort?.postMessage(pairedExperiment(workerData as ExperimentInput));
