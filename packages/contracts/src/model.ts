import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./base-schemas";

export const ModelOptionDescriptorType = Schema.Literals(["select", "boolean"]);
export type ModelOptionDescriptorType = typeof ModelOptionDescriptorType.Type;

export const ModelOptionChoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  isDefault: Schema.optional(Schema.Boolean),
});
export type ModelOptionChoice = typeof ModelOptionChoice.Type;

const ModelOptionDescriptorBase = {
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
} as const;

export const SelectModelOptionDescriptor = Schema.Struct({
  ...ModelOptionDescriptorBase,
  type: Schema.Literal("select"),
  options: Schema.Array(ModelOptionChoice),
  currentValue: Schema.optional(TrimmedNonEmptyString),
  promptInjectedValues: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type SelectModelOptionDescriptor = typeof SelectModelOptionDescriptor.Type;

export const BooleanModelOptionDescriptor = Schema.Struct({
  ...ModelOptionDescriptorBase,
  type: Schema.Literal("boolean"),
  currentValue: Schema.optional(Schema.Boolean),
});
export type BooleanModelOptionDescriptor = typeof BooleanModelOptionDescriptor.Type;

export const ModelOptionDescriptor = Schema.Union([
  SelectModelOptionDescriptor,
  BooleanModelOptionDescriptor,
]);
export type ModelOptionDescriptor = typeof ModelOptionDescriptor.Type;

export const ModelOptionSelectionValue = Schema.Union([TrimmedNonEmptyString, Schema.Boolean]);
export type ModelOptionSelectionValue = typeof ModelOptionSelectionValue.Type;

export const ModelOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: ModelOptionSelectionValue,
});
export type ModelOptionSelection = typeof ModelOptionSelection.Type;

/** Schema for the `options` field of every `ModelSelection` variant. */
export const ModelOptionSelections = Schema.Array(ModelOptionSelection);
export type ModelOptionSelections = typeof ModelOptionSelections.Type;

export const ModelCapabilities = Schema.Struct({
  optionDescriptors: Schema.optional(Schema.Array(ModelOptionDescriptor)),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;
