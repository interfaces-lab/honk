/**
 * Multikit component catalog — `@multi/multikit` primitives (Base UI + CVA + `multi-*` tokens).
 */

export type MultikitCategory =
  | "actions"
  | "typography"
  | "forms"
  | "layout"
  | "navigation"
  | "overlays"
  | "feedback";

export type MultikitComponent = {
  id: string;
  name: string;
  importPath: string;
  description: string;
};

export type MultikitCategoryGroup = {
  id: MultikitCategory;
  label: string;
  description: string;
  components: MultikitComponent[];
};

export const MULTIKIT_CATALOG: MultikitCategoryGroup[] = [
  {
    id: "actions",
    label: "Actions",
    description: "Buttons and interactive chrome",
    components: [
      {
        id: "button",
        name: "Button",
        importPath: "@multi/multikit/button",
        description: "Primary action control with variant and size scales",
      },
      {
        id: "workbench-button",
        name: "Workbench Button",
        importPath: "@multi/multikit/workbench-button",
        description: "Workbench icon and text toolbar controls",
      },
      {
        id: "sidebar",
        name: "Sidebar Item",
        importPath: "@multi/multikit/sidebar",
        description: "Ghost button wrappers for agent sidebar rows",
      },
      {
        id: "group",
        name: "Button Group",
        importPath: "@multi/multikit/group",
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
        importPath: "@multi/multikit/text",
        description:
          "Semantic typography with size, tone, and weight. Used in settings and dev tools; most product UI uses text-body/text-detail utilities directly.",
      },
      {
        id: "label",
        name: "Label",
        importPath: "@multi/multikit/label",
        description: "Accessible form label",
      },
      {
        id: "kbd",
        name: "Kbd",
        importPath: "@multi/multikit/kbd",
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
        importPath: "@multi/multikit/input",
        description: "Single-line text field",
      },
      {
        id: "textarea",
        name: "Textarea",
        importPath: "@multi/multikit/textarea",
        description: "Multi-line text field",
      },
      {
        id: "switch",
        name: "Switch",
        importPath: "@multi/multikit/switch",
        description: "Boolean on/off toggle",
      },
      {
        id: "select",
        name: "Select",
        importPath: "@multi/multikit/select",
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
        importPath: "@multi/multikit/badge",
        description: "Small status or tag chip",
      },
      {
        id: "empty",
        name: "Empty",
        importPath: "@multi/multikit/empty",
        description: "Empty-state layout blocks",
      },
      {
        id: "separator",
        name: "Separator",
        importPath: "@multi/multikit/separator",
        description: "Visual divider",
      },
      {
        id: "skeleton",
        name: "Skeleton",
        importPath: "@multi/multikit/skeleton",
        description: "Loading placeholder",
      },
      {
        id: "scroll-area",
        name: "Scroll Area",
        importPath: "@multi/multikit/scroll-area",
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
        importPath: "@multi/multikit/tabs",
        description: "Segmented or underline tab navigation",
      },
      {
        id: "collapsible",
        name: "Collapsible",
        importPath: "@multi/multikit/collapsible",
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
        importPath: "@multi/multikit/dialog",
        description: "Modal dialog stack",
      },
      {
        id: "alert-dialog",
        name: "Alert Dialog",
        importPath: "@multi/multikit/alert-dialog",
        description: "Confirmation-style modal",
      },
      {
        id: "popover",
        name: "Popover",
        importPath: "@multi/multikit/popover",
        description: "Anchored floating panel",
      },
      {
        id: "tooltip",
        name: "Tooltip",
        importPath: "@multi/multikit/tooltip",
        description: "Hover/focus tooltips",
      },
      {
        id: "menu",
        name: "Menu",
        importPath: "@multi/multikit/menu",
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
        importPath: "@multi/multikit/alert",
        description: "Inline status banner",
      },
      {
        id: "status-dot",
        name: "Status Dot",
        importPath: "@multi/multikit/status-dot",
        description: "Thread or provider state indicator",
      },
      {
        id: "spinner",
        name: "Spinner",
        importPath: "@multi/multikit/spinner",
        description: "Loading indicator",
      },
    ],
  },
];

export const MULTIKIT_COMPONENTS = MULTIKIT_CATALOG.flatMap((group) => group.components);

export function findMultikitComponent(id: string): MultikitComponent | undefined {
  return MULTIKIT_COMPONENTS.find((entry) => entry.id === id);
}

export const DEFAULT_MULTIKIT_COMPONENT_ID = "button";
