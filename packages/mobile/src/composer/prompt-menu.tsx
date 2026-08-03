import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import type { OpenCodeClient } from "@honk/opencode";
import { ListRow, Text } from "@honk/ui";

import { useHonkTheme } from "../ui";
import {
  mergePromptCommands,
  rankPromptCommands,
  rankPromptFiles,
  PROMPT_FILE_SEARCH_DEBOUNCE_MS,
  type PromptCommandEntry,
  type PromptMenuItem,
  type PromptToken,
} from "./prompt-token";

const MENU_ANIMATION_MS = 160;
// The menu floats over the conversation, so it must never grow past a scannable few rows.
const MENU_MAX_VISIBLE_ROWS = 4.5;

export type PromptMenuStatus = "idle" | "loading" | "error";

export interface PromptMenuSelection {
  readonly item: PromptMenuItem;
  // The range the host should replace, as reported by detectPromptToken.
  readonly token: PromptToken;
  readonly insert: string;
}

interface PromptMenuProps {
  readonly items: readonly PromptMenuItem[];
  readonly onSelect: (selection: PromptMenuSelection) => void;
  readonly status: PromptMenuStatus;
  readonly token: PromptToken | null;
}

export function PromptMenu({
  items,
  onSelect,
  status,
  token,
}: PromptMenuProps): React.ReactElement | null {
  const theme = useHonkTheme();
  if (token === null) {
    return null;
  }
  const notice =
    status === "error"
      ? "Suggestions failed to load"
      : items.length > 0
        ? null
        : status === "loading"
          ? "Searching"
          : token.kind === "command"
            ? "No matching commands or skills"
            : "No matching files";
  return (
    <Animated.View
      entering={FadeInDown.duration(MENU_ANIMATION_MS)}
      exiting={FadeOut.duration(MENU_ANIMATION_MS)}
      style={[
        styles.surface,
        {
          backgroundColor: theme.colors.layer01,
          borderColor: theme.colors.borderStrong,
          borderRadius: theme.metrics.radius.panel,
          borderWidth: theme.metrics.field.borderWidth,
          marginHorizontal: theme.metrics.space.screenGutter,
          maxHeight: theme.metrics.interaction.touchTarget * MENU_MAX_VISIBLE_ROWS,
        },
      ]}
    >
      {notice === null ? null : (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.notice,
            {
              gap: theme.metrics.space.contentGap,
              minHeight: theme.metrics.interaction.touchTarget,
              paddingHorizontal: theme.metrics.space.panelPad,
            },
          ]}
        >
          {status === "loading" ? <ActivityIndicator color={theme.colors.textMuted} /> : null}
          <Text size="sm" tone="muted">
            {notice}
          </Text>
        </View>
      )}
      {items.length === 0 ? null : (
        <ScrollView
          contentContainerStyle={{ paddingVertical: theme.metrics.space.compactGap }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        >
          {items.map((item, index) => (
            <React.Fragment key={item.key}>
              {items[index - 1]?.section === item.section ? null : (
                <Text
                  size="xs"
                  tone="muted"
                  weight="semibold"
                  style={{
                    paddingHorizontal: theme.metrics.space.panelPad,
                    paddingTop: theme.metrics.space.compactGap,
                  }}
                >
                  {item.section}
                </Text>
              )}
              <ListRow
                accessibilityLabel={
                  item.detail === null ? item.title : `${item.title}, ${item.detail}`
                }
                onClick={() => {
                  onSelect({ item, token, insert: item.insert });
                }}
              >
                <ListRow.Content>
                  <ListRow.Title>{item.title}</ListRow.Title>
                  {item.detail === null ? null : (
                    <ListRow.Description>{item.detail}</ListRow.Description>
                  )}
                </ListRow.Content>
              </ListRow>
            </React.Fragment>
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
}

interface PromptSuggestions {
  readonly items: readonly PromptMenuItem[];
  readonly status: PromptMenuStatus;
}

// Commands and skills load once per server+directory and filter locally; file search hits the
// sidecar on every keystroke, so it is debounced and stale replies are dropped.
export function usePromptSuggestions(input: {
  readonly client: OpenCodeClient | null;
  readonly directory: string | null;
  readonly token: PromptToken | null;
}): PromptSuggestions {
  const [suggestions, setSuggestions] = React.useState<PromptSuggestions>({
    items: [],
    status: "idle",
  });
  const commandsRef = React.useRef<{
    readonly key: string;
    readonly entries: readonly PromptCommandEntry[];
  } | null>(null);
  const client = input.client;
  const directory = input.directory;
  const kind = input.token?.kind ?? null;
  const query = input.token?.query ?? "";

  React.useEffect(() => {
    if (kind === null || client === null) {
      setSuggestions({ items: [], status: "idle" });
      return;
    }
    const location = directory === null ? undefined : { directory };
    let cancelled = false;

    if (kind === "command") {
      const cacheKey = `${client.server.key}:${directory ?? ""}`;
      const cached = commandsRef.current;
      if (cached !== null && cached.key === cacheKey) {
        setSuggestions({ items: rankPromptCommands(cached.entries, query), status: "idle" });
        return;
      }
      setSuggestions({ items: [], status: "loading" });
      void Promise.all([client.commands.list(location), client.skills.list(location)])
        .then(([commands, skills]) => {
          const entries = mergePromptCommands({ skills: skills.data, commands: commands.data });
          commandsRef.current = { key: cacheKey, entries };
          if (cancelled) return;
          setSuggestions({ items: rankPromptCommands(entries, query), status: "idle" });
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions({ items: [], status: "error" });
        });
      return () => {
        cancelled = true;
      };
    }

    setSuggestions((previous) => ({ items: previous.items, status: "loading" }));
    const timer = setTimeout(() => {
      void client.files
        .find(query, location)
        .then((result) => {
          if (cancelled) return;
          setSuggestions({ items: rankPromptFiles(result.data), status: "idle" });
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions({ items: [], status: "error" });
        });
    }, PROMPT_FILE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, directory, kind, query]);

  return suggestions;
}

const styles = StyleSheet.create({
  surface: {
    borderCurve: "continuous",
    overflow: "hidden",
    width: "auto",
  },
  notice: {
    alignItems: "center",
    flexDirection: "row",
  },
});
