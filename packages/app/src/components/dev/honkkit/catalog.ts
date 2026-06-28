/**
 * HonkKit component catalog — `@honk/honkkit` primitives (Base UI + CVA + `honk-*` tokens).
 */

import honkKitRegistry from "../../../../../honkkit/registry.json" with { type: "json" };

export type HonkKitCategory =
  | "system"
  | "actions"
  | "typography"
  | "forms"
  | "layout"
  | "navigation"
  | "overlays"
  | "feedback"
  | "workbench-parity";

export type HonkKitComponent = {
  id: string;
  name: string;
  importPath: string;
  description: string;
};

export type HonkKitCategoryGroup = {
  id: HonkKitCategory;
  label: string;
  description: string;
  components: HonkKitComponent[];
};

type RegistryItem = {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  type: string;
};

const registryItems = new Map(
  (honkKitRegistry.items as RegistryItem[]).map((item) => [item.name, item]),
);

const specialComponents = new Map<string, HonkKitComponent>([
  [
    "honk-colors",
    {
      id: "honk-colors",
      name: "Honk Colors",
      importPath: "@honk/brand/colors",
      description: "Brand palette cards for Honk accent and neutral colors",
    },
  ],
  [
    "component-system",
    {
      id: "component-system",
      name: "Component System",
      importPath: "@honk/honkkit/*",
      description:
        "Actual HonkKit components composed against the shared token staircase and DialKit geometry controls",
    },
  ],
  [
    "workbench-parity",
    {
      id: "workbench-parity",
      name: "Workbench Parity",
      importPath: "@honk/honkkit/workbench-chrome-row",
      description:
        "DialKit spec for 35px chrome, shadow ladder, workbench typography, and motion tiers",
    },
  ],
]);

const categoryDefs: Array<{
  id: HonkKitCategory;
  label: string;
  description: string;
  componentIds: string[];
}> = [
  {
    id: "system",
    label: "System",
    description: "Token contracts and real-component composition",
    componentIds: ["honk-colors", "component-system"],
  },
  {
    id: "actions",
    label: "Actions",
    description: "Buttons and interactive chrome",
    componentIds: [
      "button",
      "workbench-button",
      "workbench-chrome-row",
      "sidebar",
      "group",
      "split-button",
      "toggle",
      "toggle-group",
    ],
  },
  {
    id: "typography",
    label: "Typography",
    description: "Text and labels",
    componentIds: ["text", "link", "code", "label", "kbd", "inline-chip"],
  },
  {
    id: "forms",
    label: "Form controls",
    description: "Inputs and toggles",
    componentIds: [
      "input",
      "input-group",
      "autocomplete",
      "combobox",
      "checkbox",
      "radio-group",
      "textarea",
      "switch",
      "select",
    ],
  },
  {
    id: "layout",
    label: "Layout & display",
    description: "Structure and static display",
    componentIds: [
      "badge",
      "icon",
      "avatar",
      "card",
      "layout",
      "chart",
      "stat",
      "table",
      "empty",
      "separator",
      "skeleton",
      "scroll-area",
    ],
  },
  {
    id: "navigation",
    label: "Navigation",
    description: "Tabs and collapsible sections",
    componentIds: ["tabs", "collapsible"],
  },
  {
    id: "overlays",
    label: "Overlays & menus",
    description: "Floating surfaces and menus",
    componentIds: [
      "dialog",
      "alert-dialog",
      "popover",
      "tooltip",
      "hover-card",
      "menu",
      "context-menu",
      "command",
    ],
  },
  {
    id: "feedback",
    label: "Feedback",
    description: "Status and alerts",
    componentIds: [
      "alert",
      "status-dot",
      "spinner",
      "toast",
      "marker",
      "conversation-status-row",
      "conversation-bubble",
      "conversation-loader",
      "conversation-collapse",
      "conversation-scroller",
      "attachment",
      "tool-call",
    ],
  },
  {
    id: "workbench-parity",
    label: "Workbench parity",
    description: "Density, shadows, motion, and typography alignment specs",
    componentIds: ["workbench-parity"],
  },
];

export const HONKKIT_CATALOG: HonkKitCategoryGroup[] = categoryDefs.map((group) => ({
  id: group.id,
  label: group.label,
  description: group.description,
  components: group.componentIds.map(resolveCatalogComponent),
}));

export const HONKKIT_COMPONENTS = HONKKIT_CATALOG.flatMap((group) => group.components);

export function findHonkKitComponent(id: string): HonkKitComponent | undefined {
  return HONKKIT_COMPONENTS.find((entry) => entry.id === id);
}

export const DEFAULT_HONKKIT_COMPONENT_ID = "button";

function resolveCatalogComponent(id: string): HonkKitComponent {
  const specialComponent = specialComponents.get(id);
  if (specialComponent) {
    return specialComponent;
  }

  const registryItem = registryItems.get(id);
  if (!registryItem) {
    throw new Error(`Missing HonkKit registry item for catalog component: ${id}`);
  }

  return {
    id,
    name: registryItem.title ?? id,
    importPath: `@honk/honkkit/${id}`,
    description: registryItem.description ?? "",
  };
}
