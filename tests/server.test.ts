import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../apps/server/src/app.ts";
import type {
  AdaptiveExperimentJob,
  DecisionRecord,
  ExperimentResult,
  FactoryCommand,
  FactorySnapshot,
} from "../packages/contracts/src/index.ts";
import type {
  ProviderAdapter,
  ProviderDecision,
} from "../packages/providers/src/index.ts";
import type {
  AdaptiveComparisonInput,
  AdaptiveOptions,
} from "../packages/simulation/src/adaptive-experiments.ts";

async function create(
  app: Awaited<ReturnType<typeof buildApp>>,
  body: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: body,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    id: string;
    token: string;
    snapshot: FactorySnapshot;
  };
}

function command(
  app: Awaited<ReturnType<typeof buildApp>>,
  session: { id: string; token: string },
  body: FactoryCommand,
) {
  return app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/command`,
    headers: { "x-session-token": session.token },
    payload: body,
  });
}

function experimentResult(): ExperimentResult {
  const metrics = { completed: 10, throughput: 20, yield: 99 };
  return {
    name: "Bounded paired experiment",
    runs: 10,
    seeds: Array.from({ length: 10 }, (_, index) => 10_001 + index),
    baseline: metrics,
    candidate: { ...metrics, throughput: 21 },
    differences: { completed: 0, throughput: 1, yield: 0 },
    note: "Deterministic paired simulation; observational, not causal.",
    policySource: "configured-profiles",
  };
}

async function waitForAdaptiveJob(
  app: Awaited<ReturnType<typeof buildApp>>,
  session: { id: string; token: string },
  jobId: string,
) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/adaptive-experiments/${jobId}`,
      headers: { "x-session-token": session.token },
    });
    expect(response.statusCode).toBe(200);
    const job = response.json() as AdaptiveExperimentJob;
    if (!["queued", "running"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Adaptive comparison did not reach a terminal state");
}

describe("server sessions", () => {
  it("authenticates live sockets with the first message", async () => {
    const app = await buildApp({ tickMs: 5 });
    const session = await create(app);
    await app.ready();
    const socket = await app.injectWS("/api/live");
    const message = new Promise<string>((resolve) =>
      socket.once("message", (data) => resolve(data.toString())),
    );
    socket.send(JSON.stringify({ id: session.id, token: session.token }));
    const initial = JSON.parse(await message) as {
      sessionId: string;
      sequence: number;
      sentAt: number;
      snapshot: FactorySnapshot;
    };
    expect(initial).toMatchObject({
      type: "snapshot",
      sessionId: session.id,
      snapshot: { id: session.id },
    });
    expect(initial.sentAt).toBeGreaterThan(0);
    const nextMessage = new Promise<string>((resolve) =>
      socket.once("message", (data) => resolve(data.toString())),
    );
    const next = JSON.parse(await nextMessage) as {
      sessionId: string;
      sequence: number;
    };
    expect(next.sessionId).toBe(session.id);
    expect(next.sequence).toBeGreaterThan(initial.sequence);
    socket.close();
    await app.close();
  });

  it("persists authenticated NDJSON history across a server restart", async () => {
    const archiveDir = mkdtempSync(join(tmpdir(), "brickworks-history-test-"));
    try {
      const firstApp = await buildApp({ tickMs: 10_000, archiveDir });
      const session = await create(firstApp);
      await command(firstApp, session, { id: "archive-start", type: "start" });
      await command(firstApp, session, {
        id: "archive-fault",
        type: "fault",
        station: "front",
        value: "test fault",
      });
      const live = await firstApp.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/history`,
        headers: { "x-session-token": session.token },
      });
      expect(live.statusCode).toBe(200);
      expect(live.headers["content-type"]).toContain("application/x-ndjson");
      const records = live.body
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { kind: string });
      expect(records[0].kind).toBe("checkpoint");
      expect(records.some((record) => record.kind === "command")).toBe(true);
      expect(records.some((record) => record.kind === "event")).toBe(true);
      await firstApp.close();

      const restarted = await buildApp({ tickMs: 10_000, archiveDir });
      const retained = await restarted.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/history`,
        headers: { "x-session-token": session.token },
      });
      expect(retained.statusCode).toBe(200);
      const denied = await restarted.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/history`,
        headers: { "x-session-token": "wrong-token" },
      });
      expect(denied.statusCode).toBe(404);
      await restarted.close();
    } finally {
      rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  it("does not duplicate checkpoint-retained events in a new archive", async () => {
    const app = await buildApp({ tickMs: 10_000 });
    const session = await create(app);
    const history = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/history`,
      headers: { "x-session-token": session.token },
    });
    expect(history.statusCode).toBe(200);
    const records = history.body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string });
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("checkpoint");
    await app.close();
  });

  it("marks an archive when its configured disk quota truncates history", async () => {
    const app = await buildApp({
      tickMs: 10_000,
      archiveSessionBytes: 7_000,
      archiveGlobalBytes: 100_000,
    });
    const session = await create(app);
    for (let index = 0; index < 30; index++) {
      await command(app, session, {
        id: `quota-${index}`,
        type: "profile",
        station: "front",
        value: index % 2 ? "normal" : "gentle",
      });
    }
    const history = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/history`,
      headers: { "x-session-token": session.token },
    });
    expect(history.statusCode).toBe(200);
    expect(history.headers["x-archive-truncated"]).toBe("true");
    expect(history.body).toContain('"kind":"archive-truncated"');
    const replay = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/replay`,
      headers: { "x-session-token": session.token },
      payload: { time: 0 },
    });
    expect(replay.statusCode).toBe(409);
    await app.close();
  });

  it("rejects invalid and unavailable replay times without changing the source or exhausting replay slots", async () => {
    const app = await buildApp({ tickMs: 10_000 });
    try {
      const source = await create(app);
      const replay = (payload: unknown) => app.inject({
        method: "POST",
        url: `/api/sessions/${source.id}/replay`,
        headers: { "x-session-token": source.token },
        payload: payload as Record<string, unknown>,
      });
      for (const payload of [{ time: -1 }, { time: "0" }, {}, { time: 0, extra: true }]) {
        expect((await replay(payload)).statusCode).toBe(400);
      }
      // The archive is still at time zero: replay may not invent future history.
      for (let attempt = 0; attempt < 3; attempt++) {
        expect((await replay({ time: 3600 })).statusCode).toBe(422);
      }
      const valid = await replay({ time: 0 });
      expect(valid.statusCode).toBe(200);
      expect(valid.json().snapshot).toMatchObject({ time: 0, running: false });
      const original = await app.inject({
        method: "GET",
        url: `/api/sessions/${source.id}`,
        headers: { "x-session-token": source.token },
      });
      expect(original.statusCode).toBe(200);
      expect(original.json().snapshot).toMatchObject({ time: 0, revision: source.snapshot.revision });
    } finally {
      await app.close();
    }
  });

  it("creates a new paused graphical session from the latest archived epoch", async () => {
    const app = await buildApp({ tickMs: 10_000 });
    const source = await create(app);
    await command(app, source, { id: "replay-start-1", type: "start" });
    await command(app, source, { id: "replay-step-1", type: "step" });
    await command(app, source, { id: "replay-pause-1", type: "pause" });
    await command(app, source, {
      id: "replay-reset",
      type: "reset",
      scenario: "empty",
    });
    await command(app, source, { id: "replay-start-2", type: "start" });
    await command(app, source, { id: "replay-step-2", type: "step" });
    await command(app, source, { id: "replay-pause-2", type: "pause" });
    const current = await app.inject({
      method: "GET",
      url: `/api/sessions/${source.id}`,
      headers: { "x-session-token": source.token },
    });
    const target = current.json().snapshot as FactorySnapshot;
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${source.id}/replay`,
      headers: { "x-session-token": source.token },
      payload: { time: target.time },
    });
    expect(response.statusCode).toBe(200);
    const replayed = response.json();
    expect(replayed.id).not.toBe(source.id);
    expect(replayed.snapshot).toMatchObject({
      running: false,
      time: target.time,
      config: { scenario: "empty" },
    });
    expect(replayed.snapshot.providers).toEqual({ astra: false, jev: false });
    await app.close();
  });

  it("replays a live time between factory events using an archived watermark", async () => {
    const app = await buildApp({ tickMs: 5 });
    const source = await create(app);
    await command(app, source, { id: "watermark-start", type: "start" });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const current = await app.inject({
      method: "GET",
      url: `/api/sessions/${source.id}`,
      headers: { "x-session-token": source.token },
    });
    const target = (current.json().snapshot as FactorySnapshot).time;
    expect(target).toBeGreaterThan(0);
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${source.id}/replay`,
      headers: { "x-session-token": source.token },
      payload: { time: target },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().snapshot).toMatchObject({
      running: false,
      time: target,
    });
    await app.close();
  });

  it("isolates session tokens and rejects malformed commands", async () => {
    const app = await buildApp({ tickMs: 10_000 });
    const first = await create(app);
    const second = await create(app, { seed: 8 });
    const cross = await app.inject({
      method: "GET",
      url: `/api/sessions/${first.id}`,
      headers: { "x-session-token": second.token },
    });
    expect(cross.statusCode).toBe(401);
    const malformed = await app.inject({
      method: "POST",
      url: `/api/sessions/${first.id}/command`,
      headers: { "x-session-token": first.token },
      payload: { id: "bad", type: "speed", value: { unsafe: true } },
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("caps concurrent sessions at ten and expires idle sessions without deleting retained history", async () => {
    const capacityApp = await buildApp({ tickMs: 10_000 });
    for (let index = 0; index < 10; index++)
      await create(capacityApp, { seed: index + 1 });
    const overflow = await capacityApp.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { seed: 99 },
    });
    expect(overflow.statusCode).toBe(503);
    await capacityApp.close();

    const expiryApp = await buildApp({ tickMs: 5, sessionIdleMs: 1 });
    const session = await create(expiryApp);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const expired = await expiryApp.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { "x-session-token": session.token },
    });
    expect(expired.statusCode).toBe(404);
    const retained = await expiryApp.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/history`,
      headers: { "x-session-token": session.token },
    });
    expect(retained.statusCode).toBe(200);
    await expiryApp.close();
  });

  it("deduplicates command ids and rejects stale revisions", async () => {
    const app = await buildApp({ tickMs: 10_000 });
    const session = await create(app);
    const first = await command(app, session, {
      id: "same-command",
      type: "start",
    });
    const duplicate = await command(app, session, {
      id: "same-command",
      type: "start",
    });
    expect(first.json()).toEqual(duplicate.json());
    const collision = await command(app, session, {
      id: "same-command",
      type: "pause",
    });
    expect(collision.statusCode).toBe(409);
    expect(collision.json()).toEqual({
      error: "Command id was already used for a different command.",
    });
    const stale = await command(app, session, {
      id: "stale",
      type: "pause",
      revision: 0,
    });
    expect(stale.json()).toMatchObject({
      ok: false,
      message: "Stale state revision",
    });
    await app.close();
  });

  it("returns a truthful unavailable response when an AI provider is absent", async () => {
    const app = await buildApp({
      tickMs: 10_000,
      providers: {
        astra: {
          id: "astra",
          configured: false,
          decide: async () => {
            throw new Error("must not run");
          },
        },
      },
    });
    const session = await create(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "help" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Astra is not configured." });
    await app.close();
  });

  it("keeps public provider calls locked until the access code is supplied", async () => {
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: async () => ({ summary: "Hold.", commands: [], tokens: 1 }),
    };
    const app = await buildApp({
      tickMs: 10_000,
      publicMode: true,
      accessCode: "test-only-code",
      providers: { astra: provider },
    });
    const session = await create(app);
    const denied = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "review" },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "review", accessCode: "test-only-code" },
    });
    expect(allowed.statusCode).toBe(200);
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.body).not.toContain("test-only-code");
    expect(health.json().providers.accessRequired).toBe(true);
    await app.close();
  });

  it("enforces the process token budget before another provider request", async () => {
    let calls = 0;
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: async () => {
        calls++;
        return { summary: "Hold.", commands: [], tokens: 5 };
      },
    };
    const app = await buildApp({
      tickMs: 10_000,
      globalTokenLimit: 1,
      providers: { astra: provider },
    });
    const session = await create(app);
    const first = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "first" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "second" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(calls).toBe(1);
    await app.close();
  });

  it("allows only one in-flight request per provider across sessions", async () => {
    let release: (decision: ProviderDecision) => void = () => {};
    let calls = 0;
    const delayed: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: () => {
        calls++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { astra: delayed },
    });
    const firstSession = await create(app);
    const secondSession = await create(app);
    const first = app.inject({
      method: "POST",
      url: `/api/sessions/${firstSession.id}/chat`,
      headers: { "x-session-token": firstSession.token },
      payload: { message: "first" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await app.inject({
      method: "POST",
      url: `/api/sessions/${secondSession.id}/chat`,
      headers: { "x-session-token": secondSession.token },
      payload: { message: "second" },
    });
    expect(second.statusCode).toBe(429);
    expect(calls).toBe(1);
    release({ summary: "Hold.", commands: [], tokens: 2 });
    expect((await first).statusCode).toBe(200);
    await app.close();
  });

  it("rejects an out-of-policy provider action without changing the factory", async () => {
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: async () => ({
        summary: "Inject a fault.",
        commands: [{ id: "unsafe", type: "fault", station: "front" }],
        tokens: 1,
      }),
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { astra: provider },
    });
    const session = await create(app);
    await command(app, session, {
      id: "mode",
      type: "mode",
      value: "autonomous",
    });
    await command(app, session, { id: "start", type: "start" });
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "review" },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe("Astra request failed.");
    expect(response.json().snapshot.stations.front.fault).toBeNull();
    await app.close();
  });

  it("imports a bounded checkpoint larger than Fastify default body size", async () => {
    const app = await buildApp({ tickMs: 10_000 });
    const source = await create(app);
    const original = await command(app, source, {
      id: "before-import",
      type: "speed",
      value: 5,
    });
    expect(original.statusCode).toBe(200);
    const exported = await app.inject({
      method: "GET",
      url: `/api/sessions/${source.id}/export`,
      headers: { "x-session-token": source.token },
    });
    const run = exported.json() as { internal: Record<string, unknown> };
    run.internal.padding = "x".repeat(1_100_000);
    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { run },
    });
    expect(imported.statusCode).toBe(200);
    const restored = imported.json() as {
      id: string;
      token: string;
      snapshot: FactorySnapshot;
    };
    expect(restored.id).not.toBe(source.id);
    const collision = await command(app, restored, {
      id: "before-import",
      type: "speed",
      value: 10,
    });
    expect(collision.statusCode).toBe(409);
    const duplicate = await command(app, restored, {
      id: "before-import",
      type: "speed",
      value: 5,
    });
    expect(duplicate.json()).toEqual(original.json());
    await app.close();
  });

  it("discards a late autonomous action after an operator pause", async () => {
    let release: (decision: ProviderDecision) => void = () => {};
    const delayed: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { astra: delayed },
    });
    const session = await create(app);
    await command(app, session, {
      id: "mode",
      type: "mode",
      value: "autonomous",
    });
    await command(app, session, { id: "start", type: "start" });
    const chat = app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "review" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await command(app, session, { id: "operator-pause", type: "pause" });
    release({
      summary: "Increase speed.",
      commands: [{ id: "ai-speed", type: "speed", value: 10 }],
      tokens: 4,
    });
    const response = await chat;
    expect(response.statusCode).toBe(200);
    expect(response.json().decision.status).toBe("advisory");
    expect(response.json().decision.source).toMatchObject({
      time: 0,
      completed: 0,
      dispatched: 0,
    });
    expect(response.json().decision.applicationTime).toBe(0);
    expect(response.json().decision.commandResults).toEqual([
      expect.objectContaining({ commandId: "ai-speed", status: "not-applied" }),
    ]);
    expect(response.json().snapshot).toMatchObject({
      running: false,
      speed: 1,
    });
    await app.close();
  });

  it("guards and applies each autonomous command against the latest revision", async () => {
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: async () => ({
        summary: "Use two bounded adjustments.",
        commands: [
          { id: "ai-speed", type: "speed", value: 10 },
          {
            id: "ai-profile",
            type: "profile",
            station: "front",
            value: "gentle",
          },
        ],
        tokens: 5,
      }),
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { astra: provider },
    });
    const session = await create(app);
    await command(app, session, {
      id: "mode",
      type: "mode",
      value: "autonomous",
    });
    await command(app, session, { id: "start", type: "start" });
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "review" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().decision.status).toBe("applied");
    expect(response.json().decision.source).toMatchObject({
      completed: 0,
      dispatched: 0,
    });
    expect(response.json().decision.applicationTime).toBe(0);
    expect(response.json().decision.commandResults).toEqual([
      expect.objectContaining({ commandId: "ai-speed", status: "applied" }),
      expect.objectContaining({ commandId: "ai-profile", status: "applied" }),
    ]);
    expect(response.json().snapshot.speed).toBe(10);
    expect(response.json().snapshot.stations.front.profile).toBe("gentle");
    await app.close();
  });

  it("records individual rejections and a bounded observational aftermath", async () => {
    let calls = 0;
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: async () =>
        calls++ === 0
          ? {
              summary: "Try two conflicting actions.",
              commands: [
                { id: "same-ai-id", type: "speed", value: 5 },
                { id: "same-ai-id", type: "speed", value: 10 },
              ],
              tokens: 3,
            }
          : { summary: "Hold.", commands: [], tokens: 1 },
    };
    const app = await buildApp({
      tickMs: 500,
      aftermathWindowSeconds: 1,
      providers: { astra: provider },
    });
    const session = await create(app);
    await command(app, session, {
      id: "aftermath-speed",
      type: "speed",
      value: 10,
    });
    await command(app, session, {
      id: "mode",
      type: "mode",
      value: "autonomous",
    });
    await command(app, session, { id: "start", type: "start" });
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "review" },
    });
    expect(response.statusCode).toBe(200);
    const decision = response.json().decision as DecisionRecord;
    expect(decision.status).toBe("rejected");
    expect(decision.commandResults).toEqual([
      expect.objectContaining({ commandId: "same-ai-id", status: "applied" }),
      expect.objectContaining({ commandId: "same-ai-id", status: "rejected" }),
    ]);
    let measured: DecisionRecord | undefined;
    for (let attempt = 0; attempt < 100 && !measured?.aftermath; attempt++) {
      const current = await app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}`,
        headers: { "x-session-token": session.token },
      });
      measured = (current.json().snapshot as FactorySnapshot).decisions.find(
        (item) => item.id === decision.id,
      );
      if (!measured?.aftermath)
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(measured?.aftermath).toMatchObject({
      status: "complete",
      windowSeconds: 1,
      interpretation: "observational-not-causal",
      baseline: { time: decision.applicationTime },
    });
    expect(measured?.aftermath?.measurement.time).toBe(
      (decision.applicationTime ?? 0) + 1,
    );
    await app.close();
  });

  it("runs one provider-requested experiment without mutating live inventory", async () => {
    let workerInput: unknown;
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: async () => ({
        summary: "Compare gentle front handling.",
        commands: [
          {
            id: "provider-experiment",
            type: "experiment",
            value: "front:gentle",
          },
        ],
        tokens: 3,
      }),
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { astra: provider },
      experimentRunner: async (input) => {
        workerInput = input;
        return experimentResult();
      },
    });
    const session = await create(app);
    const before = session.snapshot;
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "test a profile" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      decision: DecisionRecord;
      snapshot: FactorySnapshot;
    };
    expect(workerInput).toMatchObject({
      mode: "profiles",
      profiles: { front: "gentle" },
    });
    expect(body.decision).toMatchObject({
      status: "advisory",
      commandResults: [
        { commandId: "provider-experiment", status: "experimented" },
      ],
      experiment: {
        status: "completed",
        requestedProfile: { line: "front", profile: "gentle" },
        provenance: "paired-deterministic-simulation",
        runs: 10,
      },
    });
    expect(body.snapshot.revision).toBe(before.revision);
    expect(body.snapshot.warehouse).toEqual(before.warehouse);
    expect(body.snapshot.stations).toEqual(before.stations);
    expect(body.snapshot.vehicles).toEqual(before.vehicles);
    expect(body.snapshot.metrics.consumed).toBe(before.metrics.consumed);
    await app.close();
  });

  it("discards a pending provider experiment after operator takeover", async () => {
    let release: (result: ExperimentResult) => void = () => {};
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: async () => ({
        summary: "Compare fast rear handling.",
        commands: [
          {
            id: "stale-experiment",
            type: "experiment",
            station: "rear",
            value: "rear:fast",
          },
        ],
        tokens: 3,
      }),
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { astra: provider },
      experimentRunner: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const session = await create(app);
    await command(app, session, {
      id: "experiment-mode",
      type: "mode",
      value: "autonomous",
    });
    await command(app, session, { id: "experiment-start", type: "start" });
    const pending = app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/chat`,
      headers: { "x-session-token": session.token },
      payload: { message: "test rear profile" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await command(app, session, { id: "experiment-pause", type: "pause" });
    release(experimentResult());
    const response = await pending;
    expect(response.statusCode).toBe(200);
    expect(response.json().decision).toMatchObject({
      status: "advisory",
      commandResults: [
        { commandId: "stale-experiment", status: "not-applied" },
      ],
      experiment: {
        status: "discarded",
        requestedProfile: { line: "rear", profile: "fast" },
      },
    });
    expect(response.json().decision.experiment).not.toHaveProperty("baseline");
    expect(response.json().snapshot.running).toBe(false);
    await app.close();
  });

  it("returns ten paired experiment rows and real variation without pretending to run AI", async () => {
    const app = await buildApp({ tickMs: 10_000 });
    const session = await create(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/experiments`,
      headers: { "x-session-token": session.token },
      payload: { profiles: { exterior: "gentle" } },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.perSeed).toHaveLength(10);
    expect(
      new Set(result.perSeed.map((row: { seed: number }) => row.seed)).size,
    ).toBe(10);
    expect(result.standardDeviation.baseline.completed).toBeGreaterThan(0);
    expect(result.policySource).toBe("configured-profiles");
    expect(result.note).toContain("No AI provider is called or imitated.");
    await app.close();
  });

  it("validates bounded paired configuration inputs and rejects seed overrides", async () => {
    let workerInput: unknown;
    const app = await buildApp({
      tickMs: 10_000,
      experimentRunner: async (input) => {
        workerInput = input;
        return experimentResult();
      },
    });
    const session = await create(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/experiments`,
      headers: { "x-session-token": session.token },
      payload: {
        baselineName: "Default flow",
        candidateName: "Current configuration",
        baselineConfig: { scenario: "balanced" },
        candidateConfig: { scenario: "shortage", releaseRate: 1.5 },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(workerInput).toMatchObject({
      baselineName: "Default flow",
      candidateName: "Current configuration",
      baselineConfig: { scenario: "balanced" },
      candidateConfig: { scenario: "shortage", releaseRate: 1.5 },
    });
    const seedOverride = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/experiments`,
      headers: { "x-session-token": session.token },
      payload: { candidateConfig: { seed: 99 } },
    });
    expect(seedOverride.statusCode).toBe(400);
    await app.close();
  });

  it("uses only live applied decisions for recorded-AI open-loop experiments", async () => {
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      decide: async () => ({
        summary: "Use gentle front handling.",
        commands: [
          {
            id: "live-profile",
            type: "profile",
            station: "front",
            value: "gentle",
          },
        ],
        tokens: 2,
      }),
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { astra: provider },
    });
    const source = await create(app);
    const absent = await app.inject({
      method: "POST",
      url: `/api/sessions/${source.id}/experiments`,
      headers: { "x-session-token": source.token },
      payload: { mode: "recorded-ai" },
    });
    expect(absent.statusCode).toBe(400);
    await command(app, source, {
      id: "recorded-mode",
      type: "mode",
      value: "autonomous",
    });
    await command(app, source, { id: "recorded-start", type: "start" });
    const live = await app.inject({
      method: "POST",
      url: `/api/sessions/${source.id}/chat`,
      headers: { "x-session-token": source.token },
      payload: { message: "review" },
    });
    const decisionId = live.json().decision.id as string;
    const comparison = await app.inject({
      method: "POST",
      url: `/api/sessions/${source.id}/experiments`,
      headers: { "x-session-token": source.token },
      payload: { mode: "recorded-ai" },
    });
    expect(comparison.statusCode).toBe(200);
    expect(comparison.json()).toMatchObject({
      policySource: "recorded-ai",
      actionCount: 1,
      sourceDecisionIds: [decisionId],
    });

    await command(app, source, { id: "recorded-reset", type: "reset" });
    const priorEpoch = await app.inject({
      method: "POST",
      url: `/api/sessions/${source.id}/experiments`,
      headers: { "x-session-token": source.token },
      payload: { mode: "recorded-ai" },
    });
    expect(priorEpoch.statusCode).toBe(400);

    const exported = await app.inject({
      method: "GET",
      url: `/api/sessions/${source.id}/export`,
      headers: { "x-session-token": source.token },
    });
    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { run: exported.json() },
    });
    const restored = imported.json() as { id: string; token: string };
    const untrusted = await app.inject({
      method: "POST",
      url: `/api/sessions/${restored.id}/experiments`,
      headers: { "x-session-token": restored.token },
      payload: { mode: "recorded-ai" },
    });
    expect(untrusted.statusCode).toBe(400);
    await app.close();
  });

  it("runs an adaptive comparison asynchronously without mutating the live factory", async () => {
    let observations = 0;
    const provider: ProviderAdapter = {
      id: "jev",
      configured: true,
      source: "test-fixture",
      model: "fixture-policy-v1",
      decide: async () => ({ summary: "Hold.", commands: [], tokens: 1 }),
      decideObservation: async (observation) => {
        observations++;
        expect(observation).not.toHaveProperty("internal");
        expect(JSON.stringify(observation)).not.toContain("wear");
        return {
          summary: "Use gentle front handling.",
          commands: [
            {
              id: "fixture-profile",
              type: "profile",
              station: "front",
              value: "gentle",
            },
          ],
          tokens: 1,
        };
      },
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { jev: provider },
    });
    const session = await create(app);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/adaptive-experiments`,
      headers: { "x-session-token": session.token },
      payload: {
        provider: "jev",
        decisionTimes: [0],
        config: { scenario: "balanced" },
      },
    });
    expect(accepted.statusCode).toBe(202);
    const initial = accepted.json() as AdaptiveExperimentJob;
    expect(initial).toMatchObject({
      status: "queued",
      provider: "jev",
      bounds: {
        pairedSeeds: 10,
        decisionCheckpoints: 1,
        maximumProviderCalls: 10,
        providerCallsPerMinute: 12,
      },
    });
    const completed = await waitForAdaptiveJob(app, session, initial.jobId);
    expect(completed.status).toBe("completed");
    expect(completed.result).toMatchObject({
      status: "completed",
      completedPairs: 10,
      policySource: "adaptive-test-fixture",
      providers: ["jev"],
      models: ["fixture-policy-v1"],
      requestedDecisions: 10,
      completedDecisions: 10,
    });
    expect(completed.result?.trace).toHaveLength(10);
    expect(
      completed.result?.trace.every((trace) => trace.source === "test-fixture"),
    ).toBe(true);
    expect(observations).toBe(10);
    const current = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { "x-session-token": session.token },
    });
    const snapshot = (current.json() as { snapshot: FactorySnapshot }).snapshot;
    expect(snapshot.revision).toBe(session.snapshot.revision);
    expect(snapshot.warehouse).toEqual(session.snapshot.warehouse);
    expect(snapshot.stations).toEqual(session.snapshot.stations);
    expect(snapshot.vehicles).toEqual(session.snapshot.vehicles);
    await app.close();
  });

  it("requires authorized configured providers before creating adaptive jobs", async () => {
    const app = await buildApp({
      tickMs: 10_000,
      publicMode: true,
      accessCode: "adaptive-secret",
    });
    const session = await create(app);
    const denied = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/adaptive-experiments`,
      headers: { "x-session-token": session.token },
      payload: { provider: "astra" },
    });
    expect(denied.statusCode).toBe(403);
    const absent = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/adaptive-experiments`,
      headers: { "x-session-token": session.token },
      payload: { provider: "astra", accessCode: "adaptive-secret" },
    });
    expect(absent.statusCode).toBe(503);
    expect(absent.body).not.toContain("adaptive-secret");
    const seeded = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/adaptive-experiments`,
      headers: { "x-session-token": session.token },
      payload: {
        provider: "astra",
        accessCode: "adaptive-secret",
        config: { seed: 99 },
      },
    });
    expect(seeded.statusCode).toBe(400);
    await app.close();
  });

  it("isolates adaptive job status and cancels pending work on operator takeover", async () => {
    let aborted = false;
    const provider: ProviderAdapter = {
      id: "astra",
      configured: true,
      source: "test-fixture",
      decide: async () => ({ summary: "Hold.", commands: [], tokens: 1 }),
      decideObservation: async () => ({
        summary: "Hold.",
        commands: [],
        tokens: 1,
      }),
    };
    const app = await buildApp({
      tickMs: 10_000,
      providers: { astra: provider },
      adaptiveRunner: (_input, options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("cancelled"));
            },
            { once: true },
          );
        }),
    });
    const owner = await create(app);
    const other = await create(app, { seed: 9 });
    const accepted = await app.inject({
      method: "POST",
      url: `/api/sessions/${owner.id}/adaptive-experiments`,
      headers: { "x-session-token": owner.token },
      payload: { provider: "astra" },
    });
    const jobId = (accepted.json() as AdaptiveExperimentJob).jobId;
    const cross = await app.inject({
      method: "GET",
      url: `/api/sessions/${other.id}/adaptive-experiments/${jobId}`,
      headers: { "x-session-token": other.token },
    });
    expect(cross.statusCode).toBe(404);
    await command(app, owner, { id: "operator-takeover", type: "pause" });
    const cancelled = await waitForAdaptiveJob(app, owner, jobId);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      error: "Factory control changed; adaptive comparison cancelled.",
    });
    expect(aborted).toBe(true);
    await app.close();
  });

  it("supports explicit adaptive cancellation and aborts jobs when sessions expire", async () => {
    let aborts = 0;
    const provider: ProviderAdapter = {
      id: "jev",
      configured: true,
      source: "test-fixture",
      decide: async () => ({ summary: "Hold.", commands: [], tokens: 1 }),
      decideObservation: async () => ({
        summary: "Hold.",
        commands: [],
        tokens: 1,
      }),
    };
    const runner = (
      _input: AdaptiveComparisonInput,
      options: AdaptiveOptions,
    ) =>
      new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => {
            aborts++;
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      });
    const app = await buildApp({
      tickMs: 10_000,
      providers: { jev: provider },
      adaptiveRunner: runner,
    });
    const session = await create(app);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/adaptive-experiments`,
      headers: { "x-session-token": session.token },
      payload: { provider: "jev" },
    });
    const jobId = (accepted.json() as AdaptiveExperimentJob).jobId;
    const stopped = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}/adaptive-experiments/${jobId}`,
      headers: { "x-session-token": session.token },
    });
    expect(stopped.statusCode).toBe(202);
    expect(stopped.json()).toMatchObject({ jobId, status: "cancelled" });
    expect((await waitForAdaptiveJob(app, session, jobId)).status).toBe(
      "cancelled",
    );
    expect(aborts).toBe(1);
    await app.close();

    const expiryApp = await buildApp({
      tickMs: 5,
      sessionIdleMs: 1,
      providers: { jev: provider },
      adaptiveRunner: runner,
    });
    const expiring = await create(expiryApp);
    await expiryApp.inject({
      method: "POST",
      url: `/api/sessions/${expiring.id}/adaptive-experiments`,
      headers: { "x-session-token": expiring.token },
      payload: { provider: "jev" },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(aborts).toBe(2);
    const expired = await expiryApp.inject({
      method: "GET",
      url: `/api/sessions/${expiring.id}`,
      headers: { "x-session-token": expiring.token },
    });
    expect(expired.statusCode).toBe(404);
    await expiryApp.close();
  });
});
