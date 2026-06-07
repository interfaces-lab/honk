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
        id: "workbench-chrome-row",
        name: "Workbench Chrome Row",
        importPath: "@multi/multikit/workbench-chrome-row",
        description: "Workbench tool and panel row chrome",
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
      {
        id: "split-button",
        name: "Split Button",
        importPath: "@multi/multikit/split-button",
        description: "Primary action joined to a menu trigger",
      },
      {
        id: "toggle",
        name: "Toggle",
        importPath: "@multi/multikit/toggle",
        description: "Single pressed/unpressed button control",
      },
      {
        id: "toggle-group",
        name: "Toggle Group",
        importPath: "@multi/multikit/toggle-group",
        description: "Grouped one-or-many toggle controls",
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
        id: "link",
        name: "Link",
        importPath: "@multi/multikit/link",
        description: "Token-backed anchor styling",
      },
      {
        id: "code",
        name: "Code",
        importPath: "@multi/multikit/code",
        description: "Inline and block code display",
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
        id: "input-group",
        name: "Input Group",
        importPath: "@multi/multikit/input-group",
        description: "Text field shell with addons and inline controls",
      },
      {
        id: "autocomplete",
        name: "Autocomplete",
        importPath: "@multi/multikit/autocomplete",
        description: "Text input with filtered suggestion popup",
      },
      {
        id: "combobox",
        name: "Combobox",
        importPath: "@multi/multikit/combobox",
        description: "Selectable input with listbox popup",
      },
      {
        id: "checkbox",
        name: "Checkbox",
        importPath: "@multi/multikit/checkbox",
        description: "Standalone boolean checkbox",
      },
      {
        id: "radio-group",
        name: "Radio Group",
        importPath: "@multi/multikit/radio-group",
        description: "Single-choice radio set",
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
        id: "icon",
        name: "Icon",
        importPath: "@multi/multikit/icon",
        description: "Central-icons sizing and tone wrapper",
      },
      {
        id: "avatar",
        name: "Avatar",
        importPath: "@multi/multikit/avatar",
        description: "User or agent identity image with fallback",
      },
      {
        id: "card",
        name: "Card",
        importPath: "@multi/multikit/card",
        description: "Framed display surface with header/body/footer slots",
      },
      {
        id: "layout",
        name: "Layout",
        importPath: "@multi/multikit/layout",
        description: "Stack, Row, Grid, and Spacer structural primitives",
      },
      {
        id: "chart",
        name: "Charts",
        importPath: "@multi/multikit/chart",
        description: "Simple bar, line, and pie chart primitives",
      },
      {
        id: "stat",
        name: "Stat",
        importPath: "@multi/multikit/stat",
        description: "Compact label/value metric display",
      },
      {
        id: "table",
        name: "Table",
        importPath: "@multi/multikit/table",
        description: "Token-backed table elements",
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
        id: "hover-card",
        name: "Hover Card",
        importPath: "@multi/multikit/hover-card",
        description: "Preview surface for richer hover/focus context",
      },
      {
        id: "menu",
        name: "Menu",
        importPath: "@multi/multikit/menu",
        description: "Dropdown and submenu",
      },
      {
        id: "context-menu",
        name: "Context Menu",
        importPath: "@multi/multikit/context-menu",
        description: "Right-click and long-press menu surface",
      },
      {
        id: "command",
        name: "Command",
        importPath: "@multi/multikit/command",
        description: "Command palette and composer command list primitives",
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
      {
        id: "toast",
        name: "Toast",
        importPath: "@multi/multikit/toast",
        description: "Toast chrome and action slots",
      },
      {
        id: "tool-call",
        name: "Tool Call",
        importPath: "@multi/multikit/tool-call",
        description: "Chat tool-call line chrome",
      },
    ],
  },
];

export const MULTIKIT_COMPONENTS = MULTIKIT_CATALOG.flatMap((group) => group.components);

export function findMultikitComponent(id: string): MultikitComponent | undefined {
  return MULTIKIT_COMPONENTS.find((entry) => entry.id === id);
}

export const DEFAULT_MULTIKIT_COMPONENT_ID = "button";
