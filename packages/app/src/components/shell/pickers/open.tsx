// @ts-nocheck
import { Menu } from "@base-ui/react/menu";
import { EDITORS, type EditorId } from "@multi/contracts";
import {
  IconArrowOutOfBox,
  IconCheckmark1Small,
  IconChevronDownSmall,
  IconFolderOpen,
} from "central-icons";

import { usePreferredEditor } from "~/editor-preferences";
import { ensureNativeApi } from "~/lib/native-runtime-api";
import { useShellState } from "~/hooks/use-shell-cwd";
import { useTheme } from "~/hooks/use-theme";
import { cn } from "~/lib/utils";
import { Button } from "@multi/ui/button";

// SVG icon paths for editors - using official brand assets
const editorSvgPaths: Record<string, string> = {
  cursor: "/icons/cursor/cursor.svg",
  vscode: "/icons/vscode/vscode.svg",
  "vscode-insiders": "/icons/vscode/vscode.svg",
  vscodium: "/icons/vscode/vscode.svg",
  zed: "/icons/zed/zed.svg",
  "zed-dark": "/icons/zed/zed-dark.svg",
};

function manager() {
  if (typeof navigator === "undefined") return "File Manager";
  const os = navigator.platform.toLowerCase();
  if (os.includes("mac")) return "Finder";
  if (os.includes("win")) return "Explorer";
  return "Files";
}

function label(id: EditorId) {
  if (id === "file-manager") return manager();
  return EDITORS.find((item) => item.id === id)?.label ?? id;
}

function getEditorIcon(id: EditorId, isDark: boolean): string | null {
  if (id === "zed" && isDark) return editorSvgPaths["zed-dark"] ?? null;
  return editorSvgPaths[id] ?? null;
}

export function OpenPicker(props: { variant?: "hero" | "settings" }) {
  const shell = useShellState();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [editor, setEditor] = usePreferredEditor(shell.availableEditors);
  const hero = props.variant !== "settings";

  const items = EDITORS.filter((item) => shell.availableEditors.includes(item.id)).map((item) => ({
    id: item.id,
    label: label(item.id),
    icon: getEditorIcon(item.id, isDark),
  }));

  const active = items.find((item) => item.id === editor) ?? null;
  const text = active ? `Open in ${active.label}` : "Open in editor";
  const disabled = !shell.cwd || !editor;
  const locked = !shell.cwd || items.length === 0;

  const ActiveIcon = active?.icon ? (
    <img
      src={active.icon}
      alt=""
      className={cn(hero ? "composer-toolbar-icon opacity-80" : "size-4 opacity-70")}
    />
  ) : active?.id === "file-manager" ? (
    <IconFolderOpen
      className={cn(hero ? "composer-toolbar-icon opacity-60" : "size-4 opacity-70")}
    />
  ) : (
    <IconArrowOutOfBox
      className={cn(hero ? "composer-toolbar-icon opacity-60" : "size-4 opacity-70")}
    />
  );

  return (
    <Menu.Root>
      {hero ? (
        <div
          className={cn(
            "group relative flex items-center",
            "before:pointer-events-none before:absolute before:inset-0 before:z-20 before:rounded-l-full before:rounded-r-full",
            "before:ring-2 before:ring-transparent before:ring-offset-0 before:ring-offset-background",
            "group-focus-within:before:ring-ring before:rounded-l-full before:rounded-r-full",
          )}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!shell.cwd || !editor) return;
              void ensureNativeApi().shell.openInEditor(shell.cwd, editor);
            }}
            className="font-multi relative inline-flex min-h-7 items-center gap-1.5 rounded-l-full border border-multi-stroke border-r-0 bg-multi-bubble px-2.5 text-detail/[17px] text-muted-foreground shadow-multi-card outline-none backdrop-blur-md transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:border-multi-stroke-strong hover:bg-multi-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50"
            aria-label={text}
            title={text}
          >
            {ActiveIcon}
            <span className="max-w-[16rem] truncate">{text}</span>
          </button>
          <div
            className="pointer-events-none absolute inset-y-1.5 z-10 w-px bg-multi-stroke"
            style={{ left: "calc(100% - 1.75rem)" }}
            aria-hidden
          />
          <Menu.Trigger
            aria-label="Choose editor"
            disabled={locked}
            className="font-multi relative inline-flex min-h-7 w-7 items-center justify-center rounded-r-full border border-multi-stroke border-l-0 bg-multi-bubble text-muted-foreground shadow-multi-card outline-none backdrop-blur-md transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:border-multi-stroke-strong hover:bg-multi-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50"
            title="Choose editor"
          >
            <IconChevronDownSmall className="composer-toolbar-icon opacity-60" />
          </Menu.Trigger>
        </div>
      ) : (
        <div className="group relative flex items-stretch">
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!shell.cwd || !editor) return;
              void ensureNativeApi().shell.openInEditor(shell.cwd, editor);
            }}
            variant="outline"
            size="sm"
            className="rounded-none rounded-l-[var(--multi-radius-control)] border-r-0 px-2.5 pr-2 before:rounded-none before:rounded-l-[calc(var(--radius-multi-control)-1px)]"
            aria-label={text}
            title={text}
          >
            {ActiveIcon}
            <span className="min-w-0 whitespace-normal text-left">{text}</span>
          </Button>
          <div
            className="pointer-events-none absolute inset-y-1.5 z-10 w-px bg-input"
            style={{ left: "calc(100% - 2rem)" }}
            aria-hidden
          />
          <Menu.Trigger
            aria-label="Choose editor"
            disabled={locked}
            title="Choose editor"
            render={
              <Button
                variant="outline"
                size="sm"
                className="w-8 shrink-0 rounded-none rounded-r-[var(--multi-radius-control)] border-l-0 px-0 before:rounded-none before:rounded-r-[calc(var(--radius-multi-control)-1px)]"
              >
                <IconChevronDownSmall className="size-3.5 opacity-70" />
              </Button>
            }
          />
        </div>
      )}
      <Menu.Portal>
        <Menu.Positioner
          className="z-50 outline-none ring-0"
          side="bottom"
          align="end"
          sideOffset={4}
        >
          <Menu.Popup className="w-[min(15rem,var(--available-width))] min-w-[10rem] overflow-hidden rounded border border-multi-stroke bg-multi-bubble text-foreground shadow-multi-popup outline-none ring-0 backdrop-blur-xl focus:outline-none focus-visible:outline-none">
            {items.length === 0 ? (
              <div className="px-3 py-1.5 text-body/[1.3] text-muted-foreground">
                No installed editors found.
              </div>
            ) : (
              items.map((item) => (
                <Menu.Item
                  key={item.id}
                  onClick={() => setEditor(item.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-body/[1.3] outline-none ring-0 transition-colors hover:bg-multi-hover data-highlighted:bg-multi-hover focus-visible:outline-none focus-visible:ring-0",
                    editor === item.id && "bg-primary/10",
                  )}
                >
                  {item.icon ? (
                    <img src={item.icon} alt="" className="size-3.5 shrink-0" />
                  ) : item.id === "file-manager" ? (
                    <IconFolderOpen
                      className="size-3.5 shrink-0 text-muted-foreground/75"
                      aria-hidden
                    />
                  ) : (
                    <IconArrowOutOfBox
                      className="size-3.5 shrink-0 text-muted-foreground/75"
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {editor === item.id ? (
                    <IconCheckmark1Small className="size-3.5 shrink-0 text-muted-foreground/70" />
                  ) : null}
                </Menu.Item>
              ))
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
