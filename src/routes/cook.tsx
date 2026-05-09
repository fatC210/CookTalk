import { useConversation } from "@elevenlabs/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  MessageCircle,
  Mic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Timer,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  buildCookingAgentFirstMessage,
  buildCookingAgentPrompt,
  buildCookingContextUpdate,
  buildCookingManualReplyPrompt,
  buildCookingTimerFinishedPrompt,
} from "@/lib/cooking-agent";
import { getApiKey } from "@/lib/crypto";
import { db, type Recipe } from "@/lib/db";
import { ElevenLabsService } from "@/lib/elevenlabs";
import { parseVoiceIntent } from "@/lib/voice-pipeline";
import { useTimers, type TimerInfo } from "@/hooks/use-timers";
import { useAppStore } from "@/stores/app-store";
import { useCookingStore } from "@/stores/cooking-store";

export const Route = createFileRoute("/cook")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || "",
  }),
  head: () => ({
    meta: [
      { title: "Cooking - CookTalk" },
      { name: "description", content: "Full-screen, hands-free cooking mode." },
    ],
  }),
  component: CookPage,
});

type AppLanguage = "en" | "zh";
type AgentStatus = "disconnected" | "connecting" | "connected" | "error";

type LatestCookingState = {
  recipe: Recipe | null;
  stepIndex: number;
  timers: TimerInfo[];
  isPaused: boolean;
};

function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function CookPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = Route.useSearch();
  const language = useAppStore((s) => s.language) as AppLanguage;
  const toggleVoiceBadges = useAppStore((s) => s.toggleVoiceBadges);
  const cookingVoiceId = useAppStore((s) => s.cookingVoiceId);
  const cookingAgentId = useAppStore((s) => s.cookingAgentId).trim();

  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [spokenReply, setSpokenReply] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [agentError, setAgentError] = useState<string | null>(null);

  const {
    currentStep,
    isPaused,
    startCooking,
    endCooking,
    nextStep,
    prevStep,
    pauseCooking,
    resumeCooking,
    jumpToStep,
  } = useCookingStore();

  const { activeTimers, cancelTimer, extendTimer, startTimer, setOnCompleted } = useTimers();

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const startInFlightRef = useRef(false);
  const sessionKeyRef = useRef<string | null>(null);
  const latestStateRef = useRef<LatestCookingState>({
    recipe: null,
    stepIndex: 0,
    timers: [],
    isPaused: false,
  });

  const recipeStepCount = recipe?.steps.length ?? 0;
  const safeStep =
    recipeStepCount > 0 ? Math.max(0, Math.min(currentStep, recipeStepCount - 1)) : 0;
  const step = recipe?.steps[safeStep];
  const stepNumber = safeStep + 1;
  const stepCount = recipeStepCount;
  const resolvedVoiceId = cookingVoiceId ?? recipe?.voiceId ?? undefined;
  const autoSessionKey = recipe && cookingAgentId ? `${recipe.id}:${cookingAgentId}` : null;

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      setAgentError(null);
      if (conversationId) {
        toast.success(`Cooking agent connected: ${conversationId}`);
      }
    },
    onDisconnect: () => {
      startInFlightRef.current = false;
    },
    onError: (message) => {
      startInFlightRef.current = false;
      setAgentError(message);
      toast.error(message);
    },
    onMessage: (event) => {
      if (event.type === "user_transcript") {
        const transcript = event.user_transcription_event.user_transcript.trim();
        setLastTranscript(transcript);
        void handleTranscriptIntentRef.current(transcript);
        return;
      }

      if (event.type === "agent_response") {
        setSpokenReply(event.agent_response_event.agent_response);
        return;
      }

      if (event.type === "agent_response_correction") {
        setSpokenReply(event.agent_response_correction_event.corrected_agent_response);
      }
    },
  });
  const {
    endSession,
    isMuted,
    mode,
    sendContextualUpdate,
    sendUserMessage,
    setMuted,
    startSession,
    status,
  } = conversation;

  const handleClose = useCallback(() => {
    endSession();
    endCooking();
    navigate({ to: id ? "/recipe-detail" : "/recipes", search: id ? { id } : {} });
  }, [endSession, endCooking, id, navigate]);

  const syncConversationState = useCallback(
    (reason: string, options?: { announce?: boolean }) => {
      const currentRecipe = latestStateRef.current.recipe;
      if (!currentRecipe || status !== "connected") return;

      sendContextualUpdate(
        buildCookingContextUpdate({
          recipe: currentRecipe,
          stepIndex: latestStateRef.current.stepIndex,
          isPaused: latestStateRef.current.isPaused,
          timers: latestStateRef.current.timers,
          language,
          reason,
        }),
      );

      if (options?.announce) {
        sendUserMessage(buildCookingManualReplyPrompt(language));
      }
    },
    [language, sendContextualUpdate, sendUserMessage, status],
  );

  const updateLatestState = useCallback((nextState: Partial<LatestCookingState>) => {
    latestStateRef.current = {
      ...latestStateRef.current,
      ...nextState,
    };
  }, []);

  const startConversationSession = useCallback(async () => {
    if (!recipe || !cookingAgentId) {
      setAgentError(t("cook.agentRequired"));
      return;
    }
    if (startInFlightRef.current) return;

    const apiKey = await getApiKey("elevenlabs");
    if (!apiKey) {
      setAgentError(t("cook.agentRequired"));
      toast.error(t("cook.agentRequired"));
      return;
    }

    startInFlightRef.current = true;
    setAgentError(null);
    setSpokenReply("");
    setLastTranscript("");

    try {
      const service = new ElevenLabsService(apiKey);
      const signedUrl = await service.getConversationSignedUrl(cookingAgentId);
      const prompt = buildCookingAgentPrompt({ recipe, language });
      const firstMessage = buildCookingAgentFirstMessage({
        recipe,
        stepIndex: latestStateRef.current.stepIndex,
        language,
      });

      startSession({
        signedUrl,
        connectionType: "websocket",
        overrides: {
          agent: {
            prompt: { prompt },
            firstMessage,
            language,
          },
          ...(resolvedVoiceId ? { tts: { voiceId: resolvedVoiceId } } : {}),
        },
      });
    } catch (error) {
      startInFlightRef.current = false;
      const message =
        error instanceof Error ? error.message : "Failed to start the cooking agent session.";
      setAgentError(message);
      toast.error(message);
    }
  }, [cookingAgentId, language, recipe, resolvedVoiceId, startSession, t]);

  const handleTranscriptIntent = useCallback(
    async (transcript: string) => {
      const currentRecipe = latestStateRef.current.recipe;
      if (!currentRecipe) return;

      const intent = parseVoiceIntent(transcript);
      const { stepIndex, timers } = latestStateRef.current;

      switch (intent.type) {
        case "next_step": {
          const target = Math.min(stepIndex + 1, currentRecipe.steps.length - 1);
          if (target === stepIndex) return;
          nextStep();
          updateLatestState({ stepIndex: target });
          syncConversationState("The user asked for the next step and the app advanced.");
          return;
        }
        case "previous_step": {
          const target = Math.max(stepIndex - 1, 0);
          if (target === stepIndex) return;
          prevStep();
          updateLatestState({ stepIndex: target });
          syncConversationState("The user asked for the previous step and the app moved back.");
          return;
        }
        case "jump_step": {
          const target = Math.max(
            0,
            Math.min((intent.stepNumber ?? 1) - 1, currentRecipe.steps.length - 1),
          );
          if (target === stepIndex) return;
          jumpToStep(target);
          updateLatestState({ stepIndex: target });
          syncConversationState(`The user jumped to step ${target + 1}.`);
          return;
        }
        case "pause":
          pauseCooking();
          updateLatestState({ isPaused: true });
          syncConversationState("The user paused cooking guidance.");
          return;
        case "resume":
          resumeCooking();
          updateLatestState({ isPaused: false });
          syncConversationState("The user resumed cooking guidance.");
          return;
        case "set_timer": {
          const seconds = Math.max(1, intent.seconds ?? 60);
          const label =
            intent.label?.trim() ||
            (language === "zh" ? "烹饪计时器" : "Cooking timer");
          startTimer(label, seconds);
          syncConversationState(`The user started a timer named "${label}" for ${seconds} seconds.`);
          return;
        }
        case "cancel_timer": {
          const timer = timers[0];
          if (!timer) return;
          cancelTimer(timer.id);
          updateLatestState({ timers: timers.filter((item) => item.id !== timer.id) });
          syncConversationState(`The user cancelled the timer "${timer.label}".`);
          return;
        }
        case "extend_timer": {
          const timer = timers[0];
          const seconds = intent.seconds ?? 60;
          if (!timer) return;
          extendTimer(timer.id, seconds);
          updateLatestState({
            timers: timers.map((item) =>
              item.id === timer.id
                ? {
                    ...item,
                    totalSeconds: item.totalSeconds + seconds,
                    remainingSeconds: item.remainingSeconds + seconds,
                  }
                : item,
            ),
          });
          syncConversationState(
            `The user extended the timer "${timer.label}" by ${seconds} seconds.`,
          );
          return;
        }
        case "hide_badges":
          toggleVoiceBadges(false);
          return;
        case "show_badges":
          toggleVoiceBadges(true);
          return;
        case "stop_listening":
          setMuted(true);
          return;
        case "start_listening":
          setMuted(false);
          return;
        case "end_cooking":
          handleClose();
          return;
        default:
          return;
      }
    },
    [
      cancelTimer,
      extendTimer,
      handleClose,
      jumpToStep,
      language,
      nextStep,
      pauseCooking,
      prevStep,
      resumeCooking,
      setMuted,
      startTimer,
      syncConversationState,
      toggleVoiceBadges,
      updateLatestState,
    ],
  );

  const handleTranscriptIntentRef = useRef(handleTranscriptIntent);
  useEffect(() => {
    handleTranscriptIntentRef.current = handleTranscriptIntent;
  }, [handleTranscriptIntent]);

  const handleManualStepChange = useCallback(
    (targetStep: number, reason: string) => {
      if (!recipe) return;
      updateLatestState({ stepIndex: targetStep });
      syncConversationState(reason, { announce: true });
    },
    [recipe, syncConversationState, updateLatestState],
  );

  const handleToggleMic = useCallback(() => {
    if (!cookingAgentId) {
      toast.error(t("cook.agentRequired"), {
        action: {
          label: t("cook.openSettings"),
          onClick: () => void navigate({ to: "/settings" }),
        },
      });
      return;
    }

    if (status === "disconnected" || status === "error") {
      void startConversationSession();
      return;
    }

    if (status === "connected") {
      setMuted(!isMuted);
    }
  }, [cookingAgentId, isMuted, navigate, setMuted, startConversationSession, status, t]);

  useEffect(() => {
    if (!id) {
      setRecipe(null);
      return;
    }
    void db.recipes.get(id).then((result) => setRecipe(result ?? null));
  }, [id]);

  useEffect(() => {
    if (recipe && id) {
      startCooking(id, recipe.steps.length);
    }
  }, [id, recipe, startCooking]);

  useEffect(() => {
    updateLatestState({
      recipe: recipe ?? null,
      stepIndex: safeStep,
      timers: activeTimers,
      isPaused,
    });
  }, [activeTimers, isPaused, recipe, safeStep, updateLatestState]);

  useEffect(() => {
    if (!autoSessionKey) {
      sessionKeyRef.current = null;
      return;
    }

    if (sessionKeyRef.current === autoSessionKey) return;
    sessionKeyRef.current = autoSessionKey;
    void startConversationSession();
  }, [autoSessionKey, startConversationSession]);

  useEffect(() => {
    return () => {
      endSession();
      sessionKeyRef.current = null;
    };
  }, [endSession]);

  useEffect(() => {
    setOnCompleted((_, label) => {
      syncConversationState(`A timer named "${label}" has finished.`);
      if (status === "connected") {
        sendUserMessage(buildCookingTimerFinishedPrompt(label, language));
      }
    });
  }, [language, sendUserMessage, setOnCompleted, status, syncConversationState]);

  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;

    const acquireWakeLock = async () => {
      try {
        sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
        wakeLockRef.current = sentinel;
      } catch {
        // Ignore unsupported browsers or permission denials.
      }
    };

    void acquireWakeLock();

    return () => {
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  const agentStatusLabel = useMemo(
    () => getAgentStatusLabel(status as AgentStatus, mode, isMuted, t),
    [isMuted, mode, status, t],
  );

  const agentDotClass = useMemo(() => {
    if (status === "error") return "bg-destructive";
    if (status === "connecting") return "bg-amber-500 animate-pulse";
    if (status === "connected" && mode === "speaking") {
      return "bg-clay animate-pulse";
    }
    if (status === "connected" && isMuted) return "bg-destructive";
    if (status === "connected") return "bg-clay";
    return "bg-muted-foreground";
  }, [isMuted, mode, status]);

  if (recipe === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (recipe === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-muted-foreground">{t("recipeDetail.notFound")}</p>
        <Link
          to="/recipes"
          className="rounded-full border border-border px-5 py-2 text-sm hover:bg-foreground hover:text-background"
        >
          {t("recipeDetail.back")}
        </Link>
      </div>
    );
  }

  const description = step?.description ?? "";
  const splitIndex = Math.max(description.lastIndexOf("，"), description.lastIndexOf("。"));
  const descMain = splitIndex > 0 ? description.slice(0, splitIndex + 1) : description;
  const descHighlight = splitIndex > 0 ? description.slice(splitIndex + 1) : "";
  const micButtonLabel =
    status === "connected"
      ? isMuted
        ? t("cook.resumeMic")
        : t("cook.pauseMic")
      : t("cook.startAgent");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 bg-secondary">
              <Volume2 className="h-5 w-5 text-clay" strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {t("cook.nowNarrating")} · ElevenLabs Agent
              </div>
              <div className="font-display text-base">{recipe.title}</div>
            </div>
          </div>
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${agentDotClass}`} />
              {agentStatusLabel}
            </span>
            <button
              onClick={handleClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent bg-transparent text-foreground hover:border-border hover:text-clay focus-visible:border-border"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t("cook.stepOf", { current: stepNumber, total: stepCount })}
            </div>
            <div className="flex w-full gap-1 overflow-x-auto pb-1 sm:w-auto sm:overflow-visible sm:pb-0">
              {Array.from({ length: stepCount }).map((_, index) => (
                <span
                  key={index}
                  className={`h-1 rounded-full transition-all ${
                    index < safeStep
                      ? "bg-foreground w-6 sm:w-10"
                      : index === safeStep
                        ? "bg-clay w-6 sm:w-10"
                        : "bg-border w-6 sm:w-10"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-center">
            <h1 className="font-display text-[clamp(2.25rem,10vw,4.5rem)] font-medium leading-[1.1] tracking-tight md:text-7xl">
              {descMain}
              {descHighlight && <span className="text-clay">{descHighlight}</span>}
            </h1>
            {step?.tips && (
              <p className="mt-6 inline-flex w-full items-center gap-2 rounded-full bg-accent/40 px-4 py-2 text-sm sm:w-fit">
                <span className="font-medium">{t("cook.tip")} ·</span> {step.tips}
              </p>
            )}

            <div className="mt-10 flex items-center gap-4">
              <Waves className="h-8 w-8 animate-pulse text-clay" strokeWidth={1.25} />
              <div className="flex h-10 flex-1 items-center gap-1">
                {Array.from({ length: 80 }).map((_, index) => (
                  <span
                    key={index}
                    className="flex-1 rounded-full bg-clay/40"
                    style={{ height: `${20 + Math.abs(Math.sin(index * 0.4)) * 80}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {activeTimers.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {activeTimers.map((timer) => {
                const progress =
                  timer.totalSeconds > 0
                    ? (1 - timer.remainingSeconds / timer.totalSeconds) * 100
                    : 0;

                return (
                  <div
                    key={timer.id}
                    className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div
                      className="absolute left-0 top-0 h-full bg-clay/15 transition-all"
                      style={{ width: `${progress}%` }}
                      aria-hidden
                    />
                    <div className="relative flex items-center gap-3">
                      <Timer className="h-5 w-5 text-clay" strokeWidth={1.5} />
                      <div>
                        <div className="text-xs text-muted-foreground">{timer.label}</div>
                        <div className="font-display text-3xl tabular-nums">
                          {formatTimer(timer.remainingSeconds)}
                        </div>
                      </div>
                    </div>
                    <div className="relative flex flex-col items-start gap-1 sm:items-end">
                      <VoiceHint>
                        {t("cook.addTime")} · {t("cook.cancel")}
                      </VoiceHint>
                      <button
                        onClick={() => {
                          cancelTimer(timer.id);
                          updateLatestState({
                            timers: latestStateRef.current.timers.filter((item) => item.id !== timer.id),
                          });
                          syncConversationState(`The cook cancelled the timer "${timer.label}".`);
                        }}
                        className="mt-1 rounded-full border border-border px-3 py-1 text-xs hover:bg-foreground hover:text-background"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-clay" strokeWidth={1.75} />
              <div className="text-sm">
                <div className="text-xs text-muted-foreground">{t("cook.voiceQa")}</div>
                <p className="mt-0.5 text-muted-foreground">
                  {spokenReply || lastTranscript || t("cook.voiceQaBody")}
                </p>
                {agentError && <p className="mt-1 text-xs text-destructive">{agentError}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border/60 bg-card/50">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-3 px-4 py-4 sm:px-6 sm:py-6">
            <button
              onClick={() => {
                const target = Math.max(safeStep - 1, 0);
                if (target === safeStep) return;
                prevStep();
                handleManualStepChange(target, "The cook tapped the previous-step button.");
              }}
              disabled={safeStep === 0}
              className="relative inline-flex h-14 w-14 items-center justify-center rounded-full border border-transparent bg-transparent text-foreground hover:border-border hover:text-clay focus-visible:border-border disabled:cursor-not-allowed disabled:opacity-40"
            >
              <VoiceBadge n={1} className="absolute -right-1 -top-1" />
              <SkipBack className="h-5 w-5" strokeWidth={1.5} />
            </button>
            <button
              onClick={() => {
                if (isPaused) {
                  resumeCooking();
                  updateLatestState({ isPaused: false });
                  syncConversationState("The cook resumed with the on-screen control.", {
                    announce: true,
                  });
                } else {
                  pauseCooking();
                  updateLatestState({ isPaused: true });
                  syncConversationState("The cook paused with the on-screen control.", {
                    announce: true,
                  });
                }
              }}
              className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background hover:bg-clay"
            >
              {isPaused ? (
                <Play className="h-6 w-6" strokeWidth={1.5} />
              ) : (
                <Pause className="h-6 w-6" strokeWidth={1.5} />
              )}
            </button>
            <button
              onClick={() => {
                const target = Math.min(safeStep + 1, Math.max(stepCount - 1, 0));
                if (target === safeStep) return;
                nextStep();
                handleManualStepChange(target, "The cook tapped the next-step button.");
              }}
              disabled={safeStep === stepCount - 1}
              className="relative inline-flex h-14 w-14 items-center justify-center rounded-full border border-transparent bg-transparent text-foreground hover:border-border hover:text-clay focus-visible:border-border disabled:cursor-not-allowed disabled:opacity-40"
            >
              <VoiceBadge n={2} className="absolute -right-1 -top-1" />
              <SkipForward className="h-5 w-5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={handleToggleMic}
              disabled={status === "connecting"}
              className="order-4 flex w-full items-center gap-2 rounded-full border border-border bg-background px-4 py-3 text-left hover:border-clay disabled:cursor-wait disabled:opacity-70 md:ml-4 md:flex-1"
            >
              <Mic
                className={`h-4 w-4 ${isMuted ? "text-destructive" : "text-clay"}`}
                strokeWidth={1.75}
              />
              <span className="text-sm text-muted-foreground">
                {agentStatusLabel} · {micButtonLabel}
              </span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function getAgentStatusLabel(
  status: AgentStatus,
  mode: "speaking" | "listening",
  isMuted: boolean,
  t: (key: string) => string,
): string {
  if (status === "connecting") return t("cook.agentConnecting");
  if (status === "error") return t("cook.agentDisconnected");
  if (status === "connected" && isMuted) return t("cook.listeningOff");
  if (status === "connected" && mode === "speaking") return t("cook.agentSpeaking");
  if (status === "connected") return t("cook.alwaysListening");
  return t("cook.agentDisconnected");
}
