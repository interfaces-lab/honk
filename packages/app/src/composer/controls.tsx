import { Badge, Button, Icon, IconButton, Picker, Tooltip } from "@honk/ui";
import { IconClawd, IconOpenaiCodex, IconPlusSmall } from "@honk/ui/icons";
import * as React from "react";

import type { PromptEditorHandle } from "./types";
import { DEFAULT_MODE, modeById, nextModeId, type ModeId } from "../modes";
import { PRESETS, presetById, type PresetDefinition } from "../presets";

export function ModeControl({
  value,
  onValueChange,
}: {
  readonly value: ModeId;
  readonly onValueChange: (id: ModeId) => void;
}): React.ReactElement | null {
  if (value === DEFAULT_MODE) {
    return null;
  }

  const mode = modeById(value);
  return (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      title={`${mode.label} mode. ${mode.description} Shift+Tab or click to switch.`}
      aria-label={`Mode: ${mode.label}. Shift+Tab or click to switch.`}
      onClick={() => {
        onValueChange(nextModeId(value));
      }}
    >
      <Badge tone={mode.tone}>{mode.label}</Badge>
    </Button>
  );
}

function presetDisplayLabel(preset: PresetDefinition): string {
  return `${preset.label.slice(0, 1).toUpperCase()}${preset.label.slice(1)}`;
}

function PresetProviderIcon({ preset }: { readonly preset: PresetDefinition }): React.ReactElement {
  return (
    <Icon
      icon={preset.mainModel.providerID === "anthropic" ? IconClawd : IconOpenaiCodex}
      size="sm"
      tone="muted"
    />
  );
}

export function PresetSelector({
  value,
  onValueChange,
}: {
  readonly value: string;
  readonly onValueChange: (id: string) => void;
}): React.ReactElement {
  const selected = presetById(value);

  return (
    <Picker.Root value={value} onValueChange={onValueChange}>
      <Picker.Trigger
        size="sm"
        tone="quiet"
        accessibilityLabel={`Model preset: ${presetDisplayLabel(selected)}`}
      >
        <PresetProviderIcon preset={selected} />
        {presetDisplayLabel(selected)}
      </Picker.Trigger>
      <Picker.Popup label="Model preset" width="wide" side="bottom" align="start">
        <Picker.Group>
          <Picker.GroupLabel>Model preset</Picker.GroupLabel>
          {PRESETS.map((preset) => (
            <Picker.Option
              key={preset.id}
              value={preset.id}
              label={presetDisplayLabel(preset)}
              description={`Main ${preset.mainLabel} · Sidekick ${preset.sidekickLabel}`}
              leading={<PresetProviderIcon preset={preset} />}
              metadata={preset.mainVariant}
            />
          ))}
        </Picker.Group>
      </Picker.Popup>
    </Picker.Root>
  );
}

export function ComposerAttachmentButton(props: {
  readonly editorRef: React.RefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  return (
    <Tooltip label="Add attachments">
      <IconButton
        type="button"
        aria-label="Add attachments"
        size="sm"
        variant="quiet"
        onClick={() => props.editorRef.current?.chooseImages()}
      >
        <Icon icon={IconPlusSmall} size="sm" />
      </IconButton>
    </Tooltip>
  );
}
