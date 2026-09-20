type ClockSnapshot = { id: string; epoch: number; time: number; running: boolean; speed: number };

/** Presentation-only clock. Network corrections change pace, never reverse motion. */
export class AnimationClock {
  private snapshot?: ClockSnapshot;
  private receivedAt = 0;
  private frameAt = 0;
  private time = 0;

  receive(next: ClockSnapshot, now: number) {
    const previous = this.snapshot;
    if (!previous || previous.id !== next.id || previous.epoch !== next.epoch) {
      this.time = next.time;
      this.frameAt = now;
    } else {
      this.read(now);
      // Explicit pause/step is authoritative; normal packets never reset time.
      if (!next.running) this.time = next.time;
    }
    this.snapshot = { ...next };
    this.receivedAt = now;
  }

  read(now: number) {
    const s = this.snapshot;
    if (!s) return 0;
    const dt = Math.max(0, Math.min(.1, (now - this.frameAt) / 1000));
    this.frameAt = now;
    if (!s.running) return this.time;
    const age = Math.max(0, (now - this.receivedAt) / 1000);
    const target = s.time + Math.min(.25, age) * s.speed;
    const error = (target - this.time) / s.speed;
    // Smooth corrections over half a second, taper to rest on a disconnected stream.
    const rate = Math.max(0, Math.min(1.25, (age > .25 ? 0 : 1) + error / .5));
    this.time += Math.min(dt * s.speed * rate, Math.max(0, s.time + .25 * s.speed - this.time));
    return this.time;
  }
}

/** Interpolate an in-flight station operation, without advancing its controller. */
export function stationPresentationProgress(
  station: { status: string; progress: number; phaseStart: number; phaseEnd: number },
  time: number,
  running: boolean,
) {
  if (!running || !['loading', 'processing', 'unloading'].includes(station.status))
    return station.progress;
  return Math.max(0, Math.min(1,
    (time - station.phaseStart) / (station.phaseEnd - station.phaseStart || 1)));
}
