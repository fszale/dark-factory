import { downloadBlob } from "./download.ts";
import { useEffect, useRef, useState } from "react";
import { adaptiveExperimentJobSchema } from "../../../packages/contracts/src/runtime.ts";
import type {
  AdaptiveExperimentJob,
  FactoryConfig,
  ProviderStatus,
} from "../../../packages/contracts/src/index.ts";

export function AdaptiveComparisonPanel({
  session,
  config,
  providers,
  accessCode,
  metricSpecFor,
}: {
  session: { id: string; token: string };
  config: FactoryConfig;
  providers: ProviderStatus | null;
  accessCode: string;
  metricSpecFor: (key: string) => { label: string; unit: string };
}) {
  const [provider, setProvider] = useState<"astra" | "jev">("astra");
  const [job, setJob] = useState<AdaptiveExperimentJob | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const active = job?.status === "queued" || job?.status === "running";
  const base = `/api/sessions/${session.id}/adaptive-experiments`;
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) {
    const response = await fetch(path, {
      method,
      signal,
      headers: {
        "content-type": "application/json",
        "x-session-token": session.token,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || `Comparison request failed (${response.status})`,
      );
    return adaptiveExperimentJobSchema.parse(data) as AdaptiveExperimentJob;
  }
  useEffect(() => {
    const abort = new AbortController();
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(`brickworks-adaptive-${session.id}`);
    } catch {}
    if (saved)
      void call(
        `${base}/${encodeURIComponent(saved)}`,
        "GET",
        undefined,
        abort.signal,
      )
        .then((next) => {
          if (!abort.signal.aborted) setJob(next);
        })
        .catch(() => {
          if (!abort.signal.aborted) {
            try {
              sessionStorage.removeItem(`brickworks-adaptive-${session.id}`);
            } catch {}
          }
        });
    return () => abort.abort();
  }, [base, session.id, session.token]);
  useEffect(() => {
    if (job)
      try {
        sessionStorage.setItem(`brickworks-adaptive-${session.id}`, job.jobId);
      } catch {}
  }, [job?.jobId, session.id]);
  useEffect(() => {
    if (!active || !job) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await call(
          `${base}/${job.jobId}`,
          "GET",
          undefined,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setJob(next);
          setError("");
        }
      } catch (reason) {
        if (!abort.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "Status unavailable",
          );
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [active, job?.jobId, base, session.token]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const next = await call(base, "POST", {
        provider,
        accessCode: accessCode || undefined,
        config: Object.fromEntries(
          Object.entries(config).filter(([key]) => key !== "seed"),
        ),
      });
      try {
        sessionStorage.setItem(`brickworks-adaptive-${session.id}`, next.jobId);
      } catch {}
      if (alive.current) setJob(next);
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error ? reason.message : "Comparison failed",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      const next = await call(`${base}/${job!.jobId}`, "DELETE");
      if (alive.current) setJob(next);
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error ? reason.message : "Cancellation failed",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const result = job?.result;
  const value = (n: number) =>
    Number.isFinite(n)
      ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : "—";
  return (
    <section className="adaptive-comparison">
      <h3>Live policy experiment</h3>
      <p className="muted">
        Ten paired trials. The candidate policy observes each trial at 300 and
        900 simulated seconds and may adjust its operation. The baseline
        receives no AI decisions.
      </p>
      <label className="chart-selector">
        Supervisor
        <select
          aria-label="Experiment supervisor"
          value={provider}
          disabled={active || busy}
          onChange={(event) =>
            setProvider(event.target.value as "astra" | "jev")
          }
        >
          <option value="astra">Astra</option>
          <option value="jev">Jev</option>
        </select>
      </label>
      <p className="assumption">
        Uses up to 20 paid provider calls. Astra allows two requests per minute;
        Jev allows twelve. Allow roughly 10 minutes for Astra, plus response
        time. Shared usage limits may stop the job. Pause, reset, or manual
        changes cancel it.
      </p>
      <button
        className="wide-button"
        disabled={
          busy ||
          active ||
          !providers?.[provider].configured ||
          (providers.accessRequired && !accessCode)
        }
        onClick={() => void start()}
      >
        {busy ? "Submitting…" : "Run live paired experiment"}
      </button>
      {!providers?.[provider].configured && (
        <p className="muted">
          Configure the server’s{" "}
          {provider === "astra" ? "OPENAI_API_KEY" : "TYPESAFE_API_KEY"} to
          enable this experiment.
        </p>
      )}
      {providers?.accessRequired && !accessCode && (
        <p className="muted">
          Enter the AI access code in Intelligence before starting.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {job && (
        <div aria-live="polite">
          <b>
            {job.status} · {job.progress.completedPairs}/10 paired trials
          </b>
          <p>
            {job.progress.completedDecisions}/{job.bounds.maximumProviderCalls}{" "}
            decisions completed · {job.progress.phase.replaceAll("-", " ")}
          </p>
          {job.error && <p>{job.error}</p>}
          {active && (
            <button
              className="wide-button"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancel experiment
            </button>
          )}
        </div>
      )}
      {result && (
        <div className="experiment">
          <b>{result.name}</b>
          <p className="assumption">{result.note}</p>
          <small>
            {result.completedDecisions} calls · {result.tokens} reported tokens
            · {result.policySource}
          </small>
          <div className="comparison-table">
            <div className="comparison-row comparison-head">
              <span>Metric</span>
              <span>Baseline</span>
              <span>AI candidate</span>
              <span>Δ</span>
            </div>
            {Object.keys(result.baseline).map((key) => (
              <div className="comparison-row" key={key}>
                <span>
                  {metricSpecFor(key).label}
                  <small>{metricSpecFor(key).unit}</small>
                </span>
                <span>{value(result.baseline[key])}</span>
                <span>
                  {value(result.candidate[key])}
                  <small>
                    ± {value(result.standardDeviation.candidate[key])}
                  </small>
                </span>
                <span>{value(result.differences[key])}</span>
              </div>
            ))}
          </div>
          <details>
            <summary>Per-trial variation and decisions</summary>
            {result.perSeed.map((row) => (
              <p key={row.seed}>
                Seed {row.seed}: Δ throughput{" "}
                {value(row.differences.throughput)}/hr; {row.appliedActions}{" "}
                applied, {row.rejectedActions} rejected.
              </p>
            ))}
            {result.trace.map((trace, index) => (
              <details key={index}>
                <summary>
                  Seed {trace.seed} · {trace.simulationTime}s · {trace.summary}
                </summary>
                <pre>{JSON.stringify(trace, null, 2)}</pre>
              </details>
            ))}
          </details>
          <button
            className="wide-button"
            onClick={() => {
              downloadBlob(
                new Blob([JSON.stringify(result, null, 2)], {
                  type: "application/json",
                }),
                `brickworks-adaptive-${job!.jobId}.json`,
              );
            }}
          >
            Download experiment evidence
          </button>
        </div>
      )}
    </section>
  );
}
