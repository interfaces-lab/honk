import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const ptys: Array<{
    readonly pid: number;
    readonly write: ReturnType<typeof vi.fn>;
    readonly resize: ReturnType<typeof vi.fn>;
    readonly kill: ReturnType<typeof vi.fn>;
    emitData: (data: string) => void;
  }> = [];
  const send = vi.fn();
  return {
    ptys,
    send,
    spawn: vi.fn(() => {
      const dataListeners = new Set<(data: string) => void>();
      const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
      const pty = {
        pid: 42,
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        emitData: (data: string) => dataListeners.forEach((listener) => listener(data)),
        onData: vi.fn((listener: (data: string) => void) => {
          dataListeners.add(listener);
          return { dispose: () => dataListeners.delete(listener) };
        }),
        onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
          exitListeners.add(listener);
          return { dispose: () => exitListeners.delete(listener) };
        }),
      };
      ptys.push(pty);
      return pty;
    }),
    app: {
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    window: {
      isDestroyed: () => false,
      webContents: {
        getType: () => "window",
        on: vi.fn(),
        send,
      },
    },
  };
});

vi.mock("@lydell/node-pty", () => ({ spawn: mocks.spawn }));
vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: { getAllWindows: () => [mocks.window] },
}));

import { PTY_EXIT_CHANNEL } from "../ipc/channels";
import { DesktopPty, layer } from "./desktop-pty";

beforeEach(() => {
  mocks.ptys.length = 0;
  mocks.send.mockClear();
  mocks.spawn.mockClear();
});

describe("desktop background PTY lifecycle", () => {
  it("retains output and an honest exited snapshot after agent stop", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pty = yield* DesktopPty;
        yield* pty.openBackground({
          id: "agent-job",
          threadId: "thread-1",
          command: "pnpm watch",
          cwd: process.cwd(),
        });
        mocks.ptys[0]?.emitData("ready\n");
        yield* pty.stop("agent-job");
        const snapshot = yield* pty.attach("agent-job");
        const killCount = mocks.ptys[0]?.kill.mock.calls.length;
        return { snapshot, killCount };
      }).pipe(Effect.provide(layer), Effect.scoped),
    );

    expect(result.snapshot).toMatchObject({
      terminalId: "agent-job",
      status: "exited",
      pid: null,
      history: "ready\n",
      exitCode: null,
      exitSignal: null,
    });
    expect(result.killCount).toBe(1);
    expect(mocks.send).toHaveBeenCalledWith(PTY_EXIT_CHANNEL, {
      id: "agent-job",
      code: null,
    });
  });

  it("forgets a user-closed job without broadcasting a fake exit", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pty = yield* DesktopPty;
        yield* pty.openBackground({
          id: "agent-job",
          threadId: "thread-1",
          command: "pnpm watch",
          cwd: process.cwd(),
        });
        mocks.send.mockClear();
        yield* pty.close("agent-job");
        return yield* pty.attach("agent-job");
      }).pipe(Effect.provide(layer), Effect.scoped),
    );

    expect(result).toBeNull();
    expect(mocks.send).not.toHaveBeenCalledWith(PTY_EXIT_CHANNEL, expect.anything());
  });
});
