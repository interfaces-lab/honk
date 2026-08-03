// Bounded output ring for background PTY jobs. A background job runs with no
// renderer attached for most of its life, so main keeps the tail itself: the
// agent polls it and a late attach replays it into a fresh terminal.
// Sizes count UTF-16 code units, which tracks bytes closely for terminal output.

const OUTPUT_LIMIT = 200_000;

export interface TerminalOutputBuffer {
  readonly chunks: string[];
  size: number;
}

export function createTerminalOutputBuffer(): TerminalOutputBuffer {
  return { chunks: [], size: 0 };
}

export function appendTerminalOutput(buffer: TerminalOutputBuffer, data: string): void {
  buffer.chunks.push(data);
  buffer.size += data.length;
  // Keep the newest chunk even when it alone exceeds the cap; readTerminalOutput trims it.
  while (buffer.size > OUTPUT_LIMIT && buffer.chunks.length > 1) {
    const dropped = buffer.chunks.shift();
    if (dropped === undefined) return;
    buffer.size -= dropped.length;
  }
}

export function readTerminalOutput(buffer: TerminalOutputBuffer, maxSize = OUTPUT_LIMIT): string {
  const history = buffer.chunks.join("");
  return history.length > maxSize ? history.slice(history.length - maxSize) : history;
}
