import { IconBrain } from "central-icons";
import { forwardRef, useEffect, useState, type HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

const DEFAULT_WORDS = ["Thinking", "Planning", "Refining"] as const;

interface ThinkingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  createdAt?: string | null;
  words?: ReadonlyArray<string>;
}

const ThinkingIndicator = forwardRef<HTMLDivElement, ThinkingIndicatorProps>(
  ({ className, createdAt = null, words = DEFAULT_WORDS, ...props }, ref) => {
    const [index, setIndex] = useState(0);
    const elapsed = useElapsedLabel(createdAt);
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
          className="size-5 shrink-0 animate-thinking-glyph opacity-80 will-change-[transform,opacity] motion-reduce:animate-none"
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
          {elapsed ? (
            <span className="font-normal text-muted-foreground">for {elapsed}</span>
          ) : null}
        </span>
      </div>
    );
  },
);

ThinkingIndicator.displayName = "ThinkingIndicator";

function useElapsedLabel(createdAt: string | null): string | null {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!createdAt) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [createdAt]);

  if (!createdAt) return null;
  return formatElapsed(createdAt, nowMs);
}

function formatElapsed(startIso: string, endMs: number): string | null {
  const startedAtMs = Date.parse(startIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endMs)) return null;

  const elapsedSeconds = Math.max(0, Math.floor((endMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export { ThinkingIndicator };
