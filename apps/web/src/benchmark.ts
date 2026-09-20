import { FactoryWorld } from "./world";
const world = new FactoryWorld(document.querySelector("canvas")!, () => {});
world.addStressFleet();
const samples: number[] = [];
let lifetimeMinimum = Infinity;
let started = performance.now();
let windowNumber = 1;
document.querySelector("#restart")!.addEventListener("click", () => {
  samples.length = 0;
  started = performance.now();
  windowNumber++;
  document.querySelector("#stats")!.textContent =
    "New measurement window started.";
});
world.onStats = (fps, meshes) => {
  samples.push(fps);
  lifetimeMinimum = Math.min(lifetimeMinimum, fps);
  if (samples.length > 600) samples.shift();
  const sorted = [...samples].sort((a, b) => a - b);
  const p5 = sorted[Math.floor((sorted.length - 1) * 0.05)];
  document.querySelector("#fps")!.textContent = `${fps.toFixed(1)} FPS`;
  document.querySelector("#stats")!.textContent =
    `Window ${windowNumber} · ${((performance.now() - started) / 1000).toFixed(0)} seconds · ${samples.length} samples · ${meshes} meshes · mean ${(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1)} FPS · minimum ${Math.min(...samples).toFixed(1)} FPS · 5th percentile ${p5.toFixed(1)} FPS · ${innerWidth} × ${innerHeight}`;
  document.querySelector("#lifetime")!.textContent =
    `Minimum since page load, including warm-up and other windows: ${lifetimeMinimum.toFixed(1)} FPS.`;
};
