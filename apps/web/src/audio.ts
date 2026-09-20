import {
  LINE_IDS,
  LINE_META,
  type FactorySnapshot,
  type LineId,
} from "../../../packages/contracts/src/index.ts";

type AudioLevel = "master" | "ambience" | "machinery" | "alerts";
type Point = { x: number; y: number; z: number };
type Voice = { source: OscillatorNode; nodes: AudioNode[] };
const STORAGE_KEY = "brickworks.factory-audio.v1";
const MAX_VOICES = 16;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const point = (x: number, y: number, z: number): Point => ({ x, y, z });
const mix = (a: Point, b: Point, f: number) =>
  point(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
function path(points: Point[], fraction: number): Point {
  const lengths = points
    .slice(1)
    .map((p, i) =>
      Math.hypot(p.x - points[i].x, p.y - points[i].y, p.z - points[i].z),
    );
  let distance = clamp(fraction) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i])
      return mix(points[i], points[i + 1], distance / (lengths[i] || 1));
    distance -= lengths[i];
  }
  return points[points.length - 1];
}

/** Procedural factory sound. The browser's gesture gate is entered only by enable(). */
export class FactoryAudio {
  enabled = false;
  settings: Record<AudioLevel, number> = {
    master: 0.55,
    ambience: 0.22,
    machinery: 0.36,
    alerts: 0.58,
  };
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private machinery: GainNode | null = null;
  private alerts: GainNode | null = null;
  private hum: OscillatorNode | null = null;
  private humFilter: BiquadFilterNode | null = null;
  private backgroundSources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  private backgroundNodes: AudioNode[] = [];
  private voices = new Set<Voice>();
  private activation = 0;
  private seedNext = true;
  private sessionKey = "";
  private lastEventId = 0;
  private lastPulse = -Infinity;
  private lastAlert = -Infinity;
  private pulseIndex = 0;
  private running = false;

  constructor() {
    try {
      const value = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "{}",
      ) as Record<string, unknown>;
      for (const key of [
        "master",
        "ambience",
        "machinery",
        "alerts",
      ] as AudioLevel[]) {
        const level = value[key];
        if (typeof level === "number" && Number.isFinite(level))
          this.settings[key] = clamp(level);
      }
    } catch {
      /* Private-mode storage is optional. */
    }
  }
  async enable(): Promise<void> {
    if (this.enabled && this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const request = ++this.activation;
    if (!this.context) {
      const Ctor =
        globalThis.AudioContext ??
        (
          globalThis as typeof globalThis & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.ambience = this.context.createGain();
      this.machinery = this.context.createGain();
      this.alerts = this.context.createGain();
      this.ambience.connect(this.master);
      this.machinery.connect(this.master);
      this.alerts.connect(this.master);
      this.master.connect(this.context.destination);
      // Start silent until the first live snapshot confirms factory activity.
      this.master.gain.value = 0;
      this.ambience.gain.value = 0;
      this.machinery.gain.value = 0;
      this.startBackground();
    }
    const context = this.context;
    this.seedNext = true;
    await context.resume();
    if (request !== this.activation || context !== this.context) return;
    this.enabled = true;
    this.applyLevels();
  }
  setEnabled(value: boolean): void {
    if (value) {
      void this.enable();
      return;
    }
    this.activation++;
    this.enabled = false;
    this.seedNext = true;
    this.stopVoices();
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
    if (this.context?.state === "running") void this.context.suspend();
  }
  setLevel(key: AudioLevel, value: number): void {
    if (!(key in this.settings) || !Number.isFinite(value)) return;
    this.settings[key] = clamp(value);
    this.applyLevels();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* Optional persistence. */
    }
  }
  update(snapshot: FactorySnapshot, camera: Point = point(0, 7, -24)): void {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    if (this.running !== snapshot.running) {
      this.running = snapshot.running;
      this.applyLevels();
    }
    this.updateBackground(snapshot, now);
    this.updateListener(camera);
    const key = `${snapshot.id}:${snapshot.epoch}`;
    const newest = snapshot.events.reduce(
      (maximum, event) => Math.max(maximum, event.id),
      0,
    );
    if (this.seedNext || key !== this.sessionKey) {
      this.seedNext = false;
      this.sessionKey = key;
      this.lastEventId = newest;
      this.lastPulse = now;
      this.lastAlert = -Infinity;
      return; // Initial enable, unmute, reconnect, and epoch transitions never play historical events.
    }
    if (snapshot.running && now - this.lastPulse >= 0.85) {
      this.lastPulse = now;
      const active = LINE_IDS.filter((line) =>
        ["loading", "processing", "unloading"].includes(
          snapshot.stations[line].status,
        ),
      );
      if (active.length) {
        const line = active[this.pulseIndex++ % active.length];
        this.servo(this.entityPoint(line, snapshot), 0.035);
      }
      const moving =
        snapshot.trucks.find((truck) =>
          ["approach", "departing"].includes(truck.phase),
        ) ||
        snapshot.carts.find((cart) =>
          ["outbound", "returning"].includes(cart.phase),
        );
      if (moving)
        this.motor(
          this.entityPoint(moving.id, snapshot),
          moving.id.startsWith("truck") ? 0.07 : 0.035,
        );
    }
    for (const event of snapshot.events) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;
      const location =
        typeof event.data?.cart === "string" ? event.data.cart : event.entity;
      const origin = this.entityPoint(location, snapshot);
      if (/fault|reject|supply-hold/.test(event.type)) {
        if (now - this.lastAlert > 1.8) {
          this.alert(origin);
          this.lastAlert = now;
        }
      } else if (snapshot.running) {
        if (/truck|shipment|dispatch-start|parking-route/.test(event.type))
          this.motor(origin, 0.065);
        else if (/module-start|maintenance-complete/.test(event.type))
          this.servo(origin, 0.07);
        else if (
          /module-accepted|kit-delivered|assembly-joined|vehicle-complete|vehicle-parked/.test(
            event.type,
          )
        )
          this.click(origin, 0.13);
      }
    }
  }
  dispose(): void {
    this.activation++;
    this.enabled = false;
    this.stopVoices();
    for (const source of this.backgroundSources) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
      source.disconnect();
    }
    for (const node of this.backgroundNodes) node.disconnect();
    this.backgroundSources = [];
    this.backgroundNodes = [];
    this.hum = null;
    this.humFilter = null;
    void this.context?.close();
    this.context = null;
    this.master = this.ambience = this.machinery = this.alerts = null;
    this.seedNext = true;
    this.sessionKey = "";
    this.lastEventId = 0;
  }
  private applyLevels(): void {
    if (
      !this.context ||
      !this.master ||
      !this.ambience ||
      !this.machinery ||
      !this.alerts
    )
      return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(
      this.enabled ? this.settings.master : 0,
      now,
      0.06,
    );
    this.ambience.gain.setTargetAtTime(
      this.running ? this.settings.ambience : 0,
      now,
      0.18,
    );
    this.machinery.gain.setTargetAtTime(
      this.running ? this.settings.machinery : 0,
      now,
      0.12,
    );
    this.alerts.gain.setTargetAtTime(this.settings.alerts, now, 0.04);
  }
  private startBackground(): void {
    if (!this.context || !this.ambience) return;
    const context = this.context;
    this.hum = context.createOscillator();
    this.hum.type = "sawtooth";
    this.hum.frequency.value = 49;
    this.humFilter = context.createBiquadFilter();
    this.humFilter.type = "lowpass";
    this.humFilter.frequency.value = 110;
    const humGain = context.createGain();
    humGain.gain.value = 0.14;
    this.hum.connect(this.humFilter).connect(humGain).connect(this.ambience);
    this.hum.start();
    // A quiet band-limited air/ventilation bed avoids an exposed electronic drone.
    const noise = context.createBuffer(
      1,
      context.sampleRate * 2,
      context.sampleRate,
    );
    const data = noise.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < data.length; i++) {
      smooth = (smooth + Math.random() * 0.035 - 0.0175) / 1.018;
      data[i] = smooth;
    }
    const air = context.createBufferSource();
    air.buffer = noise;
    air.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 520;
    filter.Q.value = 0.45;
    const airGain = context.createGain();
    airGain.gain.value = 0.12;
    air.connect(filter).connect(airGain).connect(this.ambience);
    air.start();
    this.backgroundSources = [this.hum, air];
    this.backgroundNodes = [this.humFilter, humGain, filter, airGain];
  }
  private updateBackground(snapshot: FactorySnapshot, now: number): void {
    if (!this.hum || !this.humFilter) return;
    const active = Object.values(snapshot.stations).filter(
      (station) => station.status === "processing",
    ).length;
    this.hum.frequency.setTargetAtTime(46 + active * 1.7, now, 0.3);
    this.humFilter.frequency.setTargetAtTime(90 + active * 15, now, 0.3);
  }
  private updateListener(camera: Point): void {
    const listener = this.context!.listener;
    listener.positionX.setValueAtTime(camera.x, this.context!.currentTime);
    listener.positionY.setValueAtTime(camera.y, this.context!.currentTime);
    listener.positionZ.setValueAtTime(camera.z, this.context!.currentTime);
    // Face the current site center from the actual camera position.
    const length = Math.hypot(camera.x, camera.y, camera.z) || 1;
    listener.forwardX.setValueAtTime(
      -camera.x / length,
      this.context!.currentTime,
    );
    listener.forwardY.setValueAtTime(
      -camera.y / length,
      this.context!.currentTime,
    );
    listener.forwardZ.setValueAtTime(
      -camera.z / length,
      this.context!.currentTime,
    );
    listener.upX.setValueAtTime(0, this.context!.currentTime);
    listener.upY.setValueAtTime(1, this.context!.currentTime);
    listener.upZ.setValueAtTime(0, this.context!.currentTime);
  }
  private voice(
    origin: Point,
    output: GainNode,
    wave: OscillatorType,
    startFrequency: number,
    endFrequency: number,
    duration: number,
    level: number,
  ): void {
    if (!this.context || this.voices.size >= MAX_VOICES) return;
    const context = this.context,
      now = context.currentTime,
      source = context.createOscillator(),
      gain = context.createGain(),
      panner = context.createPanner();
    source.type = wave;
    source.frequency.setValueAtTime(startFrequency, now);
    source.frequency.exponentialRampToValueAtTime(
      endFrequency,
      now + duration * 0.8,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      level,
      now + Math.min(0.025, duration / 8),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 8;
    panner.maxDistance = 120;
    panner.rolloffFactor = 0.7;
    panner.positionX.value = origin.x;
    panner.positionY.value = origin.y;
    panner.positionZ.value = origin.z;
    source.connect(gain).connect(panner).connect(output);
    const voice = { source, nodes: [source, gain, panner] };
    this.voices.add(voice);
    source.onended = () => this.finishVoice(voice);
    source.start(now);
    source.stop(now + duration + 0.02);
  }
  private click(origin: Point, level: number): void {
    if (this.machinery)
      this.voice(origin, this.machinery, "square", 390, 90, 0.075, level);
  }
  private servo(origin: Point, level: number): void {
    if (this.machinery)
      this.voice(origin, this.machinery, "triangle", 160, 330, 0.32, level);
  }
  private motor(origin: Point, level: number): void {
    if (this.machinery)
      this.voice(origin, this.machinery, "sawtooth", 85, 60, 0.55, level);
  }
  private alert(origin: Point): void {
    if (this.alerts)
      this.voice(origin, this.alerts, "sine", 690, 520, 0.3, 0.16);
  }
  private finishVoice(voice: Voice): void {
    for (const node of voice.nodes) node.disconnect();
    voice.source.onended = null;
    this.voices.delete(voice);
  }
  private stopVoices(): void {
    for (const voice of [...this.voices]) {
      try {
        voice.source.stop();
      } catch {
        /* Source may have just finished. */
      }
      this.finishVoice(voice);
    }
  }
  private entityPoint(entity: string, snapshot: FactorySnapshot): Point {
    if (LINE_IDS.includes(entity as LineId))
      return point(-7, 1.5, LINE_META[entity as LineId].z);
    const truck = snapshot.trucks.find(
      (truck) => truck.id === entity || truck.lot === entity,
    );
    if (truck) {
      const f = clamp(
        (snapshot.time - truck.start) / (truck.end - truck.start || 1),
      );
      return truck.phase === "approach"
        ? path(
            [point(-36, 0.8, -30), point(-36, 0.8, -7), point(-29, 0.8, 0)],
            f,
          )
        : truck.phase === "departing"
          ? path(
              [point(-29, 0.8, 0), point(-36, 0.8, 7), point(-36, 0.8, 30)],
              f,
            )
          : point(-29, 0.8, 0);
    }
    const cart = snapshot.carts.find((cart) => cart.id === entity);
    if (cart) {
      const f = clamp(
          (snapshot.time - cart.start) / (cart.end - cart.start || 1),
        ),
        z = LINE_META[cart.line].z;
      return point(
        cart.phase === "outbound"
          ? -20 + 4 * f
          : cart.phase === "returning"
            ? -16 - 4 * f
            : cart.phase === "loading"
              ? -20
              : -16,
        0.8,
        z,
      );
    }
    const vehicle = snapshot.vehicles.find((vehicle) => vehicle.id === entity);
    if (vehicle) {
      const parked = point(
          40,
          0.8,
          -15.4 + vehicle.slot * 2.8,
        ),
        f = clamp(
          (snapshot.time - vehicle.start) / (vehicle.end - vehicle.start || 1),
        );
      if (vehicle.phase === "joining") return point(10, 1.3, 0);
      if (vehicle.phase === "testing") return point(19, 1.3, 0);
      if (vehicle.phase === "outbound")
        return path(
          [
            point(20, 0.8, 0),
            point(23, 0.8, 0),
            point(23, 0.8, 17.5),
            point(31, 0.8, 17.5),
            point(31, 0.8, parked.z),
          ],
          f,
        );
      if (vehicle.phase === "parking")
        return mix(point(31, 0.8, parked.z), parked, f);
      if (vehicle.phase === "dispatching")
        return path([parked, point(31, 0.8, parked.z), point(31, 0.8, 27)], f);
      return parked;
    }
    if (
      entity.startsWith("truck") ||
      entity.startsWith("lot") ||
      entity === "receiving" ||
      entity === "supply"
    )
      return point(-29, 1, 0);
    if (entity === "parking" || entity === "dispatch") return point(39, 1, 0);
    return point(10, 1.3, 0);
  }
}
