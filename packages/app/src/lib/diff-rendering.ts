export const DIFF_THEME_NAMES = {
  light: "pierre-light",
  dark: "pierre-dark",
} as const;

export type DiffThemeName = (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES];

export function resolveDiffThemeName(theme: "light" | "dark"): DiffThemeName {
  return theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light;
}

export const WORKBENCH_CODE_UNSAFE_CSS = `
  [data-line] {
    min-height: 1lh;
  }

  [data-line-type='change-addition'] [data-diff-span],
  [data-line-type='change-deletion'] [data-diff-span] {
    background-color: inherit;
  }

  [data-background] [data-line-type='change-addition'][data-line],
  [data-background] [data-line-type='change-addition'][data-no-newline],
  [data-background] [data-line-type='change-addition'][data-gutter-buffer] {
    background-color: var(--diffs-bg-addition);
  }

  [data-background] [data-line-type='change-deletion'][data-line],
  [data-background] [data-line-type='change-deletion'][data-no-newline],
  [data-background] [data-line-type='change-deletion'][data-gutter-buffer] {
    background-color: var(--diffs-bg-deletion);
  }

  [data-line-type='change-addition']:is([data-column-number], [data-gutter-buffer]) {
    background:
      linear-gradient(
        to right,
        var(--multi-git-diff-addition, var(--diffs-addition-base)) 0 2px,
        var(--diffs-bg-addition) 2px 100%
      );
  }

  [data-line-type='change-deletion']:is([data-column-number], [data-gutter-buffer]) {
    background:
      linear-gradient(
        to right,
        var(--multi-git-diff-deletion, var(--diffs-deletion-base)) 0 2px,
        var(--diffs-bg-deletion) 2px 100%
      );
  }
`;

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

export function buildPatchCacheKey(patch: string, scope = "diff-panel"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}
