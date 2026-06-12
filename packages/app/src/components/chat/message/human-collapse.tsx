import { useState, type ReactNode } from "react";
import { Button } from "@honk/multikit/button";
import { cn } from "~/lib/utils";

const COLLAPSED_MAX_PX = 72;

function measureOverflow(el: HTMLElement): boolean {
  return el.scrollHeight > COLLAPSED_MAX_PX + 1;
}

export function HumanMessageCollapsible({ children }: { children: ReactNode }) {
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measureElement = (el: HTMLDivElement | null) => {
    if (!el) {
      return;
    }
    const measure = () => {
      const next = measureOverflow(el);
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
  };

  const collapsed = overflows && !expanded;

  return (
    <div className="min-w-0">
      <div
        className={cn(
          collapsed &&
            "relative max-h-[72px] overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-[linear-gradient(to_bottom,transparent_0%,var(--honk-message-bubble-background)_72%,var(--honk-message-bubble-background)_100%)] after:content-['']",
        )}
      >
        <div ref={measureElement}>{children}</div>
      </div>
      {overflows ? (
        <Button
          data-human-message-collapse-toggle=""
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
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}
