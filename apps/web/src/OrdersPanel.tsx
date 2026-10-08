/**
 * DF-ORDER-001 Orders tab. "This session" lists the visitor session's production
 * orders; "Order floor" shows the shared, read-only agent order floor.
 */
import { useState } from "react";
import { AlertTriangle, PackageCheck, Radio, Truck } from "lucide-react";
import {
  LINE_IDS,
  LINE_META,
  type FactorySnapshot,
} from "../../../packages/contracts/src/index.ts";
import type {
  DeskOrderCard,
  OrderDeskView,
  UnitView,
} from "../../../packages/contracts/src/orders.ts";
import {
  FLOOR_BANNER,
  STEPPER,
  simClock,
  statusLabel,
  stepIndex,
} from "./orderFloor.ts";

type SessionOrder = NonNullable<FactorySnapshot["orders"]>[number];

export interface OrdersPanelProps {
  desk: OrderDeskView | null;
  floorView: boolean;
  floorAvailable: boolean;
  floorOperator: boolean;
  feed: string[];
  sessionOrders: SessionOrder[];
  accessCode: string;
  onAccessCode: (value: string) => void;
  onUnlock: () => void;
  onToggleFloor: () => void;
  onCancelSessionOrder: (orderId: string) => void;
  onSelectVehicle: (vehicleId: string) => void;
}

export function OrdersPanel(props: OrdersPanelProps) {
  const [view, setView] = useState<"session" | "floor">(
    props.floorView ? "floor" : "session",
  );
  return (
    <div className="panel-body orders-panel">
      <div className="section-title">
        <PackageCheck size={17} /> Orders
      </div>
      <div className="orders-switch" role="tablist" aria-label="Order views">
        <button
          role="tab"
          aria-selected={view === "session"}
          className={view === "session" ? "active" : ""}
          onClick={() => setView("session")}
        >
          This session
        </button>
        <button
          role="tab"
          aria-selected={view === "floor"}
          className={view === "floor" ? "active" : ""}
          onClick={() => setView("floor")}
        >
          Order floor
        </button>
      </div>
      {view === "session" ? <SessionOrders {...props} /> : <FloorOrders {...props} />}
    </div>
  );
}

function SessionOrders({
  sessionOrders,
  floorView,
  onCancelSessionOrder,
}: OrdersPanelProps) {
  if (floorView)
    return (
      <p className="muted">
        You are watching the shared order floor. Turn off "Watch order floor"
        to manage your own session's production orders.
      </p>
    );
  return (
    <div className="control-section">
      <b>Production orders in this session</b>
      <p className="muted">
        Queued orders with no committed vehicle can be cancelled. Create and
        reprioritize orders from Controls.
      </p>
      {sessionOrders.length === 0 && <p className="muted">No active orders.</p>}
      {sessionOrders.map((order) => (
        <div className="session-order" key={order.id}>
          <span>
            {order.id}
            <small>
              {order.completed}/{order.quantity} complete · {order.status} ·
              priority {order.priority} · {order.source}
            </small>
          </span>
          {order.status === "queued" && order.completed === 0 && (
            <button
              onClick={() => onCancelSessionOrder(order.id)}
              aria-label={`Cancel ${order.id}`}
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function FloorOrders(props: OrdersPanelProps) {
  const { desk, floorView, floorAvailable, floorOperator, feed } = props;
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <>
      <label className="floor-toggle">
        <input
          type="checkbox"
          checked={floorView}
          disabled={!floorAvailable && !floorView}
          onChange={props.onToggleFloor}
        />
        <span>
          <Radio size={13} /> Watch order floor
        </span>
      </label>
      {!floorAvailable && !floorView && (
        <p className="muted">
          The order floor is not available on this server. It is off by
          default and only runs when the order desk is enabled.
        </p>
      )}
      {floorView && (
        <p className="floor-banner" role="status">
          {FLOOR_BANNER}
        </p>
      )}
      {floorView && !floorOperator && (
        <div className="floor-unlock">
          <span className="muted">
            Controls are disabled. Operators can enter the access code.
          </span>
          <input
            type="password"
            aria-label="Operator access code"
            value={props.accessCode}
            onChange={(event) => props.onAccessCode(event.target.value)}
          />
          <button onClick={props.onUnlock}>Unlock</button>
        </div>
      )}
      {floorView && desk && (
        <>
          <p className="muted">
            Floor time {simClock(desk.simTime)} simulated
            {desk.intakePaused ? " · intake paused" : ""}. {desk.disclaimer}
          </p>
          {feed.length > 0 && (
            <div className="order-feed" aria-label="Incoming agent orders">
              {feed.slice(0, 5).map((line, index) => (
                <p key={`${index}-${line}`}>{line}</p>
              ))}
            </div>
          )}
          {desk.orders.length === 0 && (
            <p className="muted">No agent orders yet.</p>
          )}
          {desk.orders.map((card) => (
            <OrderCard
              key={card.orderId}
              card={card}
              open={expanded === card.orderId}
              onToggle={() =>
                setExpanded(expanded === card.orderId ? null : card.orderId)
              }
              onSelectVehicle={props.onSelectVehicle}
            />
          ))}
        </>
      )}
    </>
  );
}

function OrderCard({
  card,
  open,
  onToggle,
  onSelectVehicle,
}: {
  card: DeskOrderCard;
  open: boolean;
  onToggle: () => void;
  onSelectVehicle: (vehicleId: string) => void;
}) {
  const step = stepIndex(card);
  return (
    <article className="order-card" aria-label={`Agent order ${card.orderId}`}>
      <header>
        <span>
          <b>{card.orderId}</b>
          <small>{card.agentLabel}</small>
        </span>
        <span className={`order-status ${card.status}`}>
          {statusLabel(card.status)}
        </span>
      </header>
      {card.atRisk.value && (
        <p className="order-risk" role="status">
          <AlertTriangle size={12} /> At risk: {card.atRisk.reasons.join(", ")}
        </p>
      )}
      <div className="metric-grid">
        <span>
          Quantity<b>{card.quantity}</b>
        </span>
        <span>
          Lead<b>{card.leadOption}</b>
        </span>
        <span>
          Price<b>{card.price.amount.toLocaleString()} {card.price.currency}</b>
        </span>
        <span>
          Zone<b>{card.destinationZone}</b>
        </span>
        <span>
          Promised delivery
          <b>{simClock(card.promised.deliverBySimTime)} sim</b>
        </span>
        <span>
          Latest estimate
          <b>{simClock(card.latestEstimate.deliverBySimTime)} sim</b>
        </span>
      </div>
      {step >= 0 ? (
        <ol className="order-stepper" aria-label="Order progress">
          {STEPPER.map((label, index) => (
            <li
              key={label}
              className={index < step ? "done" : index === step ? "current" : ""}
              aria-current={index === step ? "step" : undefined}
            >
              {label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">
          {statusLabel(card.status)}
          {card.statusReason ? `: ${card.statusReason}` : ""}
        </p>
      )}
      <button className="wide-button" onClick={onToggle} aria-expanded={open}>
        {open ? "Hide unit detail" : "Show unit detail"}
      </button>
      {open && (
        <>
          {card.units.map((unit) => (
            <UnitDetail
              key={unit.index}
              unit={unit}
              onSelectVehicle={onSelectVehicle}
            />
          ))}
          <div className="order-updates">
            <b>Recent updates</b>
            {[...card.recentUpdates].reverse().map((update) => (
              <p key={update.seq}>
                <time>{simClock(update.simTime)}</time> {update.message}
                {update.factoryEvent && (
                  <small> · event #{update.factoryEvent.id}</small>
                )}
                <small> · {update.source}</small>
              </p>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

function UnitDetail({
  unit,
  onSelectVehicle,
}: {
  unit: UnitView;
  onSelectVehicle: (vehicleId: string) => void;
}) {
  return (
    <div className="unit-detail">
      <div className="unit-head">
        <b>Unit {unit.index + 1}</b>
        <small>
          {statusLabel(unit.status)}
          {unit.stage ? ` · ${unit.stage.replace(/_/g, " ")}` : ""}
        </small>
        {unit.vehicleId && (
          <button
            className="vehicle-link"
            onClick={() => onSelectVehicle(unit.vehicleId!)}
          >
            {unit.vehicleId}
          </button>
        )}
      </div>
      <div className="station-chips">
        {LINE_IDS.map((line) => {
          const progress = unit.stations[line];
          if (!progress) return null;
          const detail =
            progress.binding === "bound"
              ? `${progress.moduleId ?? "module"} · lot ${progress.lot ?? "?"}${progress.rework ? " · reworked" : ""}`
              : "projected";
          return (
            <span
              key={line}
              className={`station-chip ${progress.binding} ${progress.state}`}
              style={{ borderColor: LINE_META[line].color }}
              title={detail}
            >
              <b>{LINE_META[line].name}</b>
              <small>
                {progress.state} · {detail}
              </small>
            </span>
          );
        })}
      </div>
      {unit.tracking && (
        <div className="tracking-strip" aria-label="Virtual carrier tracking">
          <span className="tracking-head">
            <Truck size={12} /> {unit.tracking.carrier} {unit.tracking.trackingId}
            <small> · ETA {simClock(unit.tracking.etaSimTime)} sim</small>
          </span>
          <ol>
            {unit.tracking.legs.map((leg, index) => (
              <li
                key={`${leg.from}-${leg.to}-${index}`}
                className={leg.actualEnd !== null ? "done" : ""}
              >
                {leg.from} to {leg.to}
                <small>
                  {leg.actualEnd !== null
                    ? ` arrived ${simClock(leg.actualEnd)}`
                    : ` planned ${simClock(leg.plannedEnd)}`}
                  {leg.delayed ? " · delayed" : ""}
                </small>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
