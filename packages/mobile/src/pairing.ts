import { normalizeRemoteOpenCodeOrigin, parseOpenCodeConnection } from "@honk/opencode";

export { parseOpenCodeConnection };

export function normalizeRemoteOrigin(value: string): string {
  return normalizeRemoteOpenCodeOrigin(value);
}
