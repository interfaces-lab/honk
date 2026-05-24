import {
  type ModelSelection,
  type ProviderInstanceId,
  type ResolvedKeybindingsConfig,
} from "@multi/contracts";
import { memo, useMemo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { IconChevronRightMedium } from "central-icons";
import { Button, buttonVariants } from "@multi/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@multi/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import { cn } from "~/lib/utils";
import { ModelPickerContent } from "./model-content";
import { ProviderInstanceIcon } from "./instance-icon";
import { getTriggerDisplayModelLabel, getTriggerDisplayModelName } from "./icon-utils";
import type { ProviderInstanceEntry } from "../../../model/provider-instances";
import type { AppModelCatalogItem, AppModelResolverStatus } from "../../../model/selection";

type ModelPickerPopoverPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end";

type ResolvedModelPickerPopoverPlacement = {
  side: "top" | "bottom";
  align: "start" | "center" | "end";
};

const MODEL_PICKER_POPOVER_PLACEMENTS: Record<
  ModelPickerPopoverPlacement,
  ResolvedModelPickerPopoverPlacement
> = {
  top: { side: "top", align: "center" },
  "top-start": { side: "top", align: "start" },
  "top-end": { side: "top", align: "end" },
  bottom: { side: "bottom", align: "center" },
  "bottom-start": { side: "bottom", align: "start" },
  "bottom-end": { side: "bottom", align: "end" },
};

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  /**
   * The instance currently selected in the composer. Drives the trigger
   * icon, label and the default-highlighted combobox row.
   */
  activeInstanceId: ProviderInstanceId;
  model: string;
  /** Instance entries rendered in the sidebar + used to resolve display name. */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelCatalogItems: ReadonlyArray<AppModelCatalogItem>;
  selectedCatalogItem: AppModelCatalogItem | undefined;
  availabilityStatus?: AppModelResolverStatus | undefined;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  /**
   * When the popover opens, seed the model search field (e.g. trailing text after `/model`).
   * `undefined` keeps the previous search query from the last open.
   */
  openSearchSeed?: string | undefined;
  popoverPlacement?: ModelPickerPopoverPlacement;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  onSelectionChange: (selection: ModelSelection) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;

  // Resolve the active instance entry by exact routing key. The composer
  // resolves fallbacks before rendering this component; if the selected
  // instance disappears, do not infer a replacement from its driver kind.
  const activeEntry = useMemo(() => {
    return (
      props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null
    );
  }, [props.activeInstanceId, props.instanceEntries]);

  const activeInstanceId = props.activeInstanceId;
  const modelCatalogItems = props.modelCatalogItems;
  const selectedModel = props.selectedCatalogItem;
  const triggerTitle = selectedModel ? getTriggerDisplayModelName(selectedModel) : props.model;
  const triggerSubtitle = selectedModel?.subProvider;
  const triggerLabel = selectedModel ? getTriggerDisplayModelLabel(selectedModel) : props.model;
  const availabilityMessage =
    props.availabilityStatus && props.availabilityStatus.kind !== "ready"
      ? props.availabilityStatus.message
      : null;
  const popoverPlacement =
    MODEL_PICKER_POPOVER_PLACEMENTS[props.popoverPlacement ?? "bottom-start"];
  const duplicateDriverCount = props.instanceEntries.filter(
    (entry) => activeEntry !== null && entry.driverKind === activeEntry.driverKind,
  ).length;
  const showInstanceBadge = Boolean(activeEntry?.accentColor) || duplicateDriverCount > 1;

  const setIsMenuOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open);
    }
  };

  const handleSelectionChange = (selection: ModelSelection) => {
    if (props.disabled) return;
    props.onSelectionChange(selection);
    setIsMenuOpen(false);
  };

  return (
    <Popover
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            data-chat-provider-model-picker="true"
            className={cn(
              "ui-model-picker__trigger max-w-full min-w-0 select-none justify-start overflow-hidden rounded-full px-1.5 py-2.5 text-muted-foreground/70 whitespace-nowrap hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "shrink" : "max-w-48 shrink sm:max-w-56 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 w-full box-border items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36 sm:pl-1" : undefined,
          )}
        >
          {activeEntry ? (
            <ProviderInstanceIcon
              driverKind={activeEntry.driverKind}
              displayName={activeEntry.displayName}
              accentColor={activeEntry.accentColor}
              showBadge={showInstanceBadge}
              className={cn(
                props.compact
                  ? showInstanceBadge
                    ? "size-4"
                    : "h-lh w-3.5"
                  : showInstanceBadge
                    ? "size-5"
                    : "h-lh w-4",
              )}
              iconClassName={cn(
                props.compact ? "w-3.5" : "w-4",
                "block h-lh",
                props.activeProviderIconClassName,
              )}
              badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 text-[7px]"
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "ui-model-picker__trigger-text min-w-0 max-w-full flex-1 overflow-hidden",
                    triggerSubtitle
                      ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1"
                      : "truncate",
                  )}
                />
              }
            >
              {triggerSubtitle ? (
                <>
                  <span className="min-w-0 truncate">{triggerTitle}</span>
                  <span aria-hidden="true" className="shrink-0 opacity-60">
                    ·
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground/85">
                    {triggerSubtitle}
                  </span>
                </>
              ) : (
                triggerTitle
              )}
            </TooltipTrigger>
            <TooltipPopup side="top" className="max-w-64">
              <span className="block">{triggerLabel}</span>
              {availabilityMessage ? (
                <span className="block pt-1 text-xs/4 text-multi-fg-tertiary">
                  {availabilityMessage}
                </span>
              ) : null}
            </TooltipPopup>
          </Tooltip>
          <IconChevronRightMedium
            aria-hidden="true"
            className="ui-model-picker__trigger-chevron block h-lh w-3 shrink-0 rotate-90 opacity-60"
          />
        </span>
      </PopoverTrigger>
      <PopoverPopup
        align={popoverPlacement.align}
        initialFocus={false}
        side={popoverPlacement.side}
        data-chat-model-picker-popup=""
        className="z-[70] border-0 bg-transparent p-0 shadow-none before:hidden transition-none data-starting-style:scale-100 data-starting-style:opacity-100 data-ending-style:scale-100 data-ending-style:opacity-100 [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:p-0"
      >
        <ModelPickerContent
          activeInstanceId={activeInstanceId}
          model={props.model}
          instanceEntries={props.instanceEntries}
          {...(props.keybindings ? { keybindings: props.keybindings } : {})}
          availabilityStatus={props.availabilityStatus}
          modelCatalogItems={modelCatalogItems}
          terminalOpen={props.terminalOpen ?? false}
          popoverOpen={isMenuOpen}
          openSearchSeed={props.openSearchSeed}
          onRequestClose={() => setIsMenuOpen(false)}
          onSelectionChange={handleSelectionChange}
        />
      </PopoverPopup>
    </Popover>
  );
});
