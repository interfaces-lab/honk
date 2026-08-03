export const ALERT_SOUND_NAMES = ["ready", "chime"] as const;
export const DEFAULT_ALERT_SOUND = "ready" as const;

export type AlertSoundName = (typeof ALERT_SOUND_NAMES)[number];
export type AlertSoundSelection = AlertSoundName | "custom";

export function isAlertSoundSelection(value: unknown): value is AlertSoundSelection {
  return value === "custom" || ALERT_SOUND_NAMES.some((sound) => sound === value);
}
