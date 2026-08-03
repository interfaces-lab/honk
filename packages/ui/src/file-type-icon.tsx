import * as stylex from "@stylexjs/stylex";
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";
import * as React from "react";

import type { IconSize, IconTone } from "./icon";
import { colorVars, iconVars } from "./tokens.stylex";

const GLYPH_SIZE = "1em";
const fileIconResolver = createFileTreeIconResolver("complete");
const spriteMarkup = { __html: getBuiltInSpriteSheet("complete") };

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    lineHeight: 1,
  },
  sprite: {
    position: "absolute",
    width: 0,
    height: 0,
    overflow: "hidden",
    pointerEvents: "none",
  },
  sizeXs: { fontSize: iconVars["--honk-icon-size-xs"] },
  sizeSm: { fontSize: iconVars["--honk-icon-size-sm"] },
  sizeMd: { fontSize: iconVars["--honk-icon-size-md"] },
  sizeLg: { fontSize: iconVars["--honk-icon-size-lg"] },
  sizeXl: { fontSize: iconVars["--honk-icon-size-xl"] },
  toneCurrent: { color: "currentColor" },
  toneMuted: { color: colorVars["--honk-color-text-muted"] },
  toneFaint: { color: colorVars["--honk-color-text-faint"] },
  toneAccent: { color: colorVars["--honk-color-accent"] },
  toneOk: { color: colorVars["--honk-color-ok-fg"] },
  toneWarn: { color: colorVars["--honk-color-warn-fg"] },
  toneErr: { color: colorVars["--honk-color-err-fg"] },
  toneInfo: { color: colorVars["--honk-color-info-fg"] },
  iconGray: { color: colorVars["--honk-color-file-icon-gray"] },
  iconRed: { color: colorVars["--honk-color-file-icon-red"] },
  iconVermilion: { color: colorVars["--honk-color-file-icon-vermilion"] },
  iconOrange: { color: colorVars["--honk-color-file-icon-orange"] },
  iconYellow: { color: colorVars["--honk-color-file-icon-yellow"] },
  iconGreen: { color: colorVars["--honk-color-file-icon-green"] },
  iconTeal: { color: colorVars["--honk-color-file-icon-teal"] },
  iconCyan: { color: colorVars["--honk-color-file-icon-cyan"] },
  iconBlue: { color: colorVars["--honk-color-file-icon-blue"] },
  iconIndigo: { color: colorVars["--honk-color-file-icon-indigo"] },
  iconPurple: { color: colorVars["--honk-color-file-icon-purple"] },
  iconPink: { color: colorVars["--honk-color-file-icon-pink"] },
  iconMauve: { color: colorVars["--honk-color-file-icon-mauve"] },
});

const sizeStyles: Record<IconSize, stylex.StyleXStyles> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
  xl: styles.sizeXl,
};

const toneStyles: Record<IconTone, stylex.StyleXStyles> = {
  current: styles.toneCurrent,
  muted: styles.toneMuted,
  faint: styles.toneFaint,
  accent: styles.toneAccent,
  ok: styles.toneOk,
  warn: styles.toneWarn,
  err: styles.toneErr,
  info: styles.toneInfo,
};

// These colors are part of Pierre's Application File Icons data, matching the colored VS Code pack.
const fileIconColorStyles: Record<string, stylex.StyleXStyles> = {
  astro: styles.iconPurple,
  babel: styles.iconYellow,
  bash: styles.iconGreen,
  biome: styles.iconBlue,
  bootstrap: styles.iconIndigo,
  browserslist: styles.iconYellow,
  bun: styles.iconMauve,
  c: styles.iconBlue,
  claude: styles.iconOrange,
  cpp: styles.iconBlue,
  css: styles.iconIndigo,
  database: styles.iconPurple,
  default: styles.iconGray,
  docker: styles.iconBlue,
  eslint: styles.iconIndigo,
  git: styles.iconVermilion,
  go: styles.iconCyan,
  graphql: styles.iconPink,
  html: styles.iconOrange,
  image: styles.iconPink,
  javascript: styles.iconYellow,
  json: styles.iconOrange,
  markdown: styles.iconGreen,
  mcp: styles.iconTeal,
  npm: styles.iconRed,
  oxc: styles.iconCyan,
  postcss: styles.iconRed,
  prettier: styles.iconTeal,
  python: styles.iconBlue,
  react: styles.iconCyan,
  ruby: styles.iconRed,
  rust: styles.iconOrange,
  sass: styles.iconPink,
  svelte: styles.iconRed,
  svg: styles.iconOrange,
  svgo: styles.iconGreen,
  swift: styles.iconOrange,
  table: styles.iconTeal,
  tailwind: styles.iconCyan,
  terraform: styles.iconIndigo,
  text: styles.iconGray,
  typescript: styles.iconBlue,
  vite: styles.iconPurple,
  vscode: styles.iconBlue,
  vue: styles.iconGreen,
  wasm: styles.iconIndigo,
  webpack: styles.iconBlue,
  yml: styles.iconRed,
  zig: styles.iconOrange,
  zip: styles.iconOrange,
};

// Pierre owns exact basenames, compound extensions, and the corresponding 16px symbol geometry.
function FileTypeIcon({
  path,
  size = "md",
  tone,
}: {
  readonly path: string;
  readonly size?: IconSize;
  readonly tone?: IconTone;
}): React.ReactElement {
  const resolved = fileIconResolver.resolveIcon("file-tree-icon-file", path.replaceAll("\\", "/"));
  const width = resolved.width ?? 16;
  const height = resolved.height ?? 16;
  return (
    <span
      aria-hidden
      data-slot="icon"
      {...stylex.props(
        styles.root,
        sizeStyles[size],
        tone === undefined ? fileIconColorStyles[resolved.token ?? ""] : toneStyles[tone],
      )}
    >
      <svg
        data-icon-name={resolved.name}
        data-icon-token={resolved.token}
        viewBox={resolved.viewBox ?? `0 0 ${String(width)} ${String(height)}`}
        width={GLYPH_SIZE}
        height={GLYPH_SIZE}
        focusable="false"
      >
        <use href={`#${resolved.name}`} />
      </svg>
    </span>
  );
}

// Consumers mount this once so all file icons share one stable set of global symbol definitions.
function FileTypeIconSprite(): React.ReactElement {
  return (
    <span aria-hidden {...stylex.props(styles.sprite)} dangerouslySetInnerHTML={spriteMarkup} />
  );
}

export { FileTypeIcon, FileTypeIconSprite };
