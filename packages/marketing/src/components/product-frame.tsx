import "~/lib/diff-rendering";

import { cn } from "@honk/honkkit/utils";

import { marketingDemoThreadTitle } from "./product-frame/demo-data";
import { MarketingChat } from "./product-frame/marketing-chat";
import { MarketingMobileThreadRail } from "./product-frame/marketing-mobile-thread-rail";
import { MarketingSidebar } from "./product-frame/marketing-sidebar";
import { MarketingWorkspaceHeader } from "./product-frame/marketing-workspace-header";
import { useMarketingDemoAnimation } from "./product-frame/use-marketing-demo-animation";

function MarketingWorkspace() {
  const { scene, stepIndex } = useMarketingDemoAnimation();

  return (
    <div
      className="honk-marketing-preview @container/marketing-workspace flex h-full min-h-0 flex-col overflow-hidden font-honk text-body text-honk-fg-primary antialiased"
      data-honk-glass-mode="false"
    >
      <MarketingWorkspaceHeader threadTitle={marketingDemoThreadTitle(scene.activeThreadId)} />
      <MarketingMobileThreadRail
        activeThreadId={scene.activeThreadId}
        threadStates={scene.threadStates}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <MarketingSidebar activeThreadId={scene.activeThreadId} threadStates={scene.threadStates} />
        <div className="flex min-h-0 min-w-0 flex-[1_1_0%] flex-col overflow-hidden">
          <MarketingChat
            activeThreadId={scene.activeThreadId}
            messages={scene.messages}
            stepIndex={stepIndex}
          />
        </div>
      </div>
    </div>
  );
}

type ProductFrameProps = {
  className?: string;
};

export function ProductFrame({ className }: ProductFrameProps) {
  return (
    <div
      aria-label="Honk workspace preview"
      id="workspace"
      className={cn(
        "relative mx-auto aspect-[16/10] h-auto max-h-[100cqh] w-[min(100%,calc(100cqh*1.6))] min-h-0 max-w-full",
        className,
      )}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 dark:border-white/10 dark:shadow-none">
        <MarketingWorkspace />
      </div>
    </div>
  );
}
