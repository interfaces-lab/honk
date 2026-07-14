// The curated glyph set — @honk/ui's window onto central-icons. The raw pack
// (@central-icons-react/round-outlined-radius-2-stroke-1.5) ships 2041 glyphs; @app only draws a
// small reviewed subset. This module re-exports that subset under the pack names so the rewrite
// imports its icons from @honk/ui — one curated, reviewed surface — instead
// of reaching into the 2041-glyph pack ad hoc. Adding a new glyph to the app becomes a deliberate
// edit here, not a fresh deep import buried in a feature file.
//
// Names are the pack's own (no renaming): the central-icons vocabulary is the established
// spelling across the codebase, and inventing semantic aliases (IconSend, IconDelete…) would be
// bespoke jargon that drifts from the source. The CATEGORIES below are ours, though — grouped by
// what each glyph actually DOES in production (from the usage map), not by how its name is spelt,
// so a reader can find "the copy icon" by function.
//
// A pure re-export leaf: NO logic, NO styles, NO effects (ADR 0025). The only value this file
// mints is ICON_CATALOG, a plain data description of the grouping so the dev gallery can render
// the set from data. Rendering, sizing, and tone all belong to <Icon> (./icon.tsx); here we only
// name and group the glyph components.

import type { Glyph } from "./icon";
import {
  IconArchive1,
  IconArrowUp,
  IconBarsThree,
  IconBranch,
  IconBrowserTabs,
  IconBubbleQuestion,
  IconBuildingBlocks,
  IconCheckmark1,
  IconChanges,
  IconChevronDoubleLeft,
  IconChevronDoubleRight,
  IconChevronDownMedium,
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconCircleCheck,
  IconClawd,
  IconClipboard,
  IconConsole,
  IconConsoleSimple,
  IconCrossMedium,
  IconCrossMediumDefault,
  IconCrossSmall,
  IconDotGrid1x3Horizontal,
  IconExclamationCircle,
  IconEyeOpen,
  IconFileBend,
  IconFiles,
  IconFilter2,
  IconFolder1,
  IconFolderAddRight,
  IconFolderOpen,
  IconGlobe,
  IconHome,
  IconLayoutSidebar,
  IconMagnifyingGlass,
  IconOpenaiCodex,
  IconPencilLine,
  IconPin,
  IconPlusSmall,
  IconSettingsGear2,
  IconSidebarSimpleRightWide,
  IconStepBack,
  IconSummary,
  IconTrashCan,
  IconUnpin,
} from "central-icons";

// ── Re-export surface, grouped by production function ────────────────────────────────────────
// Each `export` block below is one category; the section comment says what the glyphs do in the
// app. This is the surface consumers deep-import ("@honk/ui/icons"). ICON_CATALOG at the bottom
// mirrors these exact groups, in this exact order — the two are kept in lockstep by hand (a name
// can't be in an export block without a catalog row, or the gallery would silently miss it).

// Navigation & disclosure — moving through content: expanding a row (right/down), stepping back
// through history (left / revert).
export {
  IconChevronRightMedium,
  IconChevronDownMedium,
  IconChevronLeftMedium,
  IconChevronDoubleLeft,
  IconChevronDoubleRight,
  IconStepBack,
};

// Files & folders — the filesystem vocabulary: a closed/open/new folder, a files placeholder, a
// single file.
export { IconFolder1, IconFolderOpen, IconFolderAddRight, IconFiles, IconFileBend };

// Content actions — acting on the thing in front of you: edit, delete, copy, accept, send a
// message (arrow-up), add/new (+), preview.
export {
  IconPencilLine,
  IconTrashCan,
  IconClipboard,
  IconCheckmark1,
  IconArrowUp,
  IconPlusSmall,
  IconEyeOpen,
};

// Triage & thread state — organizing threads in the sidebar: pin, unpin, archive.
export { IconPin, IconUnpin, IconArchive1 };

// Close & dismiss — the × family, one per weight: small (chips, tabs), medium (thread item), and
// the filled default variant (attachments, banners, terminal rail).
export { IconCrossSmall, IconCrossMedium, IconCrossMediumDefault };

// Status & feedback — glyphs that report a state: a success node, an error/alert, and an
// ask/prompt bubble. (A summary is a view, not a state — it lives under Workspace & chrome.)
export { IconCircleCheck, IconExclamationCircle, IconBubbleQuestion };

// Model providers — identity glyphs used by the composer's model selector.
export { IconClawd, IconOpenaiCodex };

// Workspace & chrome — the surrounding tooling and views: menu and overflow handles, the browser
// and terminal surfaces, the Home anchor, settings, skills/blocks, git branch, the workbench panel
// toggle, a summary view, plus search and filter.
export {
  IconBarsThree,
  IconDotGrid1x3Horizontal,
  IconBrowserTabs,
  IconConsole,
  IconConsoleSimple,
  IconGlobe,
  IconChanges,
  IconHome,
  IconSettingsGear2,
  IconBuildingBlocks,
  IconBranch,
  IconLayoutSidebar,
  IconSidebarSimpleRightWide,
  IconSummary,
  IconMagnifyingGlass,
  IconFilter2,
};

// ── ICON_CATALOG — the grouping as data ──────────────────────────────────────────────────────
// One row per category, each carrying its glyphs as [name, component] pairs. The dev gallery maps
// over this to render every glyph under its category header; any future "icon picker" reads the
// same structure. Category set, order, and membership match the re-export blocks above exactly —
// this is the machine-readable copy of that taxonomy.

// The shape of one catalog section. Exported so a consumer (e.g. the gallery) can type a section
// prop without re-deriving it.
interface IconCatalogSection {
  readonly category: string;
  // [name, glyph]: the pack name (for the label) paired with the component (for <Icon icon=…>).
  readonly glyphs: readonly (readonly [name: string, glyph: Glyph])[];
}

const ICON_CATALOG: readonly IconCatalogSection[] = [
  {
    category: "Navigation & disclosure",
    glyphs: [
      ["IconChevronRightMedium", IconChevronRightMedium],
      ["IconChevronDownMedium", IconChevronDownMedium],
      ["IconChevronLeftMedium", IconChevronLeftMedium],
      ["IconChevronDoubleLeft", IconChevronDoubleLeft],
      ["IconChevronDoubleRight", IconChevronDoubleRight],
      ["IconStepBack", IconStepBack],
    ],
  },
  {
    category: "Files & folders",
    glyphs: [
      ["IconFolder1", IconFolder1],
      ["IconFolderOpen", IconFolderOpen],
      ["IconFolderAddRight", IconFolderAddRight],
      ["IconFiles", IconFiles],
      ["IconFileBend", IconFileBend],
    ],
  },
  {
    category: "Content actions",
    glyphs: [
      ["IconPencilLine", IconPencilLine],
      ["IconTrashCan", IconTrashCan],
      ["IconClipboard", IconClipboard],
      ["IconCheckmark1", IconCheckmark1],
      ["IconArrowUp", IconArrowUp],
      ["IconPlusSmall", IconPlusSmall],
      ["IconEyeOpen", IconEyeOpen],
    ],
  },
  {
    category: "Triage & thread state",
    glyphs: [
      ["IconPin", IconPin],
      ["IconUnpin", IconUnpin],
      ["IconArchive1", IconArchive1],
    ],
  },
  {
    category: "Close & dismiss",
    glyphs: [
      ["IconCrossSmall", IconCrossSmall],
      ["IconCrossMedium", IconCrossMedium],
      ["IconCrossMediumDefault", IconCrossMediumDefault],
    ],
  },
  {
    category: "Status & feedback",
    glyphs: [
      ["IconCircleCheck", IconCircleCheck],
      ["IconExclamationCircle", IconExclamationCircle],
      ["IconBubbleQuestion", IconBubbleQuestion],
    ],
  },
  {
    category: "Model providers",
    glyphs: [
      ["IconClawd", IconClawd],
      ["IconOpenaiCodex", IconOpenaiCodex],
    ],
  },
  {
    category: "Workspace & chrome",
    glyphs: [
      ["IconBarsThree", IconBarsThree],
      ["IconDotGrid1x3Horizontal", IconDotGrid1x3Horizontal],
      ["IconBrowserTabs", IconBrowserTabs],
      ["IconConsole", IconConsole],
      ["IconConsoleSimple", IconConsoleSimple],
      ["IconGlobe", IconGlobe],
      ["IconChanges", IconChanges],
      ["IconHome", IconHome],
      ["IconSettingsGear2", IconSettingsGear2],
      ["IconBuildingBlocks", IconBuildingBlocks],
      ["IconBranch", IconBranch],
      ["IconLayoutSidebar", IconLayoutSidebar],
      ["IconSidebarSimpleRightWide", IconSidebarSimpleRightWide],
      ["IconSummary", IconSummary],
      ["IconMagnifyingGlass", IconMagnifyingGlass],
      ["IconFilter2", IconFilter2],
    ],
  },
];

export { ICON_CATALOG };
export type { IconCatalogSection };
