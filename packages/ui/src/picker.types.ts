import type * as React from "react";

type PickerSize = "sm" | "md";
type PickerTone = "neutral" | "quiet";
type PickerPopupWidth = "trigger" | "wide";
type PickerPopupLayer = "menu" | "dialog";

interface PickerRootProps {
  children: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  name?: string;
}

interface PickerTriggerProps {
  children: React.ReactNode;
  accessibilityLabel: string;
  size?: PickerSize;
  tone?: PickerTone;
  title?: string;
}

interface PickerPopupProps {
  children: React.ReactNode;
  label: string;
  width?: PickerPopupWidth;
  layer?: PickerPopupLayer;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}

interface PickerOptionProps {
  value: string;
  label: string;
  description?: string;
  leading?: React.ReactNode;
  metadata?: React.ReactNode;
  disabled?: boolean;
}

interface PickerGroupProps {
  children: React.ReactNode;
}

interface PickerGroupLabelProps {
  children: React.ReactNode;
}

interface PickerCompound {
  Root: (props: PickerRootProps) => React.ReactElement;
  Trigger: (props: PickerTriggerProps) => React.ReactElement;
  Popup: (props: PickerPopupProps) => React.ReactElement | null;
  Option: (props: PickerOptionProps) => React.ReactElement;
  Group: (props: PickerGroupProps) => React.ReactElement;
  GroupLabel: (props: PickerGroupLabelProps) => React.ReactElement;
}

export type {
  PickerCompound,
  PickerGroupLabelProps,
  PickerGroupProps,
  PickerOptionProps,
  PickerPopupLayer,
  PickerPopupProps,
  PickerPopupWidth,
  PickerRootProps,
  PickerSize,
  PickerTone,
  PickerTriggerProps,
};
