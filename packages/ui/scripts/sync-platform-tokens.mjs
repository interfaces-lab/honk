import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { colorProvenance, honkTheme } from "../src/theme.ts";

const root = new URL("../", import.meta.url);
const stylexUrl = new URL("src/platform-tokens.stylex.ts", root);
const cssUrl = new URL("src/platform-tokens.css", root);
const parityUrl = new URL("src/theme-parity.json", root);
const isCheck = process.argv.includes("--check");

const parity = JSON.parse(await readFile(parityUrl, "utf8"));

const kebab = (value) =>
  value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/([a-z])(\d+)/g, "$1-$2");
const px = (value) => `${String(value)}px`;
const scalar = (value) => String(value);
const tsString = (value) =>
  value.includes('"') && !value.includes("'") ? `'${value}'` : JSON.stringify(value);

const colorDefaults = Object.fromEntries(
  Object.keys(honkTheme.colors.light).map((name) => {
    const light = honkTheme.colors.light[name];
    const dark = honkTheme.colors.dark[name];
    return [
      `--honk-color-${kebab(name)}`,
      light === dark ? light : `light-dark(${light}, ${dark})`,
    ];
  }),
);

/** @type {ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>} */
const groups = [
  ["color", colorDefaults],
  [
    "radius",
    Object.fromEntries(
      Object.entries(honkTheme.web.radius).map(([name, value]) => [
        `--honk-radius-${kebab(name)}`,
        px(value),
      ]),
    ),
  ],
  [
    "space",
    Object.fromEntries(
      Object.entries(honkTheme.web.space).map(([name, value]) => [
        `--honk-space-${kebab(name)}`,
        px(value),
      ]),
    ),
  ],
  [
    "control",
    {
      "--honk-control-h-sm": px(honkTheme.web.control.heightSm),
      "--honk-control-h-md": px(honkTheme.web.control.heightMd),
      "--honk-control-h-lg": px(honkTheme.web.control.heightLg),
      "--honk-control-pad-sm": px(honkTheme.web.control.paddingSm),
      "--honk-control-pad-md": px(honkTheme.web.control.paddingMd),
      "--honk-control-pad-lg": px(honkTheme.web.control.paddingLg),
      "--honk-control-gap": px(honkTheme.web.control.gap),
      "--honk-control-field-multiline-min-h": px(honkTheme.web.control.multilineMinHeight),
      "--honk-control-picker-min-w": px(honkTheme.web.control.pickerMinWidth),
      "--honk-control-picker-max-w": px(honkTheme.web.control.pickerMaxWidth),
      "--honk-control-picker-rich-min-h": px(honkTheme.web.control.pickerRichMinHeight),
      "--honk-control-border-width": px(honkTheme.web.control.borderWidth),
      "--honk-control-focus-ring-width": px(honkTheme.web.control.focusRingWidth),
      "--honk-control-focus-ring-offset": px(honkTheme.web.control.focusRingOffset),
      "--honk-control-disabled-opacity": scalar(honkTheme.web.control.disabledOpacity),
    },
  ],
  [
    "font",
    {
      "--honk-font-family-ui": honkTheme.web.font.familyUi,
      "--honk-font-family-mono": honkTheme.web.font.familyMono,
      "--honk-font-family-rounded": honkTheme.web.font.familyRounded,
      "--honk-font-size-body": px(honkTheme.web.font.sizeBody),
      "--honk-font-size-detail": px(honkTheme.web.font.sizeDetail),
      "--honk-font-size-caption": px(honkTheme.web.font.sizeCaption),
      "--honk-font-size-micro": px(honkTheme.web.font.sizeMicro),
      "--honk-font-size-body-lg": px(honkTheme.web.font.sizeBodyLg),
      "--honk-font-size-code": px(honkTheme.web.font.sizeCode),
      "--honk-text-caption": px(honkTheme.web.font.textCaption),
      "--honk-text-detail": px(honkTheme.web.font.textDetail),
      "--honk-text-body": px(honkTheme.web.font.textBody),
      "--honk-text-title": px(honkTheme.web.font.textTitle),
      "--honk-text-heading": px(honkTheme.web.font.textHeading),
      "--honk-leading-caption": px(honkTheme.web.font.leadingCaption),
      "--honk-leading-detail": px(honkTheme.web.font.leadingDetail),
      "--honk-leading-body": px(honkTheme.web.font.leadingBody),
      "--honk-leading-title": px(honkTheme.web.font.leadingTitle),
      "--honk-leading-heading": px(honkTheme.web.font.leadingHeading),
      "--honk-leading-code": px(honkTheme.web.font.leadingCode),
      "--honk-font-weight-regular": scalar(honkTheme.web.font.weightRegular),
      "--honk-font-weight-medium": scalar(honkTheme.web.font.weightMedium),
      "--honk-font-weight-semibold": scalar(honkTheme.web.font.weightSemibold),
      "--honk-font-smoothing": honkTheme.web.font.smoothing,
      "--honk-font-smoothing-moz": honkTheme.web.font.smoothingMoz,
    },
  ],
  [
    "icon",
    Object.fromEntries(
      Object.entries(honkTheme.web.icon).map(([name, value]) => [
        `--honk-icon-${kebab(name)}`,
        px(value),
      ]),
    ),
  ],
  [
    "conversation",
    {
      "--honk-conversation-inset": px(honkTheme.web.conversation.inset),
      "--honk-conversation-row-min-h": px(honkTheme.web.conversation.rowMinHeight),
      "--honk-conversation-row-gap": px(honkTheme.web.conversation.rowGap),
      "--honk-conversation-step-gap": px(honkTheme.web.conversation.stepGap),
    },
  ],
  [
    "sidebar",
    {
      "--honk-sidebar-item-height": px(honkTheme.web.sidebar.itemHeight),
      "--honk-sidebar-item-gap": px(honkTheme.web.sidebar.itemGap),
      "--honk-sidebar-row-padding-inline": px(honkTheme.web.sidebar.rowPaddingInline),
      "--honk-sidebar-row-padding-block": px(honkTheme.web.sidebar.rowPaddingBlock),
      "--honk-sidebar-section-gap": px(honkTheme.web.sidebar.sectionGap),
      "--honk-sidebar-gutter-inline": px(honkTheme.web.sidebar.gutterInline),
      "--honk-sidebar-label-size": px(honkTheme.web.sidebar.labelSize),
      "--honk-sidebar-label-leading": px(honkTheme.web.sidebar.labelLeading),
      "--honk-sidebar-subtitle-size": px(honkTheme.web.sidebar.subtitleSize),
      "--honk-sidebar-subtitle-leading": px(honkTheme.web.sidebar.subtitleLeading),
      "--honk-sidebar-icon-slot": px(honkTheme.web.sidebar.iconSlot),
    },
  ],
];

function renderObject(name, values) {
  const entries = Object.entries(values)
    .map(([key, value]) => {
      const keyLiteral = JSON.stringify(key);
      const valueLiteral = tsString(value);
      const entry = `  ${keyLiteral}: ${valueLiteral},`;
      return valueLiteral.startsWith("'") && entry.length > 100
        ? `  ${keyLiteral}:\n    ${valueLiteral},`
        : entry;
    })
    .join("\n");
  return `const ${name}Defaults = {\n${entries}\n} as const;`;
}

function renderStylex() {
  const blocks = groups.map(([name, values]) => renderObject(name, values)).join("\n\n");
  const definitions = groups
    .map(([name]) => `const ${name}Vars = stylex.defineVars(${name}Defaults);`)
    .join("\n");
  const types = groups
    .map(
      ([name]) =>
        `type ${name[0].toUpperCase()}${name.slice(1)}VarName = keyof typeof ${name}Defaults;`,
    )
    .join("\n");
  const values = groups.flatMap(([name]) => [`${name}Defaults`, `${name}Vars`]).join(",\n  ");
  const typeNames = groups
    .map(([name]) => `${name[0].toUpperCase()}${name.slice(1)}VarName`)
    .join(",\n  ");

  return `/**
 * Generated from theme.ts. Run \`pnpm --filter @honk/ui sync:tokens\`.
 * Do not edit this file by hand.
 */

import * as stylex from "@stylexjs/stylex";

${blocks}

${definitions}

${types}

export {
  ${values},
};

export type {
  ${typeNames},
};
`;
}

function renderCss() {
  const declarations = groups
    .flatMap(([, values]) => Object.entries(values))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `/* Generated from theme.ts. Do not edit by hand. */
:root {
${declarations}
}
`;
}

function parityDigest() {
  const values = parity.lockedColorKeys.map((name) => [
    name,
    honkTheme.colors.light[name],
    honkTheme.colors.dark[name],
  ]);
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function verifyThemeContract() {
  const colorKeys = Object.keys(honkTheme.colors.light);
  const darkKeys = Object.keys(honkTheme.colors.dark);
  const provenanceKeys = Object.keys(colorProvenance);
  if (JSON.stringify(colorKeys) !== JSON.stringify(darkKeys)) {
    throw new Error("theme.ts light and dark color keys differ");
  }
  if (JSON.stringify(colorKeys) !== JSON.stringify(provenanceKeys)) {
    throw new Error("theme.ts colorProvenance must cover every color key in declaration order");
  }
  if (JSON.stringify(colorKeys) !== JSON.stringify(parity.lockedColorKeys)) {
    throw new Error("theme-parity.json must lock every color key in declaration order");
  }
  const digest = parityDigest();
  if (digest !== parity.sha256) {
    throw new Error(
      `Theme parity fixture changed (${digest}); update theme-parity.json only for an accepted palette change`,
    );
  }
}

async function syncFile(url, expected) {
  if (!isCheck) {
    await writeFile(url, expected);
    return;
  }
  const actual = await readFile(url, "utf8").catch(() => "");
  if (actual !== expected) {
    throw new Error(`${fileURLToPath(url)} is stale; run pnpm --filter @honk/ui sync:tokens`);
  }
}

verifyThemeContract();
await syncFile(stylexUrl, renderStylex());
await syncFile(cssUrl, renderCss());
