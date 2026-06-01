import { homedir } from "node:os";
import { resolve } from "node:path";

import type { ClaudeSettings } from "@multi/contracts";

import { expandHomePath } from "../path-expansion.ts";

export function resolveClaudeHomePath(config: Pick<ClaudeSettings, "homePath">): string {
  const homePath = config.homePath.trim();
  return resolve(homePath.length > 0 ? expandHomePath(homePath) : homedir());
}

export function makeClaudeEnvironment(
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (config.homePath.trim().length === 0) {
    return baseEnv;
  }
  return {
    ...baseEnv,
    HOME: resolveClaudeHomePath(config),
  };
}

export function makeClaudeCapabilitiesCacheKey(
  config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
): string {
  return `${config.binaryPath}\0${resolveClaudeHomePath(config)}`;
}
