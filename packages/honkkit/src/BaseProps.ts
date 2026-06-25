import type { StyleXStyles } from "@stylexjs/stylex";
import type * as React from "react";

interface BaseProps<T extends HTMLElement = HTMLElement> extends Omit<
  React.HTMLAttributes<T>,
  | "children"
  | "title"
  | "contentEditable"
  | "dangerouslySetInnerHTML"
  | "suppressContentEditableWarning"
  | "suppressHydrationWarning"
  | "accessKey"
  | "autoCapitalize"
  | "autoFocus"
  | "contextMenu"
  | "enterKeyHint"
  | "lang"
  | "nonce"
  | "slot"
  | "spellCheck"
  | "translate"
  | "radioGroup"
  | "inputMode"
  | "is"
  | "about"
  | "content"
  | "datatype"
  | "inlist"
  | "prefix"
  | "property"
  | "rel"
  | "resource"
  | "rev"
  | "typeof"
  | "vocab"
  | "autoCorrect"
  | "autoSave"
  | "color"
  | "results"
  | "security"
  | "unselectable"
  | "itemProp"
  | "itemScope"
  | "itemType"
  | "itemID"
  | "itemRef"
  | "popover"
  | "popoverTargetAction"
  | "popoverTarget"
  | "exportparts"
  | "defaultChecked"
  | "defaultValue"
> {
  xstyle?: StyleXStyles;
  [key: `data-${string}`]: string | undefined;
}

export type { BaseProps };
