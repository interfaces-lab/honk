import type { Glyph } from "./icon";
import {
  IconArchive1,
  IconArrowLeft,
  IconArrowRight,
  IconArrowRotateClockwise,
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
  IconCode,
  IconComputerUse,
  IconConsole,
  IconConsoleSimple,
  IconCrossMedium,
  IconCrossMediumDefault,
  IconCrossSmall,
  IconDotGrid1x3Horizontal,
  IconExclamationCircle,
  IconExpand45,
  IconEyeOpen,
  IconFileBend,
  IconFileJpg,
  IconFilePdf,
  IconFilePng,
  IconFileText,
  IconFileZip,
  IconFiles,
  IconFilter2,
  IconFolder1,
  IconFolderAddRight,
  IconFolderOpen,
  IconGlobe,
  IconHomeRoofDoor,
  IconJavascript,
  IconJson,
  IconLayoutSidebar,
  IconMagnifyingGlass,
  IconMarkdown,
  IconMinusSmall,
  IconOpenaiCodex,
  IconPencilLine,
  IconPin,
  IconPictureInPicture,
  IconPlusSmall,
  IconSettingsGear2,
  IconServer,
  IconSidebarSimpleRightWide,
  IconSleep,
  IconStepBack,
  IconSummary,
  IconSun,
  IconTrashCan,
  IconTypescript,
  IconUnpin,
  IconWindowSquare,
  IconWindowSquarePlus,
} from "central-icons";

// Navigation
export {
  IconArrowLeft,
  IconArrowRight,
  IconArrowRotateClockwise,
  IconChevronRightMedium,
  IconChevronDownMedium,
  IconChevronLeftMedium,
  IconChevronDoubleLeft,
  IconChevronDoubleRight,
  IconExpand45,
  IconStepBack,
};

// Files
export {
  IconFolder1,
  IconFolderOpen,
  IconFolderAddRight,
  IconFiles,
  IconFileBend,
  IconFileJpg,
  IconFilePdf,
  IconFilePng,
  IconFileText,
  IconFileZip,
  IconCode,
  IconJavascript,
  IconJson,
  IconMarkdown,
  IconTypescript,
};

// Content actions
export {
  IconPencilLine,
  IconTrashCan,
  IconClipboard,
  IconCheckmark1,
  IconArrowUp,
  IconPlusSmall,
  IconEyeOpen,
  IconPictureInPicture,
  IconMinusSmall,
};

// Triage
export { IconPin, IconUnpin, IconArchive1 };

// Close
export { IconCrossSmall, IconCrossMedium, IconCrossMediumDefault };

// Status
export { IconCircleCheck, IconExclamationCircle, IconBubbleQuestion, IconSleep, IconSun };

// Model providers
export { IconClawd, IconOpenaiCodex };

// Workspace
export {
  IconBarsThree,
  IconDotGrid1x3Horizontal,
  IconBrowserTabs,
  IconConsole,
  IconConsoleSimple,
  IconGlobe,
  IconChanges,
  IconHomeRoofDoor,
  IconSettingsGear2,
  IconBuildingBlocks,
  IconBranch,
  IconLayoutSidebar,
  IconSidebarSimpleRightWide,
  IconSummary,
  IconMagnifyingGlass,
  IconFilter2,
  IconServer,
  IconComputerUse,
  IconWindowSquare,
  IconWindowSquarePlus,
};

interface IconCatalogSection {
  readonly category: string;
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
      ["IconExpand45", IconExpand45],
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
      ["IconFileJpg", IconFileJpg],
      ["IconFilePdf", IconFilePdf],
      ["IconFilePng", IconFilePng],
      ["IconFileText", IconFileText],
      ["IconFileZip", IconFileZip],
      ["IconCode", IconCode],
      ["IconJavascript", IconJavascript],
      ["IconJson", IconJson],
      ["IconMarkdown", IconMarkdown],
      ["IconTypescript", IconTypescript],
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
      ["IconPictureInPicture", IconPictureInPicture],
      ["IconMinusSmall", IconMinusSmall],
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
      ["IconSleep", IconSleep],
      ["IconSun", IconSun],
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
      ["IconHomeRoofDoor", IconHomeRoofDoor],
      ["IconSettingsGear2", IconSettingsGear2],
      ["IconBuildingBlocks", IconBuildingBlocks],
      ["IconBranch", IconBranch],
      ["IconLayoutSidebar", IconLayoutSidebar],
      ["IconSidebarSimpleRightWide", IconSidebarSimpleRightWide],
      ["IconSummary", IconSummary],
      ["IconMagnifyingGlass", IconMagnifyingGlass],
      ["IconFilter2", IconFilter2],
      ["IconServer", IconServer],
      ["IconComputerUse", IconComputerUse],
      ["IconWindowSquare", IconWindowSquare],
      ["IconWindowSquarePlus", IconWindowSquarePlus],
    ],
  },
];

export { ICON_CATALOG };
export type { IconCatalogSection };
