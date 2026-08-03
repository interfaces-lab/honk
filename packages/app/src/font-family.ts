const FONT_FAMILY_MAX_LENGTH = 500;
const UNSAFE_FONT_FAMILY = /[;}]|url\s*\(/i;

function normalizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const family = value.trim();
  if (
    Array.from(family).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return null;
  }
  return family.length > 0 &&
    family.length <= FONT_FAMILY_MAX_LENGTH &&
    !UNSAFE_FONT_FAMILY.test(family)
    ? family
    : null;
}

function fontFamilyCssValue(family: string, fallback: string): string {
  const normalized = normalizeFontFamily(family);
  if (normalized === null) return fallback;
  const escaped = normalized.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}", ${fallback}`;
}

export { fontFamilyCssValue, normalizeFontFamily };
