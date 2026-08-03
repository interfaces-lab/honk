export const HONK_PRESET_STOPS = ["low", "medium", "high", "ultra", "claw"] as const;

export type HonkPresetStop = (typeof HONK_PRESET_STOPS)[number];

export interface HonkModelArm {
  readonly providerID: string;
  readonly id: string;
  readonly variant: string;
}

export interface HonkAgentPairing {
  readonly stop: HonkPresetStop;
  readonly main: HonkModelArm;
  readonly sidekick: HonkModelArm;
  // Task mode when the main doesn't choose one: sync keeps the main reviewing
  // each scoped result; claw defaults async so the orchestrator keeps orchestrating.
  readonly defaultBackground: boolean;
}

// Claude arms route through the claude-code plugin provider, which spawns the local
// `claude` CLI and bills against whatever that CLI is logged into. Honk never holds
// an Anthropic credential of its own.
export const HONK_MODEL_IDS = {
  sol: { providerID: "openai", id: "gpt-5.6-sol" },
  luna: { providerID: "openai", id: "gpt-5.6-luna" },
  // OpenCode materializes Fast as a separate model whose options set the priority service tier;
  // reasoning effort remains an independent variant on the prompt.
  solFast: { providerID: "openai", id: "gpt-5.6-sol-fast" },
  fable5: { providerID: "claude-code", id: "claude-fable-5" },
  opus5: { providerID: "claude-code", id: "claude-opus-5" },
  opus5Fast: { providerID: "claude-code", id: "claude-opus-5-fast" },
  glm: { providerID: "opencode-go", id: "glm-5.2" },
  kimi: { providerID: "opencode-go", id: "kimi-k3" },
} as const;

// OpenCode stores model prices in USD per million tokens. Fast Opus is billed at
// twice the standard Opus rate; prompt-cache multipliers apply to that Fast base.
export const HONK_CLAUDE_MODEL_COSTS = {
  fable5: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  opus5: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  opus5Fast: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
} as const;

// Fable 5, wherever it appears, takes the orchestrator (main) seat. The max
// variant is reserved for explicit single-model picks, so the Fusion ladder
// tops out at xhigh.
export const HONK_AGENT_PAIRINGS: readonly HonkAgentPairing[] = [
  {
    stop: "low",
    main: { ...HONK_MODEL_IDS.sol, variant: "high" },
    sidekick: { ...HONK_MODEL_IDS.glm, variant: "medium" },
    defaultBackground: false,
  },
  {
    stop: "medium",
    main: { ...HONK_MODEL_IDS.sol, variant: "high" },
    sidekick: { ...HONK_MODEL_IDS.sol, variant: "medium" },
    defaultBackground: false,
  },
  {
    stop: "high",
    main: { ...HONK_MODEL_IDS.fable5, variant: "high" },
    sidekick: { ...HONK_MODEL_IDS.sol, variant: "xhigh" },
    defaultBackground: false,
  },
  {
    stop: "ultra",
    main: { ...HONK_MODEL_IDS.fable5, variant: "xhigh" },
    sidekick: { ...HONK_MODEL_IDS.sol, variant: "xhigh" },
    defaultBackground: false,
  },
  // Claw is the all-Anthropic tier: Fable orchestrates and hands work to Opus
  // far more aggressively than the other stops (see the claw main directive).
  {
    stop: "claw",
    main: { ...HONK_MODEL_IDS.fable5, variant: "xhigh" },
    sidekick: { ...HONK_MODEL_IDS.opus5, variant: "high" },
    defaultBackground: true,
  },
];

export function honkSidekickAgentName(stop: HonkPresetStop): string {
  return `honk-sidekick-${stop}`;
}

// Fusion intent rides the agent name (ADR 0001): stops can share a main model
// (low and medium both run Sol high), so the name must carry the stop itself.
export function honkFusionAgentName(stop: HonkPresetStop): string {
  return `honk-build-fusion-${stop}`;
}

export function honkModelSpec(model: { readonly providerID: string; readonly id: string }): string {
  return `${model.providerID}/${model.id}`;
}

export function honkPairingForFusionAgent(agent: string | undefined): HonkAgentPairing | undefined {
  if (agent === undefined) return undefined;
  return HONK_AGENT_PAIRINGS.find((pairing) => honkFusionAgentName(pairing.stop) === agent);
}

export function honkPairingForSidekick(agent: string | undefined): HonkAgentPairing | undefined {
  if (agent === undefined) return undefined;
  return HONK_AGENT_PAIRINGS.find((pairing) => honkSidekickAgentName(pairing.stop) === agent);
}
