import { useCallback, useEffect, useRef, useState } from "react";

import type { MarketingDemoThreadId } from "./demo-data";
import {
  marketingDemoFinalScene,
  marketingDemoSteps,
  settledThreadScene,
  type MarketingDemoScene,
  type MarketingTimelineItem,
} from "./demo-animation";
import { resolveMarketingReply } from "./demo-interaction";

// After this much quiet the demo returns to its autoplay tour.
const IDLE_RESUME_MS = 30_000;

type DemoState =
  | { mode: "autoplay"; stepIndex: number }
  | { mode: "interactive"; scene: MarketingDemoScene; busy: boolean };

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

// Loading tool calls resolve in place: a beat with a known callId replaces its earlier row.
function withItem(
  messages: readonly MarketingTimelineItem[],
  item: MarketingTimelineItem,
): readonly MarketingTimelineItem[] {
  if (item.kind === "tool") {
    const at = messages.findIndex(
      (message) => message.kind === "tool" && message.callId === item.callId,
    );
    if (at >= 0) return [...messages.slice(0, at), item, ...messages.slice(at + 1)];
  }
  return [...messages, item];
}

export function useMarketingDemoAnimation(): {
  scene: MarketingDemoScene;
  busy: boolean;
  activateThread: (threadId: MarketingDemoThreadId) => void;
  submitPrompt: (text: string) => void;
} {
  const reducedMotion = usePrefersReducedMotion();
  const [state, setState] = useState<DemoState>({ mode: "autoplay", stepIndex: 0 });
  const timersRef = useRef<number[]>([]);

  const clearScriptTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, []);

  useEffect(() => clearScriptTimers, [clearScriptTimers]);

  const scene =
    state.mode === "interactive"
      ? state.scene
      : reducedMotion
        ? marketingDemoFinalScene
        : (marketingDemoSteps[state.stepIndex]?.scene ?? marketingDemoFinalScene);

  // Autoplay tour advances on each step's hold time.
  useEffect(() => {
    if (state.mode !== "autoplay" || reducedMotion) return;
    const step = marketingDemoSteps[state.stepIndex];
    if (!step) return;

    const timer = window.setTimeout(() => {
      setState({ mode: "autoplay", stepIndex: (state.stepIndex + 1) % marketingDemoSteps.length });
    }, step.holdMs);

    return () => window.clearTimeout(timer);
  }, [reducedMotion, state]);

  // A quiet interactive session hands control back to the tour. Reduced motion stays put:
  // resuming would swap content nobody asked for.
  useEffect(() => {
    if (state.mode !== "interactive" || state.busy || reducedMotion) return;
    const timer = window.setTimeout(() => {
      setState({ mode: "autoplay", stepIndex: 0 });
    }, IDLE_RESUME_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, state]);

  const activateThread = useCallback(
    (threadId: MarketingDemoThreadId) => {
      clearScriptTimers();
      setState({ mode: "interactive", scene: settledThreadScene(threadId), busy: false });
    },
    [clearScriptTimers],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      if (state.mode === "interactive" && state.busy) return;
      clearScriptTimers();

      const threadId = scene.activeThreadId;
      const opening: MarketingDemoScene = {
        activeThreadId: threadId,
        messages: [...scene.messages, { kind: "user", text }],
        threadStates: { ...scene.threadStates, [threadId]: "running" },
      };
      setState({ mode: "interactive", scene: opening, busy: true });

      const beats = resolveMarketingReply(text);
      let elapsed = 0;
      beats.forEach((beat, index) => {
        elapsed += beat.delayMs;
        const last = index === beats.length - 1;
        const timer = window.setTimeout(() => {
          setState((current) => {
            if (current.mode !== "interactive") return current;
            return {
              mode: "interactive",
              scene: {
                activeThreadId: current.scene.activeThreadId,
                messages: withItem(current.scene.messages, beat.item),
                threadStates: last
                  ? { ...current.scene.threadStates, [threadId]: "done" }
                  : current.scene.threadStates,
              },
              busy: !last,
            };
          });
        }, elapsed);
        timersRef.current.push(timer);
      });
    },
    [clearScriptTimers, scene, state],
  );

  return {
    scene,
    busy: state.mode === "interactive" && state.busy,
    activateThread,
    submitPrompt,
  };
}
