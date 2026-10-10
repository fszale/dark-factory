import { useEffect, useRef } from "react";
import { newToastClock, toastExpired, toastFrame } from "./orderFloor.ts";

/**
 * Incoming agent-order toast (DF-ORDER-001). The countdown runs on painted animation frames (see
 * toastFrame), so it starts at first paint, pauses while the tab is hidden or the toast is hovered
 * or focused, and a starved main thread cannot expire it before it has been on screen.
 * Remount with a new `key` for each new message to restart the countdown.
 */
export function OrderToast({ message, onOpen, onDone }: { message: string; onOpen: () => void; onDone: () => void }) {
  const held = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let clock = newToastClock();
    let frame = 0;
    const tick = (now: number) => {
      clock = toastFrame(clock, now, held.current || document.hidden);
      if (toastExpired(clock)) {
        done.current();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const hold = (value: boolean) => () => {
    held.current = value;
  };
  return (
    <div
      className="order-toast glass"
      role="status"
      aria-live="polite"
      onPointerEnter={hold(true)}
      onPointerLeave={hold(false)}
      onFocus={hold(true)}
      onBlur={hold(false)}
    >
      <button onClick={onOpen}>{message}</button>
    </div>
  );
}
