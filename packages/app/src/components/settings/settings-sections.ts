import {
  IconArchive1,
  IconBuildingBlocks,
  IconCollaborationPointerRight,
  IconColorSwatch,
  IconSettingsGear2,
  type CentralIconBaseProps,
} from "central-icons";
import type { ComponentType } from "react";

type SettingsSectionIcon = ComponentType<CentralIconBaseProps>;

export type SettingsSectionId = "general" | "appearance" | "agents" | "skills" | "archived";

export type SettingsPreferenceDomain =
  | "application"
  | "appearance"
  | "agent-runtime"
  | "conversation-history";

export interface SettingsSectionDescriptor {
  readonly id: SettingsSectionId;
  readonly to: "/settings";
  readonly search: {
    readonly section: SettingsSectionId;
  };
  readonly label: string;
  readonly icon: SettingsSectionIcon;
  readonly domain: SettingsPreferenceDomain;
  readonly cursorPreferenceScopes: readonly string[];
}

export const SETTINGS_SECTIONS = [
  {
    id: "general",
    to: "/settings",
    search: { section: "general" },
    label: "General",
    icon: IconSettingsGear2,
    domain: "application",
    cursorPreferenceScopes: ["window", "startup", "updates", "native-chrome"],
  },
  {
    id: "appearance",
    to: "/settings",
    search: { section: "appearance" },
    label: "Appearance",
    icon: IconColorSwatch,
    domain: "appearance",
    cursorPreferenceScopes: [
      "theme",
      "glass",
      "colors",
      "fonts",
      "workbench-surfaces",
      "tool-call-density",
    ],
  },
  {
    id: "agents",
    to: "/settings",
    search: { section: "agents" },
    label: "Agents",
    icon: IconCollaborationPointerRight,
    domain: "agent-runtime",
    cursorPreferenceScopes: [
      "pi-runtime",
      "accounts",
      "agent-mode",
      "interaction-mode",
      "extension-ui",
    ],
  },
  {
    id: "skills",
    to: "/settings",
    search: { section: "skills" },
    label: "Skills, Subagents",
    icon: IconBuildingBlocks,
    domain: "agent-runtime",
    cursorPreferenceScopes: ["skills", "subagents"],
  },
  {
    id: "archived",
    to: "/settings",
    search: { section: "archived" },
    label: "Archived",
    icon: IconArchive1,
    domain: "conversation-history",
    cursorPreferenceScopes: ["history", "retention"],
  },
] as const satisfies readonly SettingsSectionDescriptor[];

export type SettingsRoutePath = (typeof SETTINGS_SECTIONS)[number]["to"];

export const DEFAULT_SETTINGS_SECTION = "general" satisfies SettingsSectionId;
export const DEFAULT_SETTINGS_ROUTE = "/settings" satisfies SettingsRoutePath;
export const DEFAULT_SETTINGS_SEARCH = {
  section: DEFAULT_SETTINGS_SECTION,
} as const;
