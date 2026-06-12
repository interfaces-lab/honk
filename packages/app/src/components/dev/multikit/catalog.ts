/**
 * Multikit component catalog — `@honk/multikit` primitives (Base UI + CVA + `honk-*` tokens).
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
        importPath: "@honk/multikit/button",
        description: "Primary action control with variant and size scales",
      },
      {
        id: "workbench-button",
        name: "Workbench Button",
        importPath: "@honk/multikit/workbench-button",
        description: "Workbench icon and text toolbar controls",
      },
      {
        id: "workbench-chrome-row",
        name: "Workbench Chrome Row",
        importPath: "@honk/multikit/workbench-chrome-row",
        description: "Workbench tool and panel row chrome",
      },
      {
        id: "sidebar",
        name: "Sidebar Item",
        importPath: "@honk/multikit/sidebar",
        description: "Ghost button wrappers for agent sidebar rows",
      },
      {
        id: "group",
        name: "Button Group",
        importPath: "@honk/multikit/group",
        description: "Joined horizontal or vertical control groups",
      },
      {
        id: "split-button",
        name: "Split Button",
        importPath: "@honk/multikit/split-button",
        description: "Primary action joined to a menu trigger",
      },
      {
        id: "toggle",
        name: "Toggle",
        importPath: "@honk/multikit/toggle",
        description: "Single pressed/unpressed button control",
      },
      {
        id: "toggle-group",
        name: "Toggle Group",
        importPath: "@honk/multikit/toggle-group",
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
        importPath: "@honk/multikit/text",
        description:
          "Semantic typography with size, tone, and weight. Used in settings and dev tools; most product UI uses text-body/text-detail utilities directly.",
      },
      {
        id: "link",
        name: "Link",
        importPath: "@honk/multikit/link",
        description: "Token-backed anchor styling",
      },
      {
        id: "code",
        name: "Code",
        importPath: "@honk/multikit/code",
        description: "Inline and block code display",
      },
      {
        id: "label",
        name: "Label",
        importPath: "@honk/multikit/label",
        description: "Accessible form label",
      },
      {
        id: "kbd",
        name: "Kbd",
        importPath: "@honk/multikit/kbd",
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
        importPath: "@honk/multikit/input",
        description: "Single-line text field",
      },
      {
        id: "input-group",
        name: "Input Group",
        importPath: "@honk/multikit/input-group",
        description: "Text field shell with addons and inline controls",
      },
      {
        id: "autocomplete",
        name: "Autocomplete",
        importPath: "@honk/multikit/autocomplete",
        description: "Text input with filtered suggestion popup",
      },
      {
        id: "combobox",
        name: "Combobox",
        importPath: "@honk/multikit/combobox",
        description: "Selectable input with listbox popup",
      },
      {
        id: "checkbox",
        name: "Checkbox",
        importPath: "@honk/multikit/checkbox",
        description: "Standalone boolean checkbox",
      },
      {
        id: "radio-group",
        name: "Radio Group",
        importPath: "@honk/multikit/radio-group",
        description: "Single-choice radio set",
      },
      {
        id: "textarea",
        name: "Textarea",
        importPath: "@honk/multikit/textarea",
        description: "Honk-line text field",
      },
      {
        id: "switch",
        name: "Switch",
        importPath: "@honk/multikit/switch",
        description: "Boolean on/off toggle",
      },
      {
        id: "select",
        name: "Select",
        importPath: "@honk/multikit/select",
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
        importPath: "@honk/multikit/badge",
        description: "Small status or tag chip",
      },
      {
        id: "icon",
        name: "Icon",
        importPath: "@honk/multikit/icon",
        description: "Central-icons sizing and tone wrapper",
      },
      {
        id: "avatar",
        name: "Avatar",
        importPath: "@honk/multikit/avatar",
        description: "User or agent identity image with fallback",
      },
      {
        id: "card",
        name: "Card",
        importPath: "@honk/multikit/card",
        description: "Framed display surface with header/body/footer slots",
      },
      {
        id: "layout",
        name: "Layout",
        importPath: "@honk/multikit/layout",
        description: "Stack, Row, Grid, and Spacer structural primitives",
      },
      {
        id: "chart",
        name: "Charts",
        importPath: "@honk/multikit/chart",
        description: "Simple bar, line, and pie chart primitives",
      },
      {
        id: "stat",
        name: "Stat",
        importPath: "@honk/multikit/stat",
        description: "Compact label/value metric display",
      },
      {
        id: "table",
        name: "Table",
        importPath: "@honk/multikit/table",
        description: "Token-backed table elements",
      },
      {
        id: "empty",
        name: "Empty",
        importPath: "@honk/multikit/empty",
        description: "Empty-state layout blocks",
      },
      {
        id: "separator",
        name: "Separator",
        importPath: "@honk/multikit/separator",
        description: "Visual divider",
      },
      {
        id: "skeleton",
        name: "Skeleton",
        importPath: "@honk/multikit/skeleton",
        description: "Loading placeholder",
      },
      {
        id: "scroll-area",
        name: "Scroll Area",
        importPath: "@honk/multikit/scroll-area",
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
        importPath: "@honk/multikit/tabs",
        description: "Segmented or underline tab navigation",
      },
      {
        id: "collapsible",
        name: "Collapsible",
        importPath: "@honk/multikit/collapsible",
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
        importPath: "@honk/multikit/dialog",
        description: "Modal dialog stack",
      },
      {
        id: "alert-dialog",
        name: "Alert Dialog",
        importPath: "@honk/multikit/alert-dialog",
        description: "Confirmation-style modal",
      },
      {
        id: "popover",
        name: "Popover",
        importPath: "@honk/multikit/popover",
        description: "Anchored floating panel",
      },
      {
        id: "tooltip",
        name: "Tooltip",
        importPath: "@honk/multikit/tooltip",
        description: "Hover/focus tooltips",
      },
      {
        id: "hover-card",
        name: "Hover Card",
        importPath: "@honk/multikit/hover-card",
        description: "Preview surface for richer hover/focus context",
      },
      {
        id: "menu",
        name: "Menu",
        importPath: "@honk/multikit/menu",
        description: "Dropdown and submenu",
      },
      {
        id: "context-menu",
        name: "Context Menu",
        importPath: "@honk/multikit/context-menu",
        description: "Right-click and long-press menu surface",
      },
      {
        id: "command",
        name: "Command",
        importPath: "@honk/multikit/command",
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
        importPath: "@honk/multikit/alert",
        description: "Inline status banner",
      },
      {
        id: "status-dot",
        name: "Status Dot",
        importPath: "@honk/multikit/status-dot",
        description: "Thread or provider state indicator",
      },
      {
        id: "spinner",
        name: "Spinner",
        importPath: "@honk/multikit/spinner",
        description: "Loading indicator",
      },
      {
        id: "toast",
        name: "Toast",
        importPath: "@honk/multikit/toast",
        description: "Toast chrome and action slots",
      },
      {
        id: "tool-call",
        name: "Tool Call",
        importPath: "@honk/multikit/tool-call",
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
