import * as React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { resolveNativeTheme } from "../theme";
import type { TextFieldHandle, TextFieldProps } from "./types";

/**
 * Native interaction behavior was reviewed against Bluesky social-app
 * 6f69ded4929a945b4dead2bbd52c464a00fef4b5. Keep the root-to-input focus
 * handoff, uncontrolled-first value flow, merged imperative handle, and
 * platform-specific text metrics when this renderer changes.
 */

const layout = StyleSheet.create({
  root: {
    width: "100%",
  },
  label: {
    alignSelf: "flex-start",
  },
  surface: {
    alignItems: "center",
    flexDirection: "row",
    width: "100%",
  },
  surfaceMultiline: {
    alignItems: "flex-start",
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
  },
  inputMultiline: {
    textAlignVertical: "top",
  },
  accessory: {
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    alignSelf: "flex-start",
  },
});

const TextField = React.forwardRef<TextFieldHandle, TextFieldProps>(function TextField(
  {
    accessibilityHint,
    autoCapitalize,
    autoComplete,
    autoCorrect,
    autoFocus,
    defaultValue,
    disabled = false,
    error,
    inputMode,
    keyboardAppearance,
    label,
    leading,
    maxLength,
    minRows = 3,
    multiline = false,
    onChangeText,
    onFocusChange,
    onSubmit,
    placeholder,
    readOnly = false,
    required = false,
    returnKeyType,
    secureTextEntry,
    selection,
    size = "md",
    submitBehavior,
    testID,
    trailing,
    value,
  },
  forwardedRef,
): React.ReactElement {
  const generatedId = React.useId();
  const inputId = testID ?? generatedId;
  const labelId = `${inputId}-label`;
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const inputRef = React.useRef<TextInput>(null);
  const currentValue = React.useRef(value ?? defaultValue ?? "");
  const [focused, setFocused] = React.useState(false);
  const field = theme.metrics.field;
  const font = theme.metrics.font;
  const minHeight = multiline
    ? field.multilineMinHeight
    : size === "lg"
      ? field.minHeightLg
      : field.minHeightMd;
  const paddingInline = size === "lg" ? field.paddingInlineLg : field.paddingInlineMd;
  const nativePaddingBlock = size === "lg" ? field.paddingBlockLg : field.paddingBlockMd;
  const androidPaddingBlock =
    size === "lg" ? field.paddingBlockAndroidLg : field.paddingBlockAndroidMd;
  const paddingBlock = Platform.OS === "android" ? androidPaddingBlock : nativePaddingBlock;
  const invalid = error !== undefined;
  const accessibleLabel = required ? `${label}, required` : label;

  React.useImperativeHandle(
    forwardedRef,
    () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      clear: () => {
        inputRef.current?.clear();
        currentValue.current = "";
        onChangeText?.("");
      },
      isFocused: () => inputRef.current?.isFocused() ?? false,
      getValue: () => value ?? currentValue.current,
    }),
    [onChangeText, value],
  );

  const rootStyle: ViewStyle = {
    gap: field.labelGap,
    opacity: disabled ? theme.metrics.interaction.disabledOpacity : 1,
  };
  const surfaceStyle: ViewStyle = {
    backgroundColor: invalid ? theme.colors.errBg : theme.colors.layer01,
    borderColor: invalid ? theme.colors.errFg : theme.colors.borderBase,
    borderRadius: theme.metrics.radius.field,
    borderStyle: "solid",
    borderWidth: field.borderWidth,
    minHeight,
    outlineColor: invalid ? theme.colors.errFg : theme.colors.accent,
    outlineOffset: field.borderWidth,
    outlineStyle: "solid",
    outlineWidth: focused ? field.focusBorderWidth : 0,
    paddingHorizontal: paddingInline,
  };
  const inputStyle: TextStyle = {
    color: theme.colors.textPrimary,
    fontSize: font.bodySize,
    fontWeight: font.weightRegular,
    lineHeight: font.bodyLeading,
    minHeight,
    paddingVertical: paddingBlock,
  };
  const labelStyle: TextStyle = {
    color: invalid ? theme.colors.errFg : theme.colors.textMuted,
    fontSize: font.detailSize,
    fontWeight: font.weightMedium,
    lineHeight: font.detailLeading,
  };
  const errorStyle: TextStyle = {
    color: theme.colors.errFg,
    fontSize: font.captionSize,
    fontWeight: font.weightRegular,
    lineHeight: font.captionLeading,
    marginTop: field.errorGap - field.labelGap,
  };
  const accessoryStyle: ViewStyle = { minHeight: theme.metrics.interaction.touchTarget };
  const valueProps = value === undefined ? { defaultValue } : { value };

  return (
    <View style={[layout.root, rootStyle]}>
      <Text nativeID={labelId} style={[layout.label, labelStyle]}>
        {label}
        {required ? " *" : ""}
      </Text>
      <Pressable
        accessible={false}
        disabled={disabled}
        onPress={() => inputRef.current?.focus()}
        style={[layout.surface, multiline && layout.surfaceMultiline, surfaceStyle]}
      >
        {leading === undefined ? null : (
          <View style={[layout.accessory, accessoryStyle, { marginRight: field.accessoryGap }]}>
            {leading}
          </View>
        )}
        <TextInput
          {...valueProps}
          ref={inputRef}
          accessibilityHint={error ?? accessibilityHint}
          accessibilityLabel={accessibleLabel}
          accessibilityLabelledBy={labelId}
          accessibilityState={{ disabled }}
          allowFontScaling
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          autoFocus={autoFocus}
          cursorColor={theme.colors.accent}
          editable={!disabled && !readOnly}
          inputMode={inputMode}
          keyboardAppearance={keyboardAppearance ?? mode}
          maxLength={maxLength}
          multiline={multiline}
          numberOfLines={multiline ? minRows : 1}
          onBlur={() => {
            setFocused(false);
            onFocusChange?.(false);
          }}
          onChangeText={(next) => {
            currentValue.current = next;
            onChangeText?.(next);
          }}
          onFocus={() => {
            setFocused(true);
            onFocusChange?.(true);
          }}
          onSubmitEditing={() => onSubmit?.(value ?? currentValue.current)}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textFaint}
          readOnly={readOnly}
          returnKeyType={returnKeyType}
          secureTextEntry={secureTextEntry}
          selection={selection}
          selectionColor={theme.colors.accent}
          style={[layout.input, multiline && layout.inputMultiline, inputStyle]}
          submitBehavior={submitBehavior ?? (multiline ? "newline" : "blurAndSubmit")}
          testID={testID}
        />
        {trailing === undefined ? null : (
          <View style={[layout.accessory, accessoryStyle, { marginLeft: field.accessoryGap }]}>
            {trailing}
          </View>
        )}
      </Pressable>
      {error === undefined ? null : (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[layout.error, errorStyle]}
        >
          {error}
        </Text>
      )}
    </View>
  );
});

export { TextField };
export type {
  TextFieldAutoComplete,
  TextFieldHandle,
  TextFieldInputMode,
  TextFieldProps,
  TextFieldReturnKey,
  TextFieldSelection,
  TextFieldSize,
  TextFieldSubmitBehavior,
} from "./types";
