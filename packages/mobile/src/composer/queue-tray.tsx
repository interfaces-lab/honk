import * as React from "react";
import { ScrollView, View } from "react-native";
import { Icon, ListRow } from "@honk/ui";

import { DetailText, useHonkTheme } from "../ui";
import type { QueueItem } from "./queue-store";

// Past this the tray starts eating the keyboard-adjacent composer, so the rest scrolls.
const VISIBLE_ROWS = 3;

interface QueueTrayProps {
  readonly items: readonly QueueItem[];
  readonly onRemove: (id: string) => void;
  readonly running: boolean;
}

export function QueueTray({ items, onRemove, running }: QueueTrayProps): React.ReactElement | null {
  const theme = useHonkTheme();
  if (items.length === 0) return null;

  const rows = items.map((item) => {
    const label = queueItemLabel(item);
    return (
      <ListRow key={item.id} size="sm">
        <ListRow.Content>
          <ListRow.Title>{label}</ListRow.Title>
        </ListRow.Content>
        <ListRow.Meta>
          <ListRow.Action accessibilityLabel={`Remove ${label}`} onClick={() => onRemove(item.id)}>
            <Icon name="xmark-circle" size="md" tone="muted" />
          </ListRow.Action>
        </ListRow.Meta>
      </ListRow>
    );
  });

  return (
    <View style={{ gap: theme.metrics.space.compactGap }}>
      <DetailText accessibilityLiveRegion="polite">
        {items.length} queued{running ? " · sends when this turn finishes" : ""}
      </DetailText>
      {items.length <= VISIBLE_ROWS ? (
        <View>{rows}</View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={{ maxHeight: theme.metrics.interaction.touchTarget * VISIBLE_ROWS }}
        >
          {rows}
        </ScrollView>
      )}
    </View>
  );
}

function queueItemLabel(item: QueueItem): string {
  const text = item.text.trim();
  if (text !== "") return text;
  return item.attachments.length === 1 ? "1 attachment" : `${item.attachments.length} attachments`;
}
