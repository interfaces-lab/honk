import { useEffect, useState } from "react";

import {
  marketingDemoFinalScene,
  marketingDemoSteps,
  type MarketingDemoScene,
} from "./demo-animation";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

export function useMarketingDemoAnimation(): {
  scene: MarketingDemoScene;
  stepIndex: number;
} {
  const reducedMotion = usePrefersReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const step = marketingDemoSteps[stepIndex];
    if (!step) {
      return;
    }

    const timer = window.setTimeout(() => {
      setStepIndex((current) => (current + 1) % marketingDemoSteps.length);
    }, step.holdMs);

    return () => window.clearTimeout(timer);
  }, [reducedMotion, stepIndex]);

  if (reducedMotion) {
    return { scene: marketingDemoFinalScene, stepIndex: marketingDemoSteps.length - 1 };
  }

  return {
    scene: marketingDemoSteps[stepIndex]?.scene ?? marketingDemoFinalScene,
    stepIndex,
  };
}
