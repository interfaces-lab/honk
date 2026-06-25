import { CommandSearchItem } from "@honk/honkkit/command";
import type { SettingsPreferenceEntry } from "~/components/settings/settings-preference-index";

function formatSettingsSearchDescription(entry: SettingsPreferenceEntry): string {
  return entry.sectionTitle !== entry.panelLabel
    ? `${entry.panelLabel} / ${entry.sectionTitle}`
    : entry.panelLabel;
}

export function SettingsSearchResults(props: {
  results: ReadonlyArray<SettingsPreferenceEntry>;
  onSelect: (entry: SettingsPreferenceEntry) => void;
}) {
  return (
    <>
      {props.results.map((entry) => (
        <CommandSearchItem
          key={entry.id}
          value={entry.id}
          onClick={() => props.onSelect(entry)}
          title={entry.title}
          description={formatSettingsSearchDescription(entry)}
        />
      ))}
    </>
  );
}
