import * as React from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import { type ModelCatalog, type ModelId, type ThinkingLevel } from "@honk/api/core/v1";
import { TextField } from "@honk/ui/text-field";

import { useRemote } from "../src/remote-context";
import { ActionButton, BodyText, DetailText, Page, useHonkTheme } from "../src/ui";

export default function NewTaskRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [title, setTitle] = React.useState("");
  const [cwd, setCwd] = React.useState(remote.defaultCwd);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null);
  const [model, setModel] = React.useState<ModelId | null>(null);
  const [thinkingLevel, setThinkingLevel] = React.useState<ThinkingLevel | null>(null);

  React.useEffect(() => {
    let active = true;
    if (remote.client === null) return;
    void remote.client.models
      .catalog()
      .then((next) => {
        if (!active) return;
        setCatalog(next);
        const selected =
          next.models.find((candidate) => candidate.available && candidate.id === next.defaultModel) ??
          next.models.find((candidate) => candidate.available);
        if (selected !== undefined) {
          setModel(selected.id);
          setThinkingLevel(selected.defaultThinkingLevel);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Models could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [remote.client]);

  if (remote.client === null) return <Redirect href="/connect" />;

  const create = async (): Promise<void> => {
    const normalizedCwd = cwd.trim();
    if (normalizedCwd === "") {
      setError("Choose the project folder for this task.");
      return;
    }
    if (model === null || thinkingLevel === null) {
      setError("No available model is configured on Core.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await remote.setDefaultCwd(normalizedCwd);
      const summary = await remote.client?.threads.create({
        cwd: normalizedCwd,
        model,
        thinkingLevel,
        ...(title.trim() === "" ? {} : { title: title.trim() }),
      });
      if (summary === undefined) throw new Error("Core disconnected while creating the task.");
      router.replace({
        pathname: "/(tabs)/home/[threadId]",
        params: { threadId: String(summary.id) },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The task could not be created.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Page>
      <Stack.Screen options={{ title: "New task" }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              gap: theme.metrics.space.rowGap,
              padding: theme.metrics.space.screenGutter,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TextField
            autoCapitalize="sentences"
            autoFocus
            label="Title"
            onChangeText={setTitle}
            placeholder="Optional task title"
            returnKeyType="next"
            value={title}
          />
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            label="Project folder"
            onChangeText={setCwd}
            placeholder="/Users/you/Developer/project"
            value={cwd}
          />
          <View style={{ gap: theme.metrics.space.contentGap }}>
            <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Model</BodyText>
            {catalog === null ? (
              <DetailText>Loading models…</DetailText>
            ) : (
              catalog.models.map((candidate) => {
                const selected = candidate.id === model;
                return (
                  <Pressable
                    key={String(candidate.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: !candidate.available }}
                    disabled={!candidate.available}
                    onPress={() => {
                      setModel(candidate.id);
                      setThinkingLevel(candidate.defaultThinkingLevel);
                    }}
                    style={({ pressed }) => ({
                      backgroundColor: selected ? theme.colors.accentSubtle : theme.colors.layer01,
                      borderColor: selected ? theme.colors.accent : theme.colors.borderBase,
                      borderRadius: theme.metrics.radius.panel,
                      borderWidth: theme.metrics.field.borderWidth,
                      gap: theme.metrics.space.compactGap,
                      opacity: candidate.available
                        ? pressed
                          ? theme.metrics.interaction.pressedOpacity
                          : 1
                        : theme.metrics.interaction.disabledOpacity,
                      padding: theme.metrics.space.panelPad,
                    })}
                  >
                    <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
                      {candidate.name}
                    </BodyText>
                    <DetailText>
                      {candidate.available ? candidate.description ?? candidate.provider : "Unavailable"}
                    </DetailText>
                  </Pressable>
                );
              })
            )}
          </View>
          {model === null || catalog === null ? null : (
            <View style={{ gap: theme.metrics.space.contentGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
                Thinking level
              </BodyText>
              <View style={[styles.choices, { gap: theme.metrics.space.compactGap }]}>
                {catalog.models
                  .find((candidate) => candidate.id === model)
                  ?.thinkingLevels.map((level) => {
                    const selected = level === thinkingLevel;
                    return (
                      <Pressable
                        key={level}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        onPress={() => setThinkingLevel(level)}
                        style={({ pressed }) => ({
                          backgroundColor: selected
                            ? theme.colors.accentSubtle
                            : theme.colors.control,
                          borderColor: selected ? theme.colors.accent : theme.colors.borderBase,
                          borderRadius: theme.metrics.radius.control,
                          borderWidth: theme.metrics.field.borderWidth,
                          minHeight: theme.metrics.interaction.touchTarget,
                          justifyContent: "center",
                          opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                          paddingHorizontal: theme.metrics.space.panelPad,
                        })}
                      >
                        <DetailText style={{ color: selected ? theme.colors.accent : undefined }}>
                          {level}
                        </DetailText>
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          )}
          {error === null ? null : (
            <DetailText accessibilityLiveRegion="polite" style={{ color: theme.colors.errFg }}>
              {error}
            </DetailText>
          )}
          <View style={styles.action}>
            <ActionButton
              disabled={model === null || thinkingLevel === null}
              label="Create task"
              onPress={() => void create()}
              pending={pending}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  action: {
    alignItems: "flex-end",
  },
  choices: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
});
