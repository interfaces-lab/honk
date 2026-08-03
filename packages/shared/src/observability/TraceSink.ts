import fs from "node:fs";
import path from "node:path";

import { Effect } from "effect";

import type { TraceRecord } from "./TraceRecord";

const FLUSH_BUFFER_THRESHOLD = 256;

export interface TraceSinkOptions {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly batchWindowMs: number;
}

export interface TraceSink {
  readonly filePath: string;
  push: (record: TraceRecord) => void;
  flush: Effect.Effect<void>;
  close: () => Effect.Effect<void>;
}

interface RotatingTraceFileSinkOptions {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
}

class RotatingTraceFileSink {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private currentSize = 0;

  constructor(options: RotatingTraceFileSinkOptions) {
    if (options.maxBytes < 1) {
      throw new Error(`maxBytes must be >= 1 (received ${options.maxBytes})`);
    }
    if (options.maxFiles < 1) {
      throw new Error(`maxFiles must be >= 1 (received ${options.maxFiles})`);
    }

    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes;
    this.maxFiles = options.maxFiles;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.pruneOverflowBackups();
    this.currentSize = this.readCurrentSize();
  }

  write(chunk: string | Buffer): void {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (buffer.length === 0) return;

    try {
      if (this.currentSize > 0 && this.currentSize + buffer.length > this.maxBytes) {
        this.rotate();
      }

      fs.appendFileSync(this.filePath, buffer);
      this.currentSize += buffer.length;

      if (this.currentSize > this.maxBytes) {
        this.rotate();
      }
    } catch {
      this.currentSize = this.readCurrentSize();
    }
  }

  private rotate(): void {
    try {
      const oldest = this.withSuffix(this.maxFiles);
      if (fs.existsSync(oldest)) {
        fs.rmSync(oldest, { force: true });
      }

      for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
        const source = this.withSuffix(index);
        const target = this.withSuffix(index + 1);
        if (fs.existsSync(source)) {
          fs.renameSync(source, target);
        }
      }

      if (fs.existsSync(this.filePath)) {
        fs.renameSync(this.filePath, this.withSuffix(1));
      }

      this.currentSize = 0;
    } catch {
      this.currentSize = this.readCurrentSize();
    }
  }

  private pruneOverflowBackups(): void {
    try {
      const dir = path.dirname(this.filePath);
      const baseName = path.basename(this.filePath);
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.startsWith(`${baseName}.`)) continue;
        const suffix = Number(entry.slice(baseName.length + 1));
        if (!Number.isInteger(suffix) || suffix <= this.maxFiles) continue;
        fs.rmSync(path.join(dir, entry), { force: true });
      }
    } catch {
      return;
    }
  }

  private readCurrentSize(): number {
    try {
      return fs.statSync(this.filePath).size;
    } catch {
      return 0;
    }
  }

  private withSuffix(index: number): string {
    return `${this.filePath}.${index}`;
  }
}

export const makeTraceSink = Effect.fn("makeTraceSink")(function* (options: TraceSinkOptions) {
  const sink = new RotatingTraceFileSink({
    filePath: options.filePath,
    maxBytes: options.maxBytes,
    maxFiles: options.maxFiles,
  });

  let buffer: Array<string> = [];
  let flushTimeout: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const clearFlushTimeout = () => {
    if (flushTimeout === null) {
      return;
    }
    clearTimeout(flushTimeout);
    flushTimeout = null;
  };

  const scheduleFlush = () => {
    if (closed || flushTimeout !== null || buffer.length === 0) {
      return;
    }

    const timeout = setTimeout(() => {
      if (flushTimeout === timeout) {
        flushTimeout = null;
      }
      flushUnsafe();
    }, options.batchWindowMs);
    timeout.unref?.();
    flushTimeout = timeout;
  };

  const flushUnsafe = () => {
    clearFlushTimeout();
    if (buffer.length === 0) return;

    const chunk = buffer.join("");
    buffer = [];

    try {
      sink.write(chunk);
    } catch {
      buffer.unshift(chunk);
      scheduleFlush();
    }
  };

  const flush = Effect.sync(flushUnsafe).pipe(Effect.withTracerEnabled(false));

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      flushUnsafe();
      clearFlushTimeout();
    }).pipe(Effect.ignore),
  );

  return {
    filePath: options.filePath,
    push(record) {
      try {
        buffer.push(`${JSON.stringify(record)}\n`);
        if (buffer.length >= FLUSH_BUFFER_THRESHOLD) {
          flushUnsafe();
        } else {
          scheduleFlush();
        }
      } catch {
        return;
      }
    },
    flush,
    close: () => flush,
  } satisfies TraceSink;
});
