"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn, interactiveControlCursorClassName } from "./utils";

function CollapsibleRoot(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ className, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn(interactiveControlCursorClassName, className)}
      data-slot="collapsible-trigger"
      {...props}
    />
  );
}

function CollapsiblePanel({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0 data-open:data-ending-style:[height:var(--collapsible-panel-height)]",
        className,
      )}
      data-slot="collapsible-panel"
      {...props}
    />
  );
}

type CollapsibleCompound = typeof CollapsibleRoot & {
  Root: typeof CollapsibleRoot;
  Trigger: typeof CollapsibleTrigger;
  Panel: typeof CollapsiblePanel;
};

const Collapsible = Object.assign(CollapsibleRoot, {
  Root: CollapsibleRoot,
  Trigger: CollapsibleTrigger,
  Panel: CollapsiblePanel,
}) as CollapsibleCompound;

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
  CollapsiblePanel as CollapsibleContent,
};
