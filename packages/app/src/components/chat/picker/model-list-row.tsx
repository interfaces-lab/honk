import { type ProviderDriverKind, type ProviderInstanceId } from "@multi/contracts";
import { memo } from "react";
import { IconCheckmark1Small, IconStar } from "central-icons";
import {
  getDisplayModelName,
  getTriggerDisplayModelLabel,
  type ModelEsque,
  PROVIDER_ICON_BY_PROVIDER,
} from "./icon-utils";
import { ComboboxItem } from "@multi/ui/combobox";
import { Kbd } from "@multi/ui/kbd";

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  model: ModelEsque;
  /** Instance the model belongs to — the routing key used in combobox values. */
  instanceId: ProviderInstanceId;
  /** Driver kind of the instance — used for the provider icon glyph. */
  driverKind: ProviderDriverKind;
  /**
   * Display name to show in the secondary line (provider footer). Usually
   * the instance's configured `displayName` so custom instances like
   * "Codex Personal" render with their user-authored label.
   */
  providerDisplayName: string;
  providerAccentColor?: string | undefined;
  isSelected: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  jumpLabel?: string | null;
  showFavoriteToggle?: boolean;
  isFavorite?: boolean;
  onFavoriteClick?: () => void;
}) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.driverKind] ?? null;
  const selectable = props.model.selectable !== false;
  const providerLabel = props.model.subProvider
    ? `${props.providerDisplayName} · ${props.model.subProvider}`
    : props.providerDisplayName;
  const providerLine = selectable ? providerLabel : `${providerLabel} · Unavailable`;

  return (
    <ComboboxItem
      disabled={!selectable}
      hideIndicator
      index={props.index}
      value={`${props.instanceId}:${props.model.slug}`}
      contentClassName="flex w-full items-start gap-1.5"
      className="group w-full cursor-pointer rounded-multi-control px-1.5 py-1 text-body transition-colors hover:bg-multi-bg-quaternary data-disabled:cursor-not-allowed data-highlighted:bg-multi-bg-quaternary data-selected:bg-multi-bg-active data-selected:text-multi-fg-primary"
    >
      <span
        aria-hidden="true"
        className="mt-px flex size-4 shrink-0 items-center justify-center text-multi-fg-secondary"
      >
        <IconCheckmark1Small
          className={props.isSelected ? "size-3.5 opacity-100" : "size-3.5 opacity-0"}
        />
      </span>

      <div className="min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5 text-body font-medium">
            <span className="truncate">
              {props.useTriggerLabel
                ? getTriggerDisplayModelLabel(props.model)
                : getDisplayModelName(
                    props.model,
                    props.preferShortName ? { preferShortName: true } : undefined,
                  )}
            </span>
            {props.showNewBadge ? (
              <span
                className="shrink-0 rounded border border-amber-500/35 bg-amber-500/15 px-0.5 py-px text-caption font-bold tracking-wide text-amber-800 uppercase dark:border-amber-400/30 dark:bg-amber-400/12 dark:text-amber-200"
                aria-label="New model"
              >
                New
              </span>
            ) : null}
          </div>
          <span className="flex shrink-0 items-center gap-0.5">
            {props.showFavoriteToggle ? (
              <button
                type="button"
                aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
                aria-pressed={props.isFavorite}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-multi-fg-tertiary opacity-85 transition-colors hover:bg-multi-bg-active hover:text-amber-700 hover:opacity-100 dark:text-multi-fg-secondary dark:hover:text-amber-300"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onFavoriteClick?.();
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
              >
                <IconStar
                  aria-hidden
                  className={
                    props.isFavorite
                      ? "size-3.5 shrink-0 fill-amber-500 text-amber-500"
                      : "size-3.5 shrink-0 opacity-95"
                  }
                />
              </button>
            ) : null}
            {props.jumpLabel ? (
              <Kbd className="h-4 min-w-0 shrink-0 rounded-sm px-1 text-caption">
                {props.jumpLabel}
              </Kbd>
            ) : null}
          </span>
        </div>
        {props.showProvider && (
          <div className="mt-0.5 flex items-center gap-1">
            {ProviderIcon ? <ProviderIcon className="size-3 shrink-0" /> : null}
            {props.providerAccentColor ? (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: props.providerAccentColor }}
                aria-hidden
              />
            ) : null}
            <span className="truncate text-detail font-normal text-multi-fg-tertiary">
              {providerLine}
            </span>
          </div>
        )}
      </div>
    </ComboboxItem>
  );
});
