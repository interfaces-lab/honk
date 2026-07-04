import {
  TERMINAL_COLS_MAX,
  TERMINAL_COLS_MIN,
  TERMINAL_ROWS_MAX,
  TERMINAL_ROWS_MIN,
} from "@honk/shared/terminal";

interface TerminalDimensionsInput {
  cols: number;
  rows: number;
}

function clampDimension(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampTerminalDimensions(input: TerminalDimensionsInput): TerminalDimensionsInput {
  return {
    cols: clampDimension(input.cols, TERMINAL_COLS_MIN, TERMINAL_COLS_MAX),
    rows: clampDimension(input.rows, TERMINAL_ROWS_MIN, TERMINAL_ROWS_MAX),
  };
}

export function waitForTerminalLayoutFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}
