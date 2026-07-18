// Centered modal over a scrim. Unanchored popup grows from its own center.

import { Dialog as Base } from "@base-ui/react/dialog";
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

const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;
const FOOTER_HAIRLINE = `inset 0 1px 0 0 ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: colorVars["--honk-color-scrim"],
    zIndex: zVars["--honk-z-dialog"],
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
  popup: {
    boxSizing: "border-box",
    position: "fixed",
    left: "50%",
    top: "50%",
    // Non-conditional translate avoids StyleX conditional-transform unknown typing.
    transform: "translate(-50%, -50%)",
    // Popup must set the same z-index as the scrim. auto would paint under the scrim.
    zIndex: zVars["--honk-z-dialog"],
    width: "100%",
    maxWidth: "480px",
    // Height cap 640px with 24px viewport edge inset. Overflow scrolls inside the popup.
    maxHeight: "min(640px, calc(100dvh - 48px))",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px dialog padding is a fixed intrinsic; no spacing token owns 20px
    padding: "20px",
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${RING_MUTED}, ${elevationVars["--honk-elevation-overlay"]}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    outline: "none",
    transformOrigin: "center",
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
  header: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px title/description header gap is a fixed intrinsic; no spacing token owns 4px
    gap: "4px",
  },
  footer: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spaceVars["--honk-space-gutter"],
    paddingTop: spaceVars["--honk-space-panel-pad"],
    boxShadow: FOOTER_HAIRLINE,
  },
});

interface DialogPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogPopup({ style, children, ...rest }: DialogPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Backdrop data-slot="dialog-backdrop" {...stylex.props(sx.backdrop)} />
      <Base.Popup {...rest} data-slot="dialog" {...applyStyle(stylex.props(sx.popup), style)}>
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

interface DialogTitleProps extends Omit<Base.Title.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogTitle({ style, ...rest }: DialogTitleProps): React.ReactElement {
  return <Base.Title {...rest} data-slot="dialog-title" {...applyStyle(stylex.props(sx.title), style)} />;
}

interface DialogDescriptionProps extends Omit<Base.Description.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogDescription({ style, ...rest }: DialogDescriptionProps): React.ReactElement {
  return (
    <Base.Description {...rest} data-slot="dialog-description" {...applyStyle(stylex.props(sx.description), style)} />
  );
}

interface DialogHeaderProps extends Omit<React.ComponentProps<"div">, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogHeader({ style, ...rest }: DialogHeaderProps): React.ReactElement {
  return <div {...rest} data-slot="dialog-header" {...applyStyle(stylex.props(sx.header), style)} />;
}

interface DialogFooterProps extends Omit<React.ComponentProps<"div">, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogFooter({ style, ...rest }: DialogFooterProps): React.ReactElement {
  return <div {...rest} data-slot="dialog-footer" {...applyStyle(stylex.props(sx.footer), style)} />;
}

const Dialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Header: DialogHeader,
  Footer: DialogFooter,
  Close: Base.Close,
};

export { Dialog };
export type {
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogPopupProps,
  DialogTitleProps,
};
