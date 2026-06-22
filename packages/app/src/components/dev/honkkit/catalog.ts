/**
 * HonkKit component catalog — `@honk/honkkit` primitives (Base UI + CVA + `honk-*` tokens).
 */

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

export const HONKKIT_CATALOG: HonkKitCategoryGroup[] = [
  {
    id: "system",
    label: "System",
    description: "Token contracts and real-component composition",
    components: [
      {
        id: "component-system",
        name: "Component System",
        importPath: "@honk/honkkit/*",
        description:
          "Actual HonkKit components composed against the shared token staircase and DialKit geometry controls",
      },
    ],
  },
  {
    id: "actions",
    label: "Actions",
    description: "Buttons and interactive chrome",
    components: [
      {
        id: "button",
        name: "Button",
        importPath: "@honk/honkkit/button",
        description: "Primary action control with variant and size scales",
      },
      {
        id: "workbench-button",
        name: "Workbench Button",
        importPath: "@honk/honkkit/workbench-button",
        description: "Workbench icon and text toolbar controls",
      },
      {
        id: "workbench-chrome-row",
        name: "Workbench Chrome Row",
        importPath: "@honk/honkkit/workbench-chrome-row",
        description: "Workbench tool and panel row chrome",
      },
      {
        id: "sidebar",
        name: "Sidebar Item",
        importPath: "@honk/honkkit/sidebar",
        description: "Ghost button wrappers for agent sidebar rows",
      },
      {
        id: "group",
        name: "Button Group",
        importPath: "@honk/honkkit/group",
        description: "Joined horizontal or vertical control groups",
      },
      {
        id: "split-button",
        name: "Split Button",
        importPath: "@honk/honkkit/split-button",
        description: "Primary action joined to a menu trigger",
      },
      {
        id: "toggle",
        name: "Toggle",
        importPath: "@honk/honkkit/toggle",
        description: "Single pressed/unpressed button control",
      },
      {
        id: "toggle-group",
        name: "Toggle Group",
        importPath: "@honk/honkkit/toggle-group",
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
        importPath: "@honk/honkkit/text",
        description:
          "Semantic typography with size, tone, and weight. Used in settings and dev tools; most product UI uses text-body/text-detail utilities directly.",
      },
      {
        id: "link",
        name: "Link",
        importPath: "@honk/honkkit/link",
        description: "Token-backed anchor styling",
      },
      {
        id: "code",
        name: "Code",
        importPath: "@honk/honkkit/code",
        description: "Inline and block code display",
      },
      {
        id: "label",
        name: "Label",
        importPath: "@honk/honkkit/label",
        description: "Accessible form label",
      },
      {
        id: "kbd",
        name: "Kbd",
        importPath: "@honk/honkkit/kbd",
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
        importPath: "@honk/honkkit/input",
        description: "Single-line text field",
      },
      {
        id: "input-group",
        name: "Input Group",
        importPath: "@honk/honkkit/input-group",
        description: "Text field shell with addons and inline controls",
      },
      {
        id: "autocomplete",
        name: "Autocomplete",
        importPath: "@honk/honkkit/autocomplete",
        description: "Text input with filtered suggestion popup",
      },
      {
        id: "combobox",
        name: "Combobox",
        importPath: "@honk/honkkit/combobox",
        description: "Selectable input with listbox popup",
      },
      {
        id: "checkbox",
        name: "Checkbox",
        importPath: "@honk/honkkit/checkbox",
        description: "Standalone boolean checkbox",
      },
      {
        id: "radio-group",
        name: "Radio Group",
        importPath: "@honk/honkkit/radio-group",
        description: "Single-choice radio set",
      },
      {
        id: "textarea",
        name: "Textarea",
        importPath: "@honk/honkkit/textarea",
        description: "Honk-line text field",
      },
      {
        id: "switch",
        name: "Switch",
        importPath: "@honk/honkkit/switch",
        description: "Boolean on/off toggle",
      },
      {
        id: "select",
        name: "Select",
        importPath: "@honk/honkkit/select",
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
        importPath: "@honk/honkkit/badge",
        description: "Small status or tag chip",
      },
      {
        id: "icon",
        name: "Icon",
        importPath: "@honk/honkkit/icon",
        description: "Central-icons sizing and tone wrapper",
      },
      {
        id: "avatar",
        name: "Avatar",
        importPath: "@honk/honkkit/avatar",
        description: "User or agent identity image with fallback",
      },
      {
        id: "card",
        name: "Card",
        importPath: "@honk/honkkit/card",
        description: "Framed display surface with header/body/footer slots",
      },
      {
        id: "layout",
        name: "Layout",
        importPath: "@honk/honkkit/layout",
        description: "Stack, Row, Grid, and Spacer structural primitives",
      },
      {
        id: "chart",
        name: "Charts",
        importPath: "@honk/honkkit/chart",
        description: "Simple bar, line, and pie chart primitives",
      },
      {
        id: "stat",
        name: "Stat",
        importPath: "@honk/honkkit/stat",
        description: "Compact label/value metric display",
      },
      {
        id: "table",
        name: "Table",
        importPath: "@honk/honkkit/table",
        description: "Token-backed table elements",
      },
      {
        id: "empty",
        name: "Empty",
        importPath: "@honk/honkkit/empty",
        description: "Empty-state layout blocks",
      },
      {
        id: "separator",
        name: "Separator",
        importPath: "@honk/honkkit/separator",
        description: "Visual divider",
      },
      {
        id: "skeleton",
        name: "Skeleton",
        importPath: "@honk/honkkit/skeleton",
        description: "Loading placeholder",
      },
      {
        id: "scroll-area",
        name: "Scroll Area",
        importPath: "@honk/honkkit/scroll-area",
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
        importPath: "@honk/honkkit/tabs",
        description: "Segmented or underline tab navigation",
      },
      {
        id: "collapsible",
        name: "Collapsible",
        importPath: "@honk/honkkit/collapsible",
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
        importPath: "@honk/honkkit/dialog",
        description: "Modal dialog stack",
      },
      {
        id: "alert-dialog",
        name: "Alert Dialog",
        importPath: "@honk/honkkit/alert-dialog",
        description: "Confirmation-style modal",
      },
      {
        id: "popover",
        name: "Popover",
        importPath: "@honk/honkkit/popover",
        description: "Anchored floating panel",
      },
      {
        id: "tooltip",
        name: "Tooltip",
        importPath: "@honk/honkkit/tooltip",
        description: "Hover/focus tooltips",
      },
      {
        id: "hover-card",
        name: "Hover Card",
        importPath: "@honk/honkkit/hover-card",
        description: "Preview surface for richer hover/focus context",
      },
      {
        id: "menu",
        name: "Menu",
        importPath: "@honk/honkkit/menu",
        description: "Dropdown and submenu",
      },
      {
        id: "context-menu",
        name: "Context Menu",
        importPath: "@honk/honkkit/context-menu",
        description: "Right-click and long-press menu surface",
      },
      {
        id: "command",
        name: "Command",
        importPath: "@honk/honkkit/command",
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
        importPath: "@honk/honkkit/alert",
        description: "Inline status banner",
      },
      {
        id: "status-dot",
        name: "Status Dot",
        importPath: "@honk/honkkit/status-dot",
        description: "Thread or provider state indicator",
      },
      {
        id: "spinner",
        name: "Spinner",
        importPath: "@honk/honkkit/spinner",
        description: "Loading indicator",
      },
      {
        id: "toast",
        name: "Toast",
        importPath: "@honk/honkkit/toast",
        description: "Toast chrome and action slots",
      },
      {
        id: "tool-call",
        name: "Tool Call",
        importPath: "@honk/honkkit/tool-call",
        description: "Chat tool-call line chrome",
      },
    ],
  },
  {
    id: "workbench-parity",
    label: "Workbench parity",
    description: "Density, shadows, motion, and typography alignment specs",
    components: [
      {
        id: "workbench-parity",
        name: "Workbench Parity",
        importPath: "@honk/honkkit/workbench-chrome-row",
        description:
          "DialKit spec for 35px chrome, shadow ladder, workbench typography, and motion tiers",
      },
      {
        id: "workbench-chrome-row",
        name: "Workbench Chrome Row",
        importPath: "@honk/honkkit/workbench-chrome-row",
        description: "Workbench tool and panel row chrome",
      },
      {
        id: "workbench-button",
        name: "Workbench Button",
        importPath: "@honk/honkkit/workbench-button",
        description: "Workbench icon and text toolbar controls",
      },
    ],
  },
];

export const HONKKIT_COMPONENTS = HONKKIT_CATALOG.flatMap((group) => group.components);

export function findHonkKitComponent(id: string): HonkKitComponent | undefined {
  return HONKKIT_COMPONENTS.find((entry) => entry.id === id);
}

export const DEFAULT_HONKKIT_COMPONENT_ID = "button";
