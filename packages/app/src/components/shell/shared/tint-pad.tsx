import { useLayoutEffect, useRef, useState } from "react";

import { TINT_PAD } from "~/lib/ui-tint";
import { hueSatFromXY, xyFromHueSat, type PadRect } from "~/lib/tint-pad-geometry";
import { cn } from "~/lib/utils";

const field =
  "radial-gradient(circle at center, oklch(0.9 0 0), transparent 58%), conic-gradient(from 0deg, oklch(0.76 0.16 0), oklch(0.78 0.16 60), oklch(0.8 0.16 120), oklch(0.76 0.16 180), oklch(0.72 0.18 240), oklch(0.74 0.17 300), oklch(0.76 0.16 360))";

function commit(
  clientX: number,
  clientY: number,
  rect: PadRect,
  onHue: (n: number) => void,
  onSat: (n: number) => void,
) {
  const { hue, saturation } = hueSatFromXY(clientX, clientY, rect, TINT_PAD.inset);
  onHue(Math.round(hue) % 360);
  onSat(Math.min(100, Math.max(0, Math.round(saturation))));
}

export function TintPad(props: {
  hue: number;
  saturation: number;
  disabled?: boolean;
  onHueChange: (value: number) => void;
  onSatChange: (value: number) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [dot, setDot] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      const p = xyFromHueSat(props.hue, props.saturation, r, TINT_PAD.inset);
      setDot(p);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.hue, props.saturation]);

  function move(clientX: number, clientY: number) {
    const el = root.current;
    if (!el || props.disabled) return;
    const r = el.getBoundingClientRect();
    commit(clientX, clientY, r, props.onHueChange, props.onSatChange);
  }

  return (
    <div
      ref={root}
      className={cn(
        "relative isolate w-full overflow-hidden rounded-none border-0",
        props.disabled && "pointer-events-none opacity-50",
        props.className,
      )}
      style={{ height: TINT_PAD.h, width: TINT_PAD.w }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{ background: field }}
      />
      <div
        aria-label="Accent tint"
        tabIndex={props.disabled ? -1 : 0}
        className="absolute inset-0 z-10 cursor-crosshair touch-none outline-none focus-visible:ring-0"
        onPointerDown={(e) => {
          if (props.disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          move(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute z-20 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_2px_12px_rgb(0_0_0/0.2)] dark:shadow-[0_2px_12px_rgb(0_0_0/0.45)]"
        style={{ left: dot.x, top: dot.y }}
      />
    </div>
  );
}
