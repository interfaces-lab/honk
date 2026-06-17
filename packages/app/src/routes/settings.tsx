import { createFileRoute } from "@tanstack/react-router";

import { SettingsRouteLayout } from "~/routes/-settings-route";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "~/components/settings/settings-sections";

const SETTINGS_SECTION_IDS = new Set<SettingsSectionId>(
  SETTINGS_SECTIONS.map((section) => section.id),
);

function parseSettingsSection(value: unknown): SettingsSectionId {
  return typeof value === "string" && SETTINGS_SECTION_IDS.has(value as SettingsSectionId)
    ? (value as SettingsSectionId)
    : DEFAULT_SETTINGS_SECTION;
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search) => {
    return {
      section: parseSettingsSection(search.section),
    };
  },
  component: SettingsRouteLayout,
});
