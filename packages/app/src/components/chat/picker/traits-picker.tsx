import {
  type ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@multi/contracts";
import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
} from "@multi/shared/model";
import { memo, useCallback, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { IconChevronRightMedium } from "central-icons";
import { Button, buttonVariants } from "@multi/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "@multi/ui/menu";
import { useComposerDraftStore, DraftId } from "../../../stores/chat-drafts";
import {
  getProviderSelectTraitValue,
  resolveProviderTraitsState,
  type ProviderTraitsScope,
} from "../../../model/provider-state";
import { cn } from "~/lib/utils";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

type TraitsPersistence =
  | {
      threadRef?: ScopedThreadRef;
      draftId?: DraftId;
      onModelOptionsChange?: never;
    }
  | {
      threadRef?: undefined;
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void;
    };

const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";

type ProviderBooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

function getProviderBooleanTraitSectionLabel(descriptor: ProviderBooleanDescriptor): string {
  return descriptor.id === "fastMode" ? "Fast" : descriptor.label;
}

function getProviderTraitsTriggerLabel(
  state: ReturnType<typeof resolveProviderTraitsState>,
): string {
  return (
    state.descriptors
      .map((descriptor) => {
        if (
          state.ultrathinkPromptControlled &&
          descriptor.id === state.primarySelectDescriptor?.id
        ) {
          return "Ultrathink";
        }
        if (descriptor.type === "boolean") {
          if (descriptor.id === "fastMode") {
            return descriptor.currentValue === true ? "Fast" : "Normal";
          }
          return `${descriptor.label} ${descriptor.currentValue === true ? "On" : "Off"}`;
        }
        return getProviderOptionCurrentLabel(descriptor);
      })
      .filter((label): label is string => typeof label === "string" && label.length > 0)
      .join(" · ") || ""
  );
}

function WorkbenchBooleanTraitMenuGroup(props: {
  descriptor: ProviderBooleanDescriptor;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  updateDescriptors: (nextDescriptors: ReadonlyArray<ProviderOptionDescriptor>) => void;
}) {
  const { descriptor, descriptors, updateDescriptors } = props;
  return (
    <MenuGroup>
      <MenuGroupLabel variant="workbench">
        {getProviderBooleanTraitSectionLabel(descriptor)}
      </MenuGroupLabel>
      <MenuRadioGroup
        value={descriptor.currentValue === true ? "on" : "off"}
        onValueChange={(value) => {
          updateDescriptors(
            replaceDescriptorCurrentValue(descriptors, descriptor.id, value === "on"),
          );
        }}
      >
        <MenuRadioItem variant="workbench" value="on">
          On
        </MenuRadioItem>
        <MenuRadioItem variant="workbench" value="off">
          Off
        </MenuRadioItem>
      </MenuRadioGroup>
    </MenuGroup>
  );
}

function replaceDescriptorCurrentValue(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  descriptorId: string,
  currentValue: string | boolean | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) =>
    descriptor.id !== descriptorId
      ? descriptor
      : descriptor.type === "boolean"
        ? {
            ...descriptor,
            ...(typeof currentValue === "boolean" ? { currentValue } : {}),
          }
        : {
            ...descriptor,
            ...(typeof currentValue === "string" ? { currentValue } : {}),
          },
  );
}

interface TraitsMenuContentProps {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelOptions?: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
  /**
   * `all`: full traits body (standalone picker).
   * `fast-only`: only the Fast (fastMode boolean) row; null when unsupported.
   * `except-fast`: reasoning / agents / booleans excluding fast mode (dock overflow slot).
   */
  traitsScope?: ProviderTraitsScope;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  traitsScope = "all",
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const updateModelOptions = useCallback(
    (nextOptions: ProviderOptions | undefined) => {
      if ("onModelOptionsChange" in persistence) {
        persistence.onModelOptionsChange(nextOptions);
        return;
      }
      const threadTarget = persistence.threadRef ?? persistence.draftId;
      if (!threadTarget) {
        return;
      }
      setProviderModelOptions(threadTarget, provider, nextOptions, {
        model,
        persistSticky: true,
      });
    },
    [model, persistence, provider, setProviderModelOptions],
  );
  const {
    descriptors,
    selectDescriptors,
    primarySelectDescriptor,
    restBooleanDescriptors,
    fastModeDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    hasAnyControls,
    showFastMode,
  } = resolveProviderTraitsState({
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
  });
  const updateDescriptors = (nextDescriptors: ReadonlyArray<ProviderOptionDescriptor>) => {
    updateModelOptions(buildProviderOptionSelectionsFromDescriptors(nextDescriptors));
  };

  const handleSelectChange = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
    value: string,
  ) => {
    if (!value) return;
    if (descriptor.promptInjectedValues?.includes(value)) {
      const nextPrompt =
        prompt.trim().length === 0
          ? ULTRATHINK_PROMPT_PREFIX
          : applyClaudePromptEffortPrefix(prompt, "ultrathink");
      onPromptChange(nextPrompt);
      return;
    }
    if (ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id) return;
    if (ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id) {
      const stripped = prompt.replace(/^Ultrathink:\s*/i, "");
      onPromptChange(stripped);
    }
    updateDescriptors(replaceDescriptorCurrentValue(descriptors, descriptor.id, value));
  };

  const rendersFastLeading =
    (traitsScope === "all" || traitsScope === "fast-only") &&
    showFastMode &&
    Boolean(fastModeDescriptor);

  const rendersRestSections = traitsScope === "all" || traitsScope === "except-fast";

  const hasRenderableRest =
    rendersRestSections && (selectDescriptors.length > 0 || restBooleanDescriptors.length > 0);

  if (traitsScope === "fast-only") {
    if (!rendersFastLeading || !fastModeDescriptor) {
      return null;
    }
    return (
      <WorkbenchBooleanTraitMenuGroup
        descriptor={fastModeDescriptor}
        descriptors={descriptors}
        updateDescriptors={updateDescriptors}
      />
    );
  }

  if (traitsScope === "except-fast" && !hasRenderableRest) {
    return null;
  }

  if (traitsScope === "all" && !hasAnyControls) {
    return null;
  }

  return (
    <>
      {traitsScope === "all" && rendersFastLeading && fastModeDescriptor ? (
        <WorkbenchBooleanTraitMenuGroup
          descriptor={fastModeDescriptor}
          descriptors={descriptors}
          updateDescriptors={updateDescriptors}
        />
      ) : null}

      {selectDescriptors.map((descriptor, index) => (
        <div key={descriptor.id}>
          {(index > 0 || (traitsScope === "all" && rendersFastLeading)) && rendersRestSections ? (
            <MenuDivider variant="workbench" />
          ) : null}
          <MenuGroup>
            <MenuGroupLabel variant="workbench">{descriptor.label}</MenuGroupLabel>
            {ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id ? (
              <div className="px-1 pb-1 text-detail text-multi-fg-tertiary">
                Your prompt contains &quot;ultrathink&quot; in the text. Remove it to change this
                option.
              </div>
            ) : null}
            <MenuRadioGroup
              value={
                ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id
                  ? "ultrathink"
                  : (getProviderSelectTraitValue(descriptor) ?? "")
              }
              onValueChange={(value) => handleSelectChange(descriptor, value)}
            >
              {descriptor.options.map((option) => (
                <MenuRadioItem
                  key={option.id}
                  variant="workbench"
                  value={option.id}
                  disabled={ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id}
                >
                  {option.label}
                  {option.isDefault ? " (default)" : ""}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </div>
      ))}
      {rendersRestSections
        ? restBooleanDescriptors.map((descriptor, index) => (
            <div key={descriptor.id}>
              {index > 0 ||
              selectDescriptors.length > 0 ||
              (traitsScope === "all" && rendersFastLeading) ? (
                <MenuDivider variant="workbench" />
              ) : null}
              <WorkbenchBooleanTraitMenuGroup
                descriptor={descriptor}
                descriptors={descriptors}
                updateDescriptors={updateDescriptors}
              />
            </div>
          ))
        : null}
    </>
  );
});

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  triggerVariant,
  triggerClassName,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const traitsState = resolveProviderTraitsState({
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
  });
  if (!traitsState.hasAnyControls) {
    return null;
  }

  const triggerLabel = getProviderTraitsTriggerLabel(traitsState);

  const isCodexStyle = provider === "codex";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={triggerVariant ?? "ghost"}
            className={cn(
              isCodexStyle
                ? "min-w-0 max-w-40 shrink select-none justify-start overflow-hidden whitespace-nowrap px-2.5 text-muted-foreground/70 hover:text-foreground/80 sm:max-w-48 sm:px-3 [&_svg]:mx-0"
                : "shrink-0 select-none whitespace-nowrap px-2.5 text-muted-foreground/70 hover:text-foreground/80 sm:px-3",
              triggerClassName,
            )}
          />
        }
      >
        {isCodexStyle ? (
          <span className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
            {triggerLabel}
            <IconChevronRightMedium
              aria-hidden="true"
              className="size-3 shrink-0 rotate-90 opacity-60"
            />
          </span>
        ) : (
          <>
            <span>{triggerLabel}</span>
            <IconChevronRightMedium aria-hidden="true" className="size-3 rotate-90 opacity-60" />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start" variant="workbench">
        <TraitsMenuContent
          provider={provider}
          models={models}
          model={model}
          prompt={prompt}
          onPromptChange={onPromptChange}
          modelOptions={modelOptions}
          allowPromptInjectedEffort={allowPromptInjectedEffort}
          {...persistence}
        />
      </MenuPopup>
    </Menu>
  );
});
