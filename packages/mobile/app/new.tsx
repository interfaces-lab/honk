import * as React from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import type { SidecarAgent, SidecarModel } from "@honk/opencode";
import { TextField } from "@honk/ui/text-field";

import { useRemote } from "../src/remote-context";
import { ActionButton, BodyText, DetailText, Page, useHonkTheme } from "../src/ui";

const defaultModel = (models: readonly SidecarModel[]): SidecarModel | null =>
  models.find((model) => model.status === "active") ?? models[0] ?? null;

export default function NewTaskRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [title, setTitle] = React.useState("");
  const [cwd, setCwd] = React.useState(remote.defaultCwd);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<readonly SidecarModel[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(true);
  const [agents, setAgents] = React.useState<readonly SidecarAgent[]>([]);
  const [agent, setAgent] = React.useState<string | null>(null);
  const [model, setModel] = React.useState<SidecarModel | null>(null);
  const [variant, setVariant] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    const client = remote.client;
    if (client === null) return;
    const configuredDirectory = remote.defaultCwd.trim();
    void (async () => {
      const directory =
        configuredDirectory === "" ? await client.defaultDirectory() : configuredDirectory;
      const [nextModels, nextAgents] = await Promise.all([
        client.listModels(),
        client.listAgents(directory),
      ]);
      return { directory, nextAgents, nextModels };
    })()
      .then(({ directory, nextAgents, nextModels }) => {
        if (!active) return;
        const selected = defaultModel(nextModels);
        const primaryAgents = nextAgents.filter((candidate) => candidate.mode !== "subagent");
        setModels(nextModels);
        setModelsLoading(false);
        setAgents(primaryAgents);
        setAgent(
          primaryAgents.find((candidate) => candidate.name === "build")?.name ??
            primaryAgents[0]?.name ??
            null,
        );
        setModel(selected);
        setVariant(selected?.variants[0] ?? null);
        if (configuredDirectory === "") setCwd(directory);
      })
      .catch((cause: unknown) => {
        if (active) {
          setModelsLoading(false);
          setError(cause instanceof Error ? cause.message : "Models could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, [remote.client, remote.defaultCwd]);

  if (remote.client === null) return <Redirect href="/connect" />;

  const chooseModel = (nextModel: SidecarModel): void => {
    setModel(nextModel);
    setVariant(nextModel.variants[0] ?? null);
  };

  const create = async (): Promise<void> => {
    const normalizedCwd = cwd.trim();
    if (normalizedCwd === "") {
      setError("Choose the project folder for this task.");
      return;
    }
    if (model === null) {
      setError("No models are available on the Honk host.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await remote.setDefaultCwd(normalizedCwd);
      const selectedModel = {
        id: model.id,
        providerID: model.providerID,
        ...(variant !== null ? { variant } : {}),
      };
      const summary = await remote.client?.threads.create({
        cwd: normalizedCwd,
        ...(agent !== null ? { agent } : {}),
        model: selectedModel,
        ...(variant !== null ? { variant } : {}),
        ...(title.trim() === "" ? {} : { title: title.trim() }),
      });
      if (summary === undefined) throw new Error("Honk disconnected while creating the task.");
      router.replace({
        pathname: "/(tabs)/home/[threadId]",
        params: { threadId: summary.id },
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

          {agents.length === 0 ? null : (
            <View style={{ gap: theme.metrics.space.contentGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Agent</BodyText>
              <View style={[styles.choices, { gap: theme.metrics.space.compactGap }]}>
                {agents.map((candidate) => {
                  const selected = candidate.name === agent;
                  return (
                    <Pressable
                      key={candidate.name}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setAgent(candidate.name)}
                      style={({ pressed }) => ({
                        backgroundColor: selected
                          ? theme.colors.accentSubtle
                          : theme.colors.control,
                        borderColor: selected ? theme.colors.accent : theme.colors.borderBase,
                        borderRadius: theme.metrics.radius.control,
                        borderWidth: theme.metrics.field.borderWidth,
                        justifyContent: "center",
                        minHeight: theme.metrics.interaction.touchTarget,
                        opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                        paddingHorizontal: theme.metrics.space.panelPad,
                      })}
                    >
                      <DetailText style={{ color: selected ? theme.colors.accent : undefined }}>
                        {candidate.name}
                      </DetailText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <View style={{ gap: theme.metrics.space.contentGap }}>
            <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Model</BodyText>
            {modelsLoading ? <DetailText>Loading models…</DetailText> : null}
            {!modelsLoading && models.length === 0 ? (
              <DetailText>No models are available on the Honk host.</DetailText>
            ) : null}
            {models.map((candidate) => {
              const selected =
                candidate.id === model?.id && candidate.providerID === model.providerID;
              return (
                <Pressable
                  key={`${candidate.providerID}/${candidate.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => chooseModel(candidate)}
                  style={({ pressed }) => ({
                    backgroundColor: selected ? theme.colors.accentSubtle : theme.colors.layer01,
                    borderColor: selected ? theme.colors.accent : theme.colors.borderBase,
                    borderRadius: theme.metrics.radius.panel,
                    borderWidth: theme.metrics.field.borderWidth,
                    gap: theme.metrics.space.compactGap,
                    opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                    padding: theme.metrics.space.panelPad,
                  })}
                >
                  <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
                    {candidate.name}
                  </BodyText>
                  <DetailText>
                    {candidate.family ?? candidate.id}
                    {candidate.reasoning ? " · reasoning" : ""}
                    {candidate.attachments ? " · attachments" : ""}
                  </DetailText>
                </Pressable>
              );
            })}
          </View>

          {model === null || model.variants.length === 0 ? null : (
            <View style={{ gap: theme.metrics.space.contentGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Variant</BodyText>
              <View style={[styles.choices, { gap: theme.metrics.space.compactGap }]}>
                {model.variants.map((candidate) => {
                  const selected = candidate === variant;
                  return (
                    <Pressable
                      key={candidate}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setVariant(candidate)}
                      style={({ pressed }) => ({
                        backgroundColor: selected
                          ? theme.colors.accentSubtle
                          : theme.colors.control,
                        borderColor: selected ? theme.colors.accent : theme.colors.borderBase,
                        borderRadius: theme.metrics.radius.control,
                        borderWidth: theme.metrics.field.borderWidth,
                        justifyContent: "center",
                        minHeight: theme.metrics.interaction.touchTarget,
                        opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                        paddingHorizontal: theme.metrics.space.panelPad,
                      })}
                    >
                      <DetailText style={{ color: selected ? theme.colors.accent : undefined }}>
                        {candidate}
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
              disabled={model === null}
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
