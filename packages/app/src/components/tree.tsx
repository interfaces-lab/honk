"use client";

import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";
import type {
  FileTreeOptions,
  TreeThemeInput,
  TreeThemeStyles,
} from "@pierre/trees";
import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
  themeToTreeStyles,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeProps as PierreFileTreeProps } from "@pierre/trees/react";
import { normalizePathSeparators as normalizeTreePath } from "@honk/shared/paths";
import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";

export type TreeHostStyle = CSSProperties & Record<`--${string}`, string | number>;
type PierreTheme = typeof pierreDark;
const FILE_TREE_ICON_SET = "complete";
const fileTreeIconResolver = createFileTreeIconResolver(FILE_TREE_ICON_SET);
const fileTreeIconSpriteSheet = getBuiltInSpriteSheet(FILE_TREE_ICON_SET);

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

  styles["--trees-git-added-color-override"] = "var(--honk-git-status-added)";
  styles["--trees-git-deleted-color-override"] = "var(--honk-git-status-deleted)";
  styles["--trees-git-ignored-color-override"] = "var(--honk-fg-quaternary)";
  styles["--trees-git-modified-color-override"] = "var(--honk-git-status-modified)";
  styles["--trees-git-renamed-color-override"] = "var(--honk-git-status-renamed)";
  styles["--trees-git-untracked-color-override"] = "var(--honk-git-status-added)";

  return styles;
}

// themeToTreeStyles() returns the --trees-theme-* fallback variables *plus*
// literal layout properties (backgroundColor, color, borderColor, colorScheme)
// taken straight from the Pierre theme. The literal backgroundColor is the
// theme's sidebar/editor background (white in light mode), and as an inline
// style it beats the `:host { background-color: var(--trees-bg) }` rule —
// painting an extra white background over our panel background. We drive the
// host entirely through --trees-*-override variables (treeHostLayout), so keep
// only the custom properties and drop the literal layout properties.
function pickTreeThemeVariables(styles: TreeThemeStyles): TreeThemeStyles {
  const variables: TreeThemeStyles = {};
  for (const [key, value] of Object.entries(styles)) {
    if (key.startsWith("--")) {
      variables[key] = value;
    }
  }
  return variables;
}

function getPierreTreeThemeStyles(resolvedTheme: "light" | "dark"): TreeThemeStyles {
  const theme = resolvedTheme === "dark" ? pierreDark : pierreLight;
  return {
    ...pickTreeThemeVariables(themeToTreeStyles(toTreeThemeInput(theme))),
    ...getExtendedGitTreeStyles(),
  };
}

function treeHostLayout(): TreeHostStyle {
  return {
    "--trees-bg-override": "var(--honk-workbench-panel-background)",
    "--trees-input-bg-override": "var(--honk-workbench-panel-background)",
    "--trees-bg-muted-override": "var(--honk-workbench-toolbar-hover-wash)",
    "--trees-selected-bg-override": "var(--honk-workbench-card-selected-background)",
    "--trees-fg-override": "var(--honk-fg-primary)",
    "--trees-fg-muted-override": "var(--honk-fg-secondary)",
    "--trees-font-family-override": "var(--honk-font-ui)",
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
    icons: FILE_TREE_ICON_SET,
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

export function FileTreeIconSprite() {
  return (
    <span
      aria-hidden
      className="hidden"
      dangerouslySetInnerHTML={{ __html: fileTreeIconSpriteSheet }}
    />
  );
}

export function FileTreeFileIcon(props: {
  path: string;
  className?: string;
  style?: CSSProperties;
}) {
  const icon = fileTreeIconResolver.resolveIcon("file-tree-icon-file", normalizeTreePath(props.path));
  const href = `#${icon.name.replace(/^#/, "")}`;
  const width = icon.width ?? 16;
  const height = icon.height ?? 16;
  const viewBox = icon.viewBox ?? `0 0 ${width} ${height}`;

  return (
    <svg
      aria-hidden
      className={props.className}
      data-align-capitals="false"
      data-icon-name={icon.remappedFrom ?? icon.name}
        data-icon-token={icon.token}
        height={height}
        style={props.style}
      viewBox={viewBox}
      width={width}
    >
      <use href={href} />
    </svg>
  );
}
