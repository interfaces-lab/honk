"use client";

import { IconChevronRightMedium } from "central-icons";
import type * as React from "react";

import { Button } from "./button";
import { ButtonGroup, ButtonGroupSeparator } from "./group";
import { Menu, MenuPopup, MenuTrigger } from "./menu";

type SplitButtonProps = {
  children: React.ReactNode;
  className?: string | undefined;
};

function SplitButton({ children, className }: SplitButtonProps) {
  return (
    <ButtonGroup {...(className ? { className } : {})}>
      <Menu>{children}</Menu>
    </ButtonGroup>
  );
}

function SplitButtonAction(props: React.ComponentProps<typeof Button>) {
  return <Button {...props} />;
}

function SplitButtonTrigger({
  "aria-label": ariaLabel = "More actions",
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <>
      <ButtonGroupSeparator />
      <MenuTrigger
        render={
          <Button
            aria-label={ariaLabel}
            size="icon"
            variant="outline"
            {...props}
          />
        }
      >
        {children ?? <IconChevronRightMedium className="rotate-90" />}
      </MenuTrigger>
    </>
  );
}

function SplitButtonPopup(props: React.ComponentProps<typeof MenuPopup>) {
  return <MenuPopup align="end" sideOffset={4} variant="workbench" {...props} />;
}

export { SplitButton, SplitButtonAction, SplitButtonTrigger, SplitButtonPopup };
