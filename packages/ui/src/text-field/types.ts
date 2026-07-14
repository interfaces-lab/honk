import type { ReactNode, Ref } from "react";

export type TextFieldSize = "md" | "lg";
export type TextFieldAutoComplete =
  | "current-password"
  | "email"
  | "name"
  | "new-password"
  | "off"
  | "one-time-code"
  | "postal-code"
  | "street-address"
  | "tel"
  | "url"
  | "username";
export type TextFieldInputMode =
  | "decimal"
  | "email"
  | "none"
  | "numeric"
  | "search"
  | "tel"
  | "text"
  | "url";
export type TextFieldReturnKey = "done" | "go" | "next" | "search" | "send";
export type TextFieldSubmitBehavior = "blurAndSubmit" | "newline" | "submit";

export interface TextFieldSelection {
  readonly start: number;
  readonly end?: number;
}

export interface TextFieldHandle {
  readonly focus: () => void;
  readonly blur: () => void;
  readonly clear: () => void;
  readonly isFocused: () => boolean;
  readonly getValue: () => string;
}

/** Product-level field contract; renderer event and host-prop unions stay private. */
export interface TextFieldProps {
  readonly ref?: Ref<TextFieldHandle>;
  readonly label: string;
  readonly accessibilityHint?: string;
  readonly autoCapitalize?: "characters" | "none" | "sentences" | "words";
  readonly autoComplete?: TextFieldAutoComplete;
  readonly autoCorrect?: boolean;
  readonly autoFocus?: boolean;
  readonly defaultValue?: string;
  readonly disabled?: boolean;
  readonly error?: string;
  readonly inputMode?: TextFieldInputMode;
  readonly keyboardAppearance?: "dark" | "default" | "light";
  readonly leading?: ReactNode;
  readonly maxLength?: number;
  readonly minRows?: number;
  readonly multiline?: boolean;
  readonly onChangeText?: (value: string) => void;
  readonly onFocusChange?: (focused: boolean) => void;
  readonly onSubmit?: (value: string) => void;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly returnKeyType?: TextFieldReturnKey;
  readonly secureTextEntry?: boolean;
  readonly selection?: TextFieldSelection;
  readonly size?: TextFieldSize;
  readonly submitBehavior?: TextFieldSubmitBehavior;
  readonly testID?: string;
  readonly trailing?: ReactNode;
  readonly value?: string;
}
