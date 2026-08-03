import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const wrapper = fileURLToPath(new URL("./claude-fast-wrapper.sh", import.meta.url));
const windowsWrapper = fileURLToPath(new URL("./claude-fast-wrapper.cmd", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "honk-claude-fast-"));
const fakeClaude = join(directory, "claude");
const fakeWindowsDirectory = join(directory, "claude path");
const fakeWindowsClaude = join(fakeWindowsDirectory, "claude.cmd");
const run = promisify(execFile);

beforeAll(async () => {
  await writeFile(fakeClaude, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n');
  await chmod(fakeClaude, 0o755);
  await mkdir(fakeWindowsDirectory);
  await writeFile(
    fakeWindowsClaude,
    [
      "@echo off",
      'if "%~1"=="--version" (',
      '  if "%HONK_FAKE_CLAUDE_VERSION%"=="probe-fails" exit /b 7',
      "  echo %HONK_FAKE_CLAUDE_VERSION%",
      "  exit /b 0",
      ")",
      ":print_args",
      'if "%~1"=="" goto done',
      "echo(%~1",
      "shift",
      "goto print_args",
      ":done",
      "exit /b %HONK_FAKE_CLAUDE_EXIT_CODE%",
      "",
    ].join("\r\n"),
  );
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function wrappedCliArguments(args: readonly string[]): Promise<string[]> {
  const result = await run("bash", [wrapper, ...args], {
    env: { ...process.env, HONK_CLAUDE_CLI_PATH: fakeClaude },
  });
  return result.stdout.trim().split("\n");
}

async function wrappedArguments(model: string): Promise<string[]> {
  return wrappedCliArguments(["--model", model, "--verbose"]);
}

describe.runIf(process.platform !== "win32")("Claude Fast wrapper", () => {
  it("leaves non-model probes untouched", async () => {
    expect(await wrappedCliArguments(["--version"])).toEqual(["--version"]);
  });

  it("replaces Claude's base prompt with Pi's default and preserves OpenCode's append", async () => {
    expect(
      await wrappedCliArguments([
        "--print",
        "--model",
        "claude-fable-5",
        "--append-system-prompt-file",
        "/tmp/opencode-system.md",
      ]),
    ).toEqual([
      "--print",
      "--model",
      "claude-fable-5",
      "--append-system-prompt-file",
      "/tmp/opencode-system.md",
      "--system-prompt",
      "You are a helpful assistant.",
    ]);
  });

  it("maps virtual Fast Opus to Opus with per-session Fast settings", async () => {
    expect(await wrappedArguments("claude-opus-5-fast")).toEqual([
      "--model",
      "claude-opus-5",
      "--verbose",
      "--settings",
      '{"fastMode":true}',
      "--system-prompt",
      "You are a helpful assistant.",
    ]);
  });

  it("explicitly keeps standard Opus out of ambient Fast mode", async () => {
    expect(await wrappedArguments("claude-opus-5")).toEqual([
      "--model",
      "claude-opus-5",
      "--verbose",
      "--settings",
      '{"fastMode":false}',
      "--system-prompt",
      "You are a helpful assistant.",
    ]);
  });

  it("leaves models without Fast support unchanged", async () => {
    expect(await wrappedArguments("claude-fable-5")).toEqual([
      "--model",
      "claude-fable-5",
      "--verbose",
      "--system-prompt",
      "You are a helpful assistant.",
    ]);
  });
});

async function runWindowsWrapper(
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_DISABLE_THINKING: "0",
    CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "0",
    // Plugin 0.12.0 injects this default into the wrapper's child environment.
    CLAUDE_CODE_SHOW_THINKING_SUMMARIES: "1",
    HONK_CLAUDE_CLI_PATH: fakeWindowsClaude,
    HONK_FAKE_CLAUDE_EXIT_CODE: "0",
    HONK_FAKE_CLAUDE_VERSION: "2.1.142",
  };
  Object.assign(childEnv, env);

  return await new Promise((resolve, reject) => {
    const child = spawn(windowsWrapper, [...args], { env: childEnv, shell: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function outputArguments(stdout: string): string[] {
  return stdout.trim().split(/\r?\n/);
}

function withoutSystemPrompt(args: readonly string[]): string[] {
  const index = args.indexOf("--system-prompt");
  return index === -1 ? [...args] : [...args.slice(0, index), ...args.slice(index + 2)];
}

describe.runIf(process.platform === "win32")("Claude Fast Windows wrapper", () => {
  it("maps Fast and standard Opus while preserving explicit session settings", async () => {
    expect(
      outputArguments(
        (await runWindowsWrapper(["--print", "--model", "claude-opus-5-fast"])).stdout,
      ),
    ).toEqual([
      "--print",
      "--model",
      "claude-opus-5",
      "--settings",
      '{"fastMode":true}',
      "--system-prompt",
      "You are a helpful assistant.",
      "--thinking",
      "enabled",
      "--thinking-display",
      "summarized",
    ]);
    expect(
      outputArguments((await runWindowsWrapper(["--print", "--model", "claude-opus-5"])).stdout),
    ).toContain('{"fastMode":false}');
  });

  it.each([
    ["1.9.9", []],
    ["2.0.0", ["--thinking", "enabled"]],
    ["2.1.141", ["--thinking", "enabled"]],
    ["2.1.142", ["--thinking", "enabled", "--thinking-display", "summarized"]],
  ])("matches the plugin flags at Claude CLI %s", async (version, expected) => {
    const result = await runWindowsWrapper(["--print", "--model", "claude-fable-5"], {
      HONK_FAKE_CLAUDE_VERSION: version,
    });
    expect(result.code).toBe(0);
    expect(withoutSystemPrompt(outputArguments(result.stdout)).slice(3)).toEqual(expected);
  });

  it.each(["CLAUDE_CODE_DISABLE_THINKING", "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING"])(
    "respects %s",
    async (variable) => {
      const result = await runWindowsWrapper(["--print", "--model", "claude-fable-5"], {
        [variable]: "1",
      });
      expect(outputArguments(result.stdout)).not.toContain("--thinking");
      expect(outputArguments(result.stdout)).not.toContain("--thinking-display");
    },
  );

  it("respects the thinking-summary environment override", async () => {
    const result = await runWindowsWrapper(["--print", "--model", "claude-fable-5"], {
      CLAUDE_CODE_SHOW_THINKING_SUMMARIES: "0",
    });
    expect(outputArguments(result.stdout)).toContain("--thinking");
    expect(outputArguments(result.stdout)).not.toContain("--thinking-display");
  });

  it("does not duplicate flags supplied by the plugin", async () => {
    const result = await runWindowsWrapper([
      "--print",
      "--model",
      "claude-fable-5",
      "--thinking",
      "enabled",
      "--thinking-display",
      "summarized",
    ]);
    expect(
      outputArguments(result.stdout).filter((argument) => argument === "--thinking"),
    ).toHaveLength(1);
    expect(
      outputArguments(result.stdout).filter((argument) => argument === "--thinking-display"),
    ).toHaveLength(1);
  });

  it("continues without gated flags when the version probe fails", async () => {
    const result = await runWindowsWrapper(["--print", "--model", "claude-fable-5"], {
      HONK_FAKE_CLAUDE_VERSION: "probe-fails",
    });
    expect(result.code).toBe(0);
    expect(outputArguments(result.stdout)).toEqual([
      "--print",
      "--model",
      "claude-fable-5",
      "--system-prompt",
      "You are a helpful assistant.",
    ]);
  });

  it("propagates the Claude exit code", async () => {
    const result = await runWindowsWrapper(["--model", "claude-fable-5"], {
      HONK_FAKE_CLAUDE_EXIT_CODE: "9",
    });
    expect(result.code).toBe(9);
  });
});
