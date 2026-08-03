import { useEffect, useRef, useState } from "react";
import { IconApple, IconArrowDown, IconChevronDownMedium } from "central-icons";

import { Menu } from "@honk/ui";

import { cn } from "../lib/classes";
import {
  detectMacDesktopArch,
  MAC_DESKTOP_ARCH_OPTIONS,
  macDmgDownloadPath,
  type MacDesktopArch,
} from "../lib/desktop-download";

const controlBaseClassName =
  "inline-flex h-10 w-full items-center gap-2 rounded-pill px-3.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent";

const archSelectorClassName = cn(
  controlBaseClassName,
  "border border-transparent bg-layer-02 hover:bg-layer-03",
);

const downloadButtonClassName = cn(
  controlBaseClassName,
  "justify-center bg-accent font-medium text-[var(--honk-color-on-accent)] no-underline hover:bg-[color-mix(in_srgb,var(--honk-color-accent)_90%,var(--honk-color-text-primary))]",
);

function MacArchLabel(props: { archLabel: string; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate text-left", props.className)}>
      <span className="font-medium text-primary">macOS</span>{" "}
      <span className="font-normal text-muted">{props.archLabel}</span>
    </span>
  );
}

export function DesktopDownloadControls(props: { className?: string; showSectionLabel?: boolean }) {
  const [arch, setArch] = useState<MacDesktopArch>("arm64");
  const [menuOpen, setMenuOpen] = useState(false);
  const userPickedArch = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void detectMacDesktopArch().then((detected) => {
      if (!cancelled && !userPickedArch.current) setArch(detected);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedOption =
    MAC_DESKTOP_ARCH_OPTIONS.find((option) => option.arch === arch) ?? MAC_DESKTOP_ARCH_OPTIONS[0]!;

  return (
    <div className={cn("flex w-full max-w-[280px] flex-col items-stretch gap-2", props.className)}>
      {props.showSectionLabel ? (
        <p className="text-right text-sm font-medium text-muted">Download Honk for desktop</p>
      ) : null}

      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          aria-expanded={menuOpen}
          aria-label="Choose Mac download architecture"
          className={archSelectorClassName}
        >
          <IconApple className="size-4 shrink-0 text-primary" aria-hidden />
          <MacArchLabel archLabel={selectedOption.label} className="flex-1" />
          <IconChevronDownMedium
            className={cn(
              "size-4 shrink-0 text-muted transition-transform",
              menuOpen && "rotate-180",
            )}
            aria-hidden
          />
        </Menu.Trigger>
        <Menu.Popup
          align="end"
          aria-label="Mac download architectures"
          style={{
            minWidth: "var(--anchor-width)",
            width: "var(--anchor-width)",
            maxWidth: "calc(100vw - 2rem)",
          }}
          side="bottom"
          sideOffset={6}
        >
          {MAC_DESKTOP_ARCH_OPTIONS.map((option) => (
            <Menu.Item
              key={option.arch}
              onClick={() => {
                userPickedArch.current = true;
                setArch(option.arch);
                setMenuOpen(false);
              }}
            >
              <IconApple className="size-4 shrink-0 opacity-80" aria-hidden />
              <MacArchLabel archLabel={option.label} />
            </Menu.Item>
          ))}
        </Menu.Popup>
      </Menu.Root>

      <a
        className={downloadButtonClassName}
        href={macDmgDownloadPath(arch)}
        rel="noopener noreferrer"
      >
        Download
        <IconArrowDown className="size-4 shrink-0" aria-hidden />
      </a>
    </div>
  );
}
