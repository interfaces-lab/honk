/**
 * Tomeito component catalog — `@multi/ui` primitives (Base UI + CVA + `multi-*` tokens).
 */

export type TomeitoCategory =
  | "actions"
  | "typography"
  | "forms"
  | "layout"
  | "navigation"
  | "overlays"
  | "feedback";

export type TomeitoComponent = {
  id: string;
  name: string;
  importPath: string;
  description: string;
};

export type TomeitoCategoryGroup = {
  id: TomeitoCategory;
  label: string;
  description: string;
  components: TomeitoComponent[];
};

export const TOMETO_CATALOG: TomeitoCategoryGroup[] = [
  {
    id: "actions",
    label: "Actions",
    description: "Buttons and interactive chrome",
    components: [
      {
        id: "button",
        name: "Button",
        importPath: "@multi/ui/button",
        description: "Primary action control with variant and size scales",
      },
      {
        id: "workbench-button",
        name: "Workbench Button",
        importPath: "@multi/ui/workbench-button",
        description: "Workbench icon and text toolbar controls",
      },
      {
        id: "sidebar",
        name: "Sidebar Item",
        importPath: "@multi/ui/sidebar",
        description: "Ghost button wrappers for agent sidebar rows",
      },
      {
        id: "group",
        name: "Button Group",
        importPath: "@multi/ui/group",
        description: "Joined horizontal or vertical control groups",
      },
    ],
  },
  {
    id: "typography",
    label: "Typography",
    description: "Text and labels",
    components: [
      {
        id: "text",
        name: "Text",
        importPath: "@multi/ui/text",
        description:
          "Semantic typography with size, tone, and weight. Used in settings and dev tools; most product UI uses text-body/text-detail utilities directly.",
      },
      {
        id: "label",
        name: "Label",
        importPath: "@multi/ui/label",
        description: "Accessible form label",
      },
      {
        id: "kbd",
        name: "Kbd",
        importPath: "@multi/ui/kbd",
        description: "Keyboard shortcut styling",
      },
    ],
  },
  {
    id: "forms",
    label: "Form controls",
    description: "Inputs and toggles",
    components: [
      {
        id: "input",
        name: "Input",
        importPath: "@multi/ui/input",
        description: "Single-line text field",
      },
      {
        id: "textarea",
        name: "Textarea",
        importPath: "@multi/ui/textarea",
        description: "Multi-line text field",
      },
      {
        id: "switch",
        name: "Switch",
        importPath: "@multi/ui/switch",
        description: "Boolean on/off toggle",
      },
      {
        id: "select",
        name: "Select",
        importPath: "@multi/ui/select",
        description: "Dropdown select with SimpleSelect convenience API",
      },
    ],
  },
  {
    id: "layout",
    label: "Layout & display",
    description: "Structure and static display",
    components: [
      {
        id: "badge",
        name: "Badge",
        importPath: "@multi/ui/badge",
        description: "Small status or tag chip",
      },
      {
        id: "empty",
        name: "Empty",
        importPath: "@multi/ui/empty",
        description: "Empty-state layout blocks",
      },
      {
        id: "separator",
        name: "Separator",
        importPath: "@multi/ui/separator",
        description: "Visual divider",
      },
      {
        id: "skeleton",
        name: "Skeleton",
        importPath: "@multi/ui/skeleton",
        description: "Loading placeholder",
      },
      {
        id: "scroll-area",
        name: "Scroll Area",
        importPath: "@multi/ui/scroll-area",
        description: "Custom scroll container",
      },
    ],
  },
  {
    id: "navigation",
    label: "Navigation",
    description: "Tabs and collapsible sections",
    components: [
      {
        id: "tabs",
        name: "Tabs",
        importPath: "@multi/ui/tabs",
        description: "Segmented or underline tab navigation",
      },
      {
        id: "collapsible",
        name: "Collapsible",
        importPath: "@multi/ui/collapsible",
        description: "Expand/collapse section",
      },
    ],
  },
  {
    id: "overlays",
    label: "Overlays & menus",
    description: "Floating surfaces and menus",
    components: [
      {
        id: "dialog",
        name: "Dialog",
        importPath: "@multi/ui/dialog",
        description: "Modal dialog stack",
      },
      {
        id: "alert-dialog",
        name: "Alert Dialog",
        importPath: "@multi/ui/alert-dialog",
        description: "Confirmation-style modal",
      },
      {
        id: "popover",
        name: "Popover",
        importPath: "@multi/ui/popover",
        description: "Anchored floating panel",
      },
      {
        id: "tooltip",
        name: "Tooltip",
        importPath: "@multi/ui/tooltip",
        description: "Hover/focus tooltips",
      },
      {
        id: "menu",
        name: "Menu",
        importPath: "@multi/ui/menu",
        description: "Dropdown and submenu",
      },
    ],
  },
  {
    id: "feedback",
    label: "Feedback",
    description: "Status and alerts",
    components: [
      {
        id: "alert",
        name: "Alert",
        importPath: "@multi/ui/alert",
        description: "Inline status banner",
      },
      {
        id: "status-dot",
        name: "Status Dot",
        importPath: "@multi/ui/status-dot",
        description: "Thread or provider state indicator",
      },
      {
        id: "spinner",
        name: "Spinner",
        importPath: "@multi/ui/spinner",
        description: "Loading indicator",
      },
    ],
  },
];

export const TOMETO_COMPONENTS = TOMETO_CATALOG.flatMap((group) => group.components);

export function findTomeitoComponent(id: string): TomeitoComponent | undefined {
  return TOMETO_COMPONENTS.find((entry) => entry.id === id);
}

export const DEFAULT_TOMETO_COMPONENT_ID = "button";
