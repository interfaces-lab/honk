import type { ReactNode } from "react";

import { WorkbenchIconButton } from "@multi/ui/workbench-button";

export function ModeButton(props: {
  active?: boolean;
  label: string;
  onClick?: () => void;
  children: ReactNode;
  chrome?: "tool" | "sub" | "panel";
}) {
  return (
    <WorkbenchIconButton
      aria-label={props.label}
      {...(props.active === undefined
        ? {}
        : { active: props.active, "aria-pressed": props.active })}
      {...(props.chrome === undefined ? {} : { chrome: props.chrome })}
      {...(props.onClick === undefined ? {} : { onClick: props.onClick })}
    >
      {props.children}
    </WorkbenchIconButton>
  );
}

export function NavButton(props: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  chrome?: "tool" | "sub" | "panel";
}) {
  return (
    <WorkbenchIconButton
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      {...(props.chrome === undefined ? {} : { chrome: props.chrome })}
    >
      {props.children}
    </WorkbenchIconButton>
  );
}
