"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Button } from "./button";
import { cn } from "./utils";

const DEFAULT_COLLAPSED_MAX_PX = 72;

function measureOverflow(el: HTMLElement, collapsedMaxPx: number): boolean {
  return el.scrollHeight > collapsedMaxPx + 1;
}

function ConversationCollapse({
  children,
  className,
  collapsedMaxPx = DEFAULT_COLLAPSED_MAX_PX,
  collapseLabel = "Show less",
  expandLabel = "Show more",
  ...props
}: Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  children: ReactNode;
  collapsedMaxPx?: number | undefined;
  collapseLabel?: string | undefined;
  expandLabel?: string | undefined;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const next = measureOverflow(el, collapsedMaxPx);
      setOverflows(next);
      if (!next) {
        setExpanded(false);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [collapsedMaxPx]);

  const collapsed = overflows && !expanded;

  return (
    <div className={cn("min-w-0", className)} data-slot="conversation-collapse" {...props}>
      <div
        className={cn(
          collapsed &&
            "relative max-h-[var(--conversation-collapse-max-height)] overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-[linear-gradient(to_bottom,transparent_0%,var(--honk-message-bubble-background)_72%,var(--honk-message-bubble-background)_100%)] after:content-['']",
        )}
        data-slot="conversation-collapse-clip"
        data-collapsed={collapsed ? "true" : undefined}
        style={
          collapsed
            ? ({
                "--conversation-collapse-max-height": `${collapsedMaxPx}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {overflows ? (
        <Button
          data-conversation-collapse-toggle=""
          size="xs"
          variant="link"
          className={cn(
            "mt-1 h-auto justify-start p-0 text-left text-detail font-medium text-muted-foreground/80",
            "hover:text-muted-foreground hover:underline",
          )}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((prev) => !prev);
          }}
        >
          {expanded ? collapseLabel : expandLabel}
        </Button>
      ) : null}
    </div>
  );
}

export { ConversationCollapse };
