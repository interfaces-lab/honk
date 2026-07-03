import { Schema } from "effect";
import { ModelId } from "./id";
import { NonNegativeInt, strictDecode, TrimmedNonEmptyString } from "./primitives";

/** The three Providers, closed and hardcoded (ADR 0016). */
export const ProviderId = Schema.Literals(["anthropic", "openai-codex", "cursor"]);
export type ProviderId = typeof ProviderId.Type;

/**
 * The Harnesses a model can route to — PartOrigin minus the non-executing
 * origins. Each Provider maps to exactly one Harness (ADR 0016): anthropic →
 * claude-code, openai-codex → pi, cursor → cursor.
 */
export const HarnessId = Schema.Literals(["pi", "claude-code", "cursor"]);
export type HarnessId = typeof HarnessId.Type;

export const ThinkingLevel = Schema.Literals(["off", "low", "medium", "high", "xhigh"]);
export type ThinkingLevel = typeof ThinkingLevel.Type;

/**
 * The honk-stored credential kinds (ADR 0016). Anthropic is absent by design:
 * its auth is delegated to the local Claude Code login (subscription OAuth or
 * the user's own API key), probed via the Claude Code Harness and never
 * stored — which keeps LoginInput and LoginFlow total over this union.
 * codex-api-key was dropped from v1 (no API-key-reachable Codex model in the
 * catalog); reintroducing a kind is a core/v1 version event (ADR 0012).
 */
export const CredentialKind = Schema.Literals(["codex-oauth", "cursor-api-key"]);
export type CredentialKind = typeof CredentialKind.Type;

/** Declarative option a client renders without knowing the model (t3code lesson). */
export const ModelOption = Schema.Struct({
	id: TrimmedNonEmptyString,
	label: TrimmedNonEmptyString,
	kind: Schema.Literal("boolean"),
	defaultValue: Schema.Boolean,
});
export type ModelOption = typeof ModelOption.Type;

/**
 * Render-ready catalog entry: the picker needs zero provider knowledge.
 * `thinkingLevels` is exactly the set of pairs the catalog offers — the Mode
 * table (CONTEXT.md), not everything the model could do — and
 * `defaultThinkingLevel` is what the Core pins when creation omits one. Both
 * pin forever at creation (ADR 0014). There is no routes array: each
 * Provider has exactly one way to execute in v1 (delegated Claude Code
 * login, codex-oauth, cursor-api-key — ADR 0016), so `available` is that one
 * route's state, and a stale value only ever costs a typed rejection at
 * threads.create (fetch-only auth posture).
 */
export const ModelDescriptor = Schema.Struct({
	id: ModelId,
	provider: ProviderId,
	name: TrimmedNonEmptyString,
	description: Schema.optional(Schema.String),
	reasoning: Schema.Boolean,
	thinkingLevels: Schema.NonEmptyArray(ThinkingLevel),
	defaultThinkingLevel: ThinkingLevel,
	contextWindow: NonNegativeInt,
	available: Schema.Boolean,
	options: Schema.optional(Schema.Array(ModelOption)),
});
export type ModelDescriptor = typeof ModelDescriptor.Type;

export const ModelCatalog = Schema.Struct({
	models: Schema.Array(ModelDescriptor),
	defaultModel: ModelId,
});
export type ModelCatalog = typeof ModelCatalog.Type;

export const decodeModelDescriptor = strictDecode(ModelDescriptor);
export const decodeModelCatalog = strictDecode(ModelCatalog);
