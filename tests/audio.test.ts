import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { FactoryAudio } from "../apps/web/src/audio.ts";
import { FactorySimulation } from "../packages/simulation/src/index.ts";

class Param {
  value = 0;
  target = 0;
  setValueAtTime(value: number) {
    this.value = this.target = value;
    return this;
  }
  setTargetAtTime(value: number) {
    this.target = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number) {
    this.target = value;
    return this;
  }
}
class Node {
  connections: Node[] = [];
  disconnected = false;
  connect<T extends Node>(other: T) {
    this.connections.push(other);
    return other;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class Source extends Node {
  frequency = new Param();
  type = "sine";
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class Gain extends Node {
  gain = new Param();
}
class Filter extends Node {
  frequency = new Param();
  Q = new Param();
  type = "lowpass";
}
class Panner extends Node {
  positionX = new Param();
  positionY = new Param();
  positionZ = new Param();
  panningModel = "";
  distanceModel = "";
  refDistance = 0;
  maxDistance = 0;
  rolloffFactor = 0;
}
class BufferSource extends Source {
  buffer: unknown;
  loop = false;
}
class Context {
  static instances: Context[] = [];
  state = "suspended";
  currentTime = 0;
  sampleRate = 100;
  destination = new Node();
  listener = Object.fromEntries(
    [
      "positionX",
      "positionY",
      "positionZ",
      "forwardX",
      "forwardY",
      "forwardZ",
      "upX",
      "upY",
      "upZ",
    ].map((name) => [name, new Param()]),
  );
  oscillators: Source[] = [];
  gains: Gain[] = [];
  panners: Panner[] = [];
  buffers: BufferSource[] = [];
  closed = 0;
  constructor() {
    Context.instances.push(this);
  }
  createOscillator() {
    const node = new Source();
    this.oscillators.push(node);
    return node;
  }
  createGain() {
    const node = new Gain();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter() {
    return new Filter();
  }
  createPanner() {
    const node = new Panner();
    this.panners.push(node);
    return node;
  }
  createBuffer(_channels: number, size: number) {
    return { getChannelData: () => new Float32Array(size) };
  }
  createBufferSource() {
    const node = new BufferSource();
    this.buffers.push(node);
    return node;
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.closed++;
    this.state = "closed";
  }
}
const event = (id: number) => ({
  id,
  time: id,
  type: "module-accepted",
  entity: "front",
  message: "Placed a component",
});
const snapshot = () => {
  const s = new FactorySimulation().snapshot();
  s.running = true;
  // Synthetic sound events below own this fixture stream; constructor events are tested separately.
  s.events = [];
  return s;
};
let audios: FactoryAudio[] = [];
const makeAudio = () => {
  const audio = new FactoryAudio();
  audios.push(audio);
  return audio;
};
beforeEach(() => {
  Context.instances = [];
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => {
  for (const audio of audios) audio.dispose();
  audios = [];
  vi.unstubAllGlobals();
});

describe("factory sound lifecycle and event playback", () => {
  it("creates audio only after enable and reuses the context across mute/unmute", async () => {
    const audio = makeAudio();
    expect(Context.instances).toHaveLength(0);
    await audio.enable();
    const context = Context.instances[0];
    audio.setEnabled(false);
    expect(context.state).toBe("suspended");
    await audio.enable();
    expect(Context.instances).toHaveLength(1);
    expect(audio.enabled).toBe(true);
    expect(context.state).toBe("running");
    audio.dispose();
    expect(context.closed).toBe(1);
  });
  it("does not play historical snapshots, rollover windows, muted history, or old epoch events", async () => {
    const audio = makeAudio();
    await audio.enable();
    const context = Context.instances[0],
      s = snapshot();
    s.events = Array.from({ length: 2000 }, (_, i) => event(i + 1));
    audio.update(s);
    expect(context.oscillators).toHaveLength(1);
    audio.update(s);
    expect(context.oscillators).toHaveLength(1);
    s.events = [...s.events.slice(1), event(2001)];
    audio.update(s);
    expect(context.oscillators).toHaveLength(2);
    audio.update(s);
    expect(context.oscillators).toHaveLength(2);
    audio.setEnabled(false);
    await audio.enable();
    s.events = [event(9000)];
    audio.update(s);
    expect(context.oscillators).toHaveLength(2);
    s.epoch++;
    s.events = [event(1), event(2)];
    audio.update(s);
    expect(context.oscillators).toHaveLength(2);
    s.events.push(event(3));
    audio.update(s);
    expect(context.oscillators).toHaveLength(3);
  });
  it("fades both ambience and machinery when production pauses and restores their chosen levels", async () => {
    const audio = makeAudio();
    await audio.enable();
    const context = Context.instances[0],
      s = snapshot();
    audio.update(s);
    const ambient = context.gains.find(
      (g) => g.gain.target === audio.settings.ambience,
    )!;
    const machinery = context.gains.find(
      (g) => g.gain.target === audio.settings.machinery,
    )!;
    expect(ambient).toBeDefined();
    expect(machinery).toBeDefined();
    s.running = false;
    audio.update(s);
    expect(ambient.gain.target).toBe(0);
    expect(machinery.gain.target).toBe(0);
    audio.setLevel("machinery", 0.63);
    expect(machinery.gain.target).toBe(0);
    s.running = true;
    audio.update(s);
    expect(machinery.gain.target).toBe(0.63);
  });
  it("positions new actions on their actual production line and disconnects ended sources", async () => {
    const audio = makeAudio();
    await audio.enable();
    const context = Context.instances[0],
      s = snapshot();
    audio.update(s, { x: 3, y: 5, z: 10 });
    s.events.push(event(2));
    audio.update(s, { x: 3, y: 5, z: 10 });
    const panner = context.panners[0];
    expect([
      panner.positionX.value,
      panner.positionY.value,
      panner.positionZ.value,
    ]).toEqual([-7, 1.5, -12]);
    expect(context.listener.positionX.value).toBe(3);
    const source = context.oscillators[1];
    const gain = source.connections[0];
    source.onended?.();
    expect(source.disconnected).toBe(true);
    expect(gain.disconnected).toBe(true);
    expect(panner.disconnected).toBe(true);
  });
  it("uses a motor sound for a delivery and a distinct short placement sound", async () => {
    const audio = makeAudio();
    await audio.enable();
    const context = Context.instances[0],
      s = snapshot();
    s.trucks = [
      {
        id: "truck-1",
        lot: "lot-1",
        phase: "unloading",
        start: 0,
        end: 10,
        amount: { front: 1, rear: 1, battery: 1, interior: 1, exterior: 1 },
      },
    ];
    audio.update(s);
    s.events.push({
      id: 2,
      time: 0,
      type: "shipment-received",
      entity: "truck-1",
      message: "Received",
    });
    audio.update(s);
    s.events.push(event(3));
    audio.update(s);
    expect(context.oscillators[1].type).toBe("sawtooth");
    expect(context.oscillators[2].type).toBe("square");
    expect(context.panners[0].positionX.value).toBe(-29);
  });
  it("bounds simultaneous voices and does not retry dropped old events", async () => {
    const audio = makeAudio();
    await audio.enable();
    const context = Context.instances[0],
      s = snapshot();
    audio.update(s);
    s.events = Array.from({ length: 2000 }, (_, i) => event(i + 2));
    audio.update(s);
    expect(context.oscillators.length).toBeLessThanOrEqual(17);
    for (const oscillator of context.oscillators.slice(1))
      oscillator.onended?.();
    audio.update(s);
    expect(context.oscillators.length).toBeLessThanOrEqual(17);
  });
  it("clamps persisted settings and ignores invalid values", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          master: 3,
          ambience: -3,
          machinery: "loud",
          alerts: 0.4,
        }),
      setItem: vi.fn(),
    });
    const audio = makeAudio();
    expect(audio.settings).toEqual({
      master: 1,
      ambience: 0,
      machinery: 0.36,
      alerts: 0.4,
    });
    audio.setLevel("master", NaN);
    expect(audio.settings.master).toBe(1);
  });
});
