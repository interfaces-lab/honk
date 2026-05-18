import { layout, layoutWithLines, prepare, prepareWithSegments } from "@chenglou/pretext";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

const ELLIPSIS = "…";
const DEFAULT_FONT_SIZE_PX = 12;
const DEFAULT_LINE_HEIGHT_RATIO = 1.2;

function wellFormed(s: string) {
  const fn = Reflect.get(String.prototype, "toWellFormed") as
    | undefined
    | ((this: string) => string);
  return typeof fn === "function" ? fn.call(s) : s;
}

function fontFromComputedStyle(style: CSSStyleDeclaration) {
  const fontStyle = style.fontStyle && style.fontStyle !== "normal" ? `${style.fontStyle} ` : "";
  const fontVariant =
    style.fontVariant && style.fontVariant !== "normal" ? `${style.fontVariant} ` : "";
  const fontWeight =
    style.fontWeight && style.fontWeight !== "normal" ? `${style.fontWeight} ` : "";
  return `${fontStyle}${fontVariant}${fontWeight}${style.fontSize} ${style.fontFamily}`.trim();
}

function lineHeightFromComputedStyle(style: CSSStyleDeclaration) {
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (lineHeight > 0) return lineHeight;
  const fontSize = Number.parseFloat(style.fontSize);
  return fontSize > 0 ? fontSize * DEFAULT_LINE_HEIGHT_RATIO : 16;
}

function fallbackFont(px: number) {
  return `400 ${px}px ui-sans-serif, system-ui, sans-serif`;
}

function buildMiddleEllipsisText(text: string, retainedCharacters: number) {
  if (retainedCharacters >= text.length) return text;
  if (retainedCharacters <= 0) return ELLIPSIS;
  const headCount = Math.ceil(retainedCharacters / 2);
  const tailCount = Math.floor(retainedCharacters / 2);
  return `${text.slice(0, headCount)}${ELLIPSIS}${text.slice(text.length - tailCount)}`;
}

function truncatePretextMiddleText(input: {
  text: string;
  maxWidth: number;
  font: string;
  lineHeight: number;
}) {
  const { text, maxWidth, font, lineHeight } = input;
  if (!text || maxWidth <= 0 || !Number.isFinite(maxWidth)) return text;

  const fits = (candidate: string) => {
    try {
      return layout(prepare(candidate, font), maxWidth, lineHeight).lineCount <= 1;
    } catch {
      return false;
    }
  };

  if (fits(text)) return text;
  if (!fits(ELLIPSIS)) return ELLIPSIS;

  let low = 0;
  let high = text.length;
  let result = ELLIPSIS;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = buildMiddleEllipsisText(text, mid);
    if (fits(candidate)) {
      result = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

export function usePretextOneLine(opts: {
  text: string;
  fontPx?: number;
  lineHeightPx?: number;
  truncate?: "end" | "middle";
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  const px = opts.fontPx ?? DEFAULT_FONT_SIZE_PX;
  const [font, setFont] = useState(() => fallbackFont(px));
  const [computedLineHeight, setComputedLineHeight] = useState(
    () => opts.lineHeightPx ?? Math.round(px * DEFAULT_LINE_HEIGHT_RATIO),
  );
  const truncateMode = opts.truncate ?? "end";
  const t = useMemo(() => {
    if (!opts.text) return "";
    return wellFormed(opts.text);
  }, [opts.text]);

  const prep = useMemo(() => {
    if (!t) return null;
    try {
      return prepareWithSegments(t, font);
    } catch {
      return null;
    }
  }, [t, font]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = () => {
      const style = getComputedStyle(el);
      setFont(fontFromComputedStyle(style));
      setComputedLineHeight(opts.lineHeightPx ?? lineHeightFromComputedStyle(style));
      setW(el.clientWidth);
    };
    next();
    const ro = new ResizeObserver(next);
    ro.observe(el);
    return () => ro.disconnect();
  }, [opts.lineHeightPx]);

  const shown = useMemo(() => {
    if (!t) return "";
    if (w <= 0) return t;

    if (truncateMode === "middle") {
      return truncatePretextMiddleText({
        text: t,
        maxWidth: w,
        font,
        lineHeight: computedLineHeight,
      });
    }

    if (!prep) return t;
    const out = layoutWithLines(prep, w, computedLineHeight);
    const head = out.lines[0];
    if (!head) return "";
    if (out.lines.length === 1) return head.text;
    const first = head.text.replace(/\s+$/, "");
    return first ? `${first}${ELLIPSIS}` : ELLIPSIS;
  }, [computedLineHeight, font, prep, t, truncateMode, w]);

  const fallback = Boolean(truncateMode === "end" && !prep && t.length > 0);

  return { ref, shown, fallback };
}
