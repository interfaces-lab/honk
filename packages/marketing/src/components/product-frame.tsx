import "~/lib/diff-rendering";

import { cn } from "@honk/honkkit/utils";

import { MarketingChat } from "./product-frame/marketing-chat";
import { marketingDemoThread } from "./product-frame/demo-data";
import { MarketingSidebar } from "./product-frame/marketing-sidebar";
import { MarketingWorkspaceHeader } from "./product-frame/marketing-workspace-header";
import { useMarketingDemoAnimation } from "./product-frame/use-marketing-demo-animation";

function MarketingWorkspace() {
  const { scene, stepIndex } = useMarketingDemoAnimation();

  return (
    <div
      className="honk-marketing-preview flex h-full min-h-0 flex-col overflow-hidden font-honk text-body text-honk-fg-primary antialiased"
      data-honk-glass-mode="false"
    >
      <MarketingWorkspaceHeader threadTitle={marketingDemoThread.title} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <MarketingSidebar threadState={scene.threadState} />
        <div className="flex min-h-0 min-w-0 flex-[1_1_0%] flex-col overflow-hidden">
          <MarketingChat messages={scene.messages} stepIndex={stepIndex} />
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
        "relative mx-auto aspect-[16/10] h-full max-h-full w-auto max-w-[min(72vw,950px,100%)] min-h-0",
        className,
      )}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 dark:border-white/10 dark:shadow-none">
        <MarketingWorkspace />
      </div>
    </div>
  );
}
