import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

function wellFormed(s: string) {
  const fn = Reflect.get(String.prototype, "toWellFormed") as
    | undefined
    | ((this: string) => string);
  return typeof fn === "function" ? fn.call(s) : s;
}

function useComposerPretextFont(px: number) {
  const [font, setFont] = useState(`400 ${px}px ui-sans-serif, system-ui, sans-serif`);

  useLayoutEffect(() => {
    const stack = getComputedStyle(document.documentElement)
      .getPropertyValue("--multi-font-ui")
      .trim();
    if (stack) setFont(`400 ${px}px ${stack}`);
  }, [px]);

  return font;
}

export function usePretextOneLine(opts: { text: string; fontPx?: number; lineHeightPx?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  const px = opts.fontPx ?? 12;
  const line = opts.lineHeightPx ?? Math.round(px * 1.3);
  const font = useComposerPretextFont(px);
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
    const next = () => setW(el.clientWidth);
    next();
    const ro = new ResizeObserver(next);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = useMemo(() => {
    if (!t) return "";
    if (!prep) return t;
    if (w <= 0) return t;
    const out = layoutWithLines(prep, w, line);
    const head = out.lines[0];
    if (!head) return "";
    if (out.lines.length === 1) return head.text;
    const first = head.text.replace(/\s+$/, "");
    return first ? `${first}…` : "…";
  }, [prep, t, w, line]);

  const fallback = Boolean(!prep && t.length > 0);

  return { ref, shown, fallback };
}
