import * as stylex from "@stylexjs/stylex";

import { Shell } from "@honk/ui/shell";
import { TabStrip, type TabDescriptor } from "@honk/ui/tabs";
import { elevationVars, radiusVars, shellVars } from "@honk/ui/tokens.stylex";

import { cn } from "../lib/classes";
import {
  demoProjectLabel,
  isMarketingDemoThreadId,
  marketingDemoThreads,
  type ThreadState,
} from "./product-frame/demo-data";
import { MarketingChat } from "./product-frame/marketing-chat";
import { useMarketingDemoAnimation } from "./product-frame/use-marketing-demo-animation";

// Fixed macOS traffic-light geometry and colors; OS chrome facts, not themeable tokens.
const TRAFFIC_LIGHT_SIZE = "12px";
const TRAFFIC_LIGHT_GAP = "8px";
const TRAFFIC_LIGHT_INSET = "20px";
const TRAFFIC_LIGHT_COLORS = ["#ff5f57", "#febc2e", "#28c840"] as const;

const styles = stylex.create({
  window: {
    position: "relative",
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-window"],
    // The floating elevation already carries the half-pixel definition ring; no border needed.
    boxShadow: elevationVars["--honk-elevation-floating"],
  },
  trafficLights: {
    position: "absolute",
    insetInlineStart: TRAFFIC_LIGHT_INSET,
    // Center the dots in the titlebar's content area below the seat padding.
    top: `calc(${shellVars["--honk-shell-titlebar-seat"]} + (${shellVars["--honk-shell-titlebar-h"]} - ${shellVars["--honk-shell-titlebar-seat"]}) / 2 - ${TRAFFIC_LIGHT_SIZE} / 2)`,
    display: "flex",
    columnGap: TRAFFIC_LIGHT_GAP,
    pointerEvents: "none",
  },
  trafficLight: (color: string) => ({
    width: TRAFFIC_LIGHT_SIZE,
    height: TRAFFIC_LIGHT_SIZE,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: color,
  }),
});

function marketingTabStatus(state: ThreadState): TabDescriptor["status"] {
  if (state === "running") return "working";
  if (state === "needs_attention") return "needs-you";
  if (state === "draft") return "draft";
  return "done";
}

function noop() {}

function MarketingWorkspace() {
  const demo = useMarketingDemoAnimation();

  const tabs: TabDescriptor[] = [
    { key: "home", title: "Home", kind: "home", status: "idle" },
    ...marketingDemoThreads.map((thread) => ({
      key: thread.id,
      title: thread.title,
      kind: "thread" as const,
      status: marketingTabStatus(demo.scene.threadStates[thread.id]),
      repository: { state: "ready" as const, label: demoProjectLabel },
      server: { label: "Local", kind: "local" as const },
    })),
  ];

  return (
    <Shell style={{ height: "100%" }}>
      <Shell.TitleBar>
        <TabStrip
          tabs={tabs}
          activeKey={demo.scene.activeThreadId}
          onActivate={(key) => {
            if (isMarketingDemoThreadId(key)) demo.activateThread(key);
          }}
          onClose={noop}
          onReorder={noop}
          onNew={noop}
          style={{ flexGrow: 1, minWidth: 0 }}
        />
      </Shell.TitleBar>
      <Shell.Stage>
        <Shell.Sheet>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <MarketingChat
              activeThreadId={demo.scene.activeThreadId}
              messages={demo.scene.messages}
              busy={demo.busy}
              onSubmitPrompt={demo.submitPrompt}
            />
          </div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

type ProductFrameProps = {
  className?: string;
};

export function ProductFrame({ className }: ProductFrameProps) {
  return (
    <div
      role="group"
      aria-label="Honk workspace preview"
      className={cn(
        // honk-marketing-preview (src/index.css) restores the app's font family and rebinds the
        // Tailwind font aliases inside the frame, so the page's Geist voice stops at this
        // boundary and the preview renders exactly like the desktop app.
        "honk-marketing-preview relative mx-auto aspect-[4/3] w-full max-w-full sm:aspect-[16/10]",
        className,
      )}
    >
      <div {...stylex.props(styles.window)}>
        <MarketingWorkspace />
        <div aria-hidden {...stylex.props(styles.trafficLights)}>
          {TRAFFIC_LIGHT_COLORS.map((color) => (
            <span key={color} {...stylex.props(styles.trafficLight(color))} />
          ))}
        </div>
      </div>
    </div>
  );
}
