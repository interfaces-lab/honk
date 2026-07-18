// Confirm interrupt. Same modal surface as Dialog.

import { AlertDialog as Base } from "@base-ui/react/alert-dialog";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import {
  colorVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
  zVars,
} from "./tokens.stylex";

const DIALOG_MAX_WIDTH = "480px";
const DIALOG_MAX_HEIGHT = "min(640px, calc(100dvh - 48px))";
const DIALOG_PAD = "20px";
const DIALOG_HEADER_GAP = "4px";

const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;
const FOOTER_DIVIDER = `inset 0 1px 0 0 ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: zVars["--honk-z-dialog"],
    backgroundColor: colorVars["--honk-color-scrim"],
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    transitionProperty: "opacity",
    transitionTimingFunction: {
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // Plain-string translate avoids StyleX conditional-transform unknown typing.
  popup: {
    boxSizing: "border-box",
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    transformOrigin: "center",
    zIndex: zVars["--honk-z-dialog"],
    display: "flex",
    flexDirection: "column",
    rowGap: spaceVars["--honk-space-panel-pad"],
    width: "100%",
    maxWidth: DIALOG_MAX_WIDTH,
    maxHeight: DIALOG_MAX_HEIGHT,
    overflowY: "auto",
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px dialog surface inset is fixed geometry, no spacing token owns it
    padding: DIALOG_PAD,
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${RING_MUTED}, ${elevationVars["--honk-elevation-overlay"]}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    outline: "none",
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    scale: {
      default: 1,
      "[data-starting-style]": motionVars["--honk-motion-scale-overlay"],
      "[data-ending-style]": motionVars["--honk-motion-scale-overlay"],
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionTimingFunction: {
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  header: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px title/description gap is fixed tight geometry, no spacing token owns it
    rowGap: DIALOG_HEADER_GAP,
  },
  title: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-title"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    color: colorVars["--honk-color-text-primary"],
  },
  description: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
  footer: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spaceVars["--honk-space-gutter"],
    paddingTop: spaceVars["--honk-space-panel-pad"],
    boxShadow: FOOTER_DIVIDER,
  },
});

interface AlertDialogPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogPopup({ style, children, ...rest }: AlertDialogPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Backdrop data-slot="alert-dialog-backdrop" {...stylex.props(sx.backdrop)} />
      <Base.Popup {...rest} data-slot="alert-dialog" {...applyStyle(stylex.props(sx.popup), style)}>
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

interface AlertDialogTitleProps extends Omit<Base.Title.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogTitle({ style, ...rest }: AlertDialogTitleProps): React.ReactElement {
  return <Base.Title {...rest} data-slot="alert-dialog-title" {...applyStyle(stylex.props(sx.title), style)} />;
}

interface AlertDialogDescriptionProps extends Omit<Base.Description.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogDescription({
  style,
  ...rest
}: AlertDialogDescriptionProps): React.ReactElement {
  return (
    <Base.Description
      {...rest}
      data-slot="alert-dialog-description"
      {...applyStyle(stylex.props(sx.description), style)}
    />
  );
}

interface AlertDialogHeaderProps extends Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogHeader({ style, ...rest }: AlertDialogHeaderProps): React.ReactElement {
  return <div {...rest} data-slot="alert-dialog-header" {...applyStyle(stylex.props(sx.header), style)} />;
}

interface AlertDialogFooterProps extends Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogFooter({ style, ...rest }: AlertDialogFooterProps): React.ReactElement {
  return <div {...rest} data-slot="alert-dialog-footer" {...applyStyle(stylex.props(sx.footer), style)} />;
}

const AlertDialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: AlertDialogPopup,
  Title: AlertDialogTitle,
  Description: AlertDialogDescription,
  Header: AlertDialogHeader,
  Footer: AlertDialogFooter,
  Close: Base.Close,
};

export { AlertDialog };
export type {
  AlertDialogDescriptionProps,
  AlertDialogFooterProps,
  AlertDialogHeaderProps,
  AlertDialogPopupProps,
  AlertDialogTitleProps,
};
