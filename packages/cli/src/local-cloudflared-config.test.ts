import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupLocalCloudflaredConfiguration,
  LocalCloudflaredCleanupError,
  LocalCloudflaredMaterializationError,
  materializeLocalCloudflaredConfiguration,
  type LocalCloudflaredMaterializationOptions,
  type WindowsOwnerProtection,
} from "./local-cloudflared-config";

const directories = new Set<string>();
const accountTag = "699d98642c564d2e855e9661899b7252";
const tunnelId = "c1744f8b-faa1-48a4-9e5c-02ac921467fa";
const secondTunnelId = "6ff42ae2-765d-4adf-8112-31c55c1551ef";
const tunnelSecret = Buffer.alloc(32, 23).toString("base64");

afterEach(async () => {
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true })));
  directories.clear();
});

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "honk-local-cloudflared-test-"));
  directories.add(directory);
  return directory;
}

function materializationOptions(
  stateDirectory: string,
  overrides: Partial<LocalCloudflaredMaterializationOptions> = {},
): LocalCloudflaredMaterializationOptions {
  return {
    stateDirectory,
    platform: process.platform,
    accountTag,
    tunnelId,
    tunnelSecret,
    hostname: "desk-01.remote.honk.example",
    localOrigin: "http://127.0.0.1:4096",
    ...(process.platform === "win32" ? { protectWindowsOwnerOnly: async () => undefined } : {}),
    ...overrides,
  };
}

describe("local cloudflared configuration", () => {
  it("atomically materializes one exact loopback ingress and tunnel-scoped credentials", async () => {
    const stateDirectory = await testDirectory();
    const materialization = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory),
    );

    expect(Object.keys(materialization).sort()).toEqual([
      "configPath",
      "credentialsPath",
      "redactValues",
      "tunnelId",
    ]);
    expect(materialization).toMatchObject({
      configPath: join(stateDirectory, "managed-cloudflared", "v1", tunnelId, "config.yml"),
      credentialsPath: join(
        stateDirectory,
        "managed-cloudflared",
        "v1",
        tunnelId,
        "credentials.json",
      ),
      tunnelId,
      redactValues: [tunnelSecret],
    });
    expect(materialization.configPath).not.toContain(tunnelSecret);
    expect(materialization.credentialsPath).not.toContain(tunnelSecret);

    expect(await readFile(materialization.credentialsPath, "utf8")).toBe(
      `${JSON.stringify({
        AccountTag: accountTag,
        TunnelID: tunnelId,
        TunnelSecret: tunnelSecret,
      })}\n`,
    );
    expect(await readFile(materialization.configPath, "utf8")).toBe(
      [
        `tunnel: ${JSON.stringify(tunnelId)}`,
        `credentials-file: ${JSON.stringify(materialization.credentialsPath)}`,
        "ingress:",
        `  - hostname: ${JSON.stringify("desk-01.remote.honk.example")}`,
        `    service: ${JSON.stringify("http://127.0.0.1:4096")}`,
        `  - service: ${JSON.stringify("http_status:404")}`,
        "",
      ].join("\n"),
    );
    expect(await readdir(dirname(materialization.configPath))).toEqual([
      "config.yml",
      "credentials.json",
    ]);

    if (process.platform === "win32") return;
    expect((await stat(join(stateDirectory, "managed-cloudflared"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(stateDirectory, "managed-cloudflared", "v1"))).mode & 0o777).toBe(
      0o700,
    );
    expect((await stat(dirname(materialization.configPath))).mode & 0o777).toBe(0o700);
    expect((await stat(materialization.configPath)).mode & 0o777).toBe(0o600);
    expect((await stat(materialization.credentialsPath)).mode & 0o777).toBe(0o600);
  });

  it("accepts the exact IPv6 loopback origin", async () => {
    const stateDirectory = await testDirectory();
    const materialization = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory, {
        localOrigin: "http://[::1]:65535",
      }),
    );

    expect(await readFile(materialization.configPath, "utf8")).toContain(
      `service: ${JSON.stringify("http://[::1]:65535")}`,
    );
  });

  it("quotes generated YAML scalars when the owned state path contains spaces and markers", async () => {
    const root = await testDirectory();
    const stateDirectory = join(root, "owned state #1");
    await mkdir(stateDirectory);
    const materialization = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory),
    );

    expect(await readFile(materialization.configPath, "utf8")).toContain(
      `credentials-file: ${JSON.stringify(materialization.credentialsPath)}`,
    );
  });

  it("rejects noncanonical or unsafe allocation fields before writing", async () => {
    const invalid = [
      { accountTag: accountTag.toUpperCase() },
      { tunnelId: tunnelId.toUpperCase() },
      { tunnelSecret: Buffer.alloc(31, 23).toString("base64") },
      { tunnelSecret: `${tunnelSecret}\n` },
      { hostname: "Desk-01.remote.honk.example" },
      { hostname: "*.remote.honk.example" },
      { hostname: "remote.honk.example\nservice: http://127.0.0.1:22" },
      { hostname: "localhost" },
      { localOrigin: "http://localhost:4096" },
      { localOrigin: "http://127.0.0.2:4096" },
      { localOrigin: "http://127.0.0.1:4096/" },
      { localOrigin: "http://127.0.0.1:4096/admin" },
      { localOrigin: "http://127.0.0.1:4096?service=http://127.0.0.1:22" },
      { localOrigin: "https://127.0.0.1:4096" },
      { localOrigin: "http://127.0.0.1:0" },
      { localOrigin: "http://127.0.0.1:65536" },
    ];

    await Promise.all(
      invalid.map(async (override) => {
        const stateDirectory = await testDirectory();
        await expect(
          materializeLocalCloudflaredConfiguration(
            materializationOptions(stateDirectory, override),
          ),
        ).rejects.toMatchObject({
          name: "LocalCloudflaredMaterializationError",
          reason: "invalid_configuration",
        });
        await expect(readdir(stateDirectory)).resolves.toEqual([]);
      }),
    );
  });

  it("rejects a relative state directory before writing", async () => {
    await expect(
      materializeLocalCloudflaredConfiguration(materializationOptions("relative/state")),
    ).rejects.toEqual(new LocalCloudflaredMaterializationError("invalid_configuration"));
  });

  it("rejects a platform value that does not match the running OS", async () => {
    const stateDirectory = await testDirectory();
    const platform = process.platform === "win32" ? "linux" : "win32";

    await expect(
      materializeLocalCloudflaredConfiguration(
        materializationOptions(stateDirectory, {
          platform,
          ...(platform === "win32" ? { protectWindowsOwnerOnly: async () => undefined } : {}),
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid_configuration" });
    await expect(readdir(stateDirectory)).resolves.toEqual([]);
  });

  it("rejects a POSIX state directory writable by another account", async () => {
    if (process.platform === "win32") return;
    const stateDirectory = await testDirectory();
    await chmod(stateDirectory, 0o777);

    await expect(
      materializeLocalCloudflaredConfiguration(materializationOptions(stateDirectory)),
    ).rejects.toMatchObject({ reason: "state_directory_unavailable" });
    await expect(readdir(stateDirectory)).resolves.toEqual([]);
  });

  it("reuses only a byte-identical materialization for the same tunnel ID", async () => {
    const stateDirectory = await testDirectory();
    const options = materializationOptions(stateDirectory);
    const first = await materializeLocalCloudflaredConfiguration(options);
    const second = await materializeLocalCloudflaredConfiguration(options);

    expect(second).toEqual(first);

    await writeFile(first.configPath, "tunnel: changed\n", "utf8");
    await expect(materializeLocalCloudflaredConfiguration(options)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(await readFile(first.configPath, "utf8")).toBe("tunnel: changed\n");
  });

  it("rejects rather than replacing an existing empty tunnel directory", async () => {
    const stateDirectory = await testDirectory();
    const materialDirectory = join(stateDirectory, "managed-cloudflared", "v1", tunnelId);
    await mkdir(materialDirectory, { recursive: true, mode: 0o700 });

    await expect(
      materializeLocalCloudflaredConfiguration(materializationOptions(stateDirectory)),
    ).rejects.toMatchObject({ reason: "conflict" });
    await expect(readdir(materialDirectory)).resolves.toEqual([]);
  });

  it("rejects a byte-identical POSIX credential that was already broadly readable", async () => {
    if (process.platform === "win32") return;
    const stateDirectory = await testDirectory();
    const materialization = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory),
    );
    await chmod(materialization.credentialsPath, 0o644);

    await expect(
      materializeLocalCloudflaredConfiguration(materializationOptions(stateDirectory)),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect((await stat(materialization.credentialsPath)).mode & 0o777).toBe(0o644);
  });

  it("does not replace an existing tunnel directory when the secret changes", async () => {
    const stateDirectory = await testDirectory();
    const first = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory),
    );
    const originalCredentials = await readFile(first.credentialsPath, "utf8");

    const replacementSecret = Buffer.alloc(32, 99).toString("base64");
    const failure = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory, {
        tunnelSecret: replacementSecret,
      }),
    ).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(failure).toMatchObject({ reason: "conflict" });
    expect(String(failure)).not.toContain(replacementSecret);
    expect(await readFile(first.credentialsPath, "utf8")).toBe(originalCredentials);
  });

  it("rejects extra files in an existing tunnel material directory", async () => {
    const stateDirectory = await testDirectory();
    const materialization = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory),
    );
    await writeFile(join(dirname(materialization.configPath), "relay-config.yml"), "untrusted\n");

    await expect(
      materializeLocalCloudflaredConfiguration(materializationOptions(stateDirectory)),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(await readFile(materialization.configPath, "utf8")).toContain(
      `service: ${JSON.stringify("http://127.0.0.1:4096")}`,
    );
    await expect(
      cleanupLocalCloudflaredConfiguration({
        stateDirectory,
        platform: process.platform,
        tunnelId,
        ...(process.platform === "win32" ? { protectWindowsOwnerOnly: async () => undefined } : {}),
      }),
    ).rejects.toEqual(new LocalCloudflaredCleanupError());
    await expect(access(materialization.credentialsPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      access(join(dirname(materialization.configPath), "relay-config.yml")),
    ).resolves.toBeUndefined();
  });

  it("fails closed on Windows before writing when no ACL adapter is supplied", async () => {
    const stateDirectory = await testDirectory();

    await expect(
      materializeLocalCloudflaredConfiguration({
        stateDirectory,
        platform: "win32",
        accountTag,
        tunnelId,
        tunnelSecret,
        hostname: "desk-01.remote.honk.example",
        localOrigin: "http://127.0.0.1:4096",
      }),
    ).rejects.toMatchObject({ reason: "invalid_configuration" });
    await expect(readdir(stateDirectory)).resolves.toEqual([]);
  });

  it("protects a Windows staging directory before writing its children", async () => {
    if (process.platform !== "win32") return;
    const stateDirectory = await testDirectory();
    const calls: {
      readonly path: string;
      readonly kind: "directory" | "file";
      readonly operation: "protect" | "verify";
    }[] = [];
    const protectWindowsOwnerOnly: WindowsOwnerProtection = async (input) => {
      if (
        input.kind === "directory" &&
        input.operation === "protect" &&
        input.path.includes(".stage-")
      ) {
        expect(await readdir(input.path)).toEqual([]);
      }
      calls.push(input);
    };
    const materialization = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory, {
        platform: "win32",
        protectWindowsOwnerOnly,
      }),
    );

    const stagingDirectory = calls.find(
      (call) =>
        call.kind === "directory" && call.operation === "protect" && call.path.includes(".stage-"),
    )?.path;
    expect(stagingDirectory).toBeDefined();
    expect(
      calls
        .filter((call) => call.kind === "file" && call.operation === "protect")
        .map((call) => call.path),
    ).toEqual([
      join(stagingDirectory ?? "", "credentials.json"),
      join(stagingDirectory ?? "", "config.yml"),
    ]);
    expect(calls[0]).toEqual({
      path: stateDirectory,
      kind: "directory",
      operation: "verify",
    });
    expect(
      calls.findIndex(
        (call) =>
          call.kind === "directory" &&
          call.operation === "protect" &&
          call.path.includes(".stage-"),
      ),
    ).toBeLessThan(calls.findIndex((call) => call.kind === "file" && call.operation === "protect"));
    expect(materialization.configPath).not.toContain(".stage-");
  });

  it("removes staging credentials when owner protection fails", async () => {
    if (process.platform !== "win32") return;
    const stateDirectory = await testDirectory();
    const protectWindowsOwnerOnly: WindowsOwnerProtection = async (input) => {
      if (input.kind === "file" && input.operation === "protect") {
        throw new Error("simulated ACL failure");
      }
    };

    await expect(
      materializeLocalCloudflaredConfiguration(
        materializationOptions(stateDirectory, {
          platform: "win32",
          protectWindowsOwnerOnly,
        }),
      ),
    ).rejects.toMatchObject({ reason: "protection_failed" });
    await expect(readdir(join(stateDirectory, "managed-cloudflared", "v1"))).resolves.toEqual([]);
  });

  it("cleans only the validated tunnel directory and is idempotent", async () => {
    const stateDirectory = await testDirectory();
    const first = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory),
    );
    const second = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory, { tunnelId: secondTunnelId }),
    );

    const cleanup = {
      stateDirectory,
      platform: process.platform,
      tunnelId,
      ...(process.platform === "win32" ? { protectWindowsOwnerOnly: async () => undefined } : {}),
    };
    await cleanupLocalCloudflaredConfiguration(cleanup);
    await cleanupLocalCloudflaredConfiguration(cleanup);

    await expect(access(first.credentialsPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(first.configPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(second.credentialsPath)).resolves.toBeUndefined();
    await expect(access(second.configPath)).resolves.toBeUndefined();
  });

  it("removes a dead process's tunnel-identifiable staging credentials", async () => {
    const stateDirectory = await testDirectory();
    const versionDirectory = join(stateDirectory, "managed-cloudflared", "v1");
    const stagingDirectory = join(versionDirectory, `.${tunnelId}.stage-2147483647-orphan`);
    await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(stagingDirectory, "credentials.json"), tunnelSecret, {
      mode: 0o600,
    });

    await cleanupLocalCloudflaredConfiguration({
      stateDirectory,
      platform: process.platform,
      tunnelId,
      ...(process.platform === "win32" ? { protectWindowsOwnerOnly: async () => undefined } : {}),
    });

    await expect(access(stagingDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes cleanup with materialization for the same tunnel ID", async () => {
    const stateDirectory = await testDirectory();
    const options = materializationOptions(stateDirectory);
    const materialization = materializeLocalCloudflaredConfiguration(options);
    const cleanup = cleanupLocalCloudflaredConfiguration({
      stateDirectory,
      platform: process.platform,
      tunnelId,
      ...(process.platform === "win32" ? { protectWindowsOwnerOnly: async () => undefined } : {}),
    });

    const result = await materialization;
    await cleanup;
    await expect(access(result.credentialsPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(result.configPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not follow an unexpected material-directory symlink during cleanup", async () => {
    if (process.platform === "win32") return;
    const stateDirectory = await testDirectory();
    const materialization = await materializeLocalCloudflaredConfiguration(
      materializationOptions(stateDirectory),
    );
    await cleanupLocalCloudflaredConfiguration({
      stateDirectory,
      platform: process.platform,
      tunnelId,
    });
    const outsideDirectory = join(stateDirectory, "outside");
    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, "credentials.json"), tunnelSecret, "utf8");
    await symlink(
      outsideDirectory,
      join(stateDirectory, "managed-cloudflared", "v1", tunnelId),
      "dir",
    );

    expect(materialization.credentialsPath).not.toBe(join(outsideDirectory, "credentials.json"));
    await expect(
      cleanupLocalCloudflaredConfiguration({
        stateDirectory,
        platform: process.platform,
        tunnelId,
      }),
    ).rejects.toEqual(new LocalCloudflaredCleanupError());
    expect(await readFile(join(outsideDirectory, "credentials.json"), "utf8")).toBe(tunnelSecret);

    await expect(
      cleanupLocalCloudflaredConfiguration({
        stateDirectory: "relative/state",
        platform: process.platform,
        tunnelId,
      }),
    ).rejects.toEqual(new LocalCloudflaredCleanupError());
  });
});
