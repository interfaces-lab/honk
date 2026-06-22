import { IconStepBack } from "central-icons";
import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Button } from "@honk/honkkit/button";
import { Text } from "@honk/honkkit/text";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/honkkit/tooltip";
import { settingsPreferenceDomId } from "./settings-preference-index";

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
        <h2 className="flex items-center gap-1.5 font-honk text-honk-sm font-medium text-honk-fg-tertiary">
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

type SettingsItemShellProps = Omit<HTMLAttributes<HTMLDivElement>, "id"> & {
  preferenceId?: string | undefined;
  children: ReactNode;
};

export function SettingsItemShell({
  preferenceId,
  className,
  children,
  ...shellProps
}: SettingsItemShellProps) {
  return (
    <div
      {...shellProps}
      id={preferenceId ? settingsPreferenceDomId(preferenceId) : undefined}
      data-settings-preference-id={preferenceId}
      className={cn(
        "scroll-mt-24 border-t border-honk-stroke-quaternary px-2.5 first:border-t-0 sm:px-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsItemTitle({
  className,
  children,
  title,
}: {
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <h3 className={cn("font-honk text-honk-lg font-medium text-honk-fg-primary", className)} title={title}>
      {children}
    </h3>
  );
}

export function SettingsRow({
  preferenceId,
  title,
  description,
  status,
  resetAction,
  control,
  children,
}: {
  preferenceId?: string;
  title: ReactNode;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SettingsItemShell preferenceId={preferenceId} className={cn(children ? "py-3" : "py-2.5")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-4 items-center gap-1.5">
            <SettingsItemTitle>{title}</SettingsItemTitle>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <Text as="p" display="block" size="base" tone="tertiary">
            {description}
          </Text>
          {status ? (
            <div className="pt-1">
              <Text as="div" display="block" size="sm" tone="tertiary">
                {status}
              </Text>
            </div>
          ) : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </SettingsItemShell>
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
