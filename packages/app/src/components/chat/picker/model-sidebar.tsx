import { type ProviderInstanceId } from "@multi/contracts";
import { memo, useMemo, type ReactNode } from "react";
import { IconClock3OClock, IconSparklesThree, IconStar } from "central-icons";
import { IconGemini, IconCopilot } from "central-icons";
import { ProviderInstanceIcon } from "./instance-icon";
import { ScrollArea } from "@multi/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import { cn } from "~/lib/utils";
import type { ProviderInstanceEntry } from "../../../model/provider-instances";

/**
 * Build the hover tooltip for an instance button. Mirrors the old
 * kind-based copy but uses the entry's configured `displayName` so custom
 * instances get their user-authored name (e.g. "Codex Personal — Unavailable.").
 */
function describeUnavailableInstance(entry: ProviderInstanceEntry): string {
  const label = entry.displayName;
  if (entry.status === "ready") {
    return label;
  }
  const kind =
    entry.status === "error"
      ? "Unavailable"
      : entry.status === "warning"
        ? "Limited"
        : entry.status === "disabled"
          ? "Disabled in settings"
          : "Not ready";
  const msg = entry.snapshot.message?.trim();
  return msg ? `${label} — ${kind}. ${msg}` : `${label} — ${kind}.`;
}

/** Opens toward the rail so the list stays readable (not over the model names). */
const PICKER_TOOLTIP_SIDE = "left" as const;

function SelectedProviderIndicator() {
  return (
    <div className="pointer-events-none absolute -right-1 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary" />
  );
}

function ProviderRailBadge({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "new" | "soon";
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute -right-0.5 top-0.5 z-10 flex size-3.5 items-center justify-center rounded-full bg-transparent shadow-sm",
        variant === "new" ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground",
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

function ModelPickerTooltipPopup({ children }: { children: ReactNode }) {
  return (
    <TooltipPopup
      side={PICKER_TOOLTIP_SIDE}
      align="center"
      className="max-w-64 text-balance text-xs/4 font-normal"
    >
      {children}
    </TooltipPopup>
  );
}

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  /**
   * Instance entries to render as rail buttons. Each entry becomes one icon
   * keyed by `instanceId`, so the default built-in Codex and a user-authored
   * `codex_personal` appear as two distinct rail items, each routing to
   * their own model list.
   */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  /** Render the favorites rail entry. */
  showFavorites?: boolean;
  /** Render non-configured coming-soon provider entries. */
  showComingSoon?: boolean;
  /**
   * Instance id values that should render the "new" sparkle badge. Callers
   * pass the subset of default built-in ids they want flagged (custom
   * instances are never flagged — the user just made them).
   */
  newBadgeInstanceIds?: ReadonlySet<ProviderInstanceId>;
}) {
  const handleSelect = (instanceId: ProviderInstanceId | "favorites") => {
    props.onSelectInstance(instanceId);
  };
  const showFavorites = props.showFavorites ?? true;
  const showComingSoon = props.showComingSoon ?? true;
  const duplicateDriverCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of props.instanceEntries) {
      counts.set(entry.driverKind, (counts.get(entry.driverKind) ?? 0) + 1);
    }
    return counts;
  }, [props.instanceEntries]);

  return (
    <ScrollArea
      hideScrollbars
      scrollFade
      className="flex min-h-0 w-12 min-w-12 shrink-0 flex-1 flex-col border-r border-multi-stroke-tertiary bg-multi-bg-secondary-wash"
      data-model-picker-sidebar="true"
    >
      <div className="flex min-h-full flex-col gap-1 p-1">
        {/* Favorites section */}
        {showFavorites ? (
          <div className="mb-1 border-b border-multi-stroke-tertiary pb-1">
            <div className="relative w-full">
              {props.selectedInstanceId === "favorites" && <SelectedProviderIndicator />}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      className={cn(
                        "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-multi-control transition-colors hover:bg-multi-bg-quaternary",
                        props.selectedInstanceId === "favorites" &&
                          "bg-multi-bg-active text-multi-fg-primary shadow-sm",
                      )}
                      onClick={() => handleSelect("favorites")}
                      type="button"
                      data-model-picker-provider="favorites"
                      aria-label="Favorites"
                    >
                      <IconStar className="size-5 fill-current shrink-0" aria-hidden />
                    </button>
                  }
                />
                <ModelPickerTooltipPopup>Favorites</ModelPickerTooltipPopup>
              </Tooltip>
            </div>
          </div>
        ) : null}

        {/* Instance buttons (one per configured instance — built-in + custom) */}
        {props.instanceEntries.map((entry) => {
          const isDisabled = !entry.isAvailable || entry.status !== "ready";
          const isSelected = props.selectedInstanceId === entry.instanceId;
          const showNewBadge = props.newBadgeInstanceIds?.has(entry.instanceId) ?? false;
          const showInstanceBadge =
            Boolean(entry.accentColor) || (duplicateDriverCounts.get(entry.driverKind) ?? 0) > 1;

          const tooltip = isDisabled
            ? describeUnavailableInstance(entry)
            : showNewBadge
              ? `${entry.displayName} — New`
              : entry.displayName;

          const button = (
            <button
              data-model-picker-provider={entry.instanceId}
              className={cn(
                "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-multi-control transition-colors hover:bg-multi-bg-quaternary",
                isSelected && "bg-multi-bg-active text-multi-fg-primary shadow-sm",
                isDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
              data-provider-accent-color={entry.accentColor}
              onClick={() => !isDisabled && handleSelect(entry.instanceId)}
              disabled={isDisabled}
              type="button"
              aria-label={
                isDisabled
                  ? tooltip
                  : showNewBadge
                    ? `${entry.displayName}, new`
                    : entry.displayName
              }
            >
              <ProviderInstanceIcon
                driverKind={entry.driverKind}
                displayName={entry.displayName}
                accentColor={entry.accentColor}
                showBadge={showInstanceBadge}
                className="size-6"
                iconClassName="size-5"
              />
              {showNewBadge ? (
                <ProviderRailBadge variant="new">
                  <IconSparklesThree className="size-2" />
                </ProviderRailBadge>
              ) : null}
            </button>
          );

          const trigger = isDisabled ? (
            <span className="relative block w-full">{button}</span>
          ) : (
            button
          );

          return (
            <div key={entry.instanceId} className="relative w-full">
              {isSelected && <SelectedProviderIndicator />}
              <Tooltip>
                <TooltipTrigger render={trigger} />
                <ModelPickerTooltipPopup>{tooltip}</ModelPickerTooltipPopup>
              </Tooltip>
            </div>
          );
        })}

        {showComingSoon ? (
          <>
            {/* Gemini button (coming soon) */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="relative block w-full">
                    <button
                      className={cn(
                        "relative isolate flex aspect-square w-full cursor-not-allowed items-center justify-center rounded-multi-control opacity-50 transition-colors hover:bg-transparent",
                      )}
                      disabled
                      type="button"
                      data-model-picker-provider="gemini-coming-soon"
                      aria-label="Gemini — coming soon"
                    >
                      <IconGemini className="size-5 text-muted-foreground/85" aria-hidden />
                      <ProviderRailBadge variant="soon">
                        <IconClock3OClock className="size-2" />
                      </ProviderRailBadge>
                    </button>
                  </span>
                }
              />
              <ModelPickerTooltipPopup>Gemini — Coming soon</ModelPickerTooltipPopup>
            </Tooltip>
            {/* Github Copilot button (coming soon) */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="relative block w-full">
                    <button
                      className={cn(
                        "relative isolate flex aspect-square w-full cursor-not-allowed items-center justify-center rounded-multi-control opacity-50 transition-colors hover:bg-transparent",
                      )}
                      disabled
                      type="button"
                      data-model-picker-provider="github-copilot-coming-soon"
                      aria-label="Github Copilot — coming soon"
                    >
                      <IconCopilot className="size-5 text-muted-foreground/85" aria-hidden />
                      <ProviderRailBadge variant="soon">
                        <IconClock3OClock className="size-2" />
                      </ProviderRailBadge>
                    </button>
                  </span>
                }
              />
              <ModelPickerTooltipPopup>Github Copilot — Coming soon</ModelPickerTooltipPopup>
            </Tooltip>
          </>
        ) : null}
      </div>
    </ScrollArea>
  );
});
