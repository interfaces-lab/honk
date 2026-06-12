import {
  type ApprovalRequestId,
  type EnvironmentId,
  type OrchestrationThreadActivity,
  type ThreadId,
  type TurnId,
} from "@honk/contracts";
import { useCallback, useMemo, useState, type RefObject } from "react";

import { readEnvironmentApi } from "../../../environment-api";
import { newCommandId } from "~/lib/utils";
import { derivePendingUserInputs, type PendingUserInput } from "../../../session-logic";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
  type PendingUserInputProgress,
} from "../composer/pending/user-input";
import type { ComposerInputHandle } from "../composer/input";

const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const EMPTY_PENDING_USER_INPUTS: PendingUserInput[] = [];

export interface UseThreadPendingUserInputArgs {
  composerRef: RefObject<ComposerInputHandle | null>;
  environmentId: EnvironmentId;
  activeThreadId: ThreadId | null;
  threadActivities: ReadonlyArray<OrchestrationThreadActivity>;
  activeLatestTurnTurnId: TurnId | null;
  // When the latest turn has settled, pending user inputs no longer apply.
  // Allows callers to short-circuit derivation with a stable empty result.
  latestTurnSettled: boolean;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
}

export interface UseThreadPendingUserInputReturn {
  pendingUserInputs: PendingUserInput[];
  activePendingUserInput: PendingUserInput | null;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  activePendingQuestionIndex: number;
  activePendingProgress: PendingUserInputProgress | null;
  activePendingResolvedAnswers: Record<string, string | string[]> | null;
  activePendingIsResponding: boolean;
  onRespondToUserInput: (
    requestId: ApprovalRequestId,
    answers: Record<string, unknown>,
  ) => Promise<void>;
  onAdvanceActivePendingUserInput: (
    draftAnswersOverride?: Record<string, PendingUserInputDraftAnswer>,
  ) => void;
  onSelectActivePendingUserInputOption: (
    questionId: string,
    optionLabel: string,
    advanceAfterSelect?: boolean,
  ) => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;
  onPreviousActivePendingUserInputQuestion: () => void;
}

export function useThreadPendingUserInput(
  args: UseThreadPendingUserInputArgs,
): UseThreadPendingUserInputReturn {
  const {
    composerRef,
    environmentId,
    activeThreadId,
    threadActivities,
    activeLatestTurnTurnId,
    latestTurnSettled,
    setThreadError,
  } = args;

  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});

  const pendingUserInputs = useMemo(
    () =>
      latestTurnSettled || !activeThreadId
        ? EMPTY_PENDING_USER_INPUTS
        : derivePendingUserInputs(threadActivities, activeLatestTurnTurnId),
    [activeLatestTurnTurnId, activeThreadId, latestTurnSettled, threadActivities],
  );

  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingRequestId = activePendingUserInput?.requestId ?? null;
  const activePendingDraftAnswers = activePendingRequestId
    ? (pendingUserInputAnswersByRequestId[activePendingRequestId] ??
      EMPTY_PENDING_USER_INPUT_ANSWERS)
    : EMPTY_PENDING_USER_INPUT_ANSWERS;
  const activePendingQuestionIndex = activePendingRequestId
    ? (pendingUserInputQuestionIndexByRequestId[activePendingRequestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding =
    activePendingRequestId !== null &&
    respondingUserInputRequestIds.includes(activePendingRequestId);

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThreadId) {
        return;
      }

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.user-input.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit user input.",
          );
        });
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, environmentId, setThreadError],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingRequestId) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingRequestId]: nextQuestionIndex,
      }));
    },
    [activePendingRequestId],
  );

  const onAdvanceActivePendingUserInput = useCallback(
    (draftAnswersOverride?: Record<string, PendingUserInputDraftAnswer>) => {
      if (!activePendingUserInput) {
        return;
      }

      const draftAnswers = draftAnswersOverride ?? activePendingDraftAnswers;
      const progress = derivePendingUserInputProgress(
        activePendingUserInput.questions,
        draftAnswers,
        activePendingQuestionIndex,
      );

      if (!progress.canAdvance) {
        return;
      }
      if (progress.isLastQuestion) {
        const resolvedAnswers = buildPendingUserInputAnswers(
          activePendingUserInput.questions,
          draftAnswers,
        );
        if (resolvedAnswers) {
          void onRespondToUserInput(activePendingUserInput.requestId, resolvedAnswers);
        }
        return;
      }

      setActivePendingUserInputQuestionIndex(progress.questionIndex + 1);
    },
    [
      activePendingDraftAnswers,
      activePendingQuestionIndex,
      activePendingUserInput,
      onRespondToUserInput,
      setActivePendingUserInputQuestionIndex,
    ],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string, advanceAfterSelect = false) => {
      if (!activePendingUserInput) {
        return;
      }
      const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
      if (!question) {
        return;
      }

      const requestDraftAnswers =
        pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ?? {};
      const nextRequestDraftAnswers = {
        ...requestDraftAnswers,
        [questionId]: togglePendingUserInputOptionSelection(
          question,
          requestDraftAnswers[questionId],
          optionLabel,
        ),
      };
      setPendingUserInputAnswersByRequestId((existing) => {
        return {
          ...existing,
          [activePendingUserInput.requestId]: nextRequestDraftAnswers,
        };
      });
      composerRef.current?.clearComposer();

      if (advanceAfterSelect) {
        onAdvanceActivePendingUserInput(nextRequestDraftAnswers);
      }
    },
    [
      activePendingUserInput,
      composerRef,
      onAdvanceActivePendingUserInput,
      pendingUserInputAnswersByRequestId,
    ],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      _cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      const snapshot = composerRef.current?.readSnapshot();
      if (
        snapshot?.value !== value ||
        snapshot.cursor !== nextCursor ||
        snapshot.expandedCursor !== expandedCursor
      ) {
        composerRef.current?.focusAt(nextCursor);
      }
    },
    [activePendingUserInput, composerRef],
  );

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  return useMemo(
    () => ({
      pendingUserInputs,
      activePendingUserInput,
      activePendingDraftAnswers,
      activePendingQuestionIndex,
      activePendingProgress,
      activePendingResolvedAnswers,
      activePendingIsResponding,
      onRespondToUserInput,
      onAdvanceActivePendingUserInput,
      onSelectActivePendingUserInputOption,
      onChangeActivePendingUserInputCustomAnswer,
      onPreviousActivePendingUserInputQuestion,
    }),
    [
      activePendingDraftAnswers,
      activePendingIsResponding,
      activePendingProgress,
      activePendingQuestionIndex,
      activePendingResolvedAnswers,
      activePendingUserInput,
      onAdvanceActivePendingUserInput,
      onChangeActivePendingUserInputCustomAnswer,
      onPreviousActivePendingUserInputQuestion,
      onRespondToUserInput,
      onSelectActivePendingUserInputOption,
      pendingUserInputs,
    ],
  );
}
