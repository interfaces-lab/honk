import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireCloudflaredExecutable,
  CLOUDFLARED_VERSION,
  CloudflaredAcquisitionError,
  CloudflaredTunnelError,
  CloudflaredTunnelTimeoutError,
  CloudflaredUnavailableError,
  managedCloudflaredExecutablePath,
  parseCloudflaredQuickTunnelUrl,
  probeCloudflaredExecutable,
  readCloudflaredTunnelRecord,
  reclaimOrphanedCloudflaredTunnel,
  resolveCloudflaredExecutable,
  resolveCloudflaredReleaseAsset,
  startCloudflaredQuickTunnel,
  writeCloudflaredTunnelRecord,
  type CloudflaredReleaseAsset,
  type CloudflaredSpawner,
} from "./tunnel";

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const nodeSpawner =
  (script: string, onSpawn?: (child: ChildProcessWithoutNullStreams) => void): CloudflaredSpawner =>
  () => {
    const child = spawn(process.execPath, ["-e", script], { stdio: "pipe" });
    onSpawn?.(child);
    return child;
  };

const testDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "honk-tunnel-test-"));
  testDirectories.push(directory);
  return directory;
};

const releaseAsset = (
  bytes: Uint8Array,
  archive: CloudflaredReleaseAsset["archive"] = "binary",
  executableBytes?: Uint8Array,
): CloudflaredReleaseAsset => ({
  url: "https://downloads.example.invalid/cloudflared?credential=private",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  archive,
  ...(executableBytes === undefined
    ? {}
    : { executableSha256: createHash("sha256").update(executableBytes).digest("hex") }),
});

const cloudflaredVersionSpawner = (
  version = CLOUDFLARED_VERSION,
  stream: "stdout" | "stderr" = "stdout",
) =>
  nodeSpawner(
    `process.${stream}.write(${JSON.stringify(`cloudflared version ${version} (built test)\n`)});`,
  );

describe("cloudflared quick tunnel parsing", () => {
  it("resolves the executable for Finder launches and Windows", () => {
    expect(
      resolveCloudflaredExecutable("darwin", (path) => path === "/opt/homebrew/bin/cloudflared"),
    ).toBe("/opt/homebrew/bin/cloudflared");
    expect(resolveCloudflaredExecutable("darwin", () => false)).toBe("cloudflared");
    expect(resolveCloudflaredExecutable("win32", () => false, "")).toBe("cloudflared.exe");
    expect(
      resolveCloudflaredExecutable(
        "linux",
        (path) => path === "/trusted/bin/cloudflared",
        "/usr/bin:/trusted/bin",
      ),
    ).toBe("/trusted/bin/cloudflared");
    expect(
      resolveCloudflaredExecutable(
        "win32",
        (path) => path === "D:\\Cloudflare\\cloudflared.exe",
        "C:\\Tools;D:\\Cloudflare",
      ),
    ).toBe("D:\\Cloudflare\\cloudflared.exe");
  });

  it("extracts only a validated trycloudflare.com origin", () => {
    expect(
      parseCloudflaredQuickTunnelUrl(
        "INF Your quick Tunnel has been created! Visit it at https://blue-bird-7.trycloudflare.com\n",
      ),
    ).toBe("https://blue-bird-7.trycloudflare.com");
    expect(
      parseCloudflaredQuickTunnelUrl("https://blue-bird-7.trycloud" + "flare.com is ready"),
    ).toBe("https://blue-bird-7.trycloudflare.com");
    expect(parseCloudflaredQuickTunnelUrl("https://trycloudflare.com.evil.example")).toBeNull();
    expect(parseCloudflaredQuickTunnelUrl("https://evil.example/trycloudflare.com")).toBeNull();
    expect(parseCloudflaredQuickTunnelUrl("waiting for an address")).toBeNull();
  });
});

describe("managed cloudflared acquisition", () => {
  it("pins official 2026.7.2 assets for supported desktop targets", () => {
    expect(CLOUDFLARED_VERSION).toBe("2026.7.2");
    expect(resolveCloudflaredReleaseAsset("darwin", "arm64")).toEqual({
      url: "https://github.com/cloudflare/cloudflared/releases/download/2026.7.2/cloudflared-darwin-arm64.tgz",
      sha256: "2086e51c61d6565781d84117a5007d0c826d03ffdc74acb91c08c167f9f8cd7c",
      archive: "tgz",
      executableSha256: "0588df58494a6cadd38b9deb6078908a5054063c80784d92fdb8d4a5f3de1c67",
    });
    expect(resolveCloudflaredReleaseAsset("darwin", "x64")).toEqual({
      url: "https://github.com/cloudflare/cloudflared/releases/download/2026.7.2/cloudflared-darwin-amd64.tgz",
      sha256: "4ee0d3b48a990a2f9b5faec5838f73ec1f400aa8e0a4864be576adfafec406cb",
      archive: "tgz",
      executableSha256: "a5afb0ba3da859da47bebc9a918d5b196bf7e4aec23589419b46356731bcc75f",
    });
    expect(resolveCloudflaredReleaseAsset("linux", "arm64")?.sha256).toBe(
      "405df476437e027fc6d18729a5a77155c0a33a6082aeee60a799a688f3052e66",
    );
    expect(resolveCloudflaredReleaseAsset("linux", "x64")?.sha256).toBe(
      "ec905ea7b7e327ff8abdde8cb64697a2152de74dbcdbf6aec9db8364eb3886cd",
    );
    expect(resolveCloudflaredReleaseAsset("win32", "x64")?.sha256).toBe(
      "cdb5d4432f6ae1595654a692a51308b69d2bf7af961f5578d9391837cf072df9",
    );
    expect(resolveCloudflaredReleaseAsset("freebsd", "x64")).toBeNull();
    expect(managedCloudflaredExecutablePath("/state", "win32", "x64")).toBe(
      join("/state", "tools", "cloudflared", "2026.7.2", "win32-x64", "cloudflared.exe"),
    );
  });

  it("prefers an explicit override without probing cache, system, or download", async () => {
    const requests: { readonly executable: string; readonly args: readonly string[] }[] = [];
    const override = join(await testDirectory(), "custom-cloudflared");
    await expect(
      acquireCloudflaredExecutable({
        stateDirectory: await testDirectory(),
        executableOverride: override,
        systemExecutable: "/system/cloudflared",
        download: async () => {
          throw new Error("download should not run");
        },
        spawner: (input) => {
          requests.push(input);
          return cloudflaredVersionSpawner()(input);
        },
      }),
    ).resolves.toBe(override);
    expect(requests).toEqual([{ executable: override, args: ["--version"] }]);
  });

  it("uses a validated managed cache offline before a system executable", async () => {
    const stateDirectory = await testDirectory();
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    const requests: { readonly executable: string; readonly args: readonly string[] }[] = [];
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(managedPath, "cached");
    await chmod(managedPath, 0o755);

    await expect(
      acquireCloudflaredExecutable({
        stateDirectory,
        platform: "linux",
        arch: "x64",
        systemExecutable: "/system/cloudflared",
        download: async () => {
          throw new Error("offline");
        },
        spawner: (input) => {
          requests.push(input);
          return cloudflaredVersionSpawner()(input);
        },
      }),
    ).resolves.toBe(managedPath);
    expect(requests).toEqual([{ executable: managedPath, args: ["--version"] }]);
  });

  it("allows a validated managed cache time for a cold platform scan", async () => {
    const stateDirectory = await testDirectory();
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(managedPath, "cached");
    await chmod(managedPath, 0o755);

    await expect(
      acquireCloudflaredExecutable({
        stateDirectory,
        platform: "linux",
        arch: "x64",
        systemExecutable: null,
        download: async () => {
          throw new Error("download should not run");
        },
        spawner: nodeSpawner(
          `setTimeout(() => process.stdout.write(${JSON.stringify(
            `cloudflared version ${CLOUDFLARED_VERSION} (built test)\n`,
          )}), 1600);`,
        ),
      }),
    ).resolves.toBe(managedPath);
  });

  it("allows the managed cache recheck under the install lock to finish", async () => {
    const stateDirectory = await testDirectory();
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    const state = { probes: 0 };
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(managedPath, "cached");
    await chmod(managedPath, 0o755);

    await expect(
      acquireCloudflaredExecutable({
        stateDirectory,
        platform: "linux",
        arch: "x64",
        systemExecutable: null,
        releaseAsset: releaseAsset(Buffer.from("unused")),
        download: async () => {
          throw new Error("download should not run");
        },
        spawner: (input) => {
          state.probes += 1;
          if (state.probes === 1) return cloudflaredVersionSpawner("2026.6.0")(input);
          return nodeSpawner(
            `setTimeout(() => process.stdout.write(${JSON.stringify(
              `cloudflared version ${CLOUDFLARED_VERSION} (built test)\n`,
            )}), 1600);`,
          )(input);
        },
      }),
    ).resolves.toBe(managedPath);
    expect(state.probes).toBe(2);
  });

  it("uses a validated system executable before downloading", async () => {
    const requests: { readonly executable: string; readonly args: readonly string[] }[] = [];
    await expect(
      acquireCloudflaredExecutable({
        stateDirectory: await testDirectory(),
        platform: "linux",
        arch: "x64",
        systemExecutable: "/usr/local/bin/cloudflared",
        download: async () => {
          throw new Error("download should not run");
        },
        spawner: (input) => {
          requests.push(input);
          return cloudflaredVersionSpawner()(input);
        },
      }),
    ).resolves.toBe("/usr/local/bin/cloudflared");
    expect(requests).toEqual([{ executable: "/usr/local/bin/cloudflared", args: ["--version"] }]);
  });

  it("rejects an override that reports a different version", async () => {
    const failure = await acquireCloudflaredExecutable({
      stateDirectory: await testDirectory(),
      executableOverride: "/custom/cloudflared",
      spawner: cloudflaredVersionSpawner(`${CLOUDFLARED_VERSION}-beta`),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    expect((failure as CloudflaredAcquisitionError).reason).toBe("override_unavailable");
    expect((failure as Error).message).toContain(CLOUDFLARED_VERSION);
    expect((failure as Error).message).not.toContain("beta");
  });

  it("rejects a relative override without resolving another executable through PATH", async () => {
    let spawned = false;
    const failure = await acquireCloudflaredExecutable({
      stateDirectory: await testDirectory(),
      executableOverride: "cloudflared",
      spawner: (input) => {
        spawned = true;
        return cloudflaredVersionSpawner()(input);
      },
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    expect((failure as CloudflaredAcquisitionError).reason).toBe("override_unavailable");
    expect(spawned).toBe(false);
  });

  it("replaces a mismatched Windows cache after rejecting a mismatched system version", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("pinned Windows cloudflared");
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "win32", "x64");
    const systemExecutable = "C:\\tools\\cloudflared.exe";
    const requests: { readonly executable: string; readonly args: readonly string[] }[] = [];
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(managedPath, "outdated Windows cloudflared");

    await expect(
      acquireCloudflaredExecutable({
        stateDirectory,
        platform: "win32",
        arch: "x64",
        systemExecutable,
        releaseAsset: releaseAsset(bytes),
        download: async () => bytes,
        spawner: (input) => {
          requests.push(input);
          if (input.executable === managedPath) {
            return cloudflaredVersionSpawner("2026.6.0")(input);
          }
          if (input.executable === systemExecutable) {
            return cloudflaredVersionSpawner("2026.5.0")(input);
          }
          return cloudflaredVersionSpawner()(input);
        },
      }),
    ).resolves.toBe(managedPath);
    await expect(readFile(managedPath, "utf8")).resolves.toBe("pinned Windows cloudflared");
    expect(requests.map((request) => request.executable)).toEqual([
      managedPath,
      systemExecutable,
      managedPath,
      expect.stringContaining(".install-"),
    ]);
  });

  it("retains an invalid cache when the staged download reports a different version", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("downloaded cloudflared");
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(managedPath, "previous invalid cache");
    await chmod(managedPath, 0o755);
    const failure = await acquireCloudflaredExecutable({
      stateDirectory,
      platform: "linux",
      arch: "x64",
      systemExecutable: null,
      releaseAsset: releaseAsset(bytes),
      download: async () => bytes,
      spawner: (input) =>
        cloudflaredVersionSpawner(
          input.executable === managedPath ? "2026.6.0" : "2026.7.1",
          "stderr",
        )(input),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    expect((failure as CloudflaredAcquisitionError).reason).toBe("validation_failed");
    await expect(readFile(managedPath, "utf8")).resolves.toBe("previous invalid cache");
    await expect(stat(`${managedPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(dirname(managedPath))).toEqual(["cloudflared"]);
  });

  it("allows a verified staged executable time for a cold platform scan", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("slow first-run cloudflared");

    await expect(
      acquireCloudflaredExecutable({
        stateDirectory,
        platform: "linux",
        arch: "x64",
        systemExecutable: null,
        releaseAsset: releaseAsset(bytes),
        download: async () => bytes,
        spawner: nodeSpawner(
          `setTimeout(() => process.stdout.write(${JSON.stringify(
            `cloudflared version ${CLOUDFLARED_VERSION} (built test)\n`,
          )}), 1600);`,
        ),
      }),
    ).resolves.toBe(managedCloudflaredExecutablePath(stateDirectory, "linux", "x64"));
  });

  it("verifies, validates, atomically installs, and reuses a binary release", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("verified cloudflared fixture");
    const requests: { readonly executable: string; readonly args: readonly string[] }[] = [];
    const state = { downloads: 0 };
    const options = {
      stateDirectory,
      platform: "linux" as const,
      arch: "x64",
      systemExecutable: null,
      releaseAsset: releaseAsset(bytes),
      download: async () => {
        state.downloads += 1;
        return bytes;
      },
      spawner: (input: { readonly executable: string; readonly args: readonly string[] }) => {
        requests.push(input);
        return cloudflaredVersionSpawner()(input);
      },
    };
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");

    await expect(acquireCloudflaredExecutable(options)).resolves.toBe(managedPath);
    await expect(readFile(managedPath)).resolves.toEqual(bytes);
    expect((await stat(managedPath)).mode & 0o111).toBe(0o111);
    expect(await readdir(dirname(managedPath))).toEqual(["cloudflared"]);
    expect(requests).toEqual([
      { executable: expect.stringContaining(".install-"), args: ["--version"] },
    ]);

    await expect(
      acquireCloudflaredExecutable({
        ...options,
        download: async () => {
          throw new Error("offline");
        },
      }),
    ).resolves.toBe(managedPath);
    expect(state.downloads).toBe(1);
    expect(requests.at(-1)).toEqual({ executable: managedPath, args: ["--version"] });
  });

  it("extracts a verified macOS archive before validation", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("not a real tgz");
    const executableBytes = Buffer.from("extracted");
    const state = { archive: "", destination: "" };
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "darwin", "arm64");

    await expect(
      acquireCloudflaredExecutable({
        stateDirectory,
        platform: "darwin",
        arch: "arm64",
        systemExecutable: null,
        releaseAsset: releaseAsset(bytes, "tgz", executableBytes),
        download: async () => bytes,
        extractArchive: async (input) => {
          state.archive = await readFile(input.archivePath, "utf8");
          state.destination = input.destinationDirectory;
          await writeFile(input.executablePath, executableBytes);
        },
        spawner: cloudflaredVersionSpawner(CLOUDFLARED_VERSION, "stderr"),
      }),
    ).resolves.toBe(managedPath);
    expect(state.archive).toBe("not a real tgz");
    expect(state.destination).toContain(".install-");
    await expect(readFile(managedPath, "utf8")).resolves.toBe("extracted");
  });

  it("rejects a macOS archive whose extracted executable has the wrong checksum", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("not a real tgz");
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "darwin", "arm64");
    const failure = await acquireCloudflaredExecutable({
      stateDirectory,
      platform: "darwin",
      arch: "arm64",
      systemExecutable: null,
      releaseAsset: releaseAsset(bytes, "tgz", Buffer.from("expected executable")),
      download: async () => bytes,
      extractArchive: async (input) => {
        await writeFile(input.executablePath, "different executable");
      },
      spawner: cloudflaredVersionSpawner(),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    expect((failure as CloudflaredAcquisitionError).reason).toBe("invalid_checksum");
    await expect(stat(managedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an invalid checksum with redacted errors and cleans installation artifacts", async () => {
    const stateDirectory = await testDirectory();
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    const secret = "private downloaded bytes";
    const failure = await acquireCloudflaredExecutable({
      stateDirectory,
      platform: "linux",
      arch: "x64",
      systemExecutable: null,
      releaseAsset: {
        ...releaseAsset(Buffer.from("different")),
        url: "https://downloads.example.invalid/cloudflared?credential=private",
      },
      download: async () => Buffer.from(secret),
      spawner: cloudflaredVersionSpawner(),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    expect((failure as CloudflaredAcquisitionError).reason).toBe("invalid_checksum");
    expect((failure as Error).message).not.toContain(secret);
    expect((failure as Error).message).not.toContain("credential");
    await expect(stat(managedPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${managedPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(dirname(managedPath))).toEqual([]);
  });

  it("rejects a download that exceeds the configured size limit", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("oversized cloudflared fixture");
    const failure = await acquireCloudflaredExecutable({
      stateDirectory,
      platform: "linux",
      arch: "x64",
      systemExecutable: null,
      releaseAsset: releaseAsset(bytes),
      download: async () => bytes,
      maxDownloadBytes: 4,
      spawner: cloudflaredVersionSpawner(),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    expect((failure as CloudflaredAcquisitionError).reason).toBe("download_failed");
    expect((failure as Error).message).not.toContain(bytes.toString());
  });

  it("deduplicates concurrent installs in one process", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("concurrent cloudflared");
    const state: {
      downloads: number;
      started: (() => void) | null;
      release: (() => void) | null;
    } = { downloads: 0, started: null, release: null };
    const started = new Promise<void>((resolve) => {
      state.started = resolve;
    });
    const options = {
      stateDirectory,
      platform: "linux" as const,
      arch: "x64",
      systemExecutable: null,
      releaseAsset: releaseAsset(bytes),
      download: async () => {
        state.downloads += 1;
        state.started?.();
        return new Promise<Uint8Array>((resolve) => {
          state.release = () => resolve(bytes);
        });
      },
      spawner: cloudflaredVersionSpawner(),
    };

    const first = acquireCloudflaredExecutable(options);
    await started;
    const second = acquireCloudflaredExecutable(options);
    expect(state.downloads).toBe(1);
    state.release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      managedCloudflaredExecutablePath(stateDirectory, "linux", "x64"),
      managedCloudflaredExecutablePath(stateDirectory, "linux", "x64"),
    ]);
    expect(state.downloads).toBe(1);
  });

  it("reclaims a stale filesystem install lock", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("stale lock cloudflared");
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(`${managedPath}.lock`, "stale");
    await utimes(`${managedPath}.lock`, new Date(0), new Date(0));

    await expect(
      acquireCloudflaredExecutable({
        stateDirectory,
        platform: "linux",
        arch: "x64",
        systemExecutable: null,
        releaseAsset: releaseAsset(bytes),
        download: async () => bytes,
        spawner: cloudflaredVersionSpawner(),
      }),
    ).resolves.toBe(managedPath);
    await expect(stat(`${managedPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("immediately reclaims a well-formed lock whose owner is dead", async () => {
    const stateDirectory = await testDirectory();
    const bytes = Buffer.from("dead owner cloudflared");
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    const lockPath = `${managedPath}.lock`;
    const checkedPids: number[] = [];
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: 9122, token: "dead-owner" }));

    await expect(
      acquireCloudflaredExecutable({
        stateDirectory,
        platform: "linux",
        arch: "x64",
        systemExecutable: null,
        releaseAsset: releaseAsset(bytes),
        download: async () => bytes,
        isProcessAlive: (pid) => {
          checkedPids.push(pid);
          return false;
        },
        spawner: cloudflaredVersionSpawner(),
      }),
    ).resolves.toBe(managedPath);
    expect(checkedPids).toEqual([9122]);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not steal a stale install lock from a live owner", async () => {
    const stateDirectory = await testDirectory();
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    const lockPath = `${managedPath}.lock`;
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: 9123, token: "live-owner" }));
    await utimes(lockPath, new Date(0), new Date(0));
    const failure = await acquireCloudflaredExecutable({
      stateDirectory,
      platform: "linux",
      arch: "x64",
      systemExecutable: null,
      releaseAsset: releaseAsset(Buffer.from("unused")),
      download: async () => {
        throw new Error("download should not run");
      },
      isProcessAlive: (pid) => pid === 9123,
      lockRetryCount: 1,
      sleep: async () => undefined,
      spawner: cloudflaredVersionSpawner(),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    expect((failure as CloudflaredAcquisitionError).reason).toBe("install_locked");
    await expect(readFile(lockPath, "utf8")).resolves.toContain("live-owner");
  });

  it("does not unlink a fresh owner that replaces the observed dead lock", async () => {
    const stateDirectory = await testDirectory();
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    const lockPath = `${managedPath}.lock`;
    const replacementOwner = JSON.stringify({ pid: 9344, token: "fresh-owner" });
    await mkdir(dirname(managedPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: 9124, token: "dead-owner" }));
    const failure = await acquireCloudflaredExecutable({
      stateDirectory,
      platform: "linux",
      arch: "x64",
      systemExecutable: null,
      releaseAsset: releaseAsset(Buffer.from("unused")),
      download: async () => {
        throw new Error("download should not run");
      },
      isProcessAlive: () => {
        unlinkSync(lockPath);
        writeFileSync(lockPath, replacementOwner, { mode: 0o600 });
        return false;
      },
      lockRetryCount: 1,
      sleep: async () => undefined,
      spawner: cloudflaredVersionSpawner(),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    expect((failure as CloudflaredAcquisitionError).reason).toBe("install_locked");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(replacementOwner);
    expect(
      (await readdir(dirname(managedPath))).filter((entry) => entry.startsWith(".reclaim-")),
    ).toEqual([]);
  });

  it("does not remove a lock file that changed owners before cleanup", async () => {
    const stateDirectory = await testDirectory();
    const managedPath = managedCloudflaredExecutablePath(stateDirectory, "linux", "x64");
    const lockPath = `${managedPath}.lock`;
    const bytes = Buffer.from("download with another owner");
    const replacementOwner = JSON.stringify({ pid: 9345, token: "replacement-owner" });
    const failure = await acquireCloudflaredExecutable({
      stateDirectory,
      platform: "linux",
      arch: "x64",
      systemExecutable: null,
      releaseAsset: releaseAsset(Buffer.from("different bytes")),
      download: async () => {
        await writeFile(lockPath, replacementOwner);
        return bytes;
      },
      spawner: cloudflaredVersionSpawner(),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredAcquisitionError);
    await expect(readFile(lockPath, "utf8")).resolves.toBe(replacementOwner);
  });
});

describe("startCloudflaredQuickTunnel", () => {
  it("uses the expected command and accepts a stderr banner split across chunks", async () => {
    const requests: { readonly executable: string; readonly args: readonly string[] }[] = [];
    const tunnel = await startCloudflaredQuickTunnel("http://127.0.0.1:3773", {
      platform: "win32",
      spawner: (input) => {
        requests.push(input);
        return nodeSpawner(
          "process.stderr.write('https://blue-bird.trycloud');" +
            "setTimeout(() => process.stderr.write('flare.com\\n'), 10);" +
            "setInterval(() => {}, 1000);",
        )(input);
      },
    });

    expect(requests).toEqual([
      {
        executable: "cloudflared.exe",
        args: ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:3773"],
      },
    ]);
    expect(tunnel).toMatchObject({
      url: "https://blue-bird.trycloudflare.com",
      hostname: "blue-bird.trycloudflare.com",
      pid: expect.any(Number),
      startedAt: expect.any(String),
    });
    await tunnel.close();
    await expect(tunnel.exited).resolves.toBeUndefined();
  });

  it("maps spawn failure and early exit to safe errors", async () => {
    await expect(
      startCloudflaredQuickTunnel("http://127.0.0.1:3773", {
        spawner: () => {
          throw new Error("ENOENT secret output");
        },
      }),
    ).rejects.toEqual(new CloudflaredUnavailableError());
    await expect(
      startCloudflaredQuickTunnel("http://127.0.0.1:3773", {
        spawner: nodeSpawner("console.error('private diagnostic'); process.exit(2);"),
      }),
    ).rejects.toEqual(new CloudflaredTunnelError());
  });

  it("kills a silent child when readiness times out", async () => {
    const state: { child: ChildProcessWithoutNullStreams | null } = { child: null };
    await expect(
      startCloudflaredQuickTunnel("http://127.0.0.1:3773", {
        readyTimeoutMs: 20,
        spawner: nodeSpawner("setInterval(() => {}, 1000);", (child) => {
          state.child = child;
        }),
      }),
    ).rejects.toEqual(new CloudflaredTunnelTimeoutError());
    if (state.child === null) throw new Error("The fake cloudflared process did not start.");
    await new Promise<void>((resolve) => state.child?.once("close", () => resolve()));
    expect(state.child.killed).toBe(true);
  });

  it("memoizes close and escalates when SIGTERM is ignored", async () => {
    const tunnel = await startCloudflaredQuickTunnel("http://127.0.0.1:3773", {
      closeGraceMs: 20,
      spawner: nodeSpawner(
        "process.on('SIGTERM', () => {});" +
          "console.error('https://stubborn-child.trycloudflare.com');" +
          "setInterval(() => {}, 1000);",
      ),
    });
    const first = tunnel.close();
    const second = tunnel.close();

    expect(first).toBe(second);
    await first;
    await expect(tunnel.exited).resolves.toBeUndefined();
  });

  it.each([
    "http://192.168.1.2:3773",
    "https://127.0.0.1:3773",
    "http://user:secret@127.0.0.1:3773",
    "http://127.0.0.1:3773/admin",
    "http://127.0.0.1:3773?token=secret",
  ])("rejects a non-loopback-only target: %s", async (target) => {
    const state = { spawned: false };
    await expect(
      startCloudflaredQuickTunnel(target, {
        spawner: () => {
          state.spawned = true;
          throw new Error("should not spawn");
        },
      }),
    ).rejects.toBeInstanceOf(CloudflaredTunnelError);
    expect(state.spawned).toBe(false);
  });

  it("never includes process output in user-facing errors", async () => {
    const secret = "private cloudflared diagnostic";
    const failure = await startCloudflaredQuickTunnel("http://127.0.0.1:3773", {
      spawner: nodeSpawner(`console.error('${secret}'); process.exit(1);`),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(CloudflaredTunnelError);
    expect((failure as Error).message).not.toContain(secret);
  });
});

describe("probeCloudflaredExecutable", () => {
  it("accepts exit zero and rejects command failures", async () => {
    await expect(
      probeCloudflaredExecutable({ spawner: nodeSpawner("process.exit(0);") }),
    ).resolves.toBeUndefined();
    await expect(
      probeCloudflaredExecutable({ spawner: nodeSpawner("process.exit(1);") }),
    ).rejects.toBeInstanceOf(CloudflaredUnavailableError);
    await expect(
      probeCloudflaredExecutable({
        spawner: () => {
          throw new Error("ENOENT");
        },
      }),
    ).rejects.toBeInstanceOf(CloudflaredUnavailableError);
  });
});

describe("cloudflared orphan reconciliation", () => {
  async function recordPath() {
    const directory = await mkdtemp(join(tmpdir(), "honk-tunnel-test-"));
    testDirectories.push(directory);
    return join(directory, "quick-tunnel.json");
  }

  it("kills a matching process and clears its record", async () => {
    const path = await recordPath();
    const startedAt = "2026-07-29T12:00:00.000Z";
    const signals: { readonly pid: number; readonly signal: NodeJS.Signals }[] = [];
    await writeCloudflaredTunnelRecord(path, {
      pid: 421,
      executable: "/opt/homebrew/bin/cloudflared",
      startedAt,
    });

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        inspect: async () => ({
          command: "/opt/homebrew/bin/cloudflared tunnel --url http://127.0.0.1:3773",
          startedAtMs: Date.parse(startedAt) + 10_000,
        }),
        kill: (pid, signal) => signals.push({ pid, signal }),
      }),
    ).resolves.toBe(true);
    expect(signals).toEqual([{ pid: 421, signal: "SIGTERM" }]);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toBeNull();
  });

  it("retains a matching process record when termination fails", async () => {
    const path = await recordPath();
    const record = {
      pid: 430,
      executable: "/opt/homebrew/bin/cloudflared",
      startedAt: "2026-07-29T12:00:00.000Z",
    };
    await writeCloudflaredTunnelRecord(path, record);

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        inspect: async () => ({
          command: `${record.executable} tunnel --url http://127.0.0.1:3773`,
          startedAtMs: Date.parse(record.startedAt),
        }),
        kill: () => {
          throw new Error("EPERM");
        },
      }),
    ).resolves.toBe(false);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toEqual(record);
  });

  it("retains the record when a live process cannot be inspected", async () => {
    const path = await recordPath();
    const record = {
      pid: 425,
      executable: "/opt/homebrew/bin/cloudflared",
      startedAt: "2026-07-29T12:00:00.000Z",
    };
    await writeCloudflaredTunnelRecord(path, record);

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        inspect: async () => {
          throw new Error("inspection unavailable");
        },
        isProcessAlive: () => true,
        kill: () => {
          throw new Error("an unverified process must not be killed");
        },
      }),
    ).resolves.toBe(false);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toEqual(record);
  });

  it("clears the record when an uninspectable process is absent", async () => {
    const path = await recordPath();
    await writeCloudflaredTunnelRecord(path, {
      pid: 426,
      executable: "/opt/homebrew/bin/cloudflared",
      startedAt: "2026-07-29T12:00:00.000Z",
    });

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        inspect: async () => null,
        isProcessAlive: () => false,
        kill: () => {
          throw new Error("an absent process must not be killed");
        },
      }),
    ).resolves.toBe(false);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toBeNull();
  });

  it("inspects a Windows process by exact path and UTC start time", async () => {
    const path = await recordPath();
    const executable = "C:\\Program Files\\Cloudflare\\cloudflared.exe";
    const startedAt = "2026-07-29T12:00:00.000Z";
    const requests: { readonly executable: string; readonly args: readonly string[] }[] = [];
    const signals: { readonly pid: number; readonly signal: NodeJS.Signals }[] = [];
    await writeCloudflaredTunnelRecord(path, { pid: 427, executable, startedAt });

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        platform: "win32",
        inspectSpawner: (input) => {
          requests.push(input);
          return nodeSpawner(
            `process.stdout.write(${JSON.stringify(
              JSON.stringify({
                path: "c:\\Program Files\\Cloudflare\\cloudflared.exe",
                startedAt,
              }),
            )});`,
          )(input);
        },
        isProcessAlive: () => {
          throw new Error("a complete inspection must not fall back to PID liveness");
        },
        kill: (pid, signal) => signals.push({ pid, signal }),
      }),
    ).resolves.toBe(true);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.executable).toMatch(/powershell\.exe$/i);
    expect(requests[0]?.args.slice(0, 4)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
    ]);
    expect(requests[0]?.args).toHaveLength(5);
    expect(requests[0]?.args.at(-1)).toContain("$targetPid = 427");
    expect(requests[0]?.args.at(-1)).not.toContain(executable);
    expect(signals).toEqual([{ pid: 427, signal: "SIGTERM" }]);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toBeNull();
  });

  it("reclaims a pre-acquisition bare Windows executable record", async () => {
    const path = await recordPath();
    const startedAt = "2026-07-29T12:00:00.000Z";
    const signals: { readonly pid: number; readonly signal: NodeJS.Signals }[] = [];
    await writeCloudflaredTunnelRecord(path, {
      pid: 431,
      executable: "cloudflared.exe",
      startedAt,
    });

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        platform: "win32",
        inspectSpawner: nodeSpawner(
          `process.stdout.write(${JSON.stringify(
            JSON.stringify({
              path: "C:\\Program Files\\Cloudflare\\cloudflared.exe",
              startedAt,
            }),
          )});`,
        ),
        kill: (pid, signal) => signals.push({ pid, signal }),
      }),
    ).resolves.toBe(true);
    expect(signals).toEqual([{ pid: 431, signal: "SIGTERM" }]);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toBeNull();
  });

  it("caps Windows inspection output before parsing it", async () => {
    const path = await recordPath();
    const record = {
      pid: 428,
      executable: "C:\\Program Files\\Cloudflare\\cloudflared.exe",
      startedAt: "2026-07-29T12:00:00.000Z",
    };
    await writeCloudflaredTunnelRecord(path, record);

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        platform: "win32",
        maxInspectionOutputBytes: 16,
        inspectSpawner: nodeSpawner(
          `process.stdout.write(${JSON.stringify(
            JSON.stringify({ path: record.executable, startedAt: record.startedAt }),
          )});`,
        ),
        isProcessAlive: () => true,
        kill: () => {
          throw new Error("a truncated inspection must not identify the process");
        },
      }),
    ).resolves.toBe(false);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toEqual(record);
  });

  it("bounds a stalled Windows inspection and retains a live process record", async () => {
    const path = await recordPath();
    const record = {
      pid: 429,
      executable: "C:\\Program Files\\Cloudflare\\cloudflared.exe",
      startedAt: "2026-07-29T12:00:00.000Z",
    };
    const state: { child: ChildProcessWithoutNullStreams | null } = { child: null };
    await writeCloudflaredTunnelRecord(path, record);

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        platform: "win32",
        inspectTimeoutMs: 20,
        inspectSpawner: nodeSpawner("setInterval(() => {}, 1000);", (child) => {
          state.child = child;
        }),
        isProcessAlive: () => true,
        kill: () => {
          throw new Error("a timed-out inspection must not identify the process");
        },
      }),
    ).resolves.toBe(false);
    if (state.child === null) throw new Error("The fake inspector process did not start.");
    await new Promise<void>((resolve) => state.child?.once("close", () => resolve()));
    expect(state.child.killed).toBe(true);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toEqual(record);
  });

  it("does not kill a wrapper whose executable name contains cloudflared", async () => {
    const path = await recordPath();
    const startedAt = "2026-07-29T12:00:00.000Z";
    const signals: NodeJS.Signals[] = [];
    await writeCloudflaredTunnelRecord(path, {
      pid: 423,
      executable: "/opt/homebrew/bin/cloudflared",
      startedAt,
    });

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        inspect: async () => ({
          command: "/usr/local/bin/my-cloudflared-wrapper.sh --url http://127.0.0.1:3773",
          startedAtMs: Date.parse(startedAt),
        }),
        kill: (_pid, signal) => signals.push(signal),
      }),
    ).resolves.toBe(false);
    expect(signals).toEqual([]);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toBeNull();
  });

  it("matches a bare cloudflared executable by basename", async () => {
    const path = await recordPath();
    const startedAt = "2026-07-29T12:00:00.000Z";
    const signals: { readonly pid: number; readonly signal: NodeJS.Signals }[] = [];
    await writeCloudflaredTunnelRecord(path, {
      pid: 424,
      executable: "/opt/homebrew/bin/cloudflared",
      startedAt,
    });

    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        inspect: async () => ({
          command: "cloudflared tunnel --url http://127.0.0.1:3773",
          startedAtMs: Date.parse(startedAt),
        }),
        kill: (pid, signal) => signals.push({ pid, signal }),
      }),
    ).resolves.toBe(true);
    expect(signals).toEqual([{ pid: 424, signal: "SIGTERM" }]);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toBeNull();
  });

  it("refuses command and start-time mismatches, clearing both records", async () => {
    const path = await recordPath();
    const record = {
      pid: 422,
      executable: "/opt/homebrew/bin/cloudflared",
      startedAt: "2026-07-29T12:00:00.000Z",
    };
    const signals: NodeJS.Signals[] = [];
    await writeCloudflaredTunnelRecord(path, record);
    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        inspect: async () => ({
          command: "/usr/bin/unrelated-process",
          startedAtMs: Date.parse(record.startedAt),
        }),
        kill: (_pid, signal) => signals.push(signal),
      }),
    ).resolves.toBe(false);
    await expect(readCloudflaredTunnelRecord(path)).resolves.toBeNull();

    await writeCloudflaredTunnelRecord(path, record);
    await expect(
      reclaimOrphanedCloudflaredTunnel(path, {
        inspect: async () => ({
          command: "/opt/homebrew/bin/cloudflared tunnel",
          startedAtMs: Date.parse(record.startedAt) + 120_000,
        }),
        kill: (_pid, signal) => signals.push(signal),
      }),
    ).resolves.toBe(false);
    expect(signals).toEqual([]);
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns false when no record exists", async () => {
    await expect(reclaimOrphanedCloudflaredTunnel(await recordPath())).resolves.toBe(false);
  });
});
