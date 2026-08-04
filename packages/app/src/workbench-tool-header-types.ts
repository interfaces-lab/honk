import type { Glyph } from "@honk/ui";

type WorkbenchToolHeaderTab = {
  readonly id: string;
  readonly label: string;
  readonly icon: Glyph;
  readonly closable: boolean;
  readonly showLabel: boolean;
  readonly filePath?: string;
  /** Hover text when the label alone cannot identify the tab, such as two files sharing a basename. */
  readonly title?: string;
};

type WorkbenchToolHeaderMenuItem = {
  readonly id: string;
  readonly label: string;
  readonly icon: Glyph;
  readonly disabled?: boolean;
};

export type { WorkbenchToolHeaderMenuItem, WorkbenchToolHeaderTab };
