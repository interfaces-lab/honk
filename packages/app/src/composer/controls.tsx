import { Badge, Button, Icon, IconButton, Picker, Tooltip } from "@honk/ui";
import { IconClawd, IconGlobe, IconOpenaiCodex, IconPlusSmall } from "@honk/ui/icons";
import * as React from "react";

import type { PromptEditorHandle } from "./types";
import { DEFAULT_MODE, modeById, nextModeId, type ModeId } from "../modes";
import { OPEN_CODE_GO_PRESET_ID, presetById, type PresetDefinition } from "../presets";

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
      icon={
        preset.mainModel.providerID === "anthropic"
          ? IconClawd
          : preset.mainModel.providerID === "opencode-go"
            ? IconGlobe
            : IconOpenaiCodex
      }
      size="sm"
      tone="muted"
    />
  );
}

export function PresetSelector({
  value,
  onValueChange,
  presets,
}: {
  readonly value: string;
  readonly onValueChange: (id: string) => void;
  readonly presets: readonly PresetDefinition[];
}): React.ReactElement {
  const selected = presetById(value, presets);
  const bundledPresets = presets.filter((preset) => preset.id !== OPEN_CODE_GO_PRESET_ID);
  const openCodeGoPreset = presets.find((preset) => preset.id === OPEN_CODE_GO_PRESET_ID);

  return (
    <Picker.Root value={selected.id} onValueChange={onValueChange}>
      <Picker.Trigger
        size="sm"
        tone="quiet"
        accessibilityLabel={`Model: ${presetDisplayLabel(selected)}`}
      >
        <PresetProviderIcon preset={selected} />
        {presetDisplayLabel(selected)}
      </Picker.Trigger>
      <Picker.Popup label="Model" width="wide" side="bottom" align="start">
        <Picker.Group>
          <Picker.GroupLabel>Model preset</Picker.GroupLabel>
          {bundledPresets.map((preset) => (
            <Picker.Option
              key={preset.id}
              value={preset.id}
              label={presetDisplayLabel(preset)}
              description={
                preset.sidekickLabel === undefined
                  ? preset.mainLabel
                  : `Models ${preset.mainLabel} · ${preset.sidekickLabel}`
              }
              leading={<PresetProviderIcon preset={preset} />}
              metadata={preset.mainVariant}
            />
          ))}
        </Picker.Group>
        {openCodeGoPreset === undefined ? null : (
          <Picker.Group>
            <Picker.GroupLabel>OpenCode Go</Picker.GroupLabel>
            <Picker.Option
              value={openCodeGoPreset.id}
              label={presetDisplayLabel(openCodeGoPreset)}
              description="Available from the live OpenCode catalog"
              leading={<PresetProviderIcon preset={openCodeGoPreset} />}
              metadata={openCodeGoPreset.mainVariant}
            />
          </Picker.Group>
        )}
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
