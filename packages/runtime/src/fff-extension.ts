import { dirname } from "node:path";
import { createRequire } from "node:module";

const moduleRequire = createRequire(import.meta.url);

export function applyFffEnvironment(): void {
  process.env.PI_FFF_MODE ??= "override";
}

export function resolveFffExtensionPaths(): string[] {
  try {
    return [dirname(moduleRequire.resolve("@ff-labs/pi-fff/package.json"))];
  } catch (error) {
    console.warn(
      "[runtime] Failed to resolve @ff-labs/pi-fff; falling back to built-in search tools.",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}
