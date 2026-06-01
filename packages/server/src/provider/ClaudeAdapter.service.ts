/**
 * ClaudeAdapter - Claude Agent implementation of the generic provider adapter contract.
 *
 * This service owns Claude runtime/session semantics and emits canonical
 * provider runtime events. It does not perform cross-provider routing, shared
 * event fan-out, or orchestration-side reactors.
 *
 * Uses Effect `Context.Service` for dependency injection and returns the
 * shared provider-adapter error channel with `provider: "claudeAgent"` context.
 *
 * @module ClaudeAdapter
 */
import { ProviderDriverKind } from "@multi/contracts";
import { Context } from "effect";

import type { ProviderAdapterError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.service.ts";

/**
 * ClaudeAdapterShape - Service API for the Claude Agent provider adapter.
 */
export interface ClaudeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: ProviderDriverKind;
}

/**
 * ClaudeAdapter - Service tag for Claude Agent provider adapter operations.
 */
export class ClaudeAdapter extends Context.Service<ClaudeAdapter, ClaudeAdapterShape>()(
  "multi/provider/ClaudeAdapter.service",
) {}
