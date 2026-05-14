"use client";

import {
  IconChevronRightMedium,
  IconEyeOpen as EyeIcon,
  IconEyeClosed as EyeOffIcon,
  IconInfoSimple as InfoIcon,
  IconPlusLarge as PlusIcon,
  IconStar as StarIcon,
  IconCrossMediumDefault as XIcon,
} from "central-icons";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProviderModel,
} from "@multi/contracts";
import { normalizeModelSlug } from "@multi/shared/model";

import { cn } from "../../lib/utils";
import { sortModelsForProviderInstance } from "../../model-ordering";
import { MAX_CUSTOM_MODEL_LENGTH } from "../../model-selection";
import { Button } from "@multi/ui/button";
import { Input } from "@multi/ui/input";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@multi/ui/tooltip";

/**
 * Placeholder text for the "add a custom model" input, keyed by driver
 * kind. Mirrors the prior hardcoded switch in `SettingsPanels.tsx` so the
 * UX is unchanged — only the owning component has moved.
 */
const CUSTOM_MODEL_PLACEHOLDER_BY_KIND: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("codex")]: "gpt-6.7-codex-ultra-preview",
  [ProviderDriverKind.make("claudeAgent")]: "claude-sonnet-5-0",
  [ProviderDriverKind.make("cursor")]: "claude-sonnet-4-6",
  [ProviderDriverKind.make("opencode")]: "openai/gpt-5",
};

function collectCapabilityLabels(model: ServerProviderModel): string[] {
  const descriptors = model.capabilities?.optionDescriptors ?? [];
  const capLabels: string[] = [];
  if (descriptors.some((descriptor) => descriptor.id === "fastMode")) {
    capLabels.push("Fast mode");
  }
  if (descriptors.some((descriptor) => descriptor.id === "thinking")) {
    capLabels.push("Thinking");
  }
  if (
    descriptors.some(
      (descriptor) =>
        descriptor.type === "select" &&
        (descriptor.id === "reasoningEffort" ||
          descriptor.id === "effort" ||
          descriptor.id === "reasoning" ||
          descriptor.id === "variant"),
    )
  ) {
    capLabels.push("Reasoning");
  }
  return capLabels;
}

interface ProviderModelRowProps {
  readonly model: ServerProviderModel;
  readonly isHidden: boolean;
  readonly isFavorite: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onToggleFavorite: (slug: string) => void;
  readonly onMoveUp: (slug: string) => void;
  readonly onMoveDown: (slug: string) => void;
  readonly onToggleHidden: (slug: string) => void;
  readonly onRemove: (slug: string) => void;
}

const ProviderModelRow = memo(function ProviderModelRow({
  model,
  isHidden,
  isFavorite,
  canMoveUp,
  canMoveDown,
  onToggleFavorite,
  onMoveUp,
  onMoveDown,
  onToggleHidden,
  onRemove,
}: ProviderModelRowProps) {
  const capLabels = collectCapabilityLabels(model);
  const hasDetails = capLabels.length > 0 || model.name !== model.slug;
  const selectable = model.selectable !== false;

  return (
    <div
      className={cn(
        "grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1",
        (isHidden || !selectable) && "text-muted-foreground",
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            "min-w-0 truncate text-xs",
            isHidden
              ? "text-muted-foreground line-through"
              : selectable
                ? "text-foreground/90"
                : "text-muted-foreground",
          )}
        >
          {model.name}
        </span>
        {hasDetails ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-5 rounded-sm p-0 text-muted-foreground/60 hover:text-muted-foreground"
                  aria-label={`Details for ${model.name}`}
                />
              }
            >
              <InfoIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top" variant="workbench" className="max-w-56">
              <div className="space-y-1">
                <code className="block text-detail text-multi-fg-primary">{model.slug}</code>
                {capLabels.length > 0 ? (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {capLabels.map((label) => (
                      <span key={label} className="text-caption text-multi-fg-tertiary">
                        {label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {isHidden ? <span className="text-caption text-muted-foreground">hidden</span> : null}
        {!selectable ? (
          <span className="text-caption text-muted-foreground">unavailable</span>
        ) : null}
        {model.isCustom ? <span className="text-caption text-muted-foreground">custom</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className={cn(
                  "size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground",
                  isFavorite && "text-yellow-500 hover:text-yellow-600",
                )}
                onClick={() => onToggleFavorite(model.slug)}
                aria-label={`${isFavorite ? "Remove" : "Add"} ${model.name} ${
                  isFavorite ? "from" : "to"
                } favorites`}
              />
            }
          >
            <StarIcon className={cn("size-3", isFavorite && "fill-current")} />
          </TooltipTrigger>
          <TooltipPopup side="top" variant="workbench">
            {isFavorite ? "Remove from favorites" : "Add to favorites"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                disabled={!canMoveUp}
                onClick={() => onMoveUp(model.slug)}
                aria-label={`Move ${model.name} up`}
              />
            }
          >
            <IconChevronRightMedium className="size-3 -rotate-90" />
          </TooltipTrigger>
          <TooltipPopup side="top" variant="workbench">
            Move up
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                disabled={!canMoveDown}
                onClick={() => onMoveDown(model.slug)}
                aria-label={`Move ${model.name} down`}
              />
            }
          >
            <IconChevronRightMedium className="size-3 rotate-90" />
          </TooltipTrigger>
          <TooltipPopup side="top" variant="workbench">
            Move down
          </TooltipPopup>
        </Tooltip>
        {!model.isCustom ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onToggleHidden(model.slug)}
                  aria-label={`${isHidden ? "Show" : "Hide"} ${model.name}`}
                />
              }
            >
              {isHidden ? <EyeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top" variant="workbench">
              {isHidden ? "Show in picker" : "Hide from picker"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {model.isCustom ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${model.slug}`}
                  onClick={() => onRemove(model.slug)}
                />
              }
            >
              <XIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top" variant="workbench">
              Remove custom model
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
});

interface ProviderModelsSectionProps {
  /** Identifier used to namespace input ids within the DOM. */
  readonly instanceId: ProviderInstanceId;
  /**
   * Driver kind for slug normalization + input placeholder. `null` when
   * the section is rendered without enough provider metadata.
   */
  readonly driverKind: ProviderDriverKind | null;
  /**
   * The live model list to display. Includes both built-in (probe-reported)
   * and custom entries, distinguished by `isCustom`.
   */
  readonly models: ReadonlyArray<ServerProviderModel>;
  /**
   * The persisted custom-model slug list for this instance. Drives dedup,
   * and is the array we hand back verbatim (with the new slug appended /
   * removed) via `onChange`.
   */
  readonly customModels: ReadonlyArray<string>;
  /** Server-returned model slugs hidden from the model picker. */
  readonly hiddenModels: ReadonlyArray<string>;
  /** Model slugs favorited for this provider instance. */
  readonly favoriteModels: ReadonlyArray<string>;
  /** Explicit user-authored model ordering for this provider instance. */
  readonly modelOrder: ReadonlyArray<string>;
  /**
   * Commit the new custom-model list. Caller is responsible for writing it
   * into the provider instance's canonical config blob.
   */
  readonly onChange: (next: ReadonlyArray<string>) => void;
  readonly onHiddenModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onFavoriteModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onModelOrderChange: (next: ReadonlyArray<string>) => void;
}

/**
 * Shared "Models" section rendered on both the built-in default and custom
 * provider-instance cards. Owns its own input + error local state so two
 * cards on screen don't fight over the input value.
 *
 * Validation mirrors the pre-consolidation logic in `SettingsPanels`:
 *   - empty / whitespace → "Enter a model slug."
 *   - duplicate of a non-custom (probe-reported) slug → "already built in"
 *   - exceeds `MAX_CUSTOM_MODEL_LENGTH` → length error
 *   - duplicate of an already-saved custom slug → already-saved error
 */
export function ProviderModelsSection({
  instanceId,
  driverKind,
  models,
  customModels,
  hiddenModels,
  favoriteModels,
  modelOrder,
  onChange,
  onHiddenModelsChange,
  onFavoriteModelsChange,
  onModelOrderChange,
}: ProviderModelsSectionProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const hiddenModelSet = useMemo(() => new Set(hiddenModels), [hiddenModels]);
  const favoriteModelSet = useMemo(() => new Set(favoriteModels), [favoriteModels]);
  const selectableModelCount = useMemo(
    () => models.filter((model) => model.selectable !== false).length,
    [models],
  );
  const unselectableModelCount = models.length - selectableModelCount;
  const orderedModels = useMemo(() => {
    return sortModelsForProviderInstance(models, {
      favoriteModels: favoriteModelSet,
      groupFavorites: true,
      modelOrder,
    });
  }, [favoriteModelSet, modelOrder, models]);

  const handleRemove = useCallback(
    (slug: string) => {
      onChange(customModels.filter((model) => model !== slug));
      onModelOrderChange(modelOrder.filter((model) => model !== slug));
      onFavoriteModelsChange(favoriteModels.filter((model) => model !== slug));
      setError(null);
    },
    [
      customModels,
      favoriteModels,
      modelOrder,
      onChange,
      onFavoriteModelsChange,
      onModelOrderChange,
    ],
  );

  const handleToggleHidden = useCallback(
    (slug: string) => {
      if (hiddenModelSet.has(slug)) {
        onHiddenModelsChange(hiddenModels.filter((model) => model !== slug));
        return;
      }
      onHiddenModelsChange([...hiddenModels, slug]);
    },
    [hiddenModelSet, hiddenModels, onHiddenModelsChange],
  );

  const handleToggleFavorite = useCallback(
    (slug: string) => {
      if (favoriteModelSet.has(slug)) {
        onFavoriteModelsChange(favoriteModels.filter((model) => model !== slug));
        return;
      }
      onFavoriteModelsChange([...favoriteModels, slug]);
    },
    [favoriteModelSet, favoriteModels, onFavoriteModelsChange],
  );

  const handleMove = useCallback(
    (slug: string, direction: -1 | 1) => {
      const slugs = sortModelsForProviderInstance(models, {
        favoriteModels: favoriteModelSet,
        groupFavorites: true,
        modelOrder,
      }).map((model) => model.slug);
      const index = slugs.indexOf(slug);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= slugs.length) {
        return;
      }
      const next = [...slugs];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      onModelOrderChange(next);
    },
    [favoriteModelSet, modelOrder, models, onModelOrderChange],
  );

  const handleMoveUp = useCallback((slug: string) => handleMove(slug, -1), [handleMove]);

  const handleMoveDown = useCallback((slug: string) => handleMove(slug, 1), [handleMove]);

  const handleAdd = () => {
    const normalized = driverKind ? normalizeModelSlug(input, driverKind) : input.trim() || null;
    if (!normalized) {
      setError("Enter a model slug.");
      return;
    }
    if (models.some((model) => !model.isCustom && model.slug === normalized)) {
      setError("That model is already built in.");
      return;
    }
    if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
      setError(`Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`);
      return;
    }
    if (customModels.includes(normalized)) {
      setError("That custom model is already saved.");
      return;
    }

    onChange([...customModels, normalized]);
    setInput("");
    setError(null);

    // Scroll the new row into view once the DOM reflects the commit.
    // `MutationObserver` handles the one-frame gap between `onChange` and
    // the `models` prop update; the `requestAnimationFrame` covers the
    // common case where the parent updates synchronously.
    const el = listRef.current;
    if (!el) return;
    const scrollToEnd = () => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    requestAnimationFrame(scrollToEnd);
    const observer = new MutationObserver(() => {
      scrollToEnd();
      observer.disconnect();
    });
    observer.observe(el, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 2_000);
  };

  return (
    <TooltipProvider delay={250} closeDelay={0}>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <div className="text-xs font-medium text-foreground">Models</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {unselectableModelCount > 0
            ? `${selectableModelCount} selectable, ${unselectableModelCount} unavailable.`
            : `${models.length} model${models.length === 1 ? "" : "s"} available.`}
        </div>
        <div ref={listRef} className="mt-2 max-h-40 overflow-y-auto pb-1">
          {orderedModels.map((model, index) => {
            const isHidden = !model.isCustom && hiddenModelSet.has(model.slug);
            const isFavorite = favoriteModelSet.has(model.slug);
            const previousModel = orderedModels[index - 1];
            const nextModel = orderedModels[index + 1];
            const canMoveUp =
              previousModel !== undefined &&
              favoriteModelSet.has(previousModel.slug) === isFavorite;
            const canMoveDown =
              nextModel !== undefined && favoriteModelSet.has(nextModel.slug) === isFavorite;

            return (
              <ProviderModelRow
                key={`${instanceId}:${model.slug}`}
                model={model}
                canMoveDown={canMoveDown}
                canMoveUp={canMoveUp}
                isFavorite={isFavorite}
                isHidden={isHidden}
                onMoveDown={handleMoveDown}
                onMoveUp={handleMoveUp}
                onRemove={handleRemove}
                onToggleFavorite={handleToggleFavorite}
                onToggleHidden={handleToggleHidden}
              />
            );
          })}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            id={`provider-instance-${instanceId}-custom-model`}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              handleAdd();
            }}
            placeholder={driverKind ? CUSTOM_MODEL_PLACEHOLDER_BY_KIND[driverKind] : "model-slug"}
            spellCheck={false}
          />
          <Button className="shrink-0" variant="outline" onClick={handleAdd}>
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        </div>

        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    </TooltipProvider>
  );
}
