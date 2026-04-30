export type PadRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const eps = 1e-6;

export function hueSatFromXY(x: number, y: number, rect: PadRect, padding: number) {
  const px = x - rect.left;
  const py = y - rect.top;
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const dx = px - cx;
  const dy = py - cy;
  const r = Math.max(0, Math.min(rect.width, rect.height) / 2 - padding);
  const dist = Math.hypot(dx, dy);
  if (dist < eps || r < eps) {
    return { hue: 0, saturation: 0 };
  }
  const saturation = Math.min(100, (Math.min(dist, r) / r) * 100);
  let hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  hue = ((hue % 360) + 360) % 360;
  return { hue, saturation };
}

export function xyFromHueSat(hue: number, saturation: number, rect: PadRect, padding: number) {
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const r = Math.max(0, Math.min(rect.width, rect.height) / 2 - padding);
  if (saturation <= eps || r < eps) {
    return { x: cx, y: cy };
  }
  const dist = (Math.min(100, Math.max(0, saturation)) / 100) * r;
  const rad = ((hue - 90) * Math.PI) / 180;
  return {
    x: cx + dist * Math.cos(rad),
    y: cy + dist * Math.sin(rad),
  };
}
