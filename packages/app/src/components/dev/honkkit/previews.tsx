import { Alert, AlertAction, AlertDescription, AlertTitle } from "@honk/honkkit/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@honk/honkkit/alert-dialog";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@honk/honkkit/autocomplete";
import { Avatar, AvatarFallback, AvatarImage } from "@honk/honkkit/avatar";
import { Badge } from "@honk/honkkit/badge";
import { Button } from "@honk/honkkit/button";
import { Card, CardBody, CardFooter, CardHeader } from "@honk/honkkit/card";
import { BarChart, LineChart, PieChart, type ChartDatum } from "@honk/honkkit/chart";
import { Checkbox } from "@honk/honkkit/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@honk/honkkit/collapsible";
import { Code, Pre } from "@honk/honkkit/code";
import {
  Command,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSearchEmpty,
  CommandSearchInput,
  CommandSearchItem,
  CommandSearchList,
  CommandSearchPopup,
  CommandSeparator,
  CommandShortcut,
} from "@honk/honkkit/command";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@honk/honkkit/combobox";
import {
  ContextMenu,
  ContextMenuTrigger,
  WorkbenchContextMenuItem,
  WorkbenchContextMenuPopup,
  WorkbenchContextMenuSeparator,
} from "@honk/honkkit/context-menu";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@honk/honkkit/dialog";
import { ButtonGroup, ButtonGroupSeparator } from "@honk/honkkit/group";
import { HoverCard, HoverCardPopup, HoverCardTrigger } from "@honk/honkkit/hover-card";
import { Icon } from "@honk/honkkit/icon";
import { Input } from "@honk/honkkit/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@honk/honkkit/input-group";
import { Kbd, KbdGroup } from "@honk/honkkit/kbd";
import { Label } from "@honk/honkkit/label";
import { Grid, Row, Spacer, Stack } from "@honk/honkkit/layout";
import { Link } from "@honk/honkkit/link";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@honk/honkkit/menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@honk/honkkit/empty";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@honk/honkkit/popover";
import { Radio, RadioGroup } from "@honk/honkkit/radio-group";
import { ScrollArea } from "@honk/honkkit/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@honk/honkkit/select";
import { Separator } from "@honk/honkkit/separator";
import {
  SidebarItem,
  SidebarTray,
  SidebarTrayHeader,
  SidebarTrayHeaderButton,
  SidebarTrayRow,
  SidebarTrayRowContent,
  SidebarTrayRowLabel,
  SidebarTrayRowStatus,
} from "@honk/honkkit/sidebar";
import { Skeleton } from "@honk/honkkit/skeleton";
import { Spinner } from "@honk/honkkit/spinner";
import {
  SplitButton,
  SplitButtonAction,
  SplitButtonPopup,
  SplitButtonTrigger,
} from "@honk/honkkit/split-button";
import { Stat, StatLabel, StatValue } from "@honk/honkkit/stat";
import { StatusDot } from "@honk/honkkit/status-dot";
import { Switch } from "@honk/honkkit/switch";
import { Tabs } from "@honk/honkkit/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@honk/honkkit/table";
import { Text } from "@honk/honkkit/text";
import { Textarea } from "@honk/honkkit/textarea";
import { Toggle as ToggleButton } from "@honk/honkkit/toggle";
import { ToggleGroup, ToggleGroupItem, ToggleGroupSeparator } from "@honk/honkkit/toggle-group";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@honk/honkkit/tooltip";
import { toastContentVariants, toastRootVariants } from "@honk/honkkit/toast";
import {
  ToolCallLine,
  ToolCallLineChevron,
  ToolCallShellBody,
  ToolCallShellHeader,
  ToolCallShellRoot,
  ToolCallTaskBody,
  ToolCallTaskChevron,
  ToolCallTaskHeader,
  ToolCallTaskRoot,
  ToolCallTaskStatusIcon,
  ToolCallTaskSubtitle,
  ToolCallTaskTitle,
  ToolCallTaskTitleArea,
  type ToolCallLineStatus,
} from "@honk/honkkit/tool-call";
import {
  WorkbenchIconButton,
  WorkbenchTabIconContent,
  WorkbenchTextButton,
} from "@honk/honkkit/workbench-button";
import { WorkbenchChromeRow } from "@honk/honkkit/workbench-chrome-row";
import {
  IconClipboard,
  IconBubbleText,
  IconCheckCircle2,
  IconChevronRightMedium,
  IconClock,
  IconConsole,
  IconCrossMediumDefault,
  IconMagnifyingGlass,
  IconSettingsGear1,
  IconWarningSign,
} from "central-icons";
import { useDialKit } from "dialkit";
import { useState, type CSSProperties, type ReactNode } from "react";

import { ChatLoaderGlyph } from "~/components/chat/message/chat-loader";
import { dialSelect, dialText, pickDialSelect } from "./dialkit-helpers";
import { cn } from "~/lib/utils";

type TokenStyle = CSSProperties & Record<`--${string}`, string | number>;

type HonkBrandColor = {
  id: string;
  name: string;
  hex: `#${string}`;
  description: string;
  bordered?: boolean;
};

const HONK_BRAND_PALETTE = [
  {
    id: "interfere-orange",
    name: "Interfere Orange",
    hex: "#FF3B00",
    description: "Primary brand accent for high-energy moments and launches",
  },
  {
    id: "interfere-pink",
    name: "Interfere Pink",
    hex: "#F6009D",
    description: "Secondary accent for highlights, emphasis, and delight",
  },
  {
    id: "interfere-purple",
    name: "Interfere Purple",
    hex: "#973AC6",
    description: "Tertiary accent and gradient bridge across brand surfaces",
  },
  {
    id: "interfere-blue",
    name: "Interfere Blue",
    hex: "#008EFF",
    description: "Quaternary accent for focus, links, and active UI states",
  },
  {
    id: "off-white",
    name: "Off White",
    hex: "#F6F6F6",
    description: "Primary light background and neutral canvas",
    bordered: true,
  },
  {
    id: "near-black",
    name: "Near Black",
    hex: "#171717",
    description: "Primary dark background and foreground anchor",
  },
] satisfies HonkBrandColor[];

const HONK_BRAND_PALETTE_JSON = JSON.stringify(
  HONK_BRAND_PALETTE.map(({ id, name, hex, description }) => ({
    id,
    name,
    hex,
    description,
  })),
  null,
  2,
);

function PreviewFrame({ children }: { children: ReactNode }) {
  return <div className="flex w-full min-w-0 items-center justify-center">{children}</div>;
}

function HonkColorsPreview() {
  const [copyLabel, setCopyLabel] = useState("Copy JSON");

  async function copyPaletteJson() {
    await navigator.clipboard.writeText(HONK_BRAND_PALETTE_JSON);
    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy JSON"), 1200);
  }

  return (
    <PreviewFrame>
      <section className="w-[min(1120px,calc(100vw-18rem))] rounded-[32px] bg-[#fafafa] p-6 font-honk text-[#171717] shadow-honk-soft sm:p-8">
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-mono text-base font-medium tracking-[0.28em] text-[#6d6d6d] uppercase">
            Colors
          </h2>
          <button
            type="button"
            onClick={copyPaletteJson}
            className="inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-[#e9e9e7] px-6 text-base font-medium text-[#171717] outline-none hover:bg-[#dededc] focus-visible:ring-2 focus-visible:ring-[#008eff]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fafafa]"
          >
            <IconClipboard className="size-5 shrink-0" aria-hidden />
            <span>{copyLabel}</span>
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4" role="list">
          {HONK_BRAND_PALETTE.map((color) => {
            const swatchStyle: TokenStyle = {
              "--honk-brand-palette-swatch": color.hex,
            };

            return (
              <article
                key={color.id}
                className="[--palette-card-padding:--spacing(1.5)] [--palette-card-radius:1.75rem] rounded-(--palette-card-radius) bg-[#e9e9e7] p-(--palette-card-padding)"
                role="listitem"
              >
                <div
                  className={cn(
                    "h-36 rounded-[calc(var(--palette-card-radius)-var(--palette-card-padding))] bg-(--honk-brand-palette-swatch)",
                    color.bordered && "shadow-honk-swatch-inset",
                  )}
                  style={swatchStyle}
                />
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-5 pt-5 pb-4">
                  <h3 className="truncate text-xl font-medium tracking-[-0.01em] text-[#171717]">
                    {color.name}
                  </h3>
                  <div className="font-mono text-lg font-medium tracking-[0.04em] text-[#707070] tabular-nums">
                    {color.hex}
                  </div>
                  <p className="col-span-2 mt-2 truncate text-lg text-[#6d6d6d]">
                    {color.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </PreviewFrame>
  );
}

function ComponentSystemPreview() {
  const footerVariants = ["default", "bare"] as const;
  const params = useDialKit("Component System", {
    radius: [8, 0, 24, 1],
    maxWidth: [512, 320, 760, 8],
    viewportPadding: [16, 0, 64, 4],
    paddingInline: [24, 12, 48, 2],
    paddingBlock: [24, 12, 48, 2],
    footerPaddingBlock: [16, 8, 32, 2],
    gap: [8, 4, 24, 1],
    footerVariant: dialSelect(footerVariants, "default"),
    showCloseButton: true,
  });

  const dialogStyle: TokenStyle = {
    "--honk-dialog-radius": `${params.radius}px`,
    "--honk-dialog-max-width": `${params.maxWidth}px`,
    "--honk-dialog-padding-inline": `${params.paddingInline}px`,
    "--honk-dialog-padding-block": `${params.paddingBlock}px`,
    "--honk-dialog-footer-padding-block": `${params.footerPaddingBlock}px`,
    "--honk-dialog-header-gap": `${params.gap}px`,
    "--honk-dialog-footer-gap": `${params.gap}px`,
  };
  const viewportStyle: TokenStyle = {
    "--honk-dialog-viewport-padding": `${params.viewportPadding}px`,
  };
  const footerVariant = pickDialSelect(params.footerVariant, footerVariants);

  return (
    <PreviewFrame>
      <div className="grid w-[min(920px,calc(100vw-18rem))] gap-4 p-4 text-left">
        <Card variant="panel">
          <CardHeader className="border-b border-honk-stroke-tertiary">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Text size="lg" weight="semibold">
                  Component System
                </Text>
                <Text size="sm" tone="secondary">
                  Actual HonkKit primitives rendered against shared token geometry.
                </Text>
              </div>
              <Badge variant="success">Dev-only</Badge>
            </div>
          </CardHeader>
          <CardBody className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <Card>
                <CardHeader>
                  <Text weight="semibold">Action stack</Text>
                  <Text size="sm" tone="secondary">
                    Buttons, input, switch, status, and copy use live HonkKit components.
                  </Text>
                </CardHeader>
                <CardBody className="grid gap-4 pt-2">
                  <div className="flex flex-wrap gap-2">
                    <Button>Primary Action</Button>
                    <Button variant="outline">Secondary Action</Button>
                    <Button variant="ghost">Tertiary</Button>
                    <Button variant="destructive-outline">Delete Draft</Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Input defaultValue="HonkKit token audit" aria-label="Example project name" />
                    <div className="flex items-center gap-2 rounded-honk-control border border-honk-stroke-tertiary px-3">
                      <Switch defaultChecked aria-label="Use tokens" />
                      <Text size="sm" tone="secondary">
                        Tokens
                      </Text>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>Neutral</Badge>
                    <Badge variant="success">Ready</Badge>
                    <Badge variant="warning">Review</Badge>
                    <Badge variant="destructive">Blocked</Badge>
                  </div>
                </CardBody>
              </Card>

              <Card variant="flat">
                <CardHeader>
                  <Text weight="semibold">Dialog geometry</Text>
                  <Text size="sm" tone="secondary">
                    DialKit controls write the same CSS variables consumed by the Dialog primitive.
                  </Text>
                </CardHeader>
                <CardBody className="grid gap-2 pt-2">
                  <TokenReadout name="radius" value={`${params.radius}px`} token="--honk-dialog-radius" />
                  <TokenReadout
                    name="padding x"
                    value={`${params.paddingInline}px`}
                    token="--honk-dialog-padding-inline"
                  />
                  <TokenReadout
                    name="padding y"
                    value={`${params.paddingBlock}px`}
                    token="--honk-dialog-padding-block"
                  />
                  <TokenReadout
                    name="margin"
                    value={`${params.viewportPadding}px`}
                    token="--honk-dialog-viewport-padding"
                  />
                </CardBody>
                <CardFooter>
                  <Dialog>
                    <DialogTrigger render={<Button variant="outline" className="w-full" />}>
                      Open Tuned Dialog
                    </DialogTrigger>
                    <DialogPopup
                      showCloseButton={params.showCloseButton}
                      style={dialogStyle}
                      viewportStyle={viewportStyle}
                    >
                      <DialogHeader>
                        <DialogTitle>Token-backed dialog</DialogTitle>
                        <DialogDescription>
                          Radius, padding, width, gaps, and viewport margin all resolve through
                          `--honk-dialog-*` variables.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogPanel>
                        <div className="grid gap-3">
                          <Alert>
                            <AlertTitle>Geometry audit</AlertTitle>
                            <AlertDescription>
                              Change the DialKit controls and inspect the popup. The primitive stays
                              token-backed instead of hardcoding a parallel scale.
                            </AlertDescription>
                          </Alert>
                          <Input defaultValue="packages/honkkit/src/dialog.tsx" />
                        </div>
                      </DialogPanel>
                      <DialogFooter variant={footerVariant}>
                        <Button variant="outline">Cancel</Button>
                        <Button>Apply Tokens</Button>
                      </DialogFooter>
                    </DialogPopup>
                  </Dialog>
                </CardFooter>
              </Card>
            </div>

            <Card variant="flat">
              <CardHeader>
                <Text weight="semibold">Staircase roles</Text>
                <Text size="sm" tone="secondary">
                  Vercel-style 100–1000 intent steps mapped to Honk roles, not new overlapping CSS.
                </Text>
              </CardHeader>
              <CardBody className="grid gap-3 pt-2">
                <TokenStaircase
                  label="Neutral"
                  steps={[
                    "--honk-color-editor",
                    "--honk-color-chat",
                    "--honk-bg-quinary",
                    "--honk-stroke-tertiary",
                    "--honk-stroke-secondary",
                    "--honk-stroke-primary",
                    "--honk-fg-quaternary",
                    "--honk-fg-tertiary",
                    "--honk-fg-secondary",
                    "--honk-fg-primary",
                  ]}
                />
                <TokenStaircase
                  label="Status"
                  steps={[
                    "--honk-bg-green-secondary",
                    "--honk-bg-yellow-secondary",
                    "--honk-bg-red-secondary",
                    "--honk-stroke-green-primary",
                    "--honk-stroke-yellow-primary",
                    "--honk-stroke-red-primary",
                    "--success",
                    "--warning",
                    "--destructive",
                    "--honk-fg-primary",
                  ]}
                />
              </CardBody>
            </Card>
          </CardBody>
        </Card>
      </div>
    </PreviewFrame>
  );
}

function TokenReadout({ name, value, token }: { name: string; value: string; token: string }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 rounded-honk-control bg-honk-bg-quinary px-2 py-1.5">
      <Text size="xs" tone="tertiary">
        {name}
      </Text>
      <Code className="truncate">
        {token}: {value}
      </Code>
    </div>
  );
}

function TokenStaircase({ label, steps }: { label: string; steps: string[] }) {
  return (
    <div className="grid gap-2">
      <Text size="sm" weight="medium">
        {label}
      </Text>
      <div className="grid grid-cols-10 overflow-hidden rounded-honk-control border border-honk-stroke-tertiary">
        {steps.map((token, index) => (
          <div
            key={`${token}-${index}`}
            className="min-h-14 border-l border-honk-stroke-quaternary p-1 first:border-l-0"
            style={{ background: `var(${token})` }}
            title={token}
          >
            <Code className="text-[9px] mix-blend-difference">{(index + 1) * 100}</Code>
          </div>
        ))}
      </div>
    </div>
  );
}

function ButtonPreview() {
  const buttonVariants = [
    "default",
    "outline",
    "ghost",
    "destructive",
    "destructive-outline",
    "secondary",
    "link",
  ] as const;
  const buttonSizes = ["xs", "sm", "default", "lg", "xl", "icon", "icon-sm", "icon-lg"] as const;
  const params = useDialKit("Button", {
    variant: dialSelect(buttonVariants, "default"),
    size: dialSelect(buttonSizes, "default"),
    label: dialText("Button"),
    disabled: false,
  });

  return (
    <PreviewFrame>
      <Button
        variant={pickDialSelect(params.variant, buttonVariants)}
        size={pickDialSelect(params.size, buttonSizes)}
        disabled={params.disabled}
      >
        {params.label}
      </Button>
    </PreviewFrame>
  );
}

function WorkbenchButtonPreview() {
  const kinds = ["icon", "text", "tab"] as const;
  const tones = ["default", "primary", "danger"] as const;
  const params = useDialKit("Workbench Button", {
    kind: dialSelect(kinds, "icon"),
    active: false,
    tone: dialSelect(tones, "default"),
    label: dialText("Workbench"),
    badge: dialText("3"),
    disabled: false,
  });

  return (
    <PreviewFrame>
      {params.kind === "icon" ? (
        <WorkbenchIconButton
          active={params.active}
          disabled={params.disabled}
          aria-label={params.label}
        >
          <IconSettingsGear1 />
        </WorkbenchIconButton>
      ) : params.kind === "tab" ? (
        <WorkbenchIconButton
          active={params.active}
          aria-label={params.label}
          disabled={params.disabled}
          tabSystem
        >
          <WorkbenchTabIconContent badge={params.badge}>
            <IconSettingsGear1 />
          </WorkbenchTabIconContent>
        </WorkbenchIconButton>
      ) : (
        <WorkbenchTextButton tone={pickDialSelect(params.tone, tones)} disabled={params.disabled}>
          {params.label}
        </WorkbenchTextButton>
      )}
    </PreviewFrame>
  );
}

function WorkbenchChromeRowPreview() {
  const variants = ["tool", "panel"] as const;
  const gaps = ["action", "loose", "relaxed"] as const;
  const params = useDialKit("Workbench Chrome Row", {
    variant: dialSelect(variants, "tool"),
    gap: dialSelect(gaps, "action"),
    trailing: true,
    end: true,
  });
  const variant = pickDialSelect(params.variant, variants);

  return (
    <PreviewFrame>
      <div className="w-full max-w-xl overflow-hidden rounded-honk-card border border-honk-stroke-tertiary bg-honk-bg-elevated">
        <WorkbenchChromeRow
          end={
            params.end ? (
              <div className="honk-workbench-titlebar-end-space size-(--honk-workbench-action-size)" />
            ) : undefined
          }
          gap={pickDialSelect(params.gap, gaps)}
          trailing={
            params.trailing ? (
              <WorkbenchIconButton aria-label="Row settings" chrome={variant}>
                <IconSettingsGear1 className="size-4" />
              </WorkbenchIconButton>
            ) : undefined
          }
          variant={variant}
        >
          <WorkbenchIconButton
            active
            aria-label="Changes"
            chrome={variant}
            tabSystem={variant === "tool"}
          >
            <IconBubbleText className="size-4" />
          </WorkbenchIconButton>
          <WorkbenchIconButton
            aria-label="Terminal"
            chrome={variant}
            tabSystem={variant === "tool"}
          >
            <IconChevronRightMedium className="size-4 rotate-90" />
          </WorkbenchIconButton>
          <span className="no-drag min-w-0 truncate text-honk-chrome font-medium text-honk-fg-secondary">
            {variant === "tool" ? "Tool island" : "Panel title row"}
          </span>
        </WorkbenchChromeRow>
      </div>
    </PreviewFrame>
  );
}

function SidebarPreview() {
  const modes = ["item", "tray-row", "tray", "queue"] as const;
  const statuses = ["Editing", "Queued", "Running", "Done"] as const;
  const params = useDialKit("Sidebar Item", {
    mode: dialSelect(modes, "item"),
    label: dialText("Sidebar"),
    status: dialSelect(statuses, "Editing"),
    selected: false,
    showStatus: true,
    interactive: true,
    itemCount: [3, 1, 5, 1],
    busy: false,
    thumbnails: true,
  });
  const mode = pickDialSelect(params.mode, modes);
  const queueItems = Array.from({ length: params.itemCount }, (_, index) => ({
    label: index === 0 ? "Review staged changes before committing" : `Queued prompt ${index + 1}`,
    status:
      index === 0 && params.selected
        ? "Editing"
        : index === 1 && params.busy
          ? "Sending"
          : "Queued",
    selected: index === 0 && params.selected,
    thumbnails: params.thumbnails && index === 0,
  }));

  return (
    <PreviewFrame>
      {mode === "queue" ? (
        <SidebarTray className="w-80 rounded-honk-card border border-honk-stroke-tertiary bg-honk-bg-elevated">
          <SidebarTrayHeader>
            <SidebarTrayHeaderButton>
              <IconChevronRightMedium className="size-3.5 rotate-90" />
              <span className="min-w-0 truncate font-medium">{queueItems.length} queued</span>
            </SidebarTrayHeaderButton>
            {params.busy ? <Spinner className="size-3.5" /> : null}
          </SidebarTrayHeader>
          <div className="flex flex-col">
            {queueItems.map((item, index) => (
              <SidebarTrayRow
                className="group/sidebar-item"
                interactive={params.interactive}
                key={item.label}
                selected={item.selected}
              >
                <SidebarTrayRowContent disabled={item.selected}>
                  {item.thumbnails ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5">
                      <span className="size-4 rounded-[3px] bg-honk-bg-secondary" />
                      <span className="size-4 rounded-[3px] bg-honk-bg-tertiary" />
                    </span>
                  ) : (
                    <IconBubbleText className="size-4 shrink-0" />
                  )}
                  <SidebarTrayRowLabel className={cn(item.selected && "text-honk-fg-primary")}>
                    {item.label}
                  </SidebarTrayRowLabel>
                </SidebarTrayRowContent>
                <SidebarTrayRowStatus>{item.status}</SidebarTrayRowStatus>
                {!item.selected ? (
                  <span className="hidden shrink-0 items-center group-focus-within/sidebar-item:flex [@media(hover:hover)]:group-hover/sidebar-item:flex">
                    <Button aria-label={`Send ${index + 1}`} size="icon-xs" variant="ghost">
                      <IconChevronRightMedium className="rotate-90" />
                    </Button>
                    <Button aria-label={`Remove ${index + 1}`} size="icon-xs" variant="ghost">
                      <IconCrossMediumDefault />
                    </Button>
                  </span>
                ) : null}
              </SidebarTrayRow>
            ))}
          </div>
        </SidebarTray>
      ) : mode === "tray" ? (
        <SidebarTray className="w-72 rounded-honk-card border border-honk-stroke-tertiary bg-honk-bg-elevated">
          <SidebarTrayHeader>
            <SidebarTrayHeaderButton>
              <IconChevronRightMedium className="size-3.5 rotate-90" />
              <span className="min-w-0 truncate font-medium">{params.label}</span>
            </SidebarTrayHeaderButton>
          </SidebarTrayHeader>
          <SidebarTrayRow selected={params.selected} interactive={params.interactive}>
            <SidebarTrayRowContent disabled={params.selected}>
              <IconBubbleText className="size-4 shrink-0" />
              <SidebarTrayRowLabel className={cn(params.selected && "text-honk-fg-primary")}>
                {pickDialSelect(params.status, statuses)}
              </SidebarTrayRowLabel>
            </SidebarTrayRowContent>
            {params.showStatus ? <SidebarTrayRowStatus>Now</SidebarTrayRowStatus> : null}
          </SidebarTrayRow>
        </SidebarTray>
      ) : mode === "tray-row" ? (
        <SidebarTrayRow
          selected={params.selected}
          interactive={params.interactive}
          className="w-72"
        >
          <SidebarTrayRowContent disabled={params.selected}>
            <IconBubbleText className="size-4 shrink-0" />
            <SidebarTrayRowLabel className={cn(params.selected && "text-honk-fg-primary")}>
              {params.label}
            </SidebarTrayRowLabel>
          </SidebarTrayRowContent>
          {params.showStatus ? (
            <SidebarTrayRowStatus>{pickDialSelect(params.status, statuses)}</SidebarTrayRowStatus>
          ) : null}
        </SidebarTrayRow>
      ) : (
        <SidebarItem selected={params.selected} interactive={params.interactive} className="w-56">
          <IconBubbleText className="size-4 shrink-0" />
          <span className="truncate">{params.label}</span>
        </SidebarItem>
      )}
    </PreviewFrame>
  );
}

function GroupPreview() {
  const orientations = ["horizontal", "vertical"] as const;
  const params = useDialKit("Button Group", {
    orientation: dialSelect(orientations, "horizontal"),
    withSeparator: true,
  });

  return (
    <PreviewFrame>
      <ButtonGroup orientation={pickDialSelect(params.orientation, orientations)}>
        <Button variant="outline" size="sm">
          Left
        </Button>
        {params.withSeparator ? <ButtonGroupSeparator /> : null}
        <Button variant="outline" size="sm">
          Center
        </Button>
        {params.withSeparator ? <ButtonGroupSeparator /> : null}
        <Button variant="outline" size="sm">
          Right
        </Button>
      </ButtonGroup>
    </PreviewFrame>
  );
}

function SplitButtonPreview() {
  const params = useDialKit("Split Button", {
    label: dialText("Run"),
    disabled: false,
  });

  return (
    <PreviewFrame>
      <SplitButton>
        <SplitButtonAction variant="outline" disabled={params.disabled}>
          {params.label}
        </SplitButtonAction>
        <SplitButtonTrigger disabled={params.disabled} />
        <SplitButtonPopup>
          <DropdownMenuItem variant="workbench">Run current</DropdownMenuItem>
          <DropdownMenuItem variant="workbench">Run all</DropdownMenuItem>
          <DropdownMenuItem variant="workbench">Schedule run</DropdownMenuItem>
        </SplitButtonPopup>
      </SplitButton>
    </PreviewFrame>
  );
}

function TogglePreview() {
  const variants = ["default", "outline"] as const;
  const sizes = ["xs", "sm", "default", "lg"] as const;
  const params = useDialKit("Toggle", {
    variant: dialSelect(variants, "outline"),
    size: dialSelect(sizes, "default"),
    pressed: true,
    disabled: false,
    label: dialText("Toggle"),
  });

  return (
    <PreviewFrame>
      <ToggleButton
        disabled={params.disabled}
        pressed={params.pressed}
        size={pickDialSelect(params.size, sizes)}
        variant={pickDialSelect(params.variant, variants)}
      >
        {params.label}
      </ToggleButton>
    </PreviewFrame>
  );
}

function ToggleGroupPreview() {
  const variants = ["default", "outline"] as const;
  const sizes = ["xs", "sm", "default", "lg"] as const;
  const orientations = ["horizontal", "vertical"] as const;
  const params = useDialKit("Toggle Group", {
    variant: dialSelect(variants, "outline"),
    size: dialSelect(sizes, "default"),
    orientation: dialSelect(orientations, "horizontal"),
    multiple: false,
    disabled: false,
    withSeparator: true,
  });
  const [value, setValue] = useState<string[]>(["bold"]);

  return (
    <PreviewFrame>
      <ToggleGroup
        disabled={params.disabled}
        multiple={params.multiple}
        onValueChange={setValue}
        orientation={pickDialSelect(params.orientation, orientations)}
        size={pickDialSelect(params.size, sizes)}
        value={params.multiple ? value : value.slice(0, 1)}
        variant={pickDialSelect(params.variant, variants)}
      >
        <ToggleGroupItem value="bold">B</ToggleGroupItem>
        {params.withSeparator ? <ToggleGroupSeparator /> : null}
        <ToggleGroupItem value="italic">I</ToggleGroupItem>
        {params.withSeparator ? <ToggleGroupSeparator /> : null}
        <ToggleGroupItem value="code">{"{}"}</ToggleGroupItem>
      </ToggleGroup>
    </PreviewFrame>
  );
}

function TextPreview() {
  const sizes = ["xs", "sm", "base", "lg", "xl", "tab", "chrome", "workbench"] as const;
  const tones = ["primary", "secondary", "tertiary", "quaternary"] as const;
  const weights = ["regular", "medium", "semibold"] as const;
  const params = useDialKit("Text", {
    size: dialSelect(sizes, "base"),
    tone: dialSelect(tones, "primary"),
    weight: dialSelect(weights, "regular"),
    truncate: false,
    content: dialText("Text"),
  });

  return (
    <PreviewFrame>
      <Text
        size={pickDialSelect(params.size, sizes)}
        tone={pickDialSelect(params.tone, tones)}
        weight={pickDialSelect(params.weight, weights)}
        truncate={params.truncate}
      >
        {params.content}
      </Text>
    </PreviewFrame>
  );
}

function LinkPreview() {
  const params = useDialKit("Link", {
    label: dialText("Open docs"),
    tone: dialSelect(["primary", "muted", "inherit"] as const, "primary"),
  });

  return (
    <PreviewFrame>
      <Link href="#" tone={pickDialSelect(params.tone, ["primary", "muted", "inherit"] as const)}>
        {params.label}
      </Link>
    </PreviewFrame>
  );
}

function CodePreview() {
  const params = useDialKit("Code", {
    inline: true,
    content: dialText("pnpm run typecheck"),
  });

  return (
    <PreviewFrame>
      {params.inline ? <Code>{params.content}</Code> : <Pre>{params.content}</Pre>}
    </PreviewFrame>
  );
}

function LabelPreview() {
  const params = useDialKit("Label", {
    text: dialText("Label"),
    htmlFor: dialText("input"),
  });

  return (
    <PreviewFrame>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <Label htmlFor={params.htmlFor}>{params.text}</Label>
        <Input id={params.htmlFor} placeholder="you@example.com" />
      </div>
    </PreviewFrame>
  );
}

function KbdPreview() {
  const params = useDialKit("Kbd", {
    modifier: dialText("⌘"),
    key: dialText("K"),
    grouped: true,
  });

  return (
    <PreviewFrame>
      {params.grouped ? (
        <KbdGroup>
          <Kbd>{params.modifier}</Kbd>
          <Kbd>{params.key}</Kbd>
        </KbdGroup>
      ) : (
        <Kbd>
          {params.modifier}
          {params.key}
        </Kbd>
      )}
    </PreviewFrame>
  );
}

function InputPreview() {
  const sizes = ["sm", "default", "lg"] as const;
  const params = useDialKit("Input", {
    size: dialSelect(sizes, "default"),
    placeholder: dialText("Placeholder"),
    disabled: false,
  });

  return (
    <PreviewFrame>
      <Input
        size={pickDialSelect(params.size, sizes)}
        placeholder={params.placeholder}
        disabled={params.disabled}
        className="max-w-xs"
      />
    </PreviewFrame>
  );
}

function InputGroupPreview() {
  const params = useDialKit("Input Group", {
    placeholder: dialText("Search"),
    disabled: false,
  });

  return (
    <PreviewFrame>
      <InputGroup disabled={params.disabled} className="max-w-xs">
        <InputGroupAddon>
          <IconSettingsGear1 />
        </InputGroupAddon>
        <InputGroupInput type="search" placeholder={params.placeholder} />
        <InputGroupButton aria-label="Submit search">
          <IconChevronRightMedium />
        </InputGroupButton>
      </InputGroup>
    </PreviewFrame>
  );
}

const suggestionItems = [
  "Ask agent",
  "Attach file",
  "Run command",
  "Search project",
  "Open settings",
];

function AutocompletePreview() {
  const modes = ["list", "both", "inline", "none"] as const;
  const sizes = ["sm", "default", "lg"] as const;
  const params = useDialKit("Autocomplete", {
    mode: dialSelect(modes, "list"),
    size: dialSelect(sizes, "default"),
    open: true,
    showTrigger: true,
    showClear: false,
    itemCount: [4, 0, suggestionItems.length, 1],
    placeholder: dialText("Type a command"),
  });
  const items = suggestionItems.slice(0, params.itemCount);

  return (
    <PreviewFrame>
      <Autocomplete
        items={items}
        mode={pickDialSelect(params.mode, modes)}
        open={params.open}
        openOnInputClick
      >
        <div className="w-72">
          <AutocompleteInput
            placeholder={params.placeholder}
            showClear={params.showClear}
            showTrigger={params.showTrigger}
            size={pickDialSelect(params.size, sizes)}
            startAddon={<IconSettingsGear1 />}
          />
          <AutocompletePopup>
            <AutocompleteList>
              <AutocompleteGroup>
                <AutocompleteGroupLabel>Suggestions</AutocompleteGroupLabel>
                {items.map((item) => (
                  <AutocompleteItem key={item} value={item}>
                    {item}
                  </AutocompleteItem>
                ))}
              </AutocompleteGroup>
              <AutocompleteEmpty>No suggestions.</AutocompleteEmpty>
            </AutocompleteList>
          </AutocompletePopup>
        </div>
      </Autocomplete>
    </PreviewFrame>
  );
}

function ComboboxPreview() {
  const sizes = ["sm", "default", "lg"] as const;
  const params = useDialKit("Combobox", {
    size: dialSelect(sizes, "default"),
    open: true,
    showClear: false,
    showTrigger: true,
    disabled: false,
    itemCount: [4, 1, suggestionItems.length, 1],
    placeholder: dialText("Choose an option"),
  });
  const items = suggestionItems.slice(0, params.itemCount);
  const [value, setValue] = useState<string | null>(items[0] ?? null);

  return (
    <PreviewFrame>
      <Combobox
        disabled={params.disabled}
        items={items}
        onValueChange={setValue}
        open={params.open}
        value={value}
      >
        <div className="w-72">
          <ComboboxInput
            placeholder={params.placeholder}
            showClear={params.showClear}
            showTrigger={params.showTrigger}
            size={pickDialSelect(params.size, sizes)}
            startAddon={<IconSettingsGear1 />}
          />
          <ComboboxPopup>
            <ComboboxList>
              <ComboboxGroup>
                <ComboboxGroupLabel>Options</ComboboxGroupLabel>
                {items.map((item) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
              <ComboboxEmpty>No options.</ComboboxEmpty>
            </ComboboxList>
          </ComboboxPopup>
        </div>
      </Combobox>
    </PreviewFrame>
  );
}

function CheckboxPreview() {
  const params = useDialKit("Checkbox", {
    checked: true,
    disabled: false,
  });

  return (
    <PreviewFrame>
      <Checkbox checked={params.checked} disabled={params.disabled} />
    </PreviewFrame>
  );
}

function RadioGroupPreview() {
  const orientations = ["vertical", "horizontal"] as const;
  const params = useDialKit("Radio Group", {
    orientation: dialSelect(orientations, "vertical"),
    disabled: false,
  });
  const [value, setValue] = useState("runtime");

  return (
    <PreviewFrame>
      <RadioGroup
        className={cn(
          pickDialSelect(params.orientation, orientations) === "horizontal" && "flex-row gap-5",
        )}
        disabled={params.disabled}
        onValueChange={setValue}
        value={value}
      >
        {[
          ["runtime", "Runtime"],
          ["workbench", "Workbench"],
          ["shell", "Shell"],
        ].map(([itemValue, label]) => (
          <label className="flex items-center gap-2 text-body text-honk-fg-primary" key={itemValue}>
            <Radio value={itemValue} />
            <span>{label}</span>
          </label>
        ))}
      </RadioGroup>
    </PreviewFrame>
  );
}

function TextareaPreview() {
  const params = useDialKit("Textarea", {
    placeholder: dialText("Placeholder"),
    rows: [4, 2, 10, 1],
    disabled: false,
  });

  return (
    <PreviewFrame>
      <Textarea
        placeholder={params.placeholder}
        rows={params.rows}
        disabled={params.disabled}
        className="max-w-md"
      />
    </PreviewFrame>
  );
}

function SwitchPreview() {
  const params = useDialKit("Switch", {
    defaultChecked: true,
    disabled: false,
  });

  return (
    <PreviewFrame>
      <Switch defaultChecked={params.defaultChecked} disabled={params.disabled} />
    </PreviewFrame>
  );
}

function SelectPreview() {
  const params = useDialKit("Select", {
    placeholder: dialText("Select"),
    disabled: false,
  });
  const [value, setValue] = useState<string | null>("gpt");

  return (
    <PreviewFrame>
      <Select value={value} onValueChange={setValue} disabled={params.disabled}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder={params.placeholder} />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="gpt">GPT</SelectItem>
          <SelectItem value="claude">Claude</SelectItem>
          <SelectItem value="gemini">Gemini</SelectItem>
        </SelectPopup>
      </Select>
    </PreviewFrame>
  );
}

function BadgePreview() {
  const variants = [
    "default",
    "secondary",
    "outline",
    "destructive",
    "error",
    "info",
    "success",
    "warning",
  ] as const;
  const sizes = ["sm", "default", "lg"] as const;
  const params = useDialKit("Badge", {
    variant: dialSelect(variants, "default"),
    size: dialSelect(sizes, "default"),
    label: dialText("Beta"),
  });

  return (
    <PreviewFrame>
      <Badge
        variant={pickDialSelect(params.variant, variants)}
        size={pickDialSelect(params.size, sizes)}
      >
        {params.label}
      </Badge>
    </PreviewFrame>
  );
}

function IconPreview() {
  const sizes = ["xs", "sm", "default", "lg", "xl"] as const;
  const tones = [
    "current",
    "primary",
    "secondary",
    "tertiary",
    "quaternary",
    "accent",
    "warning",
  ] as const;
  const params = useDialKit("Icon", {
    size: dialSelect(sizes, "default"),
    tone: dialSelect(tones, "secondary"),
  });

  return (
    <PreviewFrame>
      <Icon size={pickDialSelect(params.size, sizes)} tone={pickDialSelect(params.tone, tones)}>
        <IconSettingsGear1 />
      </Icon>
    </PreviewFrame>
  );
}

function AvatarPreview() {
  const params = useDialKit("Avatar", {
    fallback: dialText("M"),
    showImage: false,
  });

  return (
    <PreviewFrame>
      <Avatar>
        {params.showImage ? (
          <AvatarImage
            src="https://avatars.githubusercontent.com/u/9919?s=64&v=4"
            alt="Preview avatar"
          />
        ) : null}
        <AvatarFallback>{params.fallback}</AvatarFallback>
      </Avatar>
    </PreviewFrame>
  );
}

const chartPreviewData: ChartDatum[] = [
  { label: "Mon", value: 24 },
  { label: "Tue", value: 38 },
  { label: "Wed", value: 30 },
  { label: "Thu", value: 48 },
  { label: "Fri", value: 42 },
];

function ChartPreview() {
  const kinds = ["bar", "line", "pie"] as const;
  const params = useDialKit("Charts", {
    kind: dialSelect(kinds, "bar"),
    showLabels: true,
  });
  const kind = pickDialSelect(params.kind, kinds);

  return (
    <PreviewFrame>
      <div className="w-72">
        {kind === "bar" ? (
          <BarChart
            aria-label="Weekly usage bar chart"
            data={chartPreviewData}
            showLabels={params.showLabels}
          />
        ) : kind === "line" ? (
          <LineChart
            aria-label="Weekly usage line chart"
            data={chartPreviewData}
            showLabels={params.showLabels}
          />
        ) : (
          <PieChart
            aria-label="Weekly usage pie chart"
            data={chartPreviewData.slice(0, 4)}
            showLabels={params.showLabels}
          />
        )}
      </div>
    </PreviewFrame>
  );
}

function CardPreview() {
  const variants = ["default", "flat", "panel"] as const;
  const params = useDialKit("Card", {
    variant: dialSelect(variants, "default"),
    title: dialText("Card"),
    body: dialText("Reusable surface"),
    showFooter: true,
    showAction: true,
  });

  return (
    <PreviewFrame>
      <Card variant={pickDialSelect(params.variant, variants)} className="w-72">
        <CardHeader>
          <Text weight="medium">{params.title}</Text>
        </CardHeader>
        <CardBody className="pt-2">
          <Text as="p" tone="secondary">
            {params.body}
          </Text>
        </CardBody>
        {params.showFooter ? (
          <CardFooter className="justify-between border-t border-honk-stroke-tertiary pt-3">
            <Text size="sm" tone="tertiary">
              Footer
            </Text>
            {params.showAction ? (
              <Button size="xs" variant="outline">
                Action
              </Button>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>
    </PreviewFrame>
  );
}

function LayoutPreview() {
  const modes = ["stack", "row", "grid", "spacer"] as const;
  const gaps = ["none", "xs", "sm", "md", "lg", "xl"] as const;
  const aligns = ["start", "center", "end", "stretch"] as const;
  const columns = ["auto", "1", "2", "3", "4"] as const;
  const params = useDialKit("Layout", {
    mode: dialSelect(modes, "stack"),
    gap: dialSelect(gaps, "md"),
    align: dialSelect(aligns, "stretch"),
    wrap: false,
    columns: dialSelect(columns, "3"),
    spacerSize: dialSelect(gaps, "md"),
  });
  const mode = pickDialSelect(params.mode, modes);
  const gap = pickDialSelect(params.gap, gaps);
  const align = pickDialSelect(params.align, aligns);
  const columnCount = pickDialSelect(params.columns, columns);
  const items = ["One", "Two", "Three", "Four"];

  const previewItem = (item: string) => (
    <div
      className="min-w-14 rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary px-3 py-2 text-center text-body text-honk-fg-secondary"
      key={item}
    >
      {item}
    </div>
  );

  return (
    <PreviewFrame>
      {mode === "stack" ? (
        <Stack
          align={align}
          gap={gap}
          className="w-72 rounded-honk-card border border-honk-stroke-tertiary p-3"
        >
          {items.slice(0, 3).map(previewItem)}
        </Stack>
      ) : mode === "row" ? (
        <Row
          align={align}
          gap={gap}
          wrap={params.wrap}
          className="w-72 rounded-honk-card border border-honk-stroke-tertiary p-3"
        >
          {items.map(previewItem)}
        </Row>
      ) : mode === "grid" ? (
        <Grid
          columns={columnCount}
          gap={gap}
          className="w-80 rounded-honk-card border border-honk-stroke-tertiary p-3"
        >
          {items.map(previewItem)}
        </Grid>
      ) : (
        <Row className="rounded-honk-card border border-honk-stroke-tertiary p-3">
          <span className="text-body text-honk-fg-secondary">Before</span>
          <Spacer orientation="horizontal" size={pickDialSelect(params.spacerSize, gaps)} />
          <span className="text-body text-honk-fg-secondary">After</span>
        </Row>
      )}
    </PreviewFrame>
  );
}

function StatPreview() {
  const params = useDialKit("Stat", {
    label: dialText("Latency"),
    value: dialText("42 ms"),
  });

  return (
    <PreviewFrame>
      <Stat>
        <StatLabel>{params.label}</StatLabel>
        <StatValue>{params.value}</StatValue>
      </Stat>
    </PreviewFrame>
  );
}

function TablePreview() {
  const params = useDialKit("Table", {
    rows: [2, 0, 8, 1],
    columns: [2, 2, 4, 1],
    longCells: false,
    dense: false,
    wide: false,
  });
  const columns = ["Name", "Status", "Owner", "Updated"].slice(0, params.columns);
  const rows = Array.from({ length: params.rows }, (_, index) => ({
    name: params.longCells ? `Runtime timeline projection ${index + 1}` : `Runtime ${index + 1}`,
    status: index % 3 === 0 ? "Ready" : index % 3 === 1 ? "Running" : "Queued",
    owner: index % 2 === 0 ? "Chat" : "Shell",
    updated: `${index + 1}m ago`,
  }));

  return (
    <PreviewFrame>
      <Table className={cn(params.wide ? "w-[34rem]" : "w-72", params.dense && "text-detail")}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length}>No rows.</TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.name}>
                {columns.includes("Name") ? <TableCell>{row.name}</TableCell> : null}
                {columns.includes("Status") ? <TableCell>{row.status}</TableCell> : null}
                {columns.includes("Owner") ? <TableCell>{row.owner}</TableCell> : null}
                {columns.includes("Updated") ? <TableCell>{row.updated}</TableCell> : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </PreviewFrame>
  );
}

function EmptyPreview() {
  const params = useDialKit("Empty", {
    title: dialText("Title"),
    description: dialText("Description"),
    showIcon: true,
  });

  return (
    <PreviewFrame>
      <Empty className="w-full max-w-md p-0">
        <EmptyHeader>
          {params.showIcon ? (
            <EmptyMedia variant="icon">
              <IconBubbleText />
            </EmptyMedia>
          ) : null}
          <EmptyTitle>{params.title}</EmptyTitle>
          <EmptyDescription>{params.description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </PreviewFrame>
  );
}

function SeparatorPreview() {
  const params = useDialKit("Separator", {
    orientation: dialSelect(["horizontal", "vertical"], "horizontal"),
    width: [240, 80, 480, 8],
  });

  return (
    <PreviewFrame>
      {params.orientation === "horizontal" ? (
        <div style={{ width: params.width }}>
          <Separator />
        </div>
      ) : (
        <div className="flex h-24 items-center">
          <Separator orientation="vertical" />
        </div>
      )}
    </PreviewFrame>
  );
}

function SkeletonPreview() {
  const params = useDialKit("Skeleton", {
    width: [240, 80, 480, 8],
    height: [16, 8, 64, 2],
    rounded: dialSelect(["sm", "md", "lg", "full"], "sm"),
  });

  const radiusClass =
    params.rounded === "full"
      ? "rounded-full"
      : params.rounded === "lg"
        ? "rounded-lg"
        : params.rounded === "md"
          ? "rounded-md"
          : "rounded-sm";

  return (
    <PreviewFrame>
      <Skeleton className={radiusClass} style={{ width: params.width, height: params.height }} />
    </PreviewFrame>
  );
}

function ScrollAreaPreview() {
  const params = useDialKit("Scroll Area", {
    height: [160, 80, 320, 8],
    itemCount: [12, 3, 30, 1],
  });

  return (
    <PreviewFrame>
      <ScrollArea
        className="w-56 rounded-lg border border-honk-stroke-tertiary"
        style={{ height: params.height }}
      >
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: params.itemCount }, (_, index) => (
            <div
              key={index}
              className="rounded-md bg-honk-bg-quaternary px-3 py-2 text-sm text-honk-fg-secondary"
            >
              Scroll item {index + 1}
            </div>
          ))}
        </div>
      </ScrollArea>
    </PreviewFrame>
  );
}

function TabsPreview() {
  const variants = ["segmented", "underline", "workbench"] as const;
  const params = useDialKit("Tabs", {
    variant: dialSelect(variants, "segmented"),
    tabCount: [3, 2, 5, 1],
  });
  const tabs = Array.from({ length: params.tabCount }, (_, index) => ({
    value: `tab-${index + 1}`,
    label: `Tab ${index + 1}`,
  }));

  return (
    <PreviewFrame>
      <Tabs
        variant={pickDialSelect(params.variant, variants)}
        tabs={tabs}
        selectedValue={tabs[0]!.value}
        className="w-full max-w-md"
      />
    </PreviewFrame>
  );
}

function CollapsiblePreview() {
  const params = useDialKit("Collapsible", {
    defaultOpen: false,
    title: dialText("Title"),
    body: dialText("Body"),
  });

  return (
    <PreviewFrame>
      <Collapsible defaultOpen={params.defaultOpen} className="w-full max-w-md text-left">
        <CollapsibleTrigger className="font-medium text-honk-fg-primary">
          {params.title}
        </CollapsibleTrigger>
        <CollapsiblePanel className="pt-2 text-sm text-honk-fg-secondary">
          {params.body}
        </CollapsiblePanel>
      </Collapsible>
    </PreviewFrame>
  );
}

function DialogPreview() {
  const params = useDialKit("Dialog", {
    title: dialText("Title"),
    description: dialText("Description"),
    showFooter: true,
  });

  return (
    <PreviewFrame>
      <Dialog>
        <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{params.title}</DialogTitle>
            <DialogDescription>{params.description}</DialogDescription>
          </DialogHeader>
          {params.showFooter ? (
            <DialogFooter>
              <Button variant="outline">Cancel</Button>
              <Button>Create</Button>
            </DialogFooter>
          ) : null}
        </DialogPopup>
      </Dialog>
    </PreviewFrame>
  );
}

function PopoverPreview() {
  const sides = ["top", "right", "bottom", "left"] as const;
  const aligns = ["start", "center", "end"] as const;
  const variants = ["default", "workbench"] as const;
  const params = useDialKit("Popover", {
    title: dialText("Title"),
    description: dialText("Description"),
    side: dialSelect(sides, "top"),
    align: dialSelect(aligns, "center"),
    variant: dialSelect(variants, "default"),
    sideOffset: [8, 0, 24, 1],
    tooltipStyle: false,
    instant: false,
    compact: false,
  });

  return (
    <PreviewFrame>
      <Popover open>
        <PopoverTrigger render={<Button variant="outline" />}>Open popover</PopoverTrigger>
        <PopoverContent
          align={pickDialSelect(params.align, aligns)}
          instant={params.instant}
          side={pickDialSelect(params.side, sides)}
          sideOffset={params.sideOffset}
          tooltipStyle={params.tooltipStyle}
          variant={pickDialSelect(params.variant, variants)}
        >
          <div className={cn("flex flex-col gap-1", params.compact ? "max-w-48" : "max-w-72")}>
            <PopoverTitle className={params.compact ? "text-body" : undefined}>
              {params.title}
            </PopoverTitle>
            <PopoverDescription className={params.compact ? "text-detail" : undefined}>
              {params.description}
            </PopoverDescription>
          </div>
        </PopoverContent>
      </Popover>
    </PreviewFrame>
  );
}

function HoverCardPreview() {
  const params = useDialKit("Hover Card", {
    title: dialText("Preview"),
    description: dialText("A richer hover surface for contextual detail."),
  });

  return (
    <PreviewFrame>
      <HoverCard>
        <HoverCardTrigger render={<Button variant="outline" />}>Hover card</HoverCardTrigger>
        <HoverCardPopup>
          <div className="flex flex-col gap-1">
            <Text weight="medium">{params.title}</Text>
            <Text as="p" tone="secondary">
              {params.description}
            </Text>
          </div>
        </HoverCardPopup>
      </HoverCard>
    </PreviewFrame>
  );
}

function TooltipPreview() {
  const params = useDialKit("Tooltip", {
    content: dialText("Tooltip"),
    sideOffset: [6, 0, 16, 1],
  });

  return (
    <PreviewFrame>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" />}>Hover me</TooltipTrigger>
          <TooltipPopup sideOffset={params.sideOffset}>{params.content}</TooltipPopup>
        </Tooltip>
      </TooltipProvider>
    </PreviewFrame>
  );
}

function MenuPreview() {
  const variants = ["default", "workbench"] as const;
  const params = useDialKit("Menu", {
    variant: dialSelect(variants, "workbench"),
    itemCount: [3, 2, 6, 1],
    disabledItem: true,
    showIcons: true,
    showChoiceItems: true,
  });
  const items = Array.from({ length: params.itemCount }, (_, index) => `Action ${index + 1}`);
  const variant = pickDialSelect(params.variant, variants);

  return (
    <PreviewFrame>
      <DropdownMenu open>
        <DropdownMenuTrigger render={<Button variant="outline" />}>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent align="start" variant={variant}>
          <DropdownMenuLabel variant={variant}>Actions</DropdownMenuLabel>
          {items.map((label, index) => (
            <DropdownMenuItem
              disabled={params.disabledItem && index === items.length - 1}
              key={label}
              variant={variant}
            >
              {params.showIcons && index === 0 ? <IconSettingsGear1 /> : null}
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </DropdownMenuItem>
          ))}
          {params.showChoiceItems ? (
            <>
              <DropdownMenuSeparator variant={variant} />
              <DropdownMenuCheckboxItem checked>Show details</DropdownMenuCheckboxItem>
              <DropdownMenuRadioGroup value="ask">
                <DropdownMenuRadioItem value="ask" variant={variant}>
                  Ask first
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="auto" variant={variant}>
                  Auto run
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </PreviewFrame>
  );
}

function ContextMenuPreview() {
  const params = useDialKit("Context Menu", {
    open: true,
    disabledItem: false,
    itemCount: [3, 1, 5, 1],
  });
  const items = ["Open", "Rename", "Duplicate", "Archive", "Delete"].slice(0, params.itemCount);

  return (
    <PreviewFrame>
      <ContextMenu open={params.open}>
        <ContextMenuTrigger className="rounded-honk-card border border-dashed border-honk-stroke-tertiary bg-honk-bg-quinary px-4 py-3 text-body text-honk-fg-secondary">
          Right click target
        </ContextMenuTrigger>
        <WorkbenchContextMenuPopup>
          {items.map((item, index) => (
            <WorkbenchContextMenuItem
              disabled={params.disabledItem && index === items.length - 1}
              icon={index === 0 ? <IconSettingsGear1 /> : undefined}
              key={item}
            >
              {item}
            </WorkbenchContextMenuItem>
          ))}
          <WorkbenchContextMenuSeparator />
          <WorkbenchContextMenuItem>Inspect</WorkbenchContextMenuItem>
        </WorkbenchContextMenuPopup>
      </ContextMenu>
    </PreviewFrame>
  );
}

function CommandPreview() {
  const modes = ["palette", "composer", "composer-positioned", "search"] as const;
  const states = ["results", "loading", "empty"] as const;
  const itemKinds = ["slash", "path"] as const;
  const params = useDialKit("Command", {
    mode: dialSelect(modes, "search"),
    state: dialSelect(states, "results"),
    itemKind: dialSelect(itemKinds, "slash"),
    itemCount: [4, 0, 6, 1],
    placeholder: dialText("Search settings"),
    searchQuery: dialText("mk"),
    searchTitle: dialText("Time format"),
    searchDescription: dialText("General"),
    showFooter: true,
  });
  const mode = pickDialSelect(params.mode, modes);
  const state = pickDialSelect(params.state, states);
  const itemKind = pickDialSelect(params.itemKind, itemKinds);

  if (mode === "search") {
    const searchItems =
      state === "empty"
        ? []
        : [
            {
              id: "time-format",
              title: params.searchTitle,
              description: params.searchDescription,
            },
          ];

    return (
      <PreviewFrame>
        <div className="w-80">
          <Autocomplete
          open
          items={searchItems}
          filteredItems={searchItems}
          filter={null}
          mode="none"
          value={params.searchQuery}
          autoHighlight
        >
          <CommandSearchInput
            placeholder={params.placeholder}
            startAddon={<IconMagnifyingGlass aria-hidden />}
            aria-label="Command search preview"
          />
          <CommandSearchPopup side="bottom" align="start" sideOffset={4}>
            <CommandSearchList>
              {searchItems.map((item) => (
                <CommandSearchItem
                  key={item.id}
                  value={item.id}
                  title={item.title}
                  description={item.description}
                />
              ))}
              {searchItems.length === 0 ? (
                <CommandSearchEmpty>No matching settings.</CommandSearchEmpty>
              ) : null}
            </CommandSearchList>
          </CommandSearchPopup>
        </Autocomplete>
        </div>
      </PreviewFrame>
    );
  }

  const slashItems = ["Ask", "Plan", "Search files", "Summarize", "New thread", "Open settings"];
  const pathItems = [
    "packages/app/src/components/chat/view/chat-view.tsx",
    "packages/honkkit/src/command.tsx",
    "packages/app/src/components/chat/composer/command-menu/menu.tsx",
    "packages/app/src/index.css",
  ];
  const items =
    state === "empty"
      ? []
      : (itemKind === "path" ? pathItems : slashItems).slice(
          0,
          state === "loading" ? 0 : params.itemCount,
        );
  const panel = (
    <Command aria-label="Command preview" items={items} mode="none">
      <div
        className={cn(
          "relative w-96 max-w-full overflow-hidden rounded-lg border border-honk-stroke-secondary bg-honk-bg-elevated font-honk text-honk-chrome text-honk-fg-primary shadow-honk-xl backdrop-blur-[length:var(--honk-glass-blur-floating)]",
          mode !== "palette" && "max-w-sm bg-honk-bg-quinary",
        )}
      >
        <CommandInput placeholder={params.placeholder} />
        <CommandPanel className={mode === "palette" ? "max-h-72" : "max-h-56"}>
          <CommandList>
            <CommandGroup>
              <CommandGroupLabel>
                {itemKind === "path"
                  ? "Files & Folders"
                  : mode === "palette"
                    ? "Commands"
                    : "Composer"}
              </CommandGroupLabel>
              {items.map((item, index) => (
                <CommandItem
                  data-is-selected={index === 0 ? "" : undefined}
                  key={item}
                  value={item}
                >
                  {itemKind === "path" ? <IconSettingsGear1 className="size-4" /> : null}
                  <span className="min-w-0 flex-1 truncate">{item}</span>
                  {itemKind === "slash" && index < 2 ? (
                    <CommandShortcut>{index === 0 ? "Enter" : "⌘K"}</CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {items.length > 0 ? <CommandSeparator /> : null}
            <CommandEmpty>
              {state === "loading"
                ? "Searching project files..."
                : itemKind === "path"
                  ? "No matching files or folders."
                  : "No matching command."}
            </CommandEmpty>
          </CommandList>
        </CommandPanel>
        {params.showFooter ? (
          <CommandFooter>
            <span>{state === "loading" ? "Loading" : `${items.length} results`}</span>
            <span>{itemKind === "path" ? "Tab to complete" : "Enter to select"}</span>
          </CommandFooter>
        ) : null}
      </div>
    </Command>
  );

  return (
    <PreviewFrame>
      {mode === "composer-positioned" ? (
        <div className="flex w-96 max-w-full flex-col items-start gap-2">
          <div className="rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary px-3 py-2 text-body text-honk-fg-secondary">
            Ask @ or / at the caret
          </div>
          <div className="w-80 origin-bottom-left">{panel}</div>
        </div>
      ) : (
        panel
      )}
    </PreviewFrame>
  );
}

function AlertPreview() {
  const variants = ["default", "error", "info", "success", "warning"] as const;
  const params = useDialKit("Alert", {
    variant: dialSelect(variants, "info"),
    title: dialText("Title"),
    description: dialText("Description"),
    showIcon: true,
    showAction: true,
    titleless: false,
    longCopy: false,
  });
  const description = params.longCopy
    ? `${params.description} This is intentionally longer to exercise wrapping, action alignment, and compact chat error-banner geometry.`
    : params.description;

  return (
    <PreviewFrame>
      <Alert variant={pickDialSelect(params.variant, variants)} className="max-w-md">
        {params.showIcon ? <IconSettingsGear1 /> : null}
        {params.titleless ? null : <AlertTitle>{params.title}</AlertTitle>}
        <AlertDescription>{description}</AlertDescription>
        {params.showAction ? (
          <AlertAction>
            <Button size="xs" variant="outline">
              Retry
            </Button>
            <Button size="xs" variant="ghost">
              Dismiss
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
    </PreviewFrame>
  );
}

function StatusDotPreview() {
  const states = [
    "draft",
    "running",
    "needsAttention",
    "doneUnseen",
    "doneSeen",
    "success",
    "critical",
    "inactive",
  ] as const;
  const params = useDialKit("Status Dot", {
    state: dialSelect(states, "running"),
    scale: [1, 0.5, 2, 0.05],
  });

  return (
    <PreviewFrame>
      <div className="flex items-center gap-3" style={{ transform: `scale(${params.scale})` }}>
        <StatusDot state={pickDialSelect(params.state, states)} />
        <Text tone="secondary">{params.state}</Text>
      </div>
    </PreviewFrame>
  );
}

function SpinnerPreview() {
  const params = useDialKit("Spinner", {
    scale: [1, 0.5, 2, 0.05],
  });

  return (
    <PreviewFrame>
      <div style={{ transform: `scale(${params.scale})` }}>
        <Spinner />
      </div>
    </PreviewFrame>
  );
}

function ToastPreview() {
  const chrome = ["default", "anchored", "tooltip"] as const;
  const kinds = ["success", "info", "warning", "error", "loading"] as const;
  const scenarios = [
    "single",
    "stack",
    "collapsed-stack",
    "error-copy",
    "anchored-tooltip",
  ] as const;
  const positions = ["top-right", "bottom-right", "bottom-center"] as const;
  const params = useDialKit("Toast", {
    scenario: dialSelect(scenarios, "single"),
    chrome: dialSelect(chrome, "default"),
    kind: dialSelect(kinds, "success"),
    position: dialSelect(positions, "bottom-right"),
    title: dialText("Saved"),
    description: dialText("Your changes are ready."),
    action: true,
    dismiss: true,
    expanded: true,
  });
  const scenario = pickDialSelect(params.scenario, scenarios);
  const selectedChrome =
    scenario === "anchored-tooltip" ? "anchored" : pickDialSelect(params.chrome, chrome);
  const selectedKind = pickDialSelect(params.kind, kinds);
  const selectedPosition = pickDialSelect(params.position, positions);
  const isCollapsedStack = scenario === "collapsed-stack";
  const previewToasts =
    scenario === "stack" || scenario === "collapsed-stack"
      ? [
          {
            kind: "loading",
            title: "Running command",
            description: "pnpm --filter @honk/app typecheck",
          },
          { kind: selectedKind, title: params.title, description: params.description },
          { kind: "info", title: "Context updated", description: "3 files added to the prompt" },
        ]
      : scenario === "error-copy"
        ? [
            {
              kind: "error",
              title: "Command failed",
              description:
                "fatal: cannot lock ref refs/heads/main because another process holds the lock",
            },
          ]
        : [{ kind: selectedKind, title: params.title, description: params.description }];

  return (
    <PreviewFrame>
      <div
        className={cn(
          "relative flex min-h-40 w-96 max-w-full rounded-honk-card border border-dashed border-honk-stroke-tertiary p-3",
          selectedPosition === "top-right" && "items-start justify-end",
          selectedPosition === "bottom-right" && "items-end justify-end",
          selectedPosition === "bottom-center" && "items-end justify-center",
        )}
      >
        <div className={cn("flex flex-col gap-2", isCollapsedStack && "gap-0")}>
          {previewToasts.map((toast, index) => (
            <div
              className={cn(
                toastRootVariants({ chrome: selectedChrome }),
                selectedChrome === "tooltip" ? "max-w-56" : "w-80",
                isCollapsedStack &&
                  index > 0 &&
                  "-mt-8 scale-[calc(1-var(--toast-index)*0.08)] opacity-[calc(1-var(--toast-index)*0.18)]",
              )}
              data-slot="toast-popup-preview"
              key={`${toast.kind}-${toast.title}`}
              style={{ "--toast-index": index } as CSSProperties}
            >
              <div
                className={toastContentVariants({
                  layout:
                    selectedChrome === "tooltip" || scenario === "anchored-tooltip"
                      ? "tooltip"
                      : "default",
                })}
                data-expanded={params.expanded && !isCollapsedStack ? "" : undefined}
                data-slot="toast-content-preview"
              >
                {selectedChrome === "tooltip" || scenario === "anchored-tooltip" ? null : (
                  <IconSettingsGear1
                    className={cn(
                      "size-4 shrink-0",
                      toast.kind === "success" && "text-success",
                      toast.kind === "info" && "text-info",
                      toast.kind === "warning" && "text-warning",
                      toast.kind === "error" && "text-destructive",
                      toast.kind === "loading" && "tool-call-shimmer text-honk-icon-secondary",
                    )}
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="min-w-0 wrap-break-word font-medium text-honk-fg-primary">
                    {toast.title}
                  </div>
                  {selectedChrome === "tooltip" || scenario === "anchored-tooltip" ? null : (
                    <div className="min-w-0 wrap-break-word text-honk-fg-secondary">
                      {toast.description}
                    </div>
                  )}
                </div>
                {scenario === "error-copy" ? (
                  <Button size="xs" variant="outline">
                    Copy
                  </Button>
                ) : selectedChrome === "tooltip" ||
                  scenario === "anchored-tooltip" ||
                  !params.action ? null : (
                  <Button size="xs" variant="outline">
                    Undo
                  </Button>
                )}
                {params.dismiss &&
                selectedChrome !== "tooltip" &&
                scenario !== "anchored-tooltip" ? (
                  <Button aria-label="Dismiss toast" size="icon-xs" variant="ghost">
                    <IconCrossMediumDefault />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PreviewFrame>
  );
}

interface SubagentPreviewLog {
  id: string;
  label: string;
  detail?: string | undefined;
  isRunning?: boolean | undefined;
}

interface SubagentPreviewFixture {
  roleLabel: string;
  verb: string;
  model: string;
  task: string;
  logs: ReadonlyArray<SubagentPreviewLog>;
}

const SUBAGENT_PREVIEW_FIXTURE: SubagentPreviewFixture = {
  roleLabel: "Oracle",
  verb: "manifesting",
  model: "gpt-5.5",
  task: "mapping Cursor composer layout",
  logs: [
    {
      id: "log-1",
      label: "Started",
      detail: "mapping Cursor composer layout",
      isRunning: true,
    },
    {
      id: "log-2",
      label: "Task",
      detail:
        "In `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`, compare composer DOM structure",
    },
  ],
};

function SubagentPreviewIndicator({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center text-honk-icon-accent-primary">
        <ChatLoaderGlyph maxExtent={12} />
      </span>
    );
  }
  return <span className="size-1.5 shrink-0 rounded-full bg-honk-icon-tertiary" aria-hidden="true" />;
}

function SubagentPreviewActivityRows({
  logs,
  className,
  rowClassName,
}: {
  logs: ReadonlyArray<SubagentPreviewLog>;
  className?: string | undefined;
  rowClassName?: string | undefined;
}) {
  return (
    <div className={className}>
      {logs.map((log) => (
        <div
          className={cn("flex min-h-5 max-w-full min-w-0 items-center gap-1.5", rowClassName)}
          key={log.id}
        >
          <span className="inline-flex w-3 shrink-0 items-center justify-center" aria-hidden="true">
            {log.isRunning ? (
              <ChatLoaderGlyph className="text-honk-icon-accent-primary" maxExtent={10} />
            ) : (
              <span className="size-1.5 rounded-full bg-honk-icon-tertiary" />
            )}
          </span>
          <span
            className={cn(
              "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
              log.isRunning && "tool-call-shimmer",
            )}
          >
            {log.label}
            {log.detail ? <span className="text-honk-fg-quaternary">: {log.detail}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function SubagentPreviewMetaRow({
  fixture,
  active,
  showChevron = true,
}: {
  fixture: SubagentPreviewFixture;
  active: boolean;
  showChevron?: boolean | undefined;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
      <span className="inline-flex w-3 shrink-0 items-center justify-center">
        <SubagentPreviewIndicator active={active} />
      </span>
      <span className="shrink-0 font-medium text-honk-fg-primary">{fixture.roleLabel}</span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-honk-fg-secondary">
        {fixture.verb}
      </span>
      <span className="shrink-0 text-caption text-honk-fg-tertiary tabular-nums">{fixture.model}</span>
      {showChevron ? (
        <span className="ml-0.5 inline-flex shrink-0 text-honk-fg-tertiary" aria-hidden="true">
          <IconChevronRightMedium className="size-3" />
        </span>
      ) : null}
    </span>
  );
}

function SubagentStatusVariantStackedInline({
  fixture,
  active,
}: {
  fixture: SubagentPreviewFixture;
  active: boolean;
}) {
  return (
    <button
      type="button"
      className="group/subagent-row flex min-h-6 w-fit max-w-full min-w-0 flex-col items-start gap-0.5 overflow-hidden text-left text-conversation text-honk-fg-secondary"
      data-subagent-row=""
    >
      <SubagentPreviewMetaRow active={active} fixture={fixture} />
      <span
        className={cn(
          "min-w-0 max-w-full overflow-hidden pl-4.5 text-ellipsis whitespace-nowrap text-honk-fg-tertiary",
          active && "tool-call-shimmer",
        )}
        data-subagent-task=""
      >
        {fixture.task}
      </span>
      {active ? (
        <SubagentPreviewActivityRows
          className="mt-0.5 ml-4.5 flex max-w-full min-w-0 flex-col border-l border-honk-stroke-secondary/60 pl-2 text-honk-fg-tertiary"
          logs={fixture.logs}
        />
      ) : null}
    </button>
  );
}

function SubagentStatusVariantTaskHeadline({
  fixture,
  active,
}: {
  fixture: SubagentPreviewFixture;
  active: boolean;
}) {
  return (
    <button
      type="button"
      className="group/subagent-row flex w-full min-w-0 max-w-full flex-col items-start gap-1 text-left text-conversation"
      data-subagent-row=""
    >
      <span className="inline-flex w-full min-w-0 items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden text-caption text-honk-fg-tertiary">
          <SubagentPreviewIndicator active={active} />
          <span className="shrink-0 font-medium text-honk-fg-secondary">
            {fixture.roleLabel} {fixture.verb}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-honk-fg-tertiary">
          <Badge size="xs" variant="outline">
            {fixture.model}
          </Badge>
          <IconChevronRightMedium className="size-3 opacity-60" />
        </span>
      </span>
      <span
        className={cn(
          "w-full min-w-0 text-body font-medium text-honk-fg-primary",
          active && "tool-call-shimmer",
        )}
        data-subagent-task=""
      >
        {fixture.task}
      </span>
      {active ? (
        <SubagentPreviewActivityRows
          className="data-subagent-running-log flex w-full min-w-0 max-w-full flex-col gap-0.5 text-caption text-honk-fg-tertiary"
          logs={fixture.logs}
          rowClassName="pl-0.5"
        />
      ) : null}
    </button>
  );
}

function SubagentStatusVariantSurfaceCard({
  fixture,
  active,
}: {
  fixture: SubagentPreviewFixture;
  active: boolean;
}) {
  return (
    <button
      type="button"
      className="group/subagent-row flex w-full min-w-0 max-w-full flex-col gap-1.5 rounded-honk-control border border-honk-stroke-tertiary/80 bg-honk-bg-quinary/40 px-2.5 py-2 text-left text-conversation transition-colors hover:border-honk-stroke-secondary hover:bg-honk-bg-quinary/70"
      data-subagent-row=""
    >
      <span className="inline-flex w-full min-w-0 items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden">
          <SubagentPreviewIndicator active={active} />
          <span className="shrink-0 font-medium text-honk-fg-primary">{fixture.roleLabel}</span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-honk-fg-secondary">
            {fixture.verb}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-caption text-honk-fg-tertiary tabular-nums">
          {fixture.model}
          <IconChevronRightMedium className="size-3" />
        </span>
      </span>
      <span
        className={cn(
          "min-w-0 text-detail font-medium text-honk-fg-primary",
          active && "tool-call-shimmer",
        )}
        data-subagent-task=""
      >
        {fixture.task}
      </span>
      {active ? (
        <SubagentPreviewActivityRows
          className="flex flex-col gap-0.5 rounded-honk-control bg-honk-bg-tertiary/30 px-2 py-1.5 text-caption text-honk-fg-tertiary"
          logs={fixture.logs}
        />
      ) : null}
    </button>
  );
}

function SubagentStatusVariantActivityRail({
  fixture,
  active,
}: {
  fixture: SubagentPreviewFixture;
  active: boolean;
}) {
  return (
    <button
      type="button"
      className="group/subagent-row relative flex w-full min-w-0 max-w-full flex-col gap-1 pl-3 text-left text-conversation"
      data-subagent-row=""
    >
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 w-px bg-honk-stroke-secondary/70"
      />
      <span className="relative inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
        <span className="absolute -left-3 inline-flex w-3 items-center justify-center bg-transparent">
          <SubagentPreviewIndicator active={active} />
        </span>
        <span className="pl-1.5 font-medium text-honk-fg-primary">{fixture.roleLabel}</span>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-honk-fg-secondary">
          {fixture.verb}
        </span>
        <span className="shrink-0 text-caption text-honk-fg-tertiary">{fixture.model}</span>
        <IconChevronRightMedium className="ml-auto size-3 shrink-0 text-honk-fg-tertiary" />
      </span>
      <span
        className={cn(
          "relative pl-1.5 text-detail font-medium text-honk-fg-primary",
          active && "tool-call-shimmer",
        )}
        data-subagent-task=""
      >
        {fixture.task}
      </span>
      {active ? (
        <div className="relative flex flex-col gap-1.5 pl-1.5 pt-0.5">
          {fixture.logs.map((log) => (
            <div className="relative flex min-w-0 items-start gap-2" key={log.id}>
              <span className="absolute -left-3 top-1.5 inline-flex w-3 items-center justify-center">
                {log.isRunning ? (
                  <ChatLoaderGlyph className="text-honk-icon-accent-primary" maxExtent={8} />
                ) : (
                  <span className="size-1.5 rounded-full bg-honk-icon-tertiary" />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 text-caption text-honk-fg-tertiary",
                  log.isRunning && "tool-call-shimmer",
                )}
              >
                <span className="font-medium text-honk-fg-secondary">{log.label}</span>
                {log.detail ? (
                  <span className="text-honk-fg-quaternary"> — {log.detail}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </button>
  );
}

function SubagentStatusPreview() {
  const states = ["active", "completed"] as const;
  const widths = ["compact", "wide"] as const;
  const params = useDialKit("Subagent Status", {
    state: dialSelect(states, "active"),
    width: dialSelect(widths, "wide"),
  });
  const active = pickDialSelect(params.state, states) === "active";
  const fixture = SUBAGENT_PREVIEW_FIXTURE;

  return (
    <PreviewFrame>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2 px-(--conversation-text-inset) py-1 text-conversation",
          pickDialSelect(params.width, widths) === "compact" ? "w-72" : "w-[28rem]",
        )}
        data-subagent-status-container=""
      >
        <div data-uidotsh-pick="Subagent status layout" className="contents">
          <div data-uidotsh-option="Stacked inline (current)" className="contents">
            <SubagentStatusVariantStackedInline active={active} fixture={fixture} />
          </div>
          <div data-uidotsh-option="Task headline" className="contents" hidden>
            <SubagentStatusVariantTaskHeadline active={active} fixture={fixture} />
          </div>
          <div data-uidotsh-option="Surface card" className="contents" hidden>
            <SubagentStatusVariantSurfaceCard active={active} fixture={fixture} />
          </div>
          <div data-uidotsh-option="Activity rail" className="contents" hidden>
            <SubagentStatusVariantActivityRail active={active} fixture={fixture} />
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}

function ToolCallPreview() {
  const statuses = [
    "idle",
    "loading",
    "completed",
    "error",
  ] as const satisfies readonly ToolCallLineStatus[];
  const scenarios = ["line", "status-matrix", "task", "shell"] as const;
  const widths = ["compact", "wide"] as const;
  const params = useDialKit("Tool Call", {
    scenario: dialSelect(scenarios, "line"),
    action: dialText("Read"),
    details: dialText("packages/honkkit/src/button.tsx"),
    status: dialSelect(statuses, "loading"),
    width: dialSelect(widths, "wide"),
    icon: true,
    clickable: false,
    linkable: false,
  });
  const status = pickDialSelect(params.status, statuses);
  const scenario = pickDialSelect(params.scenario, scenarios);
  const toolCalls =
    scenario === "status-matrix"
      ? statuses.map((lineStatus) => ({
          action:
            lineStatus === "idle"
              ? "Queued"
              : lineStatus === "loading"
                ? "Read"
                : lineStatus === "completed"
                  ? "Edited"
                  : "Failed",
          details:
            lineStatus === "error"
              ? "packages/app/src/components/chat/view/chat-view.tsx"
              : params.details,
          status: lineStatus,
        }))
      : [{ action: params.action, details: params.details, status }];

  return (
    <PreviewFrame>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1",
          pickDialSelect(params.width, widths) === "compact" ? "w-48" : "w-96",
        )}
      >
        {scenario === "task" ? (
          <ToolCallTaskRoot
            expanded
            status={status === "error" ? "error" : status === "loading" ? "running" : "completed"}
          >
            <ToolCallTaskHeader aria-expanded>
              <ToolCallTaskStatusIcon>
                {status === "loading" ? (
                  <IconClock className="tool-call-shimmer size-3.5" />
                ) : status === "error" ? (
                  <IconWarningSign className="size-3.5 text-honk-fg-red-primary" />
                ) : (
                  <IconCheckCircle2 className="size-3.5" />
                )}
              </ToolCallTaskStatusIcon>
              <ToolCallTaskTitleArea>
                <ToolCallTaskTitle loading={status === "loading"}>
                  {params.action}
                </ToolCallTaskTitle>
                <ToolCallTaskSubtitle>{params.details}</ToolCallTaskSubtitle>
              </ToolCallTaskTitleArea>
              <ToolCallTaskChevron expanded />
            </ToolCallTaskHeader>
            <ToolCallTaskBody>
              <div className="rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary px-2 py-1.5 text-honk-fg-secondary">
                Subagent transcript slot
              </div>
            </ToolCallTaskBody>
          </ToolCallTaskRoot>
        ) : scenario === "shell" ? (
          <ToolCallShellRoot
            expanded
            status={status === "error" ? "error" : status === "loading" ? "running" : "completed"}
          >
            <ToolCallShellHeader expandable expanded hasError={status === "error"}>
              {params.icon ? (
                <IconConsole className="size-3.5 shrink-0 text-honk-fg-tertiary" />
              ) : null}
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
                <span
                  className={cn(
                    "shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-honk-fg-secondary",
                    status === "loading" && "tool-call-shimmer",
                  )}
                  data-tool-call-line-action=""
                >
                  {params.action}
                </span>
                <span
                  className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-honk-fg-tertiary"
                  data-tool-call-line-details=""
                >
                  {params.details}
                </span>
              </span>
              <ToolCallLineChevron expanded />
            </ToolCallShellHeader>
            <ToolCallShellBody>
              <pre className="m-0 whitespace-pre-wrap px-(--conversation-tool-card-padding-x) py-1.5 font-mono text-conversation text-honk-fg-tertiary wrap-anywhere">
                $ pnpm --filter @honk/app typecheck{"\n"}node ../../scripts/tsc-rc.mjs --noEmit
              </pre>
            </ToolCallShellBody>
          </ToolCallShellRoot>
        ) : (
          toolCalls.map((toolCall) => (
            <ToolCallLine
              action={toolCall.action}
              className="max-w-full"
              details={toolCall.details}
              icon={params.icon ? IconSettingsGear1 : undefined}
              key={`${toolCall.status}-${toolCall.action}`}
              linkable={params.linkable}
              onClick={params.clickable ? () => undefined : undefined}
              status={toolCall.status}
            />
          ))
        )}
      </div>
    </PreviewFrame>
  );
}

function WorkbenchParityPreview() {
  const params = useDialKit("Workbench Parity", {
    showMotion: true,
    showShadows: true,
    showTypography: true,
  });

  return (
    <PreviewFrame>
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Text size="chrome" weight="medium">
            35px chrome row · 24px icons · 1px gap
          </Text>
          <div className="overflow-hidden rounded-honk-lg border border-honk-stroke-tertiary bg-honk-bg-elevated">
            <WorkbenchChromeRow
              variant="tool"
              trailing={
                <WorkbenchIconButton aria-label="Settings" chrome="tool">
                  <IconSettingsGear1 className="size-4" />
                </WorkbenchIconButton>
              }
            >
              <WorkbenchIconButton active aria-label="Tab 1" chrome="tool" tabSystem>
                <IconBubbleText className="size-4" />
              </WorkbenchIconButton>
              <WorkbenchIconButton aria-label="Tab 2" chrome="tool" tabSystem>
                <IconConsole className="size-4" />
              </WorkbenchIconButton>
            </WorkbenchChromeRow>
          </div>
        </div>

        {params.showShadows ? (
          <div className="flex flex-col gap-2">
            <Text size="chrome" weight="medium">
              Shadow ladder
            </Text>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["soft", "shadow-honk-soft"],
                  ["sm", "shadow-honk-sm"],
                  ["base", "shadow-honk-base"],
                  ["xl", "shadow-honk-xl"],
                ] as const
              ).map(([label, shadow]) => (
                <div
                  className={cn(
                    "flex h-16 items-center justify-center rounded-honk-lg border border-honk-stroke-tertiary bg-honk-bg-elevated text-honk-tab text-honk-fg-secondary",
                    shadow,
                  )}
                  key={label}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {params.showTypography ? (
          <div className="flex flex-col gap-2">
            <Text size="chrome" weight="medium">
              Workbench typography ramp
            </Text>
            <div className="flex flex-col gap-1 rounded-honk-lg border border-honk-stroke-tertiary bg-honk-bg-elevated p-3">
              <Text size="tab">Tab 12px / 16px leading</Text>
              <Text size="chrome">Chrome 13px / 18px leading</Text>
              <Text size="workbench">Workbench body 14px / 20px leading</Text>
            </div>
          </div>
        ) : null}

        {params.showMotion ? (
          <div className="flex flex-col gap-2">
            <Text size="chrome" weight="medium">
              Motion tiers (150ms UI · 300ms dialog)
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline">UI control (150ms)</Button>
              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>Dialog (300ms)</DialogTrigger>
                <DialogPopup>
                  <DialogHeader>
                    <DialogTitle>Dialog motion</DialogTitle>
                    <DialogDescription>Uses --motion-duration-dialog easing.</DialogDescription>
                  </DialogHeader>
                </DialogPopup>
              </Dialog>
            </div>
          </div>
        ) : null}

        <Text as="p" size="tab" tone="tertiary">
          QA: top bar tabs, panel headers, composer prompt, menus, dialogs, reduced-motion,
          light/dark glass.
        </Text>
      </div>
    </PreviewFrame>
  );
}

function AlertDialogPreview() {
  const params = useDialKit("Alert Dialog", {
    title: dialText("Title"),
    description: dialText("Description"),
    destructiveLabel: dialText("Confirm"),
  });

  return (
    <PreviewFrame>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="destructive" />}>Delete</AlertDialogTrigger>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{params.title}</AlertDialogTitle>
            <AlertDialogDescription>{params.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <AlertDialogClose render={<Button variant="destructive" />}>
              {params.destructiveLabel}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </PreviewFrame>
  );
}

export const MULTIKIT_PREVIEWS: Record<string, () => ReactNode> = {
  alert: AlertPreview,
  "alert-dialog": AlertDialogPreview,
  avatar: AvatarPreview,
  badge: BadgePreview,
  button: ButtonPreview,
  card: CardPreview,
  chart: ChartPreview,
  checkbox: CheckboxPreview,
  "component-system": ComponentSystemPreview,
  "honk-colors": HonkColorsPreview,
  code: CodePreview,
  collapsible: CollapsiblePreview,
  autocomplete: AutocompletePreview,
  combobox: ComboboxPreview,
  command: CommandPreview,
  "context-menu": ContextMenuPreview,
  "workbench-parity": WorkbenchParityPreview,
  dialog: DialogPreview,
  empty: EmptyPreview,
  group: GroupPreview,
  "hover-card": HoverCardPreview,
  icon: IconPreview,
  input: InputPreview,
  "input-group": InputGroupPreview,
  kbd: KbdPreview,
  label: LabelPreview,
  layout: LayoutPreview,
  link: LinkPreview,
  menu: MenuPreview,
  popover: PopoverPreview,
  "radio-group": RadioGroupPreview,
  "scroll-area": ScrollAreaPreview,
  select: SelectPreview,
  separator: SeparatorPreview,
  sidebar: SidebarPreview,
  skeleton: SkeletonPreview,
  spinner: SpinnerPreview,
  "split-button": SplitButtonPreview,
  "status-dot": StatusDotPreview,
  stat: StatPreview,
  switch: SwitchPreview,
  tabs: TabsPreview,
  table: TablePreview,
  text: TextPreview,
  textarea: TextareaPreview,
  tooltip: TooltipPreview,
  toast: ToastPreview,
  "subagent-status": SubagentStatusPreview,
  "tool-call": ToolCallPreview,
  toggle: TogglePreview,
  "toggle-group": ToggleGroupPreview,
  "workbench-button": WorkbenchButtonPreview,
  "workbench-chrome-row": WorkbenchChromeRowPreview,
};

export function HonkKitPreview({ componentId }: { componentId: string }) {
  const Preview = MULTIKIT_PREVIEWS[componentId];
  if (!Preview) {
    return (
      <PreviewFrame>
        <Text tone="secondary">Preview not implemented yet.</Text>
      </PreviewFrame>
    );
  }
  return <Preview />;
}
