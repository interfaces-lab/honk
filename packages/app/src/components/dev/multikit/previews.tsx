import { Alert, AlertDescription, AlertTitle } from "@multi/multikit/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@multi/multikit/alert-dialog";
import { Badge } from "@multi/multikit/badge";
import { Button } from "@multi/multikit/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@multi/multikit/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@multi/multikit/dialog";
import { ButtonGroup, ButtonGroupSeparator } from "@multi/multikit/group";
import { Input } from "@multi/multikit/input";
import { Kbd, KbdGroup } from "@multi/multikit/kbd";
import { Label } from "@multi/multikit/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multi/multikit/menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@multi/multikit/empty";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@multi/multikit/popover";
import { ScrollArea } from "@multi/multikit/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@multi/multikit/select";
import { Separator } from "@multi/multikit/separator";
import { SidebarItem } from "@multi/multikit/sidebar";
import { Skeleton } from "@multi/multikit/skeleton";
import { Spinner } from "@multi/multikit/spinner";
import { StatusDot } from "@multi/multikit/status-dot";
import { Switch } from "@multi/multikit/switch";
import { Tabs } from "@multi/multikit/tabs";
import { Text } from "@multi/multikit/text";
import { Textarea } from "@multi/multikit/textarea";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@multi/multikit/tooltip";
import { WorkbenchIconButton, WorkbenchTextButton } from "@multi/multikit/workbench-button";
import { IconBubbleText, IconSettingsGear1 } from "central-icons";
import { useDialKit } from "dialkit";
import { useState, type ReactNode } from "react";

import { dialSelect, dialText, pickDialSelect } from "./dialkit-helpers";

function PreviewFrame({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-center">{children}</div>;
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
  const kinds = ["icon", "text"] as const;
  const tones = ["default", "primary", "danger"] as const;
  const params = useDialKit("Workbench Button", {
    kind: dialSelect(kinds, "icon"),
    active: false,
    tone: dialSelect(tones, "default"),
    label: dialText("Workbench"),
    disabled: false,
  });

  return (
    <PreviewFrame>
      {params.kind === "icon" ? (
        <WorkbenchIconButton active={params.active} disabled={params.disabled} aria-label={params.label}>
          <IconSettingsGear1 />
        </WorkbenchIconButton>
      ) : (
        <WorkbenchTextButton tone={pickDialSelect(params.tone, tones)} disabled={params.disabled}>
          {params.label}
        </WorkbenchTextButton>
      )}
    </PreviewFrame>
  );
}

function SidebarPreview() {
  const params = useDialKit("Sidebar Item", {
    label: dialText("Sidebar"),
    selected: false,
    interactive: true,
  });

  return (
    <PreviewFrame>
      <SidebarItem selected={params.selected} interactive={params.interactive} className="w-56">
        <IconBubbleText className="size-4 shrink-0" />
        <span className="truncate">{params.label}</span>
      </SidebarItem>
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

function TextPreview() {
  const sizes = ["xs", "sm", "base", "lg", "xl"] as const;
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
      <Badge variant={pickDialSelect(params.variant, variants)} size={pickDialSelect(params.size, sizes)}>
        {params.label}
      </Badge>
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
      <ScrollArea className="w-56 rounded-lg border border-multi-stroke-tertiary" style={{ height: params.height }}>
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: params.itemCount }, (_, index) => (
            <div
              key={index}
              className="rounded-md bg-multi-bg-quaternary px-3 py-2 text-sm text-multi-fg-secondary"
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
  const variants = ["segmented", "underline"] as const;
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
        <CollapsibleTrigger className="font-medium text-multi-fg-primary">{params.title}</CollapsibleTrigger>
        <CollapsiblePanel className="pt-2 text-sm text-multi-fg-secondary">{params.body}</CollapsiblePanel>
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
  const params = useDialKit("Popover", {
    title: dialText("Title"),
    description: dialText("Description"),
    sideOffset: [8, 0, 24, 1],
  });

  return (
    <PreviewFrame>
      <Popover>
        <PopoverTrigger render={<Button variant="outline" />}>Open popover</PopoverTrigger>
        <PopoverContent sideOffset={params.sideOffset}>
          <PopoverTitle>{params.title}</PopoverTitle>
          <PopoverDescription>{params.description}</PopoverDescription>
        </PopoverContent>
      </Popover>
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
  const params = useDialKit("Menu", {
    itemCount: [3, 2, 6, 1],
  });
  const items = Array.from({ length: params.itemCount }, (_, index) => `Action ${index + 1}`);

  return (
    <PreviewFrame>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          {items.map((label) => (
            <DropdownMenuItem key={label}>{label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </PreviewFrame>
  );
}

function AlertPreview() {
  const variants = ["default", "error", "info", "success", "warning"] as const;
  const params = useDialKit("Alert", {
    variant: dialSelect(variants, "info"),
    title: dialText("Title"),
    description: dialText("Description"),
  });

  return (
    <PreviewFrame>
      <Alert variant={pickDialSelect(params.variant, variants)} className="max-w-md">
        <AlertTitle>{params.title}</AlertTitle>
        <AlertDescription>{params.description}</AlertDescription>
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
            <AlertDialogClose render={<Button variant="destructive" />}>{params.destructiveLabel}</AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </PreviewFrame>
  );
}

export const MULTIKIT_PREVIEWS: Record<string, () => ReactNode> = {
  alert: AlertPreview,
  "alert-dialog": AlertDialogPreview,
  badge: BadgePreview,
  button: ButtonPreview,
  collapsible: CollapsiblePreview,
  dialog: DialogPreview,
  empty: EmptyPreview,
  group: GroupPreview,
  input: InputPreview,
  kbd: KbdPreview,
  label: LabelPreview,
  menu: MenuPreview,
  popover: PopoverPreview,
  "scroll-area": ScrollAreaPreview,
  select: SelectPreview,
  separator: SeparatorPreview,
  sidebar: SidebarPreview,
  skeleton: SkeletonPreview,
  spinner: SpinnerPreview,
  "status-dot": StatusDotPreview,
  switch: SwitchPreview,
  tabs: TabsPreview,
  text: TextPreview,
  textarea: TextareaPreview,
  tooltip: TooltipPreview,
  "workbench-button": WorkbenchButtonPreview,
};

export function MultikitPreview({ componentId }: { componentId: string }) {
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
