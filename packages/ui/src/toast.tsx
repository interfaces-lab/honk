"use client";

import * as React from "react";
import { Toaster as SonnerToaster, toast, type ToasterProps as SonnerToasterProps } from "sonner";

import { Icon } from "./icon";
import { IconCircleCheck, IconExclamationCircle } from "./icons";
import { Spinner } from "./spinner";
import { toastVars } from "./tokens.stylex";
import "./toast.module.css";

type ToasterProps = Pick<
  SonnerToasterProps,
  "closeButton" | "containerAriaLabel" | "dir" | "duration" | "hotkey" | "id"
>;

const SWIPE_DIRECTIONS: NonNullable<SonnerToasterProps["swipeDirections"]> = [
  "top",
  "left",
  "right",
];

const TOAST_ICONS: NonNullable<SonnerToasterProps["icons"]> = {
  success: <Icon icon={IconCircleCheck} size="lg" tone="ok" />,
  info: <Icon icon={IconExclamationCircle} size="lg" tone="info" />,
  warning: <Icon icon={IconExclamationCircle} size="lg" tone="warn" />,
  error: <Icon icon={IconExclamationCircle} size="lg" tone="err" />,
  loading: <Spinner size="lg" tone="muted" />,
};

function Toaster(props: ToasterProps): React.ReactElement {
  const viewportOffset = String(toastVars["--honk-toast-offset"]);

  return (
    <SonnerToaster
      {...props}
      position="top-center"
      offset={viewportOffset}
      mobileOffset={viewportOffset}
      swipeDirections={SWIPE_DIRECTIONS}
      icons={TOAST_ICONS}
    />
  );
}

export { Toaster, toast };
export type { ToasterProps };
