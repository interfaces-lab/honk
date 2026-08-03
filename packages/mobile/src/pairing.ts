import { parseOpenCodeConnection } from "@honk/opencode";
import { normalizeNativeOpenCodeOrigin } from "@honk/opencode/connection-native";

export { parseOpenCodeConnection };

// The native app may reach a computer on the same Wi-Fi over HTTP. Browser clients keep the shared
// HTTPS policy, so the native allowance stays at this mobile boundary.
export function normalizeRemoteOrigin(value: string): string {
  return normalizeNativeOpenCodeOrigin(value);
}
