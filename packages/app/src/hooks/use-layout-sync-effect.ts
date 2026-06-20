import { useLayoutEffect, type DependencyList, type EffectCallback } from "react";

export function useLayoutSyncEffect(effect: EffectCallback, deps: DependencyList): void {
  useLayoutEffect(effect, deps);
}
