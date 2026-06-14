"use client";

import type {
  TabsIndicator as TabsIndicatorPrimitive,
  TabsList as TabsListPrimitive,
  TabsPanel as TabsPanelPrimitive,
  TabsRoot as TabsRootPrimitive,
  TabsTab as TabsTabPrimitive,
} from "@base-ui/react/tabs";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { createContext, useContext, type ReactNode } from "react";

import { cn, interactiveControlCursorVariants } from "./utils";

const TabsIndicatorSegmentedContext = createContext(false);
const TabsIndicatorUnderlineContext = createContext(false);
const TabsIndicatorClassNameContext = createContext<string | undefined>(undefined);

function TabsIndicatorRender(props: React.ComponentProps<"div">) {
  const isSegmented = useContext(TabsIndicatorSegmentedContext);
  const isUnderline = useContext(TabsIndicatorUnderlineContext);
  const indicatorClassName = useContext(TabsIndicatorClassNameContext);
  return (
    <div
      {...props}
      className={cn(
        props.className,
        "t-tabs-pill absolute left-0 z-[1] w-(--active-tab-width) translate-x-(--active-tab-left) transition-[width,translate,top,height,opacity,scale] duration-(--tabs-dur) ease-(--tabs-ease) motion-reduce:transition-none",
        "data-[rendered=false]:scale-95 data-[rendered=false]:opacity-0",
        isSegmented &&
          "top-(--active-tab-top) h-(--active-tab-height) rounded-[5px] bg-honk-bg-tertiary shadow-sm ring-1 ring-honk-stroke-secondary",
        isUnderline && "bottom-0 h-0.5 bg-honk-stroke-focused",
        indicatorClassName,
      )}
    />
  );
}

export const HONK_TABS_VARIANTS = {
  variant: ["segmented", "underline", "workbench"],
} as const;

export const HONK_TABS_DEFAULT_VARIANTS = {
  variant: "segmented",
} as const;

export interface TabsVariantsProps {
  variant?: (typeof HONK_TABS_VARIANTS.variant)[number];
}

export type TabsItem = {
  value: string;
  label: ReactNode;
  className?: string;
  render?: TabsTabPrimitive.Props["render"];
};

export type TabsProps = TabsVariantsProps & {
  tabs?: TabsItem[];
  value?: string;
  selectedValue?: string;
  onValueChange?: (value: string) => void;
  activateOnFocus?: TabsListPrimitive.Props["activateOnFocus"];
  className?: string;
  listClassName?: string;
  indicatorClassName?: string;
};

type StatefulClassName<State> = string | ((state: State) => string | undefined) | undefined;

function mergeStatefulClassName<State>(
  baseClassName: string,
  className: StatefulClassName<State>,
): string | ((state: State) => string | undefined) {
  if (typeof className === "function") {
    return (state) => cn(baseClassName, className(state));
  }

  return cn(baseClassName, className);
}

function TabsRoot({ className, ...props }: TabsRootPrimitive.Props) {
  return (
    <TabsPrimitive.Root
      className={mergeStatefulClassName("relative min-w-0", className)}
      data-slot="tabs-root"
      {...props}
    />
  );
}

function TabsList({ className, ...props }: TabsListPrimitive.Props) {
  return (
    <TabsPrimitive.List
      className={mergeStatefulClassName("relative flex min-w-0 shrink-0 items-stretch", className)}
      data-slot="tabs-list"
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: TabsTabPrimitive.Props) {
  return (
    <TabsPrimitive.Tab
      className={mergeStatefulClassName(
        cn(
          "t-tab relative flex items-center whitespace-nowrap bg-transparent outline-none transition-colors duration-(--tabs-dur) ease-(--tabs-ease) focus-visible:ring-1 focus-visible:ring-honk-stroke-focused focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none",
          interactiveControlCursorVariants(),
        ),
        className,
      )}
      data-slot="tabs-tab"
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPanelPrimitive.Props) {
  return (
    <TabsPrimitive.Panel
      className={mergeStatefulClassName("min-w-0", className)}
      data-slot="tabs-panel"
      {...props}
    />
  );
}

function TabsIndicator({ className, ...props }: TabsIndicatorPrimitive.Props) {
  return (
    <TabsPrimitive.Indicator
      className={mergeStatefulClassName("pointer-events-none", className)}
      data-slot="tabs-indicator"
      {...props}
    />
  );
}

function Tabs({
  tabs,
  value,
  selectedValue,
  onValueChange,
  activateOnFocus,
  className,
  listClassName,
  indicatorClassName,
  variant = HONK_TABS_DEFAULT_VARIANTS.variant,
}: TabsProps) {
  const items: TabsItem[] = tabs ?? [];

  if (items.length === 0) {
    return null;
  }

  const fallbackValue = items[0]?.value;
  const isControlled = value !== undefined;
  const isSegmented = variant === "segmented";
  const isUnderline = variant === "underline";
  const isWorkbench = variant === "workbench";

  return (
    <TabsIndicatorSegmentedContext.Provider value={isSegmented}>
      <TabsIndicatorUnderlineContext.Provider value={isUnderline}>
        <TabsIndicatorClassNameContext.Provider value={indicatorClassName}>
          <TabsRoot
            value={isControlled ? value : undefined}
            defaultValue={isControlled ? undefined : (selectedValue ?? fallbackValue)}
            className={cn("relative isolate min-w-0 font-honk font-medium", className)}
            onValueChange={(nextValue) => {
              onValueChange?.(String(nextValue));
            }}
          >
            <TabsList
              activateOnFocus={activateOnFocus}
              className={cn(
                "t-tabs scrollbar-hide relative min-w-0 shrink items-stretch",
                isSegmented &&
                  "h-7 rounded-[6px] bg-honk-bg-quinary p-0.5 ring-1 ring-honk-stroke-tertiary",
                isUnderline && "h-7 gap-3 border-b border-honk-stroke-tertiary pb-1",
                isWorkbench &&
                  "h-(--honk-workbench-chrome-row-height) gap-px px-(--honk-workbench-tab-container-padding)",
                listClassName,
              )}
            >
              {items.map((tab) => (
                <TabsTab
                  key={tab.value}
                  value={tab.value}
                  render={tab.render}
                  className={cn(
                    "relative z-[2]",
                    isSegmented &&
                      "h-6 rounded-[5px] px-2 text-body text-honk-fg-secondary hover:text-honk-fg-primary aria-selected:text-honk-fg-primary focus-visible:ring-inset",
                    isUnderline &&
                      "rounded-[5px] px-1.5 py-1 text-body text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary aria-selected:font-medium aria-selected:text-honk-fg-primary",
                    isWorkbench &&
                      "ui-tab-system-tab h-(--honk-workbench-tab-height) max-w-(--honk-workbench-tab-label-max-width) me-px rounded-honk-control px-(--honk-spacing-2) text-honk-tab text-honk-fg-tertiary hover:bg-honk-bg-card hover:text-honk-fg-primary focus-visible:shadow-[inset_0_0_0_2px_var(--honk-stroke-focused)] focus-visible:ring-0 aria-selected:bg-honk-bg-quaternary aria-selected:text-honk-fg-primary",
                    tab.className,
                  )}
                >
                  {tab.label}
                </TabsTab>
              ))}
              {!isWorkbench ? <TabsIndicator render={TabsIndicatorRender} /> : null}
            </TabsList>
          </TabsRoot>
        </TabsIndicatorClassNameContext.Provider>
      </TabsIndicatorUnderlineContext.Provider>
    </TabsIndicatorSegmentedContext.Provider>
  );
}

export { Tabs, TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab };
