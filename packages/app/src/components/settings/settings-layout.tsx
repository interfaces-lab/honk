import { IconStepBack } from "central-icons";
import { type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Button } from "@honk/honkkit/button";
import { Text, textVariants } from "@honk/honkkit/text";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/honkkit/tooltip";

export function SettingsSection({
  title,
  icon,
  headerAction,
  children,
}: {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-5 items-center justify-between px-1.5">
        <h2
          className={cn(
            textVariants({ size: "sm", tone: "tertiary", weight: "medium" }),
            "flex items-center gap-1.5",
          )}
        >
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div className="relative overflow-hidden rounded-lg bg-honk-bg-quinary text-card-foreground">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
}: {
  title: ReactNode;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-t border-honk-stroke-quaternary px-2.5 first:border-t-0 sm:px-3",
        children ? "py-3" : "py-2.5",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-4 items-center gap-1.5">
            <h3 className={textVariants({ size: "lg", tone: "primary", weight: "medium" })}>
              {title}
            </h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <Text render={<p />} size="base" tone="tertiary" className="block">
            {description}
          </Text>
          {status ? (
            <Text render={<div />} size="sm" tone="tertiary" className="block pt-1">
              {status}
            </Text>
          ) : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            className="size-5 rounded-sm p-0 text-honk-fg-tertiary hover:text-honk-fg-primary"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <IconStepBack className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">Reset to default</TooltipPopup>
    </Tooltip>
  );
}

export function SettingsPageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 select-none overflow-y-auto px-5 py-12 sm:px-8 sm:py-17 [&_input]:select-text [&_textarea]:select-text">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">{children}</div>
    </div>
  );
}
