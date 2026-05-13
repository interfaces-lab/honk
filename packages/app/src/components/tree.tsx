"use client";

import type { FileTreeOptions, TreeThemeStyles } from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeProps as PierreFileTreeProps } from "@pierre/trees/react";
import type { CSSProperties } from "react";
import { useMemo } from "react";

import { getPierreTreeThemeStyles } from "~/lib/pierre-shiki-theme";
import { cn } from "~/lib/utils";

export type TreeHostStyle = CSSProperties & Record<`--${string}`, string | number>;

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

function treeHostLayout(): TreeHostStyle {
  return {
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
  const hostStyle = useMemo(
    () => treeHostStyle(getPierreTreeThemeStyles(resolvedTheme), resolvedTheme, style),
    [resolvedTheme, style],
  );

  return (
    <PierreFileTree {...props} className={cn("block h-full w-full", className)} style={hostStyle} />
  );
}

export function normalizeTreePath(path: string): string {
  return path.replace(/\\/g, "/");
}
