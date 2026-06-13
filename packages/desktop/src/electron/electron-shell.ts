import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

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
  /** Reveals an existing absolute path in the OS file manager. Returns false
   * (rather than rejecting) when the path is invalid or no longer exists, so
   * callers can surface feedback — mirrors `openExternal`. */
  readonly showItemInFolder: (path: string) => Effect.Effect<boolean>;
  readonly copyText: (text: string) => Effect.Effect<void>;
}

export class ElectronShell extends Context.Service<ElectronShell, ElectronShellShape>()(
  "honk/desktop/electron/Shell",
) {}

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
  showItemInFolder: (path) =>
    Effect.sync(() => {
      if (typeof path !== "string" || path.length === 0) {
        return false;
      }
      const resolved = expandHome(path);
      // Confine to absolute, existing paths: Electron.shell.showItemInFolder is
      // a silent no-op on a missing/relative path, so guard and report instead.
      if (!nodePath.isAbsolute(resolved) || !fs.existsSync(resolved)) {
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
