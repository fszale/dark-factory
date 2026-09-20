import assert from "node:assert/strict";
const base = process.env.SMOKE_BASE ?? process.env.BASE_URL;
if (!base) throw new Error("Set SMOKE_BASE or BASE_URL to the server origin.");
async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { "x-session-token": token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}
const health = await request("/api/health");
assert.equal(health.response.status, 200);
assert.equal(health.json.ok, true);
assert.equal(health.json.providers.astra.configured, false);
assert.equal(health.json.providers.jev.configured, false);
assert.equal(JSON.stringify(health.json).includes("API_KEY"), false);
const staticPage = await fetch(base + "/");
assert.equal(staticPage.status, 200);
assert.match(staticPage.headers.get("content-type") ?? "", /text\/html/);
assert.match(await staticPage.text(), /Brickworks|root/i);
const first = await request("/api/sessions", {
  method: "POST",
  body: { seed: 5150 },
});
assert.equal(first.response.status, 200);
assert.ok(first.json.id && first.json.token);
const second = await request("/api/sessions", {
  method: "POST",
  body: { seed: 5151 },
});
assert.equal(second.response.status, 200);
const cross = await request(`/api/sessions/${first.json.id}`, {
  token: second.json.token,
});
assert.equal(cross.response.status, 401);
const unavailable = await request(`/api/sessions/${first.json.id}/chat`, {
  method: "POST",
  token: first.json.token,
  body: { message: "review" },
});
assert.equal(unavailable.response.status, 503);
const adaptiveUnavailable = await request(
  `/api/sessions/${first.json.id}/adaptive-experiments`,
  {
    method: "POST",
    token: first.json.token,
    body: { provider: "astra" },
  },
);
assert.equal(adaptiveUnavailable.response.status, 503);
const experiment = await request(`/api/sessions/${first.json.id}/experiments`, {
  method: "POST",
  token: first.json.token,
  body: {
    baselineName: "Default flow",
    candidateName: "Current configuration",
    baselineConfig: { scenario: "balanced" },
    candidateConfig: { scenario: "balanced", releaseRate: 1.2 },
  },
});
assert.equal(experiment.response.status, 200);
assert.equal(experiment.json.runs, 10);
assert.equal(experiment.json.perSeed.length, 10);
assert.equal(experiment.json.baselineName, "Default flow");
assert.equal(experiment.json.candidateName, "Current configuration");
const recorded = await request(`/api/sessions/${first.json.id}/experiments`, {
  method: "POST",
  token: first.json.token,
  body: { mode: "recorded-ai" },
});
assert.equal(recorded.response.status, 400);
for (const command of [
  { id: "smoke-start", type: "start" },
  { id: "smoke-step", type: "step" },
  { id: "smoke-pause", type: "pause" },
]) {
  const result = await request(`/api/sessions/${first.json.id}/command`, {
    method: "POST",
    token: first.json.token,
    body: command,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.ok, true);
}
const current = await request(`/api/sessions/${first.json.id}`, {
  token: first.json.token,
});
assert.equal(current.response.status, 200);
assert.ok(current.json.snapshot.time > 0);
const replay = await request(`/api/sessions/${first.json.id}/replay`, {
  method: "POST",
  token: first.json.token,
  body: { time: current.json.snapshot.time },
});
assert.equal(replay.response.status, 200);
assert.equal(replay.json.snapshot.running, false);
assert.equal(replay.json.snapshot.time, current.json.snapshot.time);
const exported = await request(`/api/sessions/${first.json.id}/export`, {
  token: first.json.token,
});
assert.equal(exported.response.status, 200);
const imported = await request("/api/import", {
  method: "POST",
  body: { run: exported.json },
});
assert.equal(imported.response.status, 200);
assert.notEqual(imported.json.id, first.json.id);
const history = await fetch(`${base}/api/sessions/${first.json.id}/history`, {
  headers: { "x-session-token": first.json.token },
});
assert.equal(history.status, 200);
assert.match(
  history.headers.get("content-type") ?? "",
  /application\/x-ndjson/,
);
assert.equal((await history.text()).includes('"kind":"checkpoint"'), true);
const socket = new WebSocket(base.replace("http", "ws") + "/api/live");
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
  setTimeout(() => reject(new Error("websocket open timeout")), 3000).unref();
});
socket.send(JSON.stringify({ id: first.json.id, token: first.json.token }));
const live = await new Promise((resolve, reject) => {
  socket.onmessage = (event) => resolve(JSON.parse(event.data));
  socket.onerror = reject;
  setTimeout(
    () => reject(new Error("websocket message timeout")),
    3000,
  ).unref();
});
assert.equal(live.type, "snapshot");
assert.equal(live.sessionId, first.json.id);
assert.equal(live.snapshot.id, first.json.id);
assert.ok(Number.isInteger(live.sequence) && live.sequence >= 0);
assert.ok(Number.isFinite(live.sentAt) && live.sentAt > 0);
socket.close();
console.log(
  JSON.stringify(
    {
      node: process.version,
      health: true,
      static: true,
      sessions: true,
      isolation: true,
      providerAbsence: true,
      adaptiveProviderAbsence: true,
      experimentRows: experiment.json.perSeed.length,
      replay: true,
      import: true,
      history: true,
      websocket: { sequence: live.sequence, sentAt: true },
    },
    null,
    2,
  ),
);
