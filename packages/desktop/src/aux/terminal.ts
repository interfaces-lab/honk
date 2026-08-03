import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";

import type { TerminalSessionSnapshot } from "@honk/shared/terminal";

import type { DesktopPtyShape } from "../backend/desktop-pty";

// Agent-facing side of the background terminal. The sidecar plugin posts here over
// the aux server; main owns the PTY, and the workbench adopts it as a normal tab.

// Enough for the agent to see what a dev server printed without flooding its context.
const STATUS_TAIL_SIZE = 8_192;

export interface DesktopAuxTerminalRunInput {
  readonly threadId: string;
  readonly command: string;
  readonly cwd?: string | undefined;
}

export interface DesktopAuxTerminalSessionInput {
  readonly threadId: string;
  readonly terminalId: string;
}

export interface DesktopAuxTerminalService {
  readonly run: (input: DesktopAuxTerminalRunInput) => Promise<TerminalSessionSnapshot>;
  readonly status: (
    input: DesktopAuxTerminalSessionInput,
  ) => Promise<TerminalSessionSnapshot | null>;
  readonly stop: (input: DesktopAuxTerminalSessionInput) => Promise<TerminalSessionSnapshot | null>;
}

export function createDesktopAuxTerminalService(options: {
  readonly pty: DesktopPtyShape;
  readonly defaultCwd: string;
  /** Tells every open window to surface the job as a terminal tab. */
  readonly notifyOpen: (request: { threadId: string; terminalId: string }) => void;
}): DesktopAuxTerminalService {
  const snapshotFor = async (
    input: DesktopAuxTerminalSessionInput,
  ): Promise<TerminalSessionSnapshot | null> => {
    const snapshot = await Effect.runPromise(
      options.pty.attach(input.terminalId, { maxHistorySize: STATUS_TAIL_SIZE }),
    );
    // A job belongs to the thread that started it; never hand one thread another's output.
    return snapshot !== null && snapshot.threadId === input.threadId ? snapshot : null;
  };

  return {
    async run(input) {
      // Main mints the id: a caller-supplied one could name and replace an existing session.
      const terminalId = `agent-${randomUUID()}`;
      const snapshot = await Effect.runPromise(
        options.pty.openBackground({
          id: terminalId,
          threadId: input.threadId,
          command: input.command,
          cwd: input.cwd ?? options.defaultCwd,
        }),
      );
      options.notifyOpen({ threadId: input.threadId, terminalId });
      return snapshot;
    },

    status: snapshotFor,

    async stop(input) {
      const snapshot = await snapshotFor(input);
      if (snapshot === null) return null;
      await Effect.runPromise(options.pty.stop(input.terminalId));
      return snapshotFor(input);
    },
  };
}
