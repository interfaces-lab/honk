import { toQR } from "toqr";

export function renderTerminalQrCode(value: string, margin = 2): string {
  const modules = toQR(value);
  const size = Math.sqrt(modules.length);
  if (!Number.isInteger(size)) throw new Error("The QR encoder returned an invalid matrix.");

  const isDark = (x: number, y: number): boolean =>
    x >= 0 && x < size && y >= 0 && y < size && modules[y * size + x] === 1;
  const rows: string[] = [];
  for (let y = -margin; y < size + margin; y += 2) {
    let row = "";
    for (let x = -margin; x < size + margin; x += 1) {
      const top = isDark(x, y);
      const bottom = isDark(x, y + 1);
      row += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
    }
    rows.push(row);
  }
  return rows.join("\n");
}
