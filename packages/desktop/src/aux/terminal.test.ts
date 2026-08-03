import type { TerminalSessionSnapshot } from "@honk/shared/terminal";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { DesktopPtyShape } from "../backend/desktop-pty";
import { createDesktopAuxTerminalService } from "./terminal";

describe("desktop aux terminal service", () => {
  it("keeps terminal_status available after terminal_stop", async () => {
    let snapshot: TerminalSessionSnapshot = {
      threadId: "thread-1",
      terminalId: "agent-job",
      cwd: "/workspace",
      worktreePath: null,
      status: "running",
      pid: 42,
      history: "ready\n",
      exitCode: null,
      exitSignal: null,
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    const stop = vi.fn(() =>
      Effect.sync(() => {
        snapshot = {
          ...snapshot,
          status: "exited",
          pid: null,
          updatedAt: "2026-07-28T00:01:00.000Z",
        };
      }),
    );
    const close = vi.fn(() => Effect.void);
    const pty = {
      open: () => Effect.void,
      openBackground: () => Effect.succeed(snapshot),
      attach: () => Effect.succeed(snapshot),
      list: () => Effect.succeed([snapshot]),
      write: () => Effect.void,
      resize: () => Effect.void,
      stop,
      close,
    } satisfies DesktopPtyShape;
    const service = createDesktopAuxTerminalService({
      pty,
      defaultCwd: "/workspace",
      notifyOpen: () => {},
    });

    const stopped = await service.stop({ threadId: "thread-1", terminalId: "agent-job" });
    const status = await service.status({ threadId: "thread-1", terminalId: "agent-job" });

    expect(stopped).toMatchObject({ status: "exited", history: "ready\n" });
    expect(status).toEqual(stopped);
    expect(stop).toHaveBeenCalledWith("agent-job");
    expect(close).not.toHaveBeenCalled();
  });
});
