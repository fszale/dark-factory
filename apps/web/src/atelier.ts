import { FactoryWorld } from "./world";
const world = new FactoryWorld(document.querySelector("canvas")!, () => {});
world.addArtReviewVehicle();
document.querySelectorAll<HTMLButtonElement>("[data-shot]").forEach(button => button.addEventListener("click", () => world.artCamera(button.dataset.shot!)));
let dusk = false;
document.querySelector("#dusk")!.addEventListener("click", () => world.setDusk(dusk = !dusk));
world.onStats = (fps, meshes) => { document.querySelector("#stats")!.textContent = `${fps.toFixed(1)} FPS · ${meshes} meshes · ${innerWidth} × ${innerHeight} · drag to inspect`; };
