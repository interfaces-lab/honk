import { useState } from "react";
import { IconApple, IconArrowDown, IconChevronDownMedium } from "central-icons";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@honk/honkkit/menu";
import { cn } from "@honk/honkkit/utils";

import {
  defaultMacDesktopArch,
  MAC_DESKTOP_ARCH_OPTIONS,
  macDmgDownloadPath,
  type MacDesktopArch,
} from "../lib/desktop-download";

const controlBaseClassName =
  "inline-flex h-10 w-full items-center gap-2 rounded-full px-3.5 text-sm outline-none transition-colors focus-visible:ring-2";

const archSelectorClassName = cn(
  controlBaseClassName,
  "border border-transparent bg-neutral-200/70 hover:bg-neutral-200 focus-visible:ring-neutral-950/15 dark:bg-neutral-800/80 dark:hover:bg-neutral-800 dark:focus-visible:ring-white/20",
);

const downloadButtonClassName = cn(
  controlBaseClassName,
  "justify-center bg-neutral-950 font-medium text-white no-underline hover:bg-neutral-800 focus-visible:ring-neutral-950/20 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white dark:focus-visible:ring-white/20",
);

function MacArchLabel(props: { archLabel: string; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate text-left", props.className)}>
      <span className="font-medium text-neutral-950 dark:text-neutral-100">macOS</span>{" "}
      <span className="font-normal text-neutral-500 dark:text-neutral-400">{props.archLabel}</span>
    </span>
  );
}

export function DesktopDownloadControls(props: {
  className?: string;
  showSectionLabel?: boolean;
}) {
  const [arch, setArch] = useState<MacDesktopArch>(() => defaultMacDesktopArch());
  const [menuOpen, setMenuOpen] = useState(false);

  const selectedOption =
    MAC_DESKTOP_ARCH_OPTIONS.find((option) => option.arch === arch) ?? MAC_DESKTOP_ARCH_OPTIONS[0]!;

  return (
    <div className={cn("flex w-full max-w-[280px] flex-col items-stretch gap-2", props.className)}>
      {props.showSectionLabel ? (
        <p className="text-right text-sm font-medium text-neutral-600 dark:text-neutral-400">
          Download Honk for desktop
        </p>
      ) : null}

      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger
          aria-expanded={menuOpen}
          aria-label="Choose Mac download architecture"
          className={archSelectorClassName}
        >
          <IconApple className="size-4 shrink-0 text-neutral-950 dark:text-neutral-100" aria-hidden />
          <MacArchLabel archLabel={selectedOption.label} className="flex-1" />
          <IconChevronDownMedium
            className={cn(
              "size-4 shrink-0 text-neutral-500 transition-transform dark:text-neutral-400",
              menuOpen && "rotate-180",
            )}
            aria-hidden
          />
        </MenuTrigger>
        <MenuPopup
          align="end"
          aria-label="Mac download architectures"
          className="min-w-[var(--anchor-width)] w-[var(--anchor-width)] max-w-[calc(100vw-2rem)]"
          side="bottom"
          sideOffset={6}
        >
          {MAC_DESKTOP_ARCH_OPTIONS.map((option) => (
            <MenuItem
              key={option.arch}
              className="min-h-9 gap-2 rounded-md px-2.5"
              onClick={() => {
                setArch(option.arch);
                setMenuOpen(false);
              }}
            >
              <IconApple className="size-4 shrink-0 opacity-80" aria-hidden />
              <MacArchLabel archLabel={option.label} />
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>

      <a
        className={downloadButtonClassName}
        download
        href={macDmgDownloadPath(arch)}
        rel="noopener noreferrer"
      >
        Download
        <IconArrowDown className="size-4 shrink-0" aria-hidden />
      </a>
    </div>
  );
}
