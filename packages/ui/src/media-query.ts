import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

function subscribeToMobileQuery(onStoreChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onStoreChange);

  return () => {
    media.removeEventListener("change", onStoreChange);
  };
}

function getMobileQuerySnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getMobileQueryServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribeToMobileQuery,
    getMobileQuerySnapshot,
    getMobileQueryServerSnapshot,
  );
}
