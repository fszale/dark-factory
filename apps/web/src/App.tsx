import { downloadBlob } from "./download.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Box,
  Camera,
  ChevronDown,
  Download,
  Eye,
  Factory,
  FastForward,
  FileUp,
  Gauge,
  LoaderCircle,
  MapPin,
  Maximize2,
  Moon,
  PackageCheck,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ScrollText,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  Warehouse,
  Wrench,
} from "lucide-react";
import { FactoryWorld } from "./world.ts";
import { FactoryAudio } from "./audio.ts";
import { AdaptiveComparisonPanel } from "./AdaptiveComparisonPanel.tsx";
import {
  snapshotSchema,
  snapshotMessageSchema,
  providerStatusSchema,
  experimentResultSchema,
  checkpointSchema,
  commandResultSchema,
  decisionSchema,
} from "../../../packages/contracts/src/runtime.ts";
import {
  LINE_IDS,
  LINE_META,
  SCENARIOS,
  type DecisionRecord,
  type ExperimentResult,
  type FactoryCommand,
  type FactorySnapshot,
  type LineId,
  type Mode,
  type ProviderStatus,
  type Scenario,
} from "../../../packages/contracts/src/index.ts";

type Session = { id: string; token: string };
type SessionReply = Session & {
  snapshot: FactorySnapshot;
  providers: ProviderStatus;
};
type ViewPreset =
  | "site"
  | "factory"
  | "receiving"
  | "sorting"
  | "storage"
  | "assembly"
  | "parking"
  | "vehicle"
  | LineId;
const scenarioLabel: Record<Scenario, string> = {
  balanced: "Balanced flow",
  shortage: "Supply shortage",
  "slow-exterior": "Slow exterior",
  gripper: "Gripper fault",
  congestion: "Cart congestion",
  "assembly-outage": "Assembly outage",
  "dispatch-blockage": "Dispatch blockage",
  empty: "Empty start",
};
const format = (value: number, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "—";
const elapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const CHECKPOINT_KEY = "brickworks.last-checkpoint.v1";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  if (body.snapshot) body.snapshot = snapshotSchema.parse(body.snapshot);
  if (body.providers)
    body.providers = providerStatusSchema.parse(body.providers);
  if (body.decision) body.decision = decisionSchema.parse(body.decision);
  if (body.format === "brickworks-run")
    return checkpointSchema.parse(body) as T;
  if (path.endsWith("/experiments"))
    return experimentResultSchema.parse(body) as T;
  if (path.endsWith("/command")) return commandResultSchema.parse(body) as T;
  return body as T;
}

type ChartKey = Exclude<keyof FactorySnapshot["samples"][number], "time">;
const chartMetrics: Record<ChartKey, { label: string; unit: string }> = {
  completed: { label: "Completed vehicles", unit: "vehicles" },
  throughput: { label: "Throughput", unit: "vehicles/hr" },
  wip: { label: "Work in progress", unit: "module equivalents" },
  yield: { label: "Inspection yield", unit: "%" },
  stock: { label: "Warehouse + line stock", unit: "kits" },
  parked: { label: "Parking occupancy", unit: "vehicles" },
  energy: { label: "Cumulative energy", unit: "sim energy units" },
  cost: { label: "Cost per accepted vehicle", unit: "sim cost units" },
  blocked: { label: "Blocked stations", unit: "stations" },
};
function MiniChart({
  samples,
  metric,
}: {
  samples: FactorySnapshot["samples"];
  metric: ChartKey;
}) {
  const window = samples.slice(-48);
  const values = window.map((sample) => sample[metric]);
  const max = Math.max(1, ...values);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(1, values.length - 1)) * 100},${38 - (value / max) * 34}`,
    )
    .join(" ");
  return (
    <svg
      className="mini-chart"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-label={`${chartMetrics[metric].label} history`}
    >
      <path d="M0 39H100" className="chart-grid" />
      {points && <polyline points={points} className="chart-line" />}
    </svg>
  );
}

function comparisonDirection(key: string, difference: number) {
  const direction = ["completed", "dispatched", "throughput", "yield"].includes(
    key,
  )
    ? 1
    : [
          "costPerVehicle",
          "leadTime",
          "downtime",
          "dockWait",
          "assemblyWait",
          "parkingWait",
          "roadWait",
        ].includes(key)
      ? -1
      : 0;
  return difference * direction > 0
    ? "positive"
    : difference * direction < 0
      ? "negative"
      : "";
}

type MetricSpec = { key: string; label: string; unit: string; digits?: number };
const metricGroups: Array<{
  title: string;
  description: string;
  metrics: MetricSpec[];
}> = [
  {
    title: "Production flow",
    description: "Counts and rate from this simulated factory run.",
    metrics: [
      { key: "initial", label: "Initial kits", unit: "kits" },
      { key: "received", label: "Received kits", unit: "kits" },
      { key: "consumed", label: "Consumed kits", unit: "kits" },
      { key: "completed", label: "Completed vehicles", unit: "vehicles" },
      { key: "dispatched", label: "Dispatched vehicles", unit: "vehicles" },
      {
        key: "throughput",
        label: "Throughput",
        unit: "vehicles/hr",
        digits: 1,
      },
      { key: "wip", label: "Work in progress", unit: "module equivalents" },
      { key: "finishedStock", label: "Finished stock", unit: "vehicles" },
      { key: "orderedUnits", label: "Ordered vehicles", unit: "vehicles" },
      { key: "ordersCreated", label: "Orders created", unit: "orders" },
      { key: "ordersCompleted", label: "Orders completed", unit: "orders" },
    ],
  },
  {
    title: "Quality and recovery",
    description: "Inspection, reject, scrap, and rework estimates.",
    metrics: [
      { key: "yield", label: "Yield", unit: "%", digits: 1 },
      {
        key: "firstPassYield",
        label: "First-pass yield",
        unit: "%",
        digits: 1,
      },
      { key: "inspectionCount", label: "Inspections", unit: "checks" },
      { key: "firstInspections", label: "First inspections", unit: "checks" },
      {
        key: "inspectionRejects",
        label: "Inspection rejects",
        unit: "modules",
      },
      { key: "firstRejects", label: "First-pass rejects", unit: "modules" },
      { key: "reworkCount", label: "Rework attempts", unit: "modules" },
      {
        key: "qualityEscapes",
        label: "Escapes (perfect detection model)",
        unit: "defects",
      },
      {
        key: "perfectDetectionAssumption",
        label: "Perfect detection assumption",
        unit: "(1 = enabled)",
      },
      {
        key: "reworkSuccessRate",
        label: "Rework success",
        unit: "%",
        digits: 1,
      },
      { key: "scrap", label: "Scrap", unit: "modules" },
    ],
  },
  {
    title: "Receiving, inventory, and movement",
    description: "Warehouse and logistics conditions in simulated seconds.",
    metrics: [
      { key: "deliveries", label: "Deliveries", unit: "trucks" },
      {
        key: "rejectedDeliveries",
        label: "Rejected deliveries",
        unit: "trucks",
      },
      { key: "warehouseOccupancy", label: "Warehouse inventory", unit: "kits" },
      { key: "sortingKits", label: "Kits being sorted", unit: "kits" },
      { key: "sortedDeliveries", label: "Sorted deliveries", unit: "lots" },
      { key: "sortingTime", label: "Sorting time", unit: "sim s", digits: 1 },
      {
        key: "sortingUtilization",
        label: "Sorter utilization",
        unit: "%",
        digits: 1,
      },
      {
        key: "receivingInspectionCount",
        label: "Receiving checks",
        unit: "lots",
      },
      {
        key: "receivingInspectionPasses",
        label: "Accepted lot checks",
        unit: "lots",
      },
      {
        key: "rejectedIncomingKits",
        label: "Rejected incoming kits",
        unit: "kits",
      },
      {
        key: "supplierReturnKits",
        label: "Supplier return kits",
        unit: "kits",
      },
      {
        key: "rejectedCargoInTransit",
        label: "Rejected cargo in transit",
        unit: "kits",
      },
      {
        key: "receivingConservationDelta",
        label: "Receiving conservation delta",
        unit: "kits",
      },
      { key: "dockWait", label: "Dock wait", unit: "sim s", digits: 1 },
      { key: "cartTravel", label: "Cart travel", unit: "sim s", digits: 1 },
      { key: "cartWait", label: "Cart wait", unit: "sim s", digits: 1 },
      { key: "parkingWait", label: "Parking wait", unit: "sim s", digits: 1 },
      { key: "parkingOccupancy", label: "Parking occupancy", unit: "vehicles" },
      { key: "committedParking", label: "Committed parking", unit: "vehicles" },
    ],
  },
  {
    title: "Operations and resources",
    description:
      "Time and energy are modeled estimates, not physical measurements.",
    metrics: [
      { key: "assemblyWait", label: "Assembly wait", unit: "sim s", digits: 1 },
      { key: "leadTime", label: "Vehicle lead time", unit: "sim s", digits: 1 },
      { key: "energy", label: "Energy", unit: "sim energy units", digits: 1 },
      {
        key: "simulationMs",
        label: "Simulation runtime",
        unit: "ms",
        digits: 0,
      },
      {
        key: "materialCost",
        label: "Material cost",
        unit: "sim cost units",
        digits: 1,
      },
      {
        key: "maintenanceCost",
        label: "Maintenance cost",
        unit: "sim cost units",
        digits: 1,
      },
      {
        key: "costPerVehicle",
        label: "Cost per vehicle",
        unit: "sim cost units",
        digits: 2,
      },
      { key: "warehouseCapacity", label: "Warehouse capacity", unit: "kits" },
      { key: "stationStock", label: "Line-side stock", unit: "kits" },
      { key: "materialInTransit", label: "Material in transit", unit: "kits" },
      { key: "parkingCapacity", label: "Parking capacity", unit: "bays" },
      { key: "inboundKits", label: "Inbound kits", unit: "kits" },
      { key: "dockQueue", label: "Dock queue", unit: "trucks" },
      {
        key: "dockUtilization",
        label: "Dock utilization",
        unit: "%",
        digits: 1,
      },
      {
        key: "materialLoadingCapacity",
        label: "Shared loading capacity",
        unit: "slots",
      },
      {
        key: "materialLoadersBusy",
        label: "Active loading slots",
        unit: "slots",
      },
      {
        key: "materialLoaderQueue",
        label: "Lines awaiting loader",
        unit: "lines",
      },
      {
        key: "materialLoaderUtilization",
        label: "Loader utilization",
        unit: "%",
        digits: 1,
      },
      {
        key: "cartUtilization",
        label: "Cart utilization",
        unit: "%",
        digits: 1,
      },
      { key: "cartCharge", label: "Mean cart charge", unit: "%", digits: 1 },
      {
        key: "roadOccupancy",
        label: "Shared-road occupancy",
        unit: "vehicles",
      },
      { key: "roadQueue", label: "Shared-road queue", unit: "vehicles" },
      { key: "roadWait", label: "Shared-road wait", unit: "sim s", digits: 1 },
      {
        key: "roadReservations",
        label: "Shared-road reservations",
        unit: "events",
      },
      {
        key: "operatorPausedTime",
        label: "Operator line pause time",
        unit: "sim s",
        digits: 1,
      },
      { key: "downtime", label: "Station downtime", unit: "sim s", digits: 1 },
      { key: "blockedTime", label: "Blocked time", unit: "sim s", digits: 1 },
      { key: "starvedTime", label: "Starved time", unit: "sim s", digits: 1 },
      {
        key: "conservationDelta",
        label: "Material conservation delta",
        unit: "kits",
      },
    ],
  },
  {
    title: "AI and archive telemetry",
    description:
      "These counters are present when the session has recorded the activity.",
    metrics: [
      { key: "aiCalls", label: "AI calls", unit: "calls" },
      { key: "aiTokens", label: "AI tokens", unit: "tokens" },
      { key: "aiLatency", label: "AI latency", unit: "ms", digits: 0 },
      { key: "archiveErrors", label: "Archive errors", unit: "events" },
    ],
  },
];
const lineMetricSpec = (key: string): MetricSpec | undefined => {
  const match =
    /^(front|rear|battery|interior|exterior)(Utilization|Queue|Stock|Temperature|Vibration)$/.exec(
      key,
    );
  if (!match) return undefined;
  const line = match[1] as LineId;
  const measurement = match[2];
  const label = `${LINE_META[line].name} ${measurement.replace(/([A-Z])/g, " $1").toLowerCase()}`;
  if (measurement === "Utilization")
    return { key, label, unit: "%", digits: 1 };
  if (measurement === "Queue") return { key, label, unit: "modules" };
  if (measurement === "Stock") return { key, label, unit: "kits" };
  if (measurement === "Temperature")
    return { key, label, unit: "sim °C", digits: 1 };
  return { key, label, unit: "sim index", digits: 2 };
};
const allMetricSpecs = metricGroups.flatMap((group) => group.metrics);
const metricSpecFor = (key: string): MetricSpec =>
  allMetricSpecs.find((spec) => spec.key === key) ??
  lineMetricSpec(key) ??
  (key.startsWith("defect_")
    ? {
        key,
        label: key.replace("defect_", "Defect: ").replaceAll("_", " "),
        unit: "events",
      }
    : undefined) ?? {
    key,
    label: key.replace(/([a-z])([A-Z])/g, "$1 $2"),
    unit: "unclassified simulation value",
    digits: 2,
  };
const metricText = (value: number | undefined, spec: MetricSpec) =>
  value === undefined ? "—" : `${format(value, spec.digits ?? 0)} ${spec.unit}`;
const profileText = (profiles: Record<LineId, string>) =>
  LINE_IDS.map((line) => `${LINE_META[line].name}: ${profiles[line]}`).join(
    " · ",
  );

function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<FactoryWorld | null>(null);
  const audio = useRef(new FactoryAudio());
  const socket = useRef<WebSocket | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const shutdownTimer = useRef<number | null>(null);
  const bootstrap = useRef<Promise<void> | null>(null);
  const recovery = useRef<Promise<void> | null>(null);
  const recoverRef = useRef<() => Promise<void>>(async () => {});
  const commandQueue = useRef<Promise<unknown>>(Promise.resolve());
  const commandVersion = useRef({ revision: 0, epoch: 0 });
  const mounted = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<FactorySnapshot | null>(null);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [selected, setSelected] = useState("");
  const [panel, setPanel] = useState<
    "inspector" | "metrics" | "controls" | "ai"
  >("inspector");
  const [panelOpen, setPanelOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [preset, setPreset] = useState<ViewPreset>("site");
  const [overlay, setOverlay] = useState<
    "none" | "faults" | "queues" | "utilization"
  >("none");
  const [roof, setRoof] = useState(false);
  const [dusk, setDusk] = useState(false);
  const [tour, setTour] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [audioLevels, setAudioLevels] = useState({ ...audio.current.settings });
  const [orderQuantity, setOrderQuantity] = useState(3);
  const [orderPriority, setOrderPriority] = useState(2);
  const [manualLine, setManualLine] = useState<LineId>("front");
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [replayTime, setReplayTime] = useState("");
  const [fps, setFps] = useState(0);
  const [clientMetrics, setClientMetrics] = useState({
    streamLag: 0,
    validationMs: 0,
    reconnects: 0,
    invalidFrames: 0,
    errors: 0,
  });
  const [notice, setNotice] = useState("Connecting to the factory session…");
  const [error, setError] = useState("");
  useEffect(() => {
    if (error)
      setClientMetrics((current) => ({
        ...current,
        errors: current.errors + 1,
      }));
  }, [error]);
  const [chat, setChat] = useState(
    "Review the lines and recommend the safest high-value action.",
  );
  const [accessCode, setAccessCode] = useState("");
  const [asking, setAsking] = useState(false);
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartKey>("throughput");
  const [experiment, setExperiment] = useState<ExperimentResult | null>(null);

  const connectSocket = useCallback((next: Session) => {
    sessionRef.current = next;
    try {
      sessionStorage.setItem("brickworks-active-session", JSON.stringify(next));
    } catch {
      /* Private browsing may disable storage. */
    }
    if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
    if (socket.current) {
      socket.current.onclose = null;
      socket.current.close();
    }
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}/api/live`);
    socket.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(next));
      setNotice("Live session connected");
    };
    let lastSequence = -1;
    ws.onmessage = (event) => {
      if (socket.current !== ws) return;
      try {
        const validationStart = performance.now();
        const message = snapshotMessageSchema.parse(JSON.parse(event.data));
        if (message.sessionId !== next.id || message.sequence <= lastSequence)
          return;
        lastSequence = message.sequence;
        setClientMetrics((current) => ({
          ...current,
          streamLag: message.sentAt
            ? Math.max(0, Date.now() - message.sentAt)
            : 0,
          validationMs: performance.now() - validationStart,
        }));
        setSnapshot(message.snapshot as FactorySnapshot);
      } catch {
        setClientMetrics((current) => ({
          ...current,
          invalidFrames: current.invalidFrames + 1,
        }));
        setError(
          "An invalid live update was rejected; showing the last verified state.",
        );
      }
    };
    ws.onclose = (event) => {
      if (!mounted.current || socket.current !== ws || !sessionRef.current)
        return;
      setClientMetrics((current) => ({
        ...current,
        reconnects: current.reconnects + 1,
      }));
      if (event.code === 1008) {
        void recoverRef.current();
        return;
      }
      setNotice("Live stream reconnecting…");
      reconnectTimer.current = window.setTimeout(() => {
        if (sessionRef.current) connectSocket(sessionRef.current);
      }, 1200);
    };
  }, []);

  const createSession = useCallback(
    async (scenario?: Scenario) => {
      try {
        setError("");
        const created = await request<SessionReply>("/api/sessions", {
          method: "POST",
          body: JSON.stringify(scenario ? { scenario } : {}),
        });
        const next = { id: created.id, token: created.token };
        commandVersion.current = {
          revision: created.snapshot.revision,
          epoch: created.snapshot.epoch,
        };
        setSession(next);
        setSnapshot(created.snapshot);
        setProviders(created.providers);
        setNotice("Live warm-start showcase connected");
        connectSocket(next);
        const start = await request<{
          ok: boolean;
          message: string;
          revision: number;
        }>(`/api/sessions/${next.id}/command`, {
          method: "POST",
          headers: { "x-session-token": next.token },
          body: JSON.stringify({
            id: `showcase-${crypto.randomUUID()}`,
            type: "start",
            revision: created.snapshot.revision,
            epoch: created.snapshot.epoch,
          }),
        });
        if (start.ok)
          commandVersion.current = {
            revision: start.revision,
            epoch: created.snapshot.epoch,
          };
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to create a session.",
        );
      }
    },
    [connectSocket],
  );

  const recoverSession = useCallback(async () => {
    if (recovery.current) return recovery.current;
    const work = (async () => {
      try {
        const raw = localStorage.getItem(CHECKPOINT_KEY);
        if (!raw)
          throw new Error(
            "No saved checkpoint is available after the server restart.",
          );
        const imported = await request<SessionReply>("/api/import", {
          method: "POST",
          body: JSON.stringify({ run: JSON.parse(raw) }),
        });
        const next = { id: imported.id, token: imported.token };
        commandVersion.current = {
          revision: imported.snapshot.revision,
          epoch: imported.snapshot.epoch,
        };
        sessionRef.current = next;
        setSession(next);
        setSnapshot(imported.snapshot);
        setProviders(imported.providers);
        setNotice("Server session recovered from local checkpoint (paused)");
        connectSocket(next);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to recover the previous session.",
        );
      }
    })();
    recovery.current = work;
    try {
      await work;
    } finally {
      recovery.current = null;
    }
  }, [connectSocket]);
  recoverRef.current = recoverSession;

  useEffect(() => {
    mounted.current = true;
    if (shutdownTimer.current) window.clearTimeout(shutdownTimer.current);
    if (!bootstrap.current)
      bootstrap.current = (async () => {
        try {
          const active = sessionStorage.getItem("brickworks-active-session");
          if (active) {
            try {
              const next = JSON.parse(active) as Session;
              if (typeof next.id !== "string" || typeof next.token !== "string")
                throw new Error("Invalid session");
              const existing = await request<SessionReply>(
                `/api/sessions/${encodeURIComponent(next.id)}`,
                { headers: { "x-session-token": next.token } },
              );
              commandVersion.current = {
                revision: existing.snapshot.revision,
                epoch: existing.snapshot.epoch,
              };
              setSession(next);
              setSnapshot(existing.snapshot);
              setProviders(existing.providers);
              connectSocket(next);
              setNotice("Reconnected to this tab’s factory");
              return;
            } catch {
              /* Retain the connection token through temporary outages; successful recovery replaces it. */
            }
          }
          const raw = localStorage.getItem(CHECKPOINT_KEY);
          if (raw) {
            const imported = await request<SessionReply>("/api/import", {
              method: "POST",
              body: JSON.stringify({ run: JSON.parse(raw) }),
            });
            const next = { id: imported.id, token: imported.token };
            commandVersion.current = {
              revision: imported.snapshot.revision,
              epoch: imported.snapshot.epoch,
            };
            sessionRef.current = next;
            setSession(next);
            setSnapshot(imported.snapshot);
            setProviders(imported.providers);
            setNotice("Recovered last checkpoint as a paused session");
            connectSocket(next);
            return;
          }
          await createSession();
        } catch (reason) {
          // A temporary outage or full server must never erase the saved checkpoint.
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to restore the saved factory.",
          );
          setNotice("Saved checkpoint retained; reload to retry connection");
        }
      })();
    return () => {
      shutdownTimer.current = window.setTimeout(() => {
        mounted.current = false;
        if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
        socket.current?.close();
      }, 0);
    };
  }, [connectSocket, createSession]);
  useEffect(() => {
    if (!canvas.current || world.current) return;
    const next = new FactoryWorld(canvas.current, (id) => {
      setSelected(id);
      setPanel("inspector");
      setPanelOpen(true);
    });
    next.onStats = (currentFps) => setFps(currentFps);
    next.preset("site");
    world.current = next;
    return () => {
      next.dispose();
      world.current = null;
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const known = commandVersion.current;
    if (
      snapshot.epoch > known.epoch ||
      (snapshot.epoch === known.epoch && snapshot.revision >= known.revision)
    )
      commandVersion.current = {
        revision: snapshot.revision,
        epoch: snapshot.epoch,
      };
    world.current?.setSnapshot(snapshot);
    const point = world.current?.camera.position;
    if (audioOn)
      audio.current.update(
        snapshot,
        point ? { x: point.x, y: point.y, z: point.z } : undefined,
      );
  }, [snapshot, audioOn]);
  useEffect(() => () => audio.current.dispose(), []);
  useEffect(() => {
    if (!session) return;
    const save = async () => {
      try {
        const run = await request<unknown>(
          `/api/sessions/${session.id}/export`,
          { headers: { "x-session-token": session.token } },
        );
        localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(run));
      } catch {
        /* Checkpointing must never interrupt the simulation. */
      }
    };
    const timer = window.setInterval(() => void save(), 20_000);
    return () => window.clearInterval(timer);
  }, [session]);

  const command = useCallback(
    (partial: Omit<FactoryCommand, "id" | "revision" | "epoch">) => {
      const execute = async () => {
        if (!session || !snapshot) return;
        try {
          setError("");
          const version = commandVersion.current;
          const result = await request<{
            ok: boolean;
            message: string;
            revision: number;
          }>(`/api/sessions/${session.id}/command`, {
            method: "POST",
            headers: { "x-session-token": session.token },
            body: JSON.stringify({
              ...partial,
              id: `web-${crypto.randomUUID()}`,
              revision: version.revision,
              epoch: version.epoch,
            }),
          });
          if (result.ok) {
            const advancesEpoch =
              partial.type === "mode" ||
              partial.type === "pause" ||
              partial.type === "reset";
            commandVersion.current = {
              revision: result.revision,
              epoch: advancesEpoch ? version.epoch + 1 : version.epoch,
            };
          }
          setNotice(result.message);
          if (!result.ok) setError(result.message);
        } catch (reason) {
          const message =
            reason instanceof Error ? reason.message : "Command failed.";
          setError(message);
          if (message === "Session not found.") await recoverSession();
        }
      };
      const queued = commandQueue.current.then(execute, execute);
      commandQueue.current = queued.catch(() => undefined);
      return queued;
    },
    [session, snapshot, recoverSession],
  );

  const choosePreset = (value: ViewPreset) => {
    setPreset(value);
    world.current?.preset(value);
  };
  const selectLine = (line: LineId) => {
    setSelected(line);
    setManualLine(line);
    setPanel("inspector");
    setPanelOpen(true);
    choosePreset(line);
    world.current?.select(line);
  };
  const setWorldOverlay = (value: typeof overlay) => {
    setOverlay(value);
    world.current?.setOverlay(value);
  };
  const toggleAudio = async () => {
    if (!audioOn) {
      await audio.current.enable();
      audio.current.setEnabled(true);
      setAudioOn(audio.current.enabled);
    } else {
      audio.current.setEnabled(false);
      setAudioOn(false);
    }
  };
  const resetScenario = (scenario: Scenario) => {
    void command({ type: "reset", scenario });
    setExperiment(null);
  };
  const mode = snapshot?.mode ?? "manual";
  const setAudioLevel = (
    key: keyof FactoryAudio["settings"],
    value: number,
  ) => {
    audio.current.setLevel(key, value);
    setAudioLevels({ ...audio.current.settings });
  };
  const configSignature = snapshot
    ? [
        snapshot.config.releaseRate,
        snapshot.config.reorderPoint,
        snapshot.config.deliverySize,
        snapshot.config.deliveryLead,
        snapshot.config.dispatchDwell,
        snapshot.config.parkingCapacity,
        snapshot.config.orderSize,
        snapshot.config.continuous,
        snapshot.config.materialLoadingCapacity,
      ].join("|")
    : "";
  useEffect(() => {
    if (!snapshot) return;
    setConfigDraft({
      releaseRate: String(snapshot.config.releaseRate),
      reorderPoint: String(snapshot.config.reorderPoint),
      deliverySize: String(snapshot.config.deliverySize),
      deliveryLead: String(snapshot.config.deliveryLead),
      dispatchDwell: String(snapshot.config.dispatchDwell),
      parkingCapacity: String(snapshot.config.parkingCapacity),
      orderSize: String(snapshot.config.orderSize),
      continuous: String(snapshot.config.continuous),
      materialLoadingCapacity: String(
        snapshot.config.materialLoadingCapacity ?? 2,
      ),
    });
  }, [configSignature]);
  const applyConfig = (key: string) =>
    void command({ type: "config", value: `${key}:${configDraft[key]}` });

  const askAstra = async (provider: "astra" | "jev") => {
    if (!session) return;
    try {
      setAsking(true);
      setError("");
      const endpoint = provider === "astra" ? "chat" : "jev";
      const body =
        provider === "astra"
          ? { message: chat, ...(accessCode ? { accessCode } : {}) }
          : accessCode
            ? { accessCode }
            : {};
      const result = await request<{
        decision: DecisionRecord;
        snapshot: FactorySnapshot;
      }>(`/api/sessions/${session.id}/${endpoint}`, {
        method: "POST",
        headers: { "x-session-token": session.token },
        body: JSON.stringify(body),
      });
      setSnapshot(result.snapshot);
      setNotice(
        `${provider === "astra" ? "Astra" : "Jev"}: ${result.decision.summary}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI request failed.");
    } finally {
      setAsking(false);
    }
  };

  const exportRun = async () => {
    if (!session) return;
    try {
      const run = await request<unknown>(`/api/sessions/${session.id}/export`, {
        headers: { "x-session-token": session.token },
      });
      downloadBlob(
        new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }),
        `brickworks-${snapshot?.id.slice(0, 8) ?? "run"}.json`,
      );
      setNotice("Replay checkpoint exported");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Export failed.");
    }
  };
  const downloadHistory = async () => {
    if (!session) return;
    try {
      const response = await fetch(`/api/sessions/${session.id}/history`, {
        headers: { "x-session-token": session.token },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error || `History download failed (${response.status})`,
        );
      }
      downloadBlob(
        await response.blob(),
        `brickworks-history-${snapshot?.id.slice(0, 8) ?? "session"}.ndjson`,
      );
      const count = response.headers.get("x-archive-records") ?? "0";
      const truncated = response.headers.get("x-archive-truncated") === "true";
      setNotice(
        truncated
          ? `History downloaded (${count} records; archive was quota-truncated)`
          : `Full history downloaded (${count} records)`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "History download failed.",
      );
    }
  };
  const captureScene = () => {
    if (!canvas.current) return;
    const anchor = Object.assign(document.createElement("a"), {
      href: canvas.current.toDataURL("image/png"),
      download: `brickworks-factory-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.png`,
    });
    anchor.click();
    setNotice("Factory view captured as PNG");
  };
  const downloadMetricSeries = () => {
    if (!snapshot) return;
    const keys = Array.from(
      new Set(snapshot.samples.flatMap((sample) => Object.keys(sample))),
    ).filter((key) => key !== "time");
    const escape = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["record_type", "scope", "simulation_time_s", ...keys]
        .map(escape)
        .join(","),
      ...snapshot.samples.map((sample) =>
        [
          "series",
          "sampled metric series",
          sample.time,
          ...keys.map((key) => sample[key as keyof typeof sample] ?? ""),
        ]
          .map(escape)
          .join(","),
      ),
    ];
    downloadBlob(
      new Blob([`${rows.join("\n")}\n`], { type: "text/csv" }),
      `brickworks-sampled-metrics-${snapshot.id.slice(0, 8)}.csv`,
    );
    setNotice(
      `Downloaded ${snapshot.samples.length} sampled metric rows as CSV`,
    );
  };
  const downloadCurrentMetrics = () => {
    if (!snapshot) return;
    const metrics = Object.fromEntries(
      Object.entries(snapshot.metrics).map(([key, value]) => {
        const spec = metricSpecFor(key);
        return [key, { label: spec.label, unit: spec.unit, value }];
      }),
    );
    const payload = {
      scope: "current snapshot metrics only; not a time series",
      simulationTimeSeconds: snapshot.time,
      sessionId: snapshot.id,
      metrics,
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
      `brickworks-current-metrics-${snapshot.id.slice(0, 8)}.json`,
    );
    setNotice("Downloaded current-only metrics JSON");
  };
  const importRun = async (file?: File) => {
    if (!file) return;
    try {
      const imported = await request<SessionReply>("/api/import", {
        method: "POST",
        body: JSON.stringify({ run: JSON.parse(await file.text()) }),
      });
      const next = { id: imported.id, token: imported.token };
      commandVersion.current = {
        revision: imported.snapshot.revision,
        epoch: imported.snapshot.epoch,
      };
      sessionRef.current = next;
      setSession(next);
      setSnapshot(imported.snapshot);
      setProviders(imported.providers);
      setNotice("Replay checkpoint restored");
      connectSocket(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed.");
    }
  };
  const replayAt = async () => {
    if (!session || !snapshot) return;
    const time = Number(replayTime);
    if (!Number.isFinite(time) || time < 0) {
      setError("Enter a non-negative simulation time to replay.");
      return;
    }
    try {
      setError("");
      const replayed = await request<SessionReply>(
        `/api/sessions/${session.id}/replay`,
        {
          method: "POST",
          headers: { "x-session-token": session.token },
          body: JSON.stringify({ time }),
        },
      );
      const next = { id: replayed.id, token: replayed.token };
      commandVersion.current = {
        revision: replayed.snapshot.revision,
        epoch: replayed.snapshot.epoch,
      };
      sessionRef.current = next;
      setSession(next);
      setSnapshot(replayed.snapshot);
      setProviders(replayed.providers);
      connectSocket(next);
      setNotice(
        `Replayed archived epoch to ${elapsed(replayed.snapshot.time)} (paused)`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Replay failed.");
    }
  };
  const runExperiment = async (
    mode: "profiles" | "recorded-ai" = "profiles",
  ) => {
    if (!session || !snapshot || experimentBusy) return;
    setExperimentBusy(true);
    try {
      const result = await request<ExperimentResult>(
        `/api/sessions/${session.id}/experiments`,
        {
          method: "POST",
          headers: { "x-session-token": session.token },
          body: JSON.stringify(
            mode === "recorded-ai"
              ? { mode }
              : {
                  mode,
                  baselineName: "Default flow",
                  candidateName: "Current configuration",
                  baselineConfig: { scenario: snapshot.config.scenario },
                  candidateConfig: Object.fromEntries(
                    Object.entries(snapshot.config).filter(
                      ([key]) => key !== "seed",
                    ),
                  ),
                },
          ),
        },
      );
      setExperiment(result);
      setPanel("metrics");
      setPanelOpen(true);
      setNotice(`${result.name} complete`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Experiment failed.");
    } finally {
      setExperimentBusy(false);
    }
  };

  const activeStation = useMemo(
    () => LINE_IDS.find((line) => line === selected) ?? null,
    [selected],
  );
  const inspectedStation = activeStation && snapshot?.stations[activeStation];
  const selectedVehicle = useMemo(
    () => snapshot?.vehicles.find((vehicle) => vehicle.id === selected),
    [snapshot, selected],
  );
  const selectedTruck = useMemo(
    () => snapshot?.trucks.find((truck) => truck.id === selected),
    [snapshot, selected],
  );
  const selectedCart = useMemo(
    () => snapshot?.carts.find((cart) => cart.id === selected),
    [snapshot, selected],
  );
  const selectableModules = useMemo(
    () =>
      snapshot
        ? [
            ...snapshot.vehicles.flatMap((vehicle) => vehicle.modules),
            ...LINE_IDS.flatMap((line) => [
              ...snapshot.stations[line].queue,
              ...(snapshot.stations[line].current
                ? [snapshot.stations[line].current]
                : []),
            ]),
          ]
        : [],
    [snapshot],
  );
  const selectedModule = useMemo(
    () => selectableModules.find((module) => module.id === selected),
    [selectableModules, selected],
  );
  const derivedWip = snapshot
    ? Object.values(snapshot.stations).reduce(
        (total, station) =>
          total + station.queue.length + (station.current ? 1 : 0),
        0,
      ) +
      snapshot.vehicles.filter(
        (vehicle) => vehicle.phase === "joining" || vehicle.phase === "testing",
      ).length *
        5
    : 0;
  const currentWip = snapshot?.metrics.wip ?? derivedWip;
  const otherMetricSpecs = useMemo(() => {
    if (!snapshot) return [];
    const curated = new Set(allMetricSpecs.map((spec) => spec.key));
    return Object.keys(snapshot.metrics)
      .filter((key) => !curated.has(key))
      .sort()
      .map(metricSpecFor);
  }, [snapshot]);
  const followEntity = (id: string) => {
    setSelected(id);
    setPanel("inspector");
    setPanelOpen(true);
    world.current?.follow(id);
  };
  const events = snapshot?.events.slice(-7).reverse() ?? [];
  const kpis = snapshot
    ? [
        [
          "Throughput",
          `${format(snapshot.metrics.throughput, 1)}/hr`,
          "completed vehicles",
        ],
        [
          "Yield",
          `${format(snapshot.metrics.yield, 1)}%`,
          `${format(snapshot.metrics.inspectionRejects)} inspection rejects`,
        ],
        ["WIP", format(currentWip), "module equivalents"],
        [
          "Dispatch",
          format(snapshot.metrics.dispatched),
          `${format(snapshot.metrics.parkingOccupancy)} parked`,
        ],
      ]
    : [];

  return (
    <main className={`app-shell ${panelOpen ? "panel-open" : ""}`}>
      <canvas
        ref={canvas}
        className="factory-canvas"
        aria-label="Interactive 3D brick-built dark factory"
      />
      <header className="topbar">
        <div className="brand">
          <Factory size={21} />
          <span>BRICKWORKS</span>
          <small>autonomous systems</small>
        </div>
        <div className="live-status">
          <span className={snapshot?.running ? "pulse" : "dot"} />{" "}
          {snapshot?.running ? "LIVE SIMULATION" : "PAUSED"}{" "}
          <span className="divider" /> {elapsed(snapshot?.time ?? 0)}{" "}
          <span className="divider" /> {format(fps)} FPS{" "}
          <small className="initial-condition">
            {snapshot?.config.scenario === "empty"
              ? "EMPTY START"
              : "WARM START · 80 INITIAL KITS"}
          </small>
        </div>
        <div className="top-actions">
          <button
            className="icon-button"
            aria-label="Toggle dusk lighting"
            aria-pressed={dusk}
            onClick={() => {
              setDusk(!dusk);
              world.current?.setDusk(!dusk);
            }}
            title="Toggle dusk"
          >
            <Moon size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Toggle factory roof"
            aria-pressed={roof}
            onClick={() => {
              setRoof(!roof);
              world.current?.setRoof(!roof);
            }}
            title="Toggle roof"
          >
            <Eye size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={audioOn ? "Mute factory sound" : "Enable factory sound"}
            aria-pressed={audioOn}
            onClick={() => void toggleAudio()}
            title="Toggle factory sound"
          >
            {audioOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button
            className="icon-button"
            aria-label="Capture factory view as PNG"
            onClick={captureScene}
            title="Capture factory view"
          >
            <Camera size={17} />
          </button>
          <button
            className={`icon-button ${panelOpen ? "selected" : ""}`}
            aria-label={
              panelOpen ? "Close details panel" : "Open details panel"
            }
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen(!panelOpen)}
            title="Toggle details"
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>

      <aside className="left-rail glass">
        <button
          className="rail-heading rail-toggle"
          onClick={() => setCameraOpen(!cameraOpen)}
        >
          <MapPin size={15} /> CAMERA{" "}
          <ChevronDown size={13} className={cameraOpen ? "flip" : ""} />
        </button>
        {cameraOpen && (
          <div className="camera-presets">
            {(
              [
                "site",
                "factory",
                "receiving",
                "sorting",
                "storage",
                "assembly",
                "parking",
                "vehicle",
              ] as ViewPreset[]
            ).map((value) => (
              <button
                key={value}
                className={
                  preset === value ? "rail-button active" : "rail-button"
                }
                onClick={() => choosePreset(value)}
              >
                {value.replaceAll("-", " ")}
              </button>
            ))}
          </div>
        )}
        <div className="rail-heading spaced">
          <Activity size={15} /> LINES
        </div>
        {LINE_IDS.map((line) => {
          const station = snapshot?.stations[line];
          return (
            <button
              key={line}
              className={`line-button ${selected === line ? "selected" : ""}`}
              onClick={() => selectLine(line)}
            >
              <span style={{ background: LINE_META[line].color }} />{" "}
              <b>{LINE_META[line].name}</b>
              <em>{station?.status ?? "—"}</em>
            </button>
          );
        })}
        <div className="rail-heading spaced">
          <Settings2 size={15} /> VIEW
        </div>
        <label className="select-label">
          Overlay
          <select
            value={overlay}
            onChange={(event) =>
              setWorldOverlay(event.target.value as typeof overlay)
            }
          >
            <option value="none">Standard</option>
            <option value="faults">Fault map</option>
            <option value="queues">Queue map</option>
            <option value="utilization">Utilization</option>
          </select>
        </label>
        <button
          className={`rail-button ${tour ? "active" : ""}`}
          onClick={() => {
            setTour(!tour);
            world.current?.setTour(!tour);
          }}
        >
          <Radio size={14} /> guided tour
        </button>
        <button
          className={`rail-button ${exploded ? "active" : ""}`}
          onClick={() => {
            setExploded(!exploded);
            world.current?.setExploded(!exploded);
          }}
        >
          <Maximize2 size={14} /> explode vehicle
        </button>
      </aside>

      <section className="kpi-strip">
        {kpis.map(([label, value, detail]) => (
          <div className="kpi" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </section>

      <section className="control-dock glass">
        <div className="run-controls">
          <button
            className="primary action"
            onClick={() =>
              void command({ type: snapshot?.running ? "pause" : "start" })
            }
          >
            {snapshot?.running ? <Pause size={16} /> : <Play size={16} />}
            {snapshot?.running ? "Pause" : "Start factory"}
          </button>
          <button
            className="icon-button"
            aria-label="Advance one simulation event"
            onClick={() => void command({ type: "step" })}
            title="Advance one event"
          >
            <FastForward size={17} />
          </button>
          <label className="speed">
            SPEED
            <select
              value={snapshot?.speed ?? 1}
              onChange={(event) =>
                void command({
                  type: "speed",
                  value: Number(event.target.value),
                })
              }
            >
              {[1, 2, 5, 10].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mode-control">
          {(["manual", "advisory", "autonomous"] as Mode[]).map((value) => (
            <button
              key={value}
              className={mode === value ? "mode active" : "mode"}
              onClick={() => void command({ type: "mode", value })}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="scenario-control">
          <select
            value={snapshot?.config.scenario ?? "balanced"}
            onChange={(event) => resetScenario(event.target.value as Scenario)}
          >
            {SCENARIOS.map((value) => (
              <option key={value} value={value}>
                {scenarioLabel[value]}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <button
          className="icon-button"
          aria-label="Reset selected scenario"
          onClick={() => resetScenario(snapshot?.config.scenario ?? "balanced")}
          title="Reset scenario"
        >
          <RotateCcw size={17} />
        </button>
      </section>

      {panelOpen && (
        <aside className="right-panel glass">
          <nav className="panel-tabs">
            <button
              className={panel === "inspector" ? "active" : ""}
              onClick={() => setPanel("inspector")}
            >
              Inspector
            </button>
            <button
              className={panel === "metrics" ? "active" : ""}
              onClick={() => setPanel("metrics")}
            >
              Metrics
            </button>
            <button
              className={panel === "controls" ? "active" : ""}
              onClick={() => setPanel("controls")}
            >
              Controls
            </button>
            <button
              className={panel === "ai" ? "active" : ""}
              onClick={() => setPanel("ai")}
            >
              Intelligence
            </button>
          </nav>
          {panel === "inspector" && (
            <div className="panel-body">
              <div className="section-title">
                <Box size={17} />{" "}
                {activeStation
                  ? LINE_META[activeStation].name
                  : selectedVehicle
                    ? "Gold robotaxi"
                    : selectedTruck
                      ? "Receiving truck"
                      : selectedCart
                        ? "Material cart"
                        : selectedModule
                          ? "Module genealogy"
                          : "Factory overview"}
              </div>
              {activeStation && snapshot && (
                <>
                  <div className="status-row">
                    <span
                      className={`status ${snapshot.stations[activeStation].status}`}
                    />{" "}
                    {snapshot.stations[activeStation].status}
                  </div>
                  <div className="progress">
                    <i
                      style={{
                        width: `${snapshot.stations[activeStation].progress * 100}%`,
                        background: LINE_META[activeStation].color,
                      }}
                    />
                  </div>
                  <div className="metric-grid">
                    <span>
                      Line stock<b>{snapshot.stations[activeStation].stock}</b>
                    </span>
                    <span>
                      Queue
                      <b>
                        {snapshot.stations[activeStation].queue.length}/
                        {snapshot.stations[activeStation].capacity}
                      </b>
                    </span>
                    <span>
                      Completed
                      <b>{snapshot.stations[activeStation].completed}</b>
                    </span>
                    <span>
                      Temperature
                      <b>
                        {format(
                          snapshot.stations[activeStation].temperature,
                          1,
                        )}
                        °
                      </b>
                    </span>
                  </div>
                  <label className="select-label">
                    Operating profile
                    <select
                      value={snapshot.stations[activeStation].profile}
                      onChange={(event) =>
                        void command({
                          type: "profile",
                          station: activeStation,
                          value: event.target.value,
                        })
                      }
                    >
                      <option>gentle</option>
                      <option>normal</option>
                      <option>fast</option>
                    </select>
                  </label>
                  {inspectedStation && (
                    <details className="metric-group">
                      <summary>Equipment observations and timing</summary>
                      <p className="muted">
                        Simulated sensor estimates and cumulative state
                        durations. The model’s hidden condition is not a
                        measured value.
                      </p>
                      <div className="metric-grid">
                        <span>
                          Current draw
                          <b>{format(inspectedStation.currentAmps, 2)} sim A</b>
                        </span>
                        <span>
                          Vibration
                          <b>{format(inspectedStation.vibration, 3)} index</b>
                        </span>
                        <span>
                          Busy time
                          <b>{format(inspectedStation.busyTime, 1)} s</b>
                        </span>
                        <span>
                          Blocked time
                          <b>{format(inspectedStation.blockedTime, 1)} s</b>
                        </span>
                        <span>
                          Starved time
                          <b>{format(inspectedStation.starvedTime, 1)} s</b>
                        </span>
                        <span>
                          Downtime
                          <b>{format(inspectedStation.downTime, 1)} s</b>
                        </span>
                        <span>
                          Operator pause
                          <b>{format(inspectedStation.pausedTime ?? 0, 1)} s</b>
                        </span>
                        <span>
                          Cycles<b>{inspectedStation.cycles}</b>
                        </span>
                        <span>
                          Rejects<b>{inspectedStation.rejects}</b>
                        </span>
                        <span>
                          Rework attempts<b>{inspectedStation.reworked}</b>
                        </span>
                        <span>
                          Scrapped<b>{inspectedStation.scrapped}</b>
                        </span>
                        <span>
                          Phase progress
                          <b>{format(inspectedStation.progress * 100, 1)}%</b>
                        </span>
                      </div>
                      {inspectedStation.current && (
                        <p className="muted">
                          Current module: {inspectedStation.current.id} · lot{" "}
                          {inspectedStation.current.lot}
                        </p>
                      )}
                      {inspectedStation.pause && (
                        <p className="muted">
                          Holding {inspectedStation.pause.previousStatus} since{" "}
                          {elapsed(inspectedStation.pause.since)}.
                        </p>
                      )}
                      {inspectedStation.fault && (
                        <p role="status">Fault: {inspectedStation.fault}</p>
                      )}
                    </details>
                  )}
                  <div className="button-pair">
                    <button
                      onClick={() =>
                        void command({
                          type: "fault",
                          station: activeStation,
                          value: "operator demonstration",
                        })
                      }
                    >
                      Simulate fault
                    </button>
                    <button
                      onClick={() =>
                        void command({ type: "repair", station: activeStation })
                      }
                    >
                      Service line
                    </button>
                  </div>
                  <button
                    className="wide-button"
                    onClick={() =>
                      void command({
                        type:
                          snapshot.stations[activeStation].status === "paused"
                            ? "start"
                            : "pause",
                        station: activeStation,
                      })
                    }
                  >
                    {snapshot.stations[activeStation].status === "paused"
                      ? "Resume line"
                      : "Pause line"}
                  </button>
                </>
              )}
              {selectedVehicle && (
                <>
                  <div className="metric-grid">
                    <span>
                      Phase<b>{selectedVehicle.phase}</b>
                    </span>
                    <span>
                      Quality<b>{selectedVehicle.quality}</b>
                    </span>
                    <span>
                      Order<b>{selectedVehicle.orderId ?? "Legacy order"}</b>
                    </span>
                    <span>
                      Slot<b>{selectedVehicle.slot + 1}</b>
                    </span>
                    <span>
                      Modules<b>{selectedVehicle.modules.length}/5</b>
                    </span>
                    <span>
                      Created<b>{elapsed(selectedVehicle.created)}</b>
                    </span>
                    <span>
                      Completed
                      <b>
                        {selectedVehicle.completedAt === null
                          ? "—"
                          : elapsed(selectedVehicle.completedAt)}
                      </b>
                    </span>
                  </div>
                  <div className="genealogy">
                    <b>Module genealogy</b>
                    <div className="genealogy-row genealogy-head">
                      <span>Line / module</span>
                      <span>Lot</span>
                      <span>Created</span>
                      <span>Rework</span>
                    </div>
                    {selectedVehicle.modules.map((module) => (
                      <button
                        className="genealogy-row"
                        key={module.id}
                        onClick={() => followEntity(module.id)}
                      >
                        <span>
                          {LINE_META[module.line].name}
                          <small>{module.id}</small>
                        </span>
                        <span>{module.lot}</span>
                        <span>{elapsed(module.created)}</span>
                        <span>{module.rework}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {selectedTruck && snapshot && (
                <>
                  <div className="metric-grid">
                    <span>
                      Phase<b>{selectedTruck.phase}</b>
                    </span>
                    <span>
                      Inspection<b>{selectedTruck.inspection ?? "pending"}</b>
                    </span>
                    <span>
                      Lot<b>{selectedTruck.lot}</b>
                    </span>
                    <span>
                      Phase started<b>{elapsed(selectedTruck.start)}</b>
                    </span>
                    <span>
                      Phase scheduled<b>{elapsed(selectedTruck.end)}</b>
                    </span>
                    <span>
                      Phase elapsed
                      <b>
                        {elapsed(
                          Math.max(
                            0,
                            Math.min(snapshot.time, selectedTruck.end) -
                              selectedTruck.start,
                          ),
                        )}
                      </b>
                    </span>
                  </div>
                  <div className="cargo-detail">
                    <b>Five-way truck cargo</b>
                    {LINE_IDS.map((line) => (
                      <span key={line}>
                        <i style={{ background: LINE_META[line].color }} />
                        {LINE_META[line].name}
                        <strong>{selectedTruck.amount[line]} kits</strong>
                      </span>
                    ))}
                  </div>
                  <button
                    className="wide-button"
                    onClick={() => followEntity(selectedTruck.id)}
                  >
                    Follow truck
                  </button>
                </>
              )}
              {selectedCart && snapshot && (
                <>
                  <div className="metric-grid">
                    <span>
                      Phase<b>{selectedCart.phase}</b>
                    </span>
                    <span>
                      Line<b>{LINE_META[selectedCart.line].name}</b>
                    </span>
                    <span>
                      Lot<b>{selectedCart.lot}</b>
                    </span>
                    <span>
                      Cargo<b>{selectedCart.amount} kits</b>
                    </span>
                    <span>
                      Charge<b>{format(selectedCart.charge, 0)}%</b>
                    </span>
                    <span>
                      Phase started<b>{elapsed(selectedCart.start)}</b>
                    </span>
                    <span>
                      Phase scheduled<b>{elapsed(selectedCart.end)}</b>
                    </span>
                    <span>
                      Phase elapsed
                      <b>
                        {elapsed(
                          Math.max(
                            0,
                            Math.min(snapshot.time, selectedCart.end) -
                              selectedCart.start,
                          ),
                        )}
                      </b>
                    </span>
                  </div>
                  <button
                    className="wide-button"
                    onClick={() => followEntity(selectedCart.id)}
                  >
                    Follow cart
                  </button>
                </>
              )}
              {selectedModule && (
                <div className="metric-grid">
                  <span>
                    Line<b>{LINE_META[selectedModule.line].name}</b>
                  </span>
                  <span>
                    Lot<b>{selectedModule.lot}</b>
                  </span>
                  <span>
                    Created<b>{elapsed(selectedModule.created)}</b>
                  </span>
                  <span>
                    Accepted<b>{selectedModule.accepted ? "yes" : "no"}</b>
                  </span>
                  <span>
                    Rework<b>{selectedModule.rework}</b>
                  </span>
                  <span>
                    Module ID<b>{selectedModule.id}</b>
                  </span>
                </div>
              )}
              {selectedModule?.reworkHistory && (
                <div className="genealogy">
                  <b>Inspection and rework history</b>
                  <ul>
                    {selectedModule.reworkHistory.map((item, index) => (
                      <li key={index}>
                        {elapsed(item.time)} · {item.event.replaceAll("-", " ")}{" "}
                        · attempt {item.attempt + 1}
                        {item.defectClass
                          ? ` · ${item.defectClass.replaceAll("-", " ")}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!activeStation &&
                !selectedVehicle &&
                !selectedTruck &&
                !selectedCart &&
                !selectedModule &&
                snapshot && (
                  <div className="overview-list">
                    <span>
                      <Warehouse size={16} />{" "}
                      {format(snapshot.metrics.warehouseOccupancy)} kits in
                      warehouse
                    </span>
                    <span>
                      <PackageCheck size={16} />{" "}
                      {format(snapshot.metrics.completed)} vehicles completed
                    </span>
                    <span>
                      <Gauge size={16} /> {format(snapshot.metrics.energy, 1)}{" "}
                      simulated energy units
                    </span>
                  </div>
                )}
              {snapshot && (
                <label className="select-label follow-picker">
                  Follow active entity
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) followEntity(event.target.value);
                    }}
                  >
                    <option value="">
                      Choose truck, cart, vehicle, or module…
                    </option>
                    {snapshot.trucks.map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        Truck · {truck.id} · {truck.phase}
                      </option>
                    ))}
                    {snapshot.carts.map((cart) => (
                      <option key={cart.id} value={cart.id}>
                        Cart · {cart.id} · {cart.phase}
                      </option>
                    ))}
                    {snapshot.vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        Vehicle · {vehicle.id} · {vehicle.phase}
                      </option>
                    ))}
                    {selectableModules.map((module) => (
                      <option key={module.id} value={module.id}>
                        Module · {module.id} · {LINE_META[module.line].name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="section-title events-title">
                <Activity size={16} /> Recent events
              </div>
              <div className="event-list">
                {events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => {
                      setSelected(event.entity);
                      world.current?.follow(event.entity);
                    }}
                  >
                    <time>{elapsed(event.time)}</time>
                    <span>{event.message}</span>
                  </button>
                ))}
                {!events.length && (
                  <p className="muted">Waiting for the first factory event.</p>
                )}
              </div>
            </div>
          )}
          {panel === "metrics" && (
            <div className="panel-body">
              <div className="section-title">
                <Activity size={17} /> Simulation metrics
              </div>
              <details className="metric-group">
                <summary>
                  <span>Application monitoring</span>
                  <small>Measured in this browser session.</small>
                </summary>
                <div className="metric-grid wide">
                  <span>
                    Frame rate<b>{format(fps)} FPS</b>
                  </span>
                  <span>
                    Approx. stream lag
                    <b>{format(clientMetrics.streamLag)} ms</b>
                  </span>
                  <span>
                    Validation time
                    <b>{format(clientMetrics.validationMs, 1)} ms</b>
                  </span>
                  <span>
                    Reconnects<b>{clientMetrics.reconnects}</b>
                  </span>
                  <span>
                    Rejected updates<b>{clientMetrics.invalidFrames}</b>
                  </span>
                  <span>
                    Reported errors<b>{clientMetrics.errors}</b>
                  </span>
                </div>
                <p className="muted">
                  Stream lag depends on client/server clock synchronization.
                  Processing time and server session counts are available at
                  /api/health.
                </p>
              </details>
              <p className="assumption">
                Every value below is a deterministic simulation estimate in the
                displayed units. It is inspectable operational evidence, not a
                physical measurement or production forecast.
              </p>
              <label className="chart-selector">
                History
                <select
                  aria-label="History measurement"
                  value={chartMetric}
                  onChange={(event) =>
                    setChartMetric(event.target.value as ChartKey)
                  }
                >
                  {Object.entries(chartMetrics).map(([key, spec]) => (
                    <option key={key} value={key}>
                      {spec.label}
                    </option>
                  ))}
                </select>
              </label>
              <MiniChart
                samples={snapshot?.samples ?? []}
                metric={chartMetric}
              />
              <div className="chart-labels">
                <span>
                  0–
                  {format(
                    Math.max(
                      1,
                      ...(snapshot?.samples
                        .slice(-48)
                        .map((sample) => sample[chartMetric]) ?? []),
                    ),
                    2,
                  )}{" "}
                  {chartMetrics[chartMetric].unit}
                </span>
                <span>
                  Latest:{" "}
                  {format(snapshot?.samples.at(-1)?.[chartMetric] ?? 0, 2)}
                </span>
              </div>
              <div className="chart-axis">
                <span>{elapsed(snapshot?.samples.at(-48)?.time ?? 0)}</span>
                <span>simulation time</span>
                <span>{elapsed(snapshot?.samples.at(-1)?.time ?? 0)}</span>
              </div>
              {snapshot &&
                metricGroups.map((group) => (
                  <details className="metric-group" key={group.title} open>
                    <summary>
                      <span>{group.title}</span>
                      <small>{group.description}</small>
                    </summary>
                    <div className="metric-grid wide">
                      {group.metrics.map((spec) => (
                        <span key={spec.key}>
                          {spec.label}
                          <b>
                            {spec.key === "wip"
                              ? `${format(currentWip)} ${spec.unit}`
                              : metricText(snapshot.metrics[spec.key], spec)}
                          </b>
                        </span>
                      ))}
                    </div>
                  </details>
                ))}
              {snapshot && (
                <details className="metric-group" open>
                  <summary>
                    <span>Line condition</span>
                    <small>
                      Live line state, capacity, condition, and profile.
                    </small>
                  </summary>
                  <div className="line-metrics">
                    {LINE_IDS.map((line) => {
                      const station = snapshot.stations[line];
                      return (
                        <div key={line}>
                          <b style={{ color: LINE_META[line].color }}>
                            {LINE_META[line].name}
                          </b>
                          <span>
                            {station.completed} completed ·{" "}
                            {station.queue.length}/{station.capacity} queued
                          </span>
                          <span>
                            {format(station.temperature, 1)}° simulated
                            temperature · {format(station.vibration, 2)}{" "}
                            vibration
                          </span>
                          <span>
                            {station.profile} profile · {station.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
              {snapshot && (
                <details className="metric-group" open>
                  <summary>
                    <span>Other instrumented metrics</span>
                    <small>
                      Every current metric key not listed above. “Unclassified”
                      retains its source name and makes no physical-unit claim.
                    </small>
                  </summary>
                  <div className="metric-grid wide">
                    {otherMetricSpecs.map((spec) => (
                      <span key={spec.key}>
                        {spec.label}
                        <b>{metricText(snapshot.metrics[spec.key], spec)}</b>
                      </span>
                    ))}
                  </div>
                </details>
              )}
              <div className="metric-downloads">
                <button className="wide-button" onClick={downloadMetricSeries}>
                  <Download size={15} /> Download sampled CSV
                </button>
                <button
                  className="wide-button"
                  onClick={downloadCurrentMetrics}
                >
                  <Download size={15} /> Download current metrics JSON
                </button>
              </div>
              <p className="muted metric-export-note">
                CSV contains the retained sampled time series. JSON contains
                every current snapshot metric, including values not sampled over
                time.
              </p>
              {session && snapshot && (
                <AdaptiveComparisonPanel
                  metricSpecFor={metricSpecFor}
                  key={session.id}
                  session={session}
                  config={snapshot.config}
                  providers={providers}
                  accessCode={accessCode}
                />
              )}
              <button
                className="wide-button"
                disabled={experimentBusy}
                onClick={() => void runExperiment()}
              >
                <Activity size={15} />{" "}
                {experimentBusy
                  ? "Comparing…"
                  : "Compare current configuration"}
              </button>
              <button
                className="wide-button"
                disabled={
                  experimentBusy ||
                  !snapshot?.decisions.some((d) => d.status === "applied")
                }
                onClick={() => void runExperiment("recorded-ai")}
              >
                Compare recorded AI actions
              </button>
              <p className="muted">
                Recorded-action comparison requires an applied live AI decision
                in this server session.
              </p>
              {experiment && (
                <div className="experiment">
                  <b>{experiment.name}</b>
                  <small>{experiment.note}</small>
                  <p className="assumption">
                    {experiment.runs} paired runs over seeds{" "}
                    {experiment.seeds.join(", ")}.{" "}
                    {experiment.policySource === "recorded-ai"
                      ? "Baseline uses normal profiles. Candidate replays recorded manufacturing actions without adapting to the new seed. This is not a live adaptive-policy evaluation."
                      : "Baseline uses normal profiles; candidate uses the full configuration captured when this comparison was requested. Both use the same disruption scenario and paired seeds. No AI policy is invoked or replayed."}
                  </p>
                  <div className="profile-note">
                    <b>Candidate:</b>{" "}
                    {experiment.policySource === "recorded-ai"
                      ? `${experiment.actionCount ?? 0} recorded actions from ${(experiment.sourceDecisionIds ?? []).length} live decisions`
                      : profileText({
                          front: "normal",
                          rear: "normal",
                          battery: "normal",
                          interior: "normal",
                          exterior: "normal",
                          ...experiment.candidateProfiles,
                        })}
                  </div>
                  <details className="per-seed">
                    <summary>Captured configurations</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          baseline: experiment.baselineConfig,
                          candidate: experiment.candidateConfig,
                          sourceDecisions: experiment.sourceDecisionIds,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <div className="comparison-table">
                    <div className="comparison-row comparison-head">
                      <span>Metric</span>
                      <span>{experiment.baselineName ?? "Baseline"}</span>
                      <span>{experiment.candidateName ?? "Candidate"}</span>
                      <span>Δ</span>
                    </div>
                    {Object.keys(experiment.baseline).map((key) => {
                      const spec = metricGroups
                        .flatMap((group) => group.metrics)
                        .find((item) => item.key === key) ?? {
                        key,
                        label: key,
                        unit: "sim units",
                        digits: 2,
                      };
                      const sd = experiment.standardDeviation?.candidate[key];
                      return (
                        <div className="comparison-row" key={key}>
                          <span>
                            {spec.label}
                            <small>{spec.unit}</small>
                          </span>
                          <span>
                            {format(experiment.baseline[key], spec.digits ?? 2)}
                          </span>
                          <span>
                            {format(
                              experiment.candidate[key],
                              spec.digits ?? 2,
                            )}
                            {sd !== undefined && (
                              <small>± {format(sd, spec.digits ?? 2)}</small>
                            )}
                          </span>
                          <span
                            className={comparisonDirection(
                              key,
                              experiment.differences[key] ?? 0,
                            )}
                          >
                            {format(
                              experiment.differences[key] ?? 0,
                              spec.digits ?? 2,
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {experiment.perSeed && (
                    <details className="per-seed">
                      <summary>
                        Per-seed variation ({experiment.perSeed.length} paired
                        rows)
                      </summary>
                      <div className="seed-list">
                        {experiment.perSeed.map((row) => (
                          <span key={row.seed}>
                            #{row.seed}: Δ throughput{" "}
                            {format(row.differences.throughput ?? 0, 2)}{" "}
                            vehicles/hr
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
          {panel === "controls" && (
            <div className="panel-body">
              <div className="section-title">
                <SlidersHorizontal size={17} /> Manual operations
              </div>
              <p className="assumption">
                Commands are schema-checked against the current session
                revision. Limits shown here are simulation bounds.
              </p>
              <div className="control-section">
                <b>Production orders</b>
                <p className="muted">
                  Higher-priority orders receive the next available complete set
                  of modules. Committed vehicles finish their current order.
                </p>
                <label className="config-field">
                  <span>New order quantity</span>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={orderQuantity}
                    onChange={(event) =>
                      setOrderQuantity(Number(event.target.value))
                    }
                  />
                </label>
                <label className="select-label">
                  New order priority (1 highest)
                  <select
                    value={orderPriority}
                    onChange={(event) =>
                      setOrderPriority(Number(event.target.value))
                    }
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="wide-button"
                  onClick={() =>
                    void command({
                      type: "order-create",
                      value: `${orderQuantity}:${orderPriority}`,
                    })
                  }
                >
                  Add production order
                </button>
                {snapshot?.orders?.map((order) => (
                  <label className="config-field" key={order.id}>
                    <span>
                      {order.id}
                      <small>
                        {order.completed}/{order.quantity} complete ·{" "}
                        {order.status}
                      </small>
                    </span>
                    <select
                      aria-label={`Priority for ${order.id}`}
                      value={order.priority}
                      onChange={(event) =>
                        void command({
                          type: "order-priority",
                          value: `${order.id}:${event.target.value}`,
                        })
                      }
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="control-section">
                <b>Site faults</b>
                <div className="fault-buttons">
                  {(
                    ["supply", "congestion", "assembly", "dispatch"] as const
                  ).map((fault) => (
                    <button
                      className={snapshot?.faults[fault] ? "fault-active" : ""}
                      key={fault}
                      onClick={() =>
                        void command({ type: "fault", value: fault })
                      }
                    >
                      {fault.replaceAll("-", " ")}
                    </button>
                  ))}
                </div>
                <button
                  className="wide-button"
                  onClick={() => void command({ type: "repair" })}
                >
                  <Wrench size={14} /> Clear all site faults
                </button>
              </div>
              <div className="control-section">
                <b>Line control</b>
                <label className="select-label">
                  Line
                  <select
                    value={manualLine}
                    onChange={(event) =>
                      setManualLine(event.target.value as LineId)
                    }
                  >
                    {LINE_IDS.map((line) => (
                      <option key={line} value={line}>
                        {LINE_META[line].name}
                      </option>
                    ))}
                  </select>
                </label>
                {snapshot && (
                  <>
                    <label className="select-label">
                      Profile
                      <select
                        value={snapshot.stations[manualLine].profile}
                        onChange={(event) =>
                          void command({
                            type: "profile",
                            station: manualLine,
                            value: event.target.value,
                          })
                        }
                      >
                        <option>gentle</option>
                        <option>normal</option>
                        <option>fast</option>
                      </select>
                    </label>
                    <label className="select-label">
                      Buffer capacity (1–8)
                      <select
                        value={snapshot.stations[manualLine].capacity}
                        onChange={(event) =>
                          void command({
                            type: "buffer",
                            station: manualLine,
                            value: Number(event.target.value),
                          })
                        }
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label className="select-label">
                      Material priority (1 highest)
                      <select
                        value={
                          snapshot.config.materialPriority?.[manualLine] ?? 3
                        }
                        onChange={(event) =>
                          void command({
                            type: "priority",
                            station: manualLine,
                            value: Number(event.target.value),
                          })
                        }
                      >
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label className="select-label">
                      Layout offset (paused only)
                      <select
                        disabled={snapshot.running}
                        defaultValue="0"
                        onChange={(event) =>
                          void command({
                            type: "layout",
                            station: manualLine,
                            value: Number(event.target.value),
                          })
                        }
                      >
                        <option value="-1">Upstream</option>
                        <option value="0">Centered</option>
                        <option value="1">Downstream</option>
                      </select>
                    </label>
                    <div className="button-pair">
                      <button
                        onClick={() =>
                          void command({
                            type: "fault",
                            station: manualLine,
                            value: "operator demonstration",
                          })
                        }
                      >
                        Fault line
                      </button>
                      <button
                        onClick={() =>
                          void command({ type: "repair", station: manualLine })
                        }
                      >
                        Service line
                      </button>
                    </div>
                    <button
                      className="wide-button"
                      onClick={() =>
                        void command({
                          type:
                            snapshot!.stations[manualLine].status === "paused"
                              ? "start"
                              : "pause",
                          station: manualLine,
                        })
                      }
                    >
                      {snapshot!.stations[manualLine].status === "paused"
                        ? "Resume line"
                        : "Pause line"}
                    </button>
                  </>
                )}
              </div>
              <div className="control-section">
                <b>Flow configuration</b>
                <p className="muted">
                  Apply each bounded field independently. Changing finite order
                  or continuous flow affects future release behavior.
                </p>
                {[
                  ["releaseRate", "Release rate (0.1–3.0)", "0.1", "3", "0.1"],
                  ["reorderPoint", "Reorder point (1–40)", "1", "40", "1"],
                  ["deliverySize", "Delivery size (1–60)", "1", "60", "1"],
                  ["deliveryLead", "Delivery lead (≥1 sim s)", "1", "", "1"],
                  ["dispatchDwell", "Dispatch dwell (≥5 sim s)", "5", "", "1"],
                  [
                    "parkingCapacity",
                    "Parking capacity (1–12)",
                    "1",
                    "12",
                    "1",
                  ],
                  ["orderSize", "Finite order size (≥1)", "1", "", "1"],
                  [
                    "materialLoadingCapacity",
                    "Shared loading slots (1–3)",
                    "1",
                    "3",
                    "1",
                  ],
                ].map(([key, label, min, max, step]) => (
                  <label className="config-field" key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      value={configDraft[key] ?? ""}
                      onChange={(event) =>
                        setConfigDraft((old) => ({
                          ...old,
                          [key]: event.target.value,
                        }))
                      }
                    />
                    <button onClick={() => applyConfig(key)}>Apply</button>
                  </label>
                ))}
                <label className="continuous-toggle">
                  <input
                    type="checkbox"
                    checked={configDraft.continuous === "true"}
                    onChange={(event) => {
                      const value = String(event.target.checked);
                      setConfigDraft((old) => ({ ...old, continuous: value }));
                      void command({
                        type: "config",
                        value: `continuous:${value}`,
                      });
                    }}
                  />{" "}
                  Continuous orders
                </label>
              </div>
              <div className="control-section">
                <b>Audio mix</b>
                <p className="muted">
                  Levels save locally in this browser. Enable sound from the top
                  bar to hear the procedural factory mix.
                </p>
                {(["master", "ambience", "machinery", "alerts"] as const).map(
                  (key) => (
                    <label className="audio-level" key={key}>
                      <span>{key}</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={audioLevels[key]}
                        onChange={(event) =>
                          setAudioLevel(key, Number(event.target.value))
                        }
                      />
                      <output>{Math.round(audioLevels[key] * 100)}%</output>
                    </label>
                  ),
                )}
              </div>
              <div className="control-section replay-control">
                <b>Graphical replay</b>
                <p className="muted">
                  Open a paused session rebuilt from archived events in the
                  latest epoch. Quota-truncated archives are rejected.
                </p>
                <label className="config-field">
                  <span>
                    Simulation time (0–{format(snapshot?.time ?? 0)} s)
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={snapshot?.time ?? 0}
                    step="1"
                    value={replayTime}
                    onChange={(event) => setReplayTime(event.target.value)}
                    placeholder="seconds"
                  />
                  <button onClick={() => void replayAt()}>Replay</button>
                </label>
              </div>
            </div>
          )}
          {panel === "ai" && (
            <div className="panel-body">
              <div className="section-title">
                <Sparkles size={17} /> Factory intelligence
              </div>
              <p className="muted">
                Providers only receive a narrow operational view. Commands
                remain schema-checked and auditable.
              </p>
              <div className="provider-status">
                <span>
                  <i className={providers?.astra.configured ? "ready" : ""} />{" "}
                  Astra {providers?.astra.status ?? "checking"}
                </span>
                <span>
                  <i className={providers?.jev.configured ? "ready" : ""} /> Jev{" "}
                  {providers?.jev.status ?? "checking"}
                </span>
              </div>
              {providers?.accessRequired && (
                <input
                  className="access-code"
                  type="password"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  placeholder="AI access code"
                  aria-label="AI access code"
                  autoComplete="off"
                />
              )}
              <textarea
                value={chat}
                onChange={(event) => setChat(event.target.value)}
                aria-label="Question for Astra"
              />
              <button
                className="wide-button primary"
                disabled={asking || !providers?.astra.configured}
                onClick={() => void askAstra("astra")}
              >
                {asking ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Send size={16} />
                )}{" "}
                Ask Astra
              </button>
              <button
                className="wide-button"
                disabled={asking || !providers?.jev.configured}
                onClick={() => void askAstra("jev")}
              >
                <Bot size={16} /> Ask Jev
              </button>
              <div className="decision-list">
                {snapshot?.decisions
                  .slice(-20)
                  .reverse()
                  .map((decision) => (
                    <details key={decision.id} className="decision-record">
                      <summary>
                        <span className={decision.status}>
                          {decision.status}
                        </span>
                        {decision.provider === "astra" ? "Astra" : "Jev"} ·{" "}
                        {elapsed(decision.time)}
                        <p>{decision.summary}</p>
                      </summary>
                      <p className="muted">
                        Source revision {decision.revision} ·{" "}
                        {format(decision.latency)} ms · {decision.tokens}{" "}
                        reported tokens
                      </p>
                      <b>Proposed actions</b>
                      {decision.commands.length ? (
                        <ul>
                          {decision.commands.map((action, index) => (
                            <li key={index}>
                              {action.type}
                              {action.station
                                ? ` · ${LINE_META[action.station]?.name ?? action.station}`
                                : ""}
                              {action.value !== undefined
                                ? ` · ${String(action.value)}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No operational changes proposed.</p>
                      )}
                      {decision.source && (
                        <p className="muted">
                          Source: {format(decision.source.throughput, 1)}{" "}
                          vehicles/hr · {format(decision.source.yield, 1)}%
                          yield · {decision.source.wip} WIP
                        </p>
                      )}
                      {decision.commandResults && (
                        <ul>
                          {decision.commandResults.map((result) => (
                            <li key={result.commandId}>
                              {result.status}: {result.message}
                            </li>
                          ))}
                        </ul>
                      )}
                      {decision.applicationTime !== undefined && (
                        <p>Applied at {elapsed(decision.applicationTime)}</p>
                      )}
                      {decision.experiment && (
                        <div>
                          <b>
                            Paired experiment · {decision.experiment.status}
                          </b>
                          <p>
                            {decision.experiment.requestedProfile.line} /{" "}
                            {decision.experiment.requestedProfile.profile} ·{" "}
                            {decision.experiment.runs ?? 0} paired seeds
                          </p>
                          <small>{decision.experiment.note}</small>
                          {decision.experiment.differences && (
                            <pre>
                              {JSON.stringify(
                                decision.experiment.differences,
                                null,
                                2,
                              )}
                            </pre>
                          )}
                        </div>
                      )}
                      {decision.aftermath ? (
                        <div>
                          <b>
                            {decision.aftermath.windowSeconds}s observed
                            aftermath
                          </b>
                          <p>
                            Δ completed {decision.aftermath.deltas.completed} ·
                            Δ dispatched {decision.aftermath.deltas.dispatched}{" "}
                            · Δ throughput{" "}
                            {format(decision.aftermath.deltas.throughput, 1)}/hr
                            · Δ yield{" "}
                            {format(decision.aftermath.deltas.yield, 1)} points
                          </p>
                          <small>
                            Observational change, not causal proof.{" "}
                            {decision.aftermath.status === "interrupted"
                              ? "Observation window ended early."
                              : "Other activity may contribute."}
                          </small>
                        </div>
                      ) : decision.applicationTime !== undefined ? (
                        <p className="muted">
                          Awaiting 120 simulated seconds of aftermath.
                        </p>
                      ) : null}
                      <p className="muted">
                        {decision.status === "advisory"
                          ? "Recommendation only. Use Manual operations to apply a chosen change against the current state."
                          : "Execution results and subsequent measurements are retained in the event history."}
                      </p>
                    </details>
                  ))}
              </div>
            </div>
          )}
        </aside>
      )}

      <footer className="bottom-bar glass">
        <span>{notice}</span>
        {error && <span className="error">{error}</span>}
        <div>
          <a
            href="https://github.com/BabylonJS/Assets/blob/master/environments/studio.env"
            target="_blank"
            rel="noreferrer"
          >
            Studio environment · CC-BY 4.0
          </a>
          <button onClick={() => void exportRun()}>
            <Download size={14} /> Export checkpoint
          </button>
          <button onClick={() => void downloadHistory()}>
            <ScrollText size={14} /> Full history
          </button>
          <button onClick={() => fileInput.current?.click()}>
            <FileUp size={14} /> import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            onChange={(event) => void importRun(event.target.files?.[0])}
            hidden
          />
        </div>
      </footer>
    </main>
  );
}

export default App;
