import { createCodePlugin } from "@streamdown/code";
import { useMemo } from "react";
import { Streamdown, type StreamdownProps } from "streamdown";
import {
  chatMarkdownThreadClassName,
  chatMarkdownToolClassName,
  chatStreamdownControls,
  chatStreamdownShikiTheme,
} from "./chat-streamdown";
import { cn } from "./utils";

export type ChatMarkdownProps = Omit<StreamdownProps, "controls" | "plugins"> & {
  variant?: "thread" | "tool";
};

export function ChatMarkdown(props: ChatMarkdownProps) {
  const {
    variant = "thread",
    className,
    dir = "auto",
    lineNumbers = false,
    shikiTheme = chatStreamdownShikiTheme,
    ...rest
  } = props;
  const plugins = useMemo(() => ({ code: createCodePlugin({ themes: shikiTheme }) }), [shikiTheme]);
  const base = variant === "tool" ? chatMarkdownToolClassName : chatMarkdownThreadClassName;
  return (
    <Streamdown
      className={cn(base, className)}
      controls={chatStreamdownControls}
      dir={dir}
      lineNumbers={lineNumbers}
      plugins={plugins}
      shikiTheme={shikiTheme}
      {...rest}
    />
  );
}
