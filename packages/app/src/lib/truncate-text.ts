import { measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import * as React from "react";

const ELLIPSIS = "…";
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type TextMeasure = (text: string) => number;

function pretextMeasure(font: string): TextMeasure {
  return (text) => measureNaturalWidth(prepareWithSegments(text, font));
}

/**
 * Leading truncation ("…CHING.md"): keeps the end of the string, which for file
 * names is the distinctive part. Grapheme-safe (emoji/CJK never split) and
 * measurement-based, so no bidi tricks are involved.
 */
export function truncateLeading(text: string, maxWidth: number, measure: TextMeasure): string {
  if (maxWidth <= 0) return ELLIPSIS;
  if (measure(text) <= maxWidth) return text;
  const graphemes = [...GRAPHEMES.segment(text)].map((segment) => segment.segment);
  // fits(start) is monotone in the suffix start index; find the longest fitting suffix.
  let low = 1;
  let high = graphemes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (measure(ELLIPSIS + graphemes.slice(mid).join("")) <= maxWidth) high = mid;
    else low = mid + 1;
  }
  return ELLIPSIS + graphemes.slice(low).join("");
}

type TruncatedPath = {
  readonly hostRef: React.RefCallback<HTMLElement>;
  readonly dirDisplay: string | null;
  readonly nameDisplay: string;
};

/**
 * Fits "dir + name" into the observed host width the way Cursor's rows degrade:
 * full path first, then the directory prefix is dropped, then the name itself
 * leading-truncates. The host must be the flexible, overflow-hidden container
 * whose width is set by its siblings, so writing the display text back cannot
 * feed the observer.
 */
export function useTruncatedPath(dir: string, name: string): TruncatedPath {
  const [budget, setBudget] = React.useState<{ width: number; font: string } | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  // Callback ref instead of an effect: observing starts the moment the host exists and
  // ends on detach, with no dependency plumbing. Stable identity so React invokes it
  // only on mount/unmount.
  const hostRef: React.RefCallback<HTMLElement> = React.useCallback((element) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined) return;
      const style = getComputedStyle(element);
      setBudget((previous) => {
        const font = `${style.fontSize} ${style.fontFamily}`;
        return previous !== null && previous.width === width && previous.font === font
          ? previous
          : { width, font };
      });
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  const path = React.useMemo(() => {
    if (budget === null) return { dirDisplay: dir.length > 0 ? dir : null, nameDisplay: name };
    const measure = pretextMeasure(budget.font);
    if (dir.length > 0 && measure(dir + name) <= budget.width) {
      return { dirDisplay: dir, nameDisplay: name };
    }
    if (measure(name) <= budget.width) return { dirDisplay: null, nameDisplay: name };
    return { dirDisplay: null, nameDisplay: truncateLeading(name, budget.width, measure) };
  }, [budget, dir, name]);

  return { hostRef, dirDisplay: path.dirDisplay, nameDisplay: path.nameDisplay };
}
