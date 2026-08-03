import { useSyncExternalStore } from "react";

import { fontFamilyCssValue, normalizeFontFamily } from "./font-family";

type LocalFontFamily = {
  readonly family: string;
  readonly isMonospace: boolean;
};

type LocalFontsSnapshot =
  | { readonly phase: "idle"; readonly families: readonly LocalFontFamily[] }
  | { readonly phase: "loading"; readonly families: readonly LocalFontFamily[] }
  | { readonly phase: "ready"; readonly families: readonly LocalFontFamily[] }
  | { readonly phase: "unavailable"; readonly families: readonly LocalFontFamily[] };

const IDLE: LocalFontsSnapshot = Object.freeze({ phase: "idle", families: [] });
const LOADING: LocalFontsSnapshot = Object.freeze({ phase: "loading", families: [] });
const listeners = new Set<() => void>();
let snapshot: LocalFontsSnapshot = IDLE;

function useLocalFonts(): LocalFontsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
}

function loadLocalFonts(): void {
  if (snapshot.phase === "loading" || snapshot.phase === "ready") return;
  publish(LOADING);
  void readLocalFonts().then(
    (families) => {
      publish(Object.freeze({ phase: "ready", families: Object.freeze(families) }));
    },
    () => {
      publish(Object.freeze({ phase: "unavailable", families: [] }));
    },
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LocalFontsSnapshot {
  return snapshot;
}

function publish(next: LocalFontsSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => {
    listener();
  });
}

async function readLocalFonts(): Promise<readonly LocalFontFamily[]> {
  if (typeof window === "undefined") return [];
  const query: unknown = Reflect.get(window, "queryLocalFonts");
  if (typeof query !== "function") throw new Error("Local Font Access API is unavailable.");
  const result: unknown = await Reflect.apply(query, window, []);
  if (!Array.isArray(result)) return [];
  const entries: readonly unknown[] = result;
  const families = [
    ...new Set(
      entries.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const family = normalizeFontFamily(Reflect.get(entry, "family"));
        return family === null ? [] : [family];
      }),
    ),
  ].sort((left, right) => left.localeCompare(right));
  return families.map((family) => ({ family, isMonospace: isMonospaceFont(family) }));
}

function isMonospaceFont(family: string): boolean {
  if (typeof document === "undefined") return false;
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) return false;
  // Measurement size is classifier geometry; it does not paint product UI.
  context.font = `16px ${fontFamilyCssValue(family, "monospace")}`;
  const widths = ["i", "l", "W", "M", "1"].map((glyph) => context.measureText(glyph).width);
  return Math.max(...widths) - Math.min(...widths) <= 0.01;
}

export { loadLocalFonts, useLocalFonts };
export type { LocalFontFamily, LocalFontsSnapshot };
