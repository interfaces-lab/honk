// Consumed by Core Apps (desktop spawn/attach) and by the integration tests.
// The SDK must never import this package (ADR 0011).
export { type CoreAuth, type HarnessProbe, makeAuth } from "./auth";
export { claudeCodeProbe, makeClaudeHarness, type ClaudeHarnessOptions } from "./claude";
export { makeCheckpoints, type Checkpoints } from "./checkpoint";
export { cursorProbe, makeCursorHarness, type CursorHarnessOptions } from "./cursor";
export { makeCore, type Core } from "./core";
export {
  CoreDiscovery,
  claimDiscovery,
  clearDiscovery,
  clearDiscoveryIfOwn,
  probeCore,
  readDiscovery,
  writeDiscovery,
} from "./discovery";
export {
  type Harness,
  type PromptImage,
  type SteeredInput,
  type TranscriptEntry,
  type TurnContext,
} from "./harness";
export { resolveCoreHome, type CoreHome } from "./home";
export { makePiHarness, type PiHarnessOptions } from "./pi";
export { boundPort, CORE_VERSION, makeServerLayer, type ServeOptions } from "./server";
export { makeSessionAuthLayer, makeSessions, type Sessions } from "./session";
export { makeCoreBuses, sseResponse, type CoreBuses } from "./stream";
export { CoreStore, type StoredSession } from "./store";
export { makeTerminals, type Terminals } from "./terminal";
