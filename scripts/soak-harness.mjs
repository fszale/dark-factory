export function soakReport({ status, startedAt, durationSeconds, speed, note, samples, error }) {
  return {
    status,
    ...(error ? { error } : {}),
    startedAt,
    durationSeconds,
    speed,
    note,
    samples,
  };
}

// Apply these checks to every scheduled sample. Finalizing a successful run
// deliberately writes the last already-validated sample again, rather than
// manufacturing a second terminal observation with no time for live frames.
export function assertScheduledSample(samples) {
  const current = samples.at(-1);
  if (!current) throw new Error("No soak sample recorded");
  if (current.materialDelta !== 0 || current.receivingDelta !== 0) {
    throw new Error("Material conservation failed");
  }
  if (current.streamErrors > 0) throw new Error("WebSocket errors observed");
  if (current.events > 2000 || current.samples > 720) {
    throw new Error("In-memory retention bound exceeded");
  }
  if (samples.length > 1 && current.frames <= samples.at(-2).frames) {
    throw new Error("WebSocket stream stopped");
  }
  if (samples.length > 10 && current.dispatched <= samples.at(-10).dispatched) {
    throw new Error("Dispatch made no progress for nine samples");
  }
}
