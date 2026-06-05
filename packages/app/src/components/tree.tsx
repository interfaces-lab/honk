"use client";

import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";
import type { FileTreeOptions, TreeThemeInput, TreeThemeStyles } from "@pierre/trees";
import { themeToTreeStyles } from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeProps as PierreFileTreeProps } from "@pierre/trees/react";
import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";

export type TreeHostStyle = CSSProperties & Record<`--${string}`, string | number>;
type PierreTheme = typeof pierreDark;

export type TreeProps = Omit<PierreFileTreeProps, "className" | "style"> & {
  className?: string;
  resolvedTheme: "light" | "dark";
  style?: TreeHostStyle;
};

function treeUnsafeCss(extraCss: string | undefined): string {
  const baseCss = `
    button[data-type='item'] {
      letter-spacing: 0;
    }
  `;

  return extraCss ? `${baseCss}\n${extraCss}` : baseCss;
}

function toTreeThemeInput(theme: PierreTheme): TreeThemeInput {
  const colors = theme.colors as Record<string, string>;
  const bg = colors["editor.background"] ?? (theme.type === "dark" ? "#1e1e1e" : "#ffffff");
  const fg = colors["editor.foreground"] ?? (theme.type === "dark" ? "#d4d4d4" : "#1e1e1e");
  return {
    type: theme.type,
    bg,
    fg,
    colors,
  };
}

function getExtendedGitTreeStyles(): TreeThemeStyles {
  const styles: TreeThemeStyles = {};

  styles["--trees-git-added-color-override"] = "var(--multi-git-status-added)";
  styles["--trees-git-deleted-color-override"] = "var(--multi-git-status-deleted)";
  styles["--trees-git-ignored-color-override"] = "var(--multi-fg-quaternary)";
  styles["--trees-git-modified-color-override"] = "var(--multi-git-status-modified)";
  styles["--trees-git-renamed-color-override"] = "var(--multi-git-status-renamed)";
  styles["--trees-git-untracked-color-override"] = "var(--multi-git-status-added)";

  return styles;
}

function getPierreTreeThemeStyles(resolvedTheme: "light" | "dark"): TreeThemeStyles {
  const theme = resolvedTheme === "dark" ? pierreDark : pierreLight;
  return {
    ...themeToTreeStyles(toTreeThemeInput(theme)),
    ...getExtendedGitTreeStyles(),
  };
}

function treeHostLayout(): TreeHostStyle {
  return {
    "--trees-bg-override": "var(--multi-workbench-panel-background)",
    "--trees-input-bg-override": "var(--multi-workbench-panel-background)",
    "--trees-bg-muted-override": "var(--multi-workbench-toolbar-hover-wash)",
    "--trees-selected-bg-override": "var(--multi-workbench-card-selected-background)",
    "--trees-fg-override": "var(--multi-fg-primary)",
    "--trees-fg-muted-override": "var(--multi-fg-secondary)",
    "--trees-font-family-override": "var(--multi-font-ui)",
    "--trees-font-size-override": "12px",
    "--trees-font-weight-regular-override": 400,
    "--trees-font-weight-semibold-override": 500,
    "--trees-border-radius-override": "4px",
    "--trees-focus-ring-width-override": "1px",
    "--trees-focus-ring-offset-override": "-1px",
    "--trees-item-margin-x-override": "4px",
    "--trees-item-padding-x-override": "4px",
    "--trees-level-gap-override": "8px",
    "--trees-gap-override": "4px",
    "--trees-item-row-gap-override": "2px",
    "--trees-icon-width-override": "14px",
    "--trees-padding-inline-override": "8px",
  };
}

function treeHostStyle(
  pierre: TreeThemeStyles,
  resolvedTheme: "light" | "dark",
  overrides: TreeHostStyle | undefined,
): TreeHostStyle {
  return {
    ...(pierre as TreeHostStyle),
    ...treeHostLayout(),
    ...overrides,
    colorScheme: resolvedTheme === "dark" ? "dark" : "light",
  };
}

export function useTreeModel(options: FileTreeOptions): ReturnType<typeof useFileTree> {
  return useFileTree({
    density: "compact",
    itemHeight: 22,
    flattenEmptyDirectories: true,
    icons: "complete",
    ...options,
    unsafeCSS: treeUnsafeCss(options.unsafeCSS),
  });
}

export function Tree({ className, resolvedTheme, style, ...props }: TreeProps) {
  const hostStyle = treeHostStyle(getPierreTreeThemeStyles(resolvedTheme), resolvedTheme, style);

  return (
    <PierreFileTree
      {...props}
      className={cn("block h-full min-h-0 w-full overflow-auto overscroll-contain", className)}
      style={hostStyle}
    />
  );
}

export function normalizeTreePath(path: string): string {
  return path.replace(/\\/g, "/");
}
