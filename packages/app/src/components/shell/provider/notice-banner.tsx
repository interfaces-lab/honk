import { IconCrossSmall, IconLightning, IconSettingsGear2, IconX } from "central-icons";
import type { OrchestrationThreadActivity, ProviderKind } from "@multi/contracts";
import { PROVIDER_NOTICE_KIND } from "~/lib/ui-session-types";
import { useEffect, useState } from "react";

import { deriveProviderNotice, formatNoticeWait } from "~/lib/provider-notice";
import { cn } from "~/lib/utils";
import { Button } from "@multi/ui/button";

function Icon(props: { kind: string; level: "warning" | "error" }) {
  if (props.kind === PROVIDER_NOTICE_KIND.config) {
    return (
      <IconSettingsGear2
        className={cn(
          "size-4 shrink-0",
          props.level === "error" ? "text-destructive/85" : "text-amber-300/85",
        )}
      />
    );
  }
  if (props.kind === PROVIDER_NOTICE_KIND.auth) {
    return (
      <IconX
        className={cn(
          "size-4 shrink-0",
          props.level === "error" ? "text-destructive/85" : "text-amber-300/85",
        )}
      />
    );
  }
  return (
    <IconLightning
      className={cn(
        "size-4 shrink-0",
        props.level === "error" ? "text-destructive/85" : "text-amber-300/85",
      )}
    />
  );
}

function tone(level: "warning" | "error") {
  if (level === "error") {
    return {
      shell: "border-destructive/30 bg-destructive/8",
      text: "text-destructive/92",
      sub: "text-destructive/75",
      line: "bg-destructive/16",
    };
  }
  return {
    shell: "border-amber-300/18 bg-amber-300/7",
    text: "text-foreground/90",
    sub: "text-foreground/68",
    line: "bg-amber-300/12",
  };
}

export function ProviderNoticeBanner(props: {
  sessionId: string;
  provider: ProviderKind | null;
  activities: readonly OrchestrationThreadActivity[];
}) {
  const [now, setNow] = useState(Date.now());
  const [gone, setGone] = useState<string | null>(null);

  const item = deriveProviderNotice({
    activities: props.activities,
    provider: props.provider,
    now,
  });
  const show = item !== null && gone !== item.id;

  useEffect(() => {
    if (!show || item?.until === null) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [item?.until, show]);

  if (!show || item === null) {
    return null;
  }

  const view = item;
  const style = tone(view.level);
  const wait = view.until ? formatNoticeWait(view.until, now) : null;
  const text =
    view.kind === PROVIDER_NOTICE_KIND.rateLimit && wait
      ? `The next message can be sent after ${wait}.`
      : (view.detail ?? null);

  return (
    <div className="px-4 pt-4 md:px-8">
      <section
        className={cn(
          "mx-auto flex max-w-[43.875rem] min-w-0 flex-col overflow-hidden rounded-multi-card border shadow-multi-card backdrop-blur-xl",
          style.shell,
        )}
      >
        <div className="flex min-w-0 items-start gap-3 px-3 py-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-multi-control border border-white/6 bg-black/10">
            <Icon kind={view.kind} level={view.level} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-medium text-body/[1.25]", style.text)}>
                  {view.title}
                </p>
                {text ? <p className={cn("mt-1 text-body/[1.45]", style.sub)}>{text}</p> : null}
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Dismiss provider notice"
                onClick={() => setGone(view.id)}
                className="shrink-0 border-transparent bg-transparent text-muted-foreground/70 hover:text-foreground"
              >
                <IconCrossSmall className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
