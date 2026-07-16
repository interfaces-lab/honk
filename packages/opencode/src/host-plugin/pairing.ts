export const HONK_PRESET_STOPS = ["low", "medium", "high", "ultra"] as const;

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
}

export const HONK_MODEL_IDS = {
  sol: { providerID: "openai", id: "gpt-5.6-sol" },
  fable5: { providerID: "anthropic", id: "claude-fable-5" },
} as const;

// Main keeps judgment. Sol sidekick steps down one cost tier where possible.
export const HONK_AGENT_PAIRINGS: readonly HonkAgentPairing[] = [
  {
    stop: "low",
    main: { ...HONK_MODEL_IDS.sol, variant: "medium" },
    sidekick: { ...HONK_MODEL_IDS.sol, variant: "low" },
  },
  {
    stop: "medium",
    main: { ...HONK_MODEL_IDS.sol, variant: "high" },
    sidekick: { ...HONK_MODEL_IDS.sol, variant: "medium" },
  },
  {
    stop: "high",
    main: { ...HONK_MODEL_IDS.sol, variant: "xhigh" },
    sidekick: { ...HONK_MODEL_IDS.sol, variant: "high" },
  },
  {
    stop: "ultra",
    main: { ...HONK_MODEL_IDS.fable5, variant: "high" },
    sidekick: { ...HONK_MODEL_IDS.sol, variant: "high" },
  },
];

export function honkSidekickAgentName(stop: HonkPresetStop): string {
  return `honk-sidekick-${stop}`;
}

export function honkModelSpec(model: HonkModelArm): string {
  return `${model.providerID}/${model.id}`;
}

export function honkPairingForMain(
  model: { readonly providerID: string; readonly modelID: string } | undefined,
  variant: string | undefined,
): HonkAgentPairing | undefined {
  if (model === undefined || variant === undefined) return undefined;
  return HONK_AGENT_PAIRINGS.find(
    (pairing) =>
      pairing.main.providerID === model.providerID &&
      pairing.main.id === model.modelID &&
      pairing.main.variant === variant,
  );
}

export function honkPairingForSidekick(agent: string | undefined): HonkAgentPairing | undefined {
  if (agent === undefined) return undefined;
  return HONK_AGENT_PAIRINGS.find((pairing) => honkSidekickAgentName(pairing.stop) === agent);
}
