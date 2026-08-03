import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ManagedCloudflaredConfigurationError,
  ManagedCloudflaredExitError,
  ManagedCloudflaredStartError,
  ManagedCloudflaredTimeoutError,
  startManagedCloudflaredConnector,
  type ManagedCloudflaredOutput,
  type ManagedCloudflaredSpawnRequest,
  type ManagedCloudflaredSpawner,
  type ManagedCloudflaredTimers,
} from "./managed-tunnel";

const children = new Set<ChildProcessWithoutNullStreams>();
const configPath = resolve("fixtures", "managed-cloudflared.yml");
const tunnelId = "6ff42ae1-765d-4adf-8112-92a242b8f28f";

afterEach(async () => {
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("close", () => resolve());
          child.kill("SIGKILL");
        }),
    ),
  );
});

const nodeSpawner =
  (
    script: string,
    onSpawn?: (
      request: ManagedCloudflaredSpawnRequest,
      child: ChildProcessWithoutNullStreams,
    ) => void,
  ): ManagedCloudflaredSpawner =>
  (request) => {
    const child = spawn(process.execPath, ["-e", script], {
      env: request.env,
      shell: false,
      stdio: "pipe",
      windowsHide: true,
    });
    children.add(child);
    child.once("close", () => children.delete(child));
    onSpawn?.(request, child);
    return child;
  };

const manualTimers = () => {
  const scheduled: {
    readonly callback: () => void;
    readonly milliseconds: number;
    cleared: boolean;
  }[] = [];
  const timers: ManagedCloudflaredTimers = {
    setTimeout(callback, milliseconds) {
      scheduled.push({ callback, milliseconds, cleared: false });
      return scheduled.length - 1;
    },
    clearTimeout(handle) {
      const timer = typeof handle === "number" ? scheduled[handle] : undefined;
      if (timer !== undefined) timer.cleared = true;
    },
  };
  return { timers, scheduled };
};

describe("managed cloudflared connector", () => {
  it("rejects an invalid local configuration before spawning", () => {
    let spawned = false;

    expect(() =>
      startManagedCloudflaredConnector({
        executable: "cloudflared",
        configPath,
        tunnelId,
        spawner: () => {
          spawned = true;
          throw new Error("must not spawn");
        },
      }),
    ).toThrow(new ManagedCloudflaredConfigurationError());
    expect(() =>
      startManagedCloudflaredConnector({
        executable: "/managed/cloudflared",
        configPath: "relative/config.yml",
        tunnelId,
        spawner: () => {
          spawned = true;
          throw new Error("must not spawn");
        },
      }),
    ).toThrow(new ManagedCloudflaredConfigurationError());
    expect(() =>
      startManagedCloudflaredConnector({
        executable: "/managed/cloudflared",
        configPath,
        tunnelId: "not-a-tunnel-uuid",
        spawner: () => {
          spawned = true;
          throw new Error("must not spawn");
        },
      }),
    ).toThrow(new ManagedCloudflaredConfigurationError());
    expect(spawned).toBe(false);
  });

  it("uses the pinned local config command and reports sanitized output", async () => {
    const credential = "cloudflare-tunnel-secret";
    const requests: ManagedCloudflaredSpawnRequest[] = [];
    const output: ManagedCloudflaredOutput[] = [];
    const startedAt = Date.UTC(2026, 6, 30, 16, 30);
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared",
      configPath,
      tunnelId,
      redactValues: [credential],
      now: () => startedAt,
      onOutput: (event) => output.push(event),
      spawner: nodeSpawner(
        [
          "process.on('SIGTERM', () => process.exit(0));",
          `process.stdout.write(${JSON.stringify(`DBG credential=${credential}\n`)});`,
          `process.stderr.write(${JSON.stringify(`WRN retry credential=${credential}\n`)});`,
          "process.stderr.write('INF Regist');",
          "setTimeout(() => {",
          "process.stderr.write('ered tunnel connection connIndex=0\\n');",
          "setInterval(() => {}, 1000);",
          "}, 10);",
        ].join(""),
        (request) => requests.push(request),
      ),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      executable: "/managed/cloudflared",
      args: [
        "tunnel",
        "--no-autoupdate",
        "--loglevel",
        "info",
        "--transport-loglevel",
        "info",
        "--metrics",
        "127.0.0.1:0",
        "--config",
        configPath,
        "run",
        tunnelId,
      ],
      shell: false,
      stdio: "pipe",
      windowsHide: true,
    });
    expect(requests[0]?.args).not.toContain(credential);
    expect(requests[0]?.env.PATH).toBe(process.env.PATH);
    expect(requests[0]?.env.TUNNEL_TOKEN).toBeUndefined();
    expect(requests[0]?.env.TUNNEL_CRED_CONTENTS).toBeUndefined();
    expect(connector.connected).toBe(false);
    await connector.ready;
    expect(output.map((event) => event.level)).toEqual(["debug", "warning", "connected"]);
    expect(output.map((event) => event.message).join("\n")).not.toContain(credential);
    expect(output[0]?.message).toContain("[credential redacted]");
    expect(connector).toMatchObject({
      pid: expect.any(Number),
      startedAt: new Date(startedAt).toISOString(),
      connected: true,
    });

    const firstClose = connector.close();
    const secondClose = connector.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    await expect(connector.exited).resolves.toEqual({ exitCode: 0, signal: null });
    expect(connector.connected).toBe(false);
  });

  it("removes ambient cloudflared controls and pins safe process flags", async () => {
    const previous = {
      TUNNEL_CRED_CONTENTS: process.env.TUNNEL_CRED_CONTENTS,
      TUNNEL_LOGFILE: process.env.TUNNEL_LOGFILE,
      TUNNEL_LOGLEVEL: process.env.TUNNEL_LOGLEVEL,
      TUNNEL_METRICS: process.env.TUNNEL_METRICS,
      TUNNEL_TRACE_OUTPUT: process.env.TUNNEL_TRACE_OUTPUT,
    };
    process.env.TUNNEL_CRED_CONTENTS = "ambient-credential";
    process.env.TUNNEL_LOGFILE = "/tmp/unsafe-cloudflared.log";
    process.env.TUNNEL_LOGLEVEL = "debug";
    process.env.TUNNEL_METRICS = "0.0.0.0:20241";
    process.env.TUNNEL_TRACE_OUTPUT = "/tmp/unsafe-cloudflared.trace";
    const requests: ManagedCloudflaredSpawnRequest[] = [];

    try {
      const connector = startManagedCloudflaredConnector({
        executable: "/managed/cloudflared",
        configPath,
        tunnelId,
        spawner: nodeSpawner(
          [
            "process.on('SIGTERM', () => process.exit(0));",
            "process.stdout.write('Registered tunnel connection\\n');",
            "setInterval(() => {}, 1000);",
          ].join(""),
          (request) => requests.push(request),
        ),
      });
      await connector.ready;
      await connector.close();
    } finally {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
          return;
        }
        process.env[key] = value;
      });
    }

    expect(
      Object.keys(requests[0]?.env ?? {}).filter((key) => key.toUpperCase().startsWith("TUNNEL_")),
    ).toEqual([]);
    expect(requests[0]?.args).toEqual([
      "tunnel",
      "--no-autoupdate",
      "--loglevel",
      "info",
      "--transport-loglevel",
      "info",
      "--metrics",
      "127.0.0.1:0",
      "--config",
      configPath,
      "run",
      tunnelId,
    ]);
  });

  it("drops an overlong line instead of retaining or forwarding it", async () => {
    const credential = "never-forward-this-credential";
    const output: ManagedCloudflaredOutput[] = [];
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared",
      configPath,
      tunnelId,
      redactValues: [credential],
      onOutput: (event) => output.push(event),
      spawner: nodeSpawner(
        [
          "process.on('SIGTERM', () => process.exit(0));",
          `process.stdout.write('x'.repeat(70000) + ${JSON.stringify(credential)} + '\\n');`,
          "process.stdout.write('Registered tunnel connection\\n');",
          "setInterval(() => {}, 1000);",
        ].join(""),
      ),
    });

    await connector.ready;
    expect(output[0]).toEqual({
      level: "debug",
      stream: "stdout",
      message: "[cloudflared output omitted]",
    });
    expect(output.map((event) => event.message).join("\n")).not.toContain(credential);
    expect(Math.max(...output.map((event) => event.message.length))).toBeLessThanOrEqual(64 * 1024);
    await connector.close();
  });

  it("lets the owner close the child while readiness is pending", async () => {
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared",
      configPath,
      tunnelId,
      spawner: nodeSpawner(
        "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
      ),
    });

    expect(connector.connected).toBe(false);
    const closing = connector.close();
    await expect(connector.ready).rejects.toBeInstanceOf(ManagedCloudflaredExitError);
    await closing;
  });

  it("replaces a spawner error without retaining its secret-bearing message", () => {
    const credential = "secret-in-spawn-error";
    const requests: ManagedCloudflaredSpawnRequest[] = [];
    const failure = (() => {
      try {
        return startManagedCloudflaredConnector({
          executable: "/managed/cloudflared",
          configPath,
          tunnelId,
          redactValues: [credential],
          spawner: (input) => {
            requests.push(input);
            throw new Error(`failed with ${credential}`);
          },
        });
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(ManagedCloudflaredStartError);
    expect(String(failure)).not.toContain(credential);
    expect((failure as Error).stack).not.toContain(credential);
    expect(requests[0]?.args).not.toContain(credential);
    expect(requests[0]?.env.TUNNEL_TOKEN).toBeUndefined();
    expect(requests[0]?.env.TUNNEL_CRED_CONTENTS).toBeUndefined();
  });

  it("returns a typed, sanitized error when the child exits before readiness", async () => {
    const credential = "secret-before-exit";
    const output: ManagedCloudflaredOutput[] = [];
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared",
      configPath,
      tunnelId,
      redactValues: [credential],
      onOutput: (event) => output.push(event),
      spawner: nodeSpawner(
        `process.stderr.write(${JSON.stringify(`ERR credential=${credential}`)}); process.exit(23);`,
      ),
    });
    const failure = await connector.ready.then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ManagedCloudflaredExitError);
    expect(failure).toMatchObject({ exitCode: 23, signal: null });
    expect(String(failure)).not.toContain(credential);
    expect(output).toEqual([
      {
        level: "warning",
        stream: "stderr",
        message: "ERR credential=[credential redacted]",
      },
    ]);
  });

  it("waits for inherited output pipes to drain before readiness rejects", async () => {
    const output: ManagedCloudflaredOutput[] = [];
    const trailingMessage = "ERR trailing diagnostic";
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared",
      configPath,
      tunnelId,
      onOutput: (event) => output.push(event),
      spawner: nodeSpawner(
        [
          "const { spawn } = require('node:child_process');",
          "spawn(process.execPath, ['-e', ",
          JSON.stringify(
            `setTimeout(() => process.stderr.write(${JSON.stringify(trailingMessage)}), 25);`,
          ),
          "], { stdio: ['ignore', 'ignore', 'inherit'] });",
          "process.exit(17);",
        ].join(""),
      ),
    });

    await expect(connector.ready).rejects.toMatchObject({
      exitCode: 17,
      signal: null,
    });
    await expect(connector.exited).resolves.toEqual({ exitCode: 17, signal: null });
    expect(output).toEqual([
      {
        level: "warning",
        stream: "stderr",
        message: trailingMessage,
      },
    ]);
  });

  it("uses the injected readiness timer and closes a timed-out child", async () => {
    const time = manualTimers();
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared",
      configPath,
      tunnelId,
      readyTimeoutMs: 123,
      closeGraceMs: 456,
      timers: time.timers,
      spawner: nodeSpawner(
        "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
      ),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const state = { closed: false };
    void connector.exited.then(() => {
      state.closed = true;
    });

    expect(time.scheduled[0]?.milliseconds).toBe(123);
    time.scheduled[0]?.callback();
    await expect(connector.ready).rejects.toEqual(new ManagedCloudflaredTimeoutError());
    expect(state.closed).toBe(true);
    expect(time.scheduled.some((timer) => timer.milliseconds === 456)).toBe(true);
  });

  it("escalates an idempotent close when the child ignores SIGTERM", async () => {
    const time = manualTimers();
    const signals: (number | NodeJS.Signals | undefined)[] = [];
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared",
      configPath,
      tunnelId,
      closeGraceMs: 75,
      platform: "darwin",
      timers: time.timers,
      spawner: nodeSpawner(
        [
          "process.stdout.write('Registered tunnel connection\\n');",
          "setInterval(() => {}, 1000);",
        ].join(""),
        (_request, child) => {
          const kill = child.kill.bind(child);
          child.kill = (signal?: number | NodeJS.Signals) => {
            signals.push(signal);
            return signal === "SIGKILL" ? kill(signal) : true;
          };
        },
      ),
    });

    await connector.ready;
    const closing = connector.close();
    expect(connector.close()).toBe(closing);
    const escalation = time.scheduled.find((timer) => !timer.cleared && timer.milliseconds === 75);
    expect(escalation).toBeDefined();
    escalation?.callback();
    await closing;
    await expect(connector.exited).resolves.toEqual({ exitCode: null, signal: "SIGKILL" });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(connector.connected).toBe(false);
  });

  it("force closes immediately on Windows without scheduling a grace timer", async () => {
    const time = manualTimers();
    const signals: (number | NodeJS.Signals | undefined)[] = [];
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared.exe",
      configPath,
      tunnelId,
      closeGraceMs: 75,
      platform: "win32",
      timers: time.timers,
      spawner: nodeSpawner(
        [
          "process.stdout.write('Registered tunnel connection\\n');",
          "setInterval(() => {}, 1000);",
        ].join(""),
        (_request, child) => {
          const kill = child.kill.bind(child);
          child.kill = (signal?: number | NodeJS.Signals) => {
            signals.push(signal);
            return kill(signal);
          };
        },
      ),
    });

    await connector.ready;
    await connector.close();
    expect(signals).toEqual(["SIGKILL"]);
    expect(time.scheduled.some((timer) => timer.milliseconds === 75)).toBe(false);
  });

  it("ignores failures from the sanitized output callback", async () => {
    const connector = startManagedCloudflaredConnector({
      executable: "/managed/cloudflared",
      configPath,
      tunnelId,
      onOutput: () => {
        throw new Error("logging failed");
      },
      spawner: nodeSpawner(
        [
          "process.on('SIGTERM', () => process.exit(0));",
          "process.stdout.write('Registered tunnel connection\\n');",
          "setInterval(() => {}, 1000);",
        ].join(""),
      ),
    });

    await connector.ready;
    expect(connector.connected).toBe(true);
    await connector.close();
  });
});
