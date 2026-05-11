import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";

const COLLAPSED_MAX_PX = 72;
const MASK_SOLID_PERCENT = 65;

function measureOverflow(el: HTMLElement): boolean {
  return el.scrollHeight > COLLAPSED_MAX_PX + 1;
}

export const HumanMessageCollapsible = memo(function HumanMessageCollapsible({
  children,
}: {
  children: ReactNode;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = measureRef.current;
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
  }, [children]);

  const collapsed = overflows && !expanded;

  return (
    <div className="min-w-0">
      <div
        className={cn(collapsed && "max-h-[72px] overflow-hidden")}
        style={
          collapsed
            ? {
                maskImage: `linear-gradient(to bottom, black ${MASK_SOLID_PERCENT}%, transparent 100%)`,
                WebkitMaskImage: `linear-gradient(to bottom, black ${MASK_SOLID_PERCENT}%, transparent 100%)`,
              }
            : undefined
        }
      >
        <div ref={measureRef}>{children}</div>
      </div>
      {overflows ? (
        <button
          type="button"
          data-human-message-collapse-toggle=""
          className={cn(
            "mt-1 text-left text-[11px]/[14px] font-medium text-muted-foreground/80",
            "hover:text-muted-foreground hover:underline",
          )}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((prev) => !prev);
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
});
