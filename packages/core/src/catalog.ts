import {
	type ModelCatalog,
	type ModelDescriptor,
	type ProviderId,
	type ThinkingLevel,
	ModelId,
	ModelUnavailableError,
} from "@honk/api/core/v1";

/**
 * The hardcoded v1 catalog (ADR 0016): three models, rendered by clients as
 * the four Modes (CONTEXT.md) — Rush and Deep are gpt-5.5 at low/high
 * (reasoning never turns off on the ChatGPT backend, so Rush is `low`),
 * Smart is Fable 5 at medium, Composer is composer-2.5 with the fast toggle.
 * `thinkingLevels` lists exactly the pairs we present, nothing more — a
 * deliberate catalog offers what we route and test, not what models could
 * do. Specs are pinned from pi 0.80.2 model data and the legacy Cursor
 * provider.
 */
const MODELS: ReadonlyArray<Omit<ModelDescriptor, "available">> = [
	{
		id: ModelId.make("openai-codex/gpt-5.5"),
		provider: "openai-codex",
		name: "GPT-5.5",
		reasoning: true,
		thinkingLevels: ["low", "high"],
		defaultThinkingLevel: "high",
		contextWindow: 272_000,
	},
	{
		id: ModelId.make("anthropic/claude-fable-5"),
		provider: "anthropic",
		name: "Fable 5",
		reasoning: true,
		thinkingLevels: ["medium"],
		defaultThinkingLevel: "medium",
		contextWindow: 1_000_000,
	},
	{
		id: ModelId.make("cursor/composer-2.5"),
		provider: "cursor",
		name: "Composer",
		reasoning: false,
		thinkingLevels: ["off"],
		defaultThinkingLevel: "off",
		contextWindow: 128_000,
		options: [{ id: "fast", label: "Fast", kind: "boolean", defaultValue: false }],
	},
];

export const DEFAULT_MODEL = ModelId.make("anthropic/claude-fable-5");

/** Availability is per-provider — one route each (ADR 0016); the caller supplies probe/credential state. */
export const modelCatalog = (available: Record<ProviderId, boolean>): ModelCatalog => ({
	models: MODELS.map((model) => ({ ...model, available: available[model.provider] })),
	defaultModel: DEFAULT_MODEL,
});

/** The catalog row a pinned model id names, or undefined off-catalog — the turn runner derives the Provider from this. */
export const catalogEntry = (model: ModelId): Omit<ModelDescriptor, "available"> | undefined =>
	MODELS.find((candidate) => String(candidate.id) === String(model));

/**
 * Creation-time pin resolution (grill 2026-07-02): the wire stays lenient —
 * omitted model takes the catalog default, omitted thinkingLevel the model's
 * default — and everything resolved is validated fail-closed. `available`
 * must already fold in harness-arm presence: a provider whose adapter round
 * has not landed is exactly as unavailable as one whose credential is
 * missing (both are "no-available-route"; a stale picker discovers reality
 * here, fetch-only posture). Synchronous by design — callers fail the
 * returned error into their Effect.
 */
export const resolveModelPin = (
	available: Record<ProviderId, boolean>,
	requested: { readonly model?: ModelId; readonly thinkingLevel?: ThinkingLevel },
):
	| { readonly _tag: "pinned"; readonly model: ModelId; readonly provider: ProviderId; readonly thinkingLevel: ThinkingLevel }
	| ModelUnavailableError => {
	const model = requested.model ?? DEFAULT_MODEL;
	const entry = catalogEntry(model);
	if (entry === undefined) {
		return new ModelUnavailableError({ model, reason: "unknown-model" });
	}
	const thinkingLevel = requested.thinkingLevel ?? entry.defaultThinkingLevel;
	if (!entry.thinkingLevels.includes(thinkingLevel)) {
		return new ModelUnavailableError({ model, reason: "unsupported-thinking-level" });
	}
	if (!available[entry.provider]) {
		return new ModelUnavailableError({ model, reason: "no-available-route" });
	}
	return { _tag: "pinned", model: entry.id, provider: entry.provider, thinkingLevel };
};
