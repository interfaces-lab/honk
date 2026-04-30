import pierreDarkVibrant from "@pierre/theme/pierre-dark-vibrant";
import pierreLightVibrant from "@pierre/theme/pierre-light-vibrant";
import type { ThemeInput } from "streamdown";

export const chatStreamdownControls = {
  code: { copy: true, download: false },
  mermaid: false,
  table: true,
} as const;

export const chatStreamdownShikiTheme = [pierreLightVibrant, pierreDarkVibrant] as [
  ThemeInput,
  ThemeInput,
];

export const chatMarkdownThreadClassName = "font-multi chat-markdown text-body/5 text-foreground";

export const chatMarkdownToolClassName =
  "font-multi-mono chat-markdown text-detail/[1.4] text-foreground";
