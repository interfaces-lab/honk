import * as React from "react";

type ResolvedTheme = "light" | "dark";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function readResolvedTheme(): ResolvedTheme {
  if (typeof document !== "undefined") {
    const declared = document.documentElement.style.colorScheme;
    if (declared === "light") return "light";
    if (declared === "dark") return "dark";
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
  }
  return "dark";
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class", "data-theme"],
  });

  const media =
    typeof window.matchMedia === "function" ? window.matchMedia(DARK_MEDIA_QUERY) : null;
  media?.addEventListener("change", onStoreChange);

  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onStoreChange);
  };
}

function getServerSnapshot(): ResolvedTheme {
  return "dark";
}

export function useResolvedTheme(): ResolvedTheme {
  return React.useSyncExternalStore(subscribe, readResolvedTheme, getServerSnapshot);
}
