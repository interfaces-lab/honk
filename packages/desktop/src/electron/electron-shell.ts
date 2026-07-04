import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";
import { EDITORS, OpenError, type EditorId } from "@honk/shared/editor";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);
const TARGET_WITH_POSITION_PATTERN = /^(.*?):(\d+)(?::(\d+))?$/;

/** Expand a leading `~`/`~/` to the OS home dir (Electron does not). */
function expandHome(target: string): string {
  if (target === "~") {
    return os.homedir();
  }
  if (target.startsWith("~/") || target.startsWith("~\\")) {
    return nodePath.join(os.homedir(), target.slice(2));
  }
  return target;
}

export function parseSafeExternalUrl(rawUrl: unknown): Option.Option<string> {
  if (typeof rawUrl !== "string") {
    return Option.none();
  }

  try {
    const url = new URL(rawUrl);
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? Option.some(url.href) : Option.none();
  } catch {
    return Option.none();
  }
}

export interface ElectronShellShape {
  readonly openExternal: (rawUrl: unknown) => Effect.Effect<boolean>;
  readonly openInEditor: (input: {
    readonly cwd: string;
    readonly editor: EditorId;
  }) => Effect.Effect<boolean>;
  /** Reveals an existing absolute path in the OS file manager. Returns false
   * (rather than rejecting) when the path is invalid or no longer exists, so
   * callers can surface feedback — mirrors `openExternal`. */
  readonly showItemInFolder: (path: string) => Effect.Effect<boolean>;
  readonly copyText: (text: string) => Effect.Effect<void>;
}

export class ElectronShell extends Context.Service<ElectronShell, ElectronShellShape>()(
  "honk/desktop/electron/Shell",
) {}

function parseTargetPathAndPosition(target: string): {
  path: string;
  line: string | undefined;
  column: string | undefined;
} | null {
  const match = TARGET_WITH_POSITION_PATTERN.exec(target);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    path: match[1],
    line: match[2],
    column: match[3],
  };
}

function resolveCommandEditorArgs(
  editor: (typeof EDITORS)[number],
  target: string,
): ReadonlyArray<string> {
  const parsedTarget = parseTargetPathAndPosition(target);
  switch (editor.launchStyle) {
    case "direct-path":
      return [target];
    case "goto":
      return parsedTarget ? ["--goto", target] : [target];
    case "line-column": {
      if (!parsedTarget) {
        return [target];
      }
      const { path, line, column } = parsedTarget;
      return [...(line ? ["--line", line] : []), ...(column ? ["--column", column] : []), path];
    }
  }
}

function resolveEditorArgs(
  editor: (typeof EDITORS)[number],
  target: string,
): ReadonlyArray<string> {
  const baseArgs = "baseArgs" in editor ? editor.baseArgs : [];
  return [...baseArgs, ...resolveCommandEditorArgs(editor, target)];
}

function fileManagerCommandForPlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, "");
}

function resolvePathEnvironmentVariable(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? env.Path ?? env.path ?? "";
}

function resolveWindowsPathExtensions(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const rawValue = env.PATHEXT;
  const fallback = [".COM", ".EXE", ".BAT", ".CMD"];
  if (!rawValue) return fallback;

  const parsed = rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}

function resolveCommandCandidates(
  command: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (platform !== "win32") return [command];
  const extension = nodePath.extname(command);
  const normalizedExtension = extension.toUpperCase();

  if (extension.length > 0 && windowsPathExtensions.includes(normalizedExtension)) {
    const commandWithoutExtension = command.slice(0, -extension.length);
    return Array.from(
      new Set([
        command,
        `${commandWithoutExtension}${normalizedExtension}`,
        `${commandWithoutExtension}${normalizedExtension.toLowerCase()}`,
      ]),
    );
  }

  const candidates: string[] = [];
  for (const extension of windowsPathExtensions) {
    candidates.push(`${command}${extension}`);
    candidates.push(`${command}${extension.toLowerCase()}`);
  }
  return Array.from(new Set(candidates));
}

function isExecutableFile(
  filePath: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === "win32") {
      const extension = nodePath.extname(filePath);
      if (extension.length === 0) return false;
      return windowsPathExtensions.includes(extension.toUpperCase());
    }
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

function isCommandAvailable(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const windowsPathExtensions = platform === "win32" ? resolveWindowsPathExtensions(env) : [];
  const commandCandidates = resolveCommandCandidates(command, platform, windowsPathExtensions);

  if (command.includes("/") || command.includes("\\")) {
    return commandCandidates.some((candidate) =>
      isExecutableFile(candidate, platform, windowsPathExtensions),
    );
  }

  const pathValue = resolvePathEnvironmentVariable(env);
  if (pathValue.length === 0) return false;
  const pathEntries = pathValue
    .split(resolvePathDelimiter(platform))
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);

  for (const pathEntry of pathEntries) {
    for (const candidate of commandCandidates) {
      if (isExecutableFile(nodePath.join(pathEntry, candidate), platform, windowsPathExtensions)) {
        return true;
      }
    }
  }
  return false;
}

function resolveAvailableCommand(commands: ReadonlyArray<string>): string | null {
  for (const command of commands) {
    if (isCommandAvailable(command)) {
      return command;
    }
  }
  return null;
}

function resolveEditorLaunch(input: {
  readonly cwd: string;
  readonly editor: EditorId;
}): Effect.Effect<{ readonly command: string; readonly args: ReadonlyArray<string> }, OpenError> {
  const editorDef = EDITORS.find((editor) => editor.id === input.editor);
  if (!editorDef) {
    return Effect.fail(new OpenError({ message: `Unknown editor: ${input.editor}` }));
  }

  if (editorDef.commands) {
    const command = resolveAvailableCommand(editorDef.commands) ?? editorDef.commands[0];
    return Effect.succeed({
      command,
      args: resolveEditorArgs(editorDef, input.cwd),
    });
  }

  if (editorDef.id !== "file-manager") {
    return Effect.fail(new OpenError({ message: `Unsupported editor: ${input.editor}` }));
  }

  return Effect.succeed({
    command: fileManagerCommandForPlatform(process.platform),
    args: [input.cwd],
  });
}

function launchDetached(launch: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}): Effect.Effect<void, OpenError> {
  if (!isCommandAvailable(launch.command)) {
    return Effect.fail(new OpenError({ message: `Editor command not found: ${launch.command}` }));
  }

  return Effect.callback<void, OpenError>((resume) => {
    let child: ChildProcess;
    try {
      const isWin32 = process.platform === "win32";
      child = spawn(
        launch.command,
        isWin32 ? launch.args.map((arg) => `"${arg}"`) : [...launch.args],
        {
          detached: true,
          stdio: "ignore",
          shell: isWin32,
        },
      );
    } catch (cause) {
      return resume(
        Effect.fail(new OpenError({ message: "failed to spawn detached process", cause })),
      );
    }

    child.once("spawn", () => {
      child.unref();
      resume(Effect.void);
    });
    child.once("error", (cause) =>
      resume(Effect.fail(new OpenError({ message: "failed to spawn detached process", cause }))),
    );
  });
}

const make = ElectronShell.of({
  openExternal: (rawUrl) =>
    Option.match(parseSafeExternalUrl(rawUrl), {
      onNone: () => Effect.succeed(false),
      onSome: (externalUrl) =>
        Effect.promise(() =>
          Electron.shell.openExternal(externalUrl).then(
            () => true,
            () => false,
          ),
        ),
    }),
  openInEditor: (input) =>
    resolveEditorLaunch(input).pipe(
      Effect.flatMap(launchDetached),
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    ),
  showItemInFolder: (path) =>
    Effect.sync(() => {
      if (typeof path !== "string" || path.length === 0) {
        return false;
      }
      const resolved = expandHome(path);
      // Confine to absolute, existing paths: Electron.shell.showItemInFolder is
      // a silent no-op on a missing/relative path, so guard and report instead.
      if (!nodePath.isAbsolute(resolved) || !existsSync(resolved)) {
        return false;
      }
      Electron.shell.showItemInFolder(resolved);
      return true;
    }),
  copyText: (text) =>
    Effect.sync(() => {
      Electron.clipboard.writeText(text);
    }),
});

export const layer = Layer.succeed(ElectronShell, make);
