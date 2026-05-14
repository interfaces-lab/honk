import { IconBrain } from "central-icons";
import { forwardRef, useEffect, useState, type HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

const DEFAULT_WORDS = ["Thinking", "Planning", "Refining"] as const;

interface ThinkingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  words?: ReadonlyArray<string>;
}

const ThinkingIndicator = forwardRef<HTMLDivElement, ThinkingIndicatorProps>(
  ({ className, words = DEFAULT_WORDS, ...props }, ref) => {
    const [index, setIndex] = useState(0);
    const safeWords = words.length > 0 ? words : DEFAULT_WORDS;
    const currentWord = safeWords[index % safeWords.length] ?? DEFAULT_WORDS[0];
    const longestWord = safeWords.reduce((a, b) => (a.length >= b.length ? a : b));

    useEffect(() => {
      if (safeWords.length <= 1) return;
      const intervalId = window.setInterval(() => {
        setIndex((value) => (value + 1) % safeWords.length);
      }, 4000);
      return () => window.clearInterval(intervalId);
    }, [safeWords.length]);

    return (
      <div
        ref={ref}
        role="status"
        aria-label="Working"
        className={cn(
          "inline-flex items-center gap-2 px-0.5 py-1.5 text-muted-foreground/80",
          className,
        )}
        {...props}
      >
        <IconBrain
          aria-hidden="true"
          className="size-5 shrink-0 opacity-80"
        />
        <span className="inline-flex items-baseline gap-1 text-body font-medium" aria-hidden="true">
          <span className="inline-grid overflow-hidden">
            <span className="col-start-1 row-start-1 invisible">{longestWord}</span>
            <span
              key={currentWord}
              className="col-start-1 row-start-1 animate-thinking-word-in thinking-shimmer will-change-[transform,opacity] motion-reduce:animate-none"
            >
              {currentWord}
            </span>
          </span>
        </span>
      </div>
    );
  },
);

ThinkingIndicator.displayName = "ThinkingIndicator";

export { ThinkingIndicator };
