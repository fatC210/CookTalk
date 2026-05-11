import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MessageCircle, Timer, Volume2, X } from "lucide-react";
import { VoiceHint } from "@/components/voice-badge";
import {
  answerCookingQuestion,
  buildStepSpeech,
  formatDurationForSpeech,
  parseVoiceIntent,
  speakWithElevenLabs,
  type VoiceStatus,
} from "@/lib/voice-pipeline";
import { db, type Recipe } from "@/lib/db";
import i18n from "@/lib/i18n";
import { stopActiveVoicePlayback } from "@/lib/voice-playback";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { useTimers, type TimerInfo } from "@/hooks/use-timers";
import { getActiveWakeWords, useAppStore } from "@/stores/app-store";
import { useCookingStore } from "@/stores/cooking-store";

export const Route = createFileRoute("/cook")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || "",
    step: Number.isFinite(Number(search.step)) ? Number(search.step) : 0,
  }),
  head: () => ({
    meta: [
      { title: i18n.t("cook.metaTitle") },
      { name: "description", content: i18n.t("cook.metaDescription") },
    ],
  }),
  component: CookPage,
});

type AppLanguage = "en" | "zh";

type LatestCookingState = {
  recipe: Recipe | null;
  stepIndex: number;
  timers: TimerInfo[];
  isPaused: boolean;
};

type QaMessage = {
  id: number;
  speaker: "assistant" | "user";
  text: string;
};

function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function getStepDescriptionParts(description: string): { main: string; highlight: string } {
  const punctuationIndex = Math.max(
    description.lastIndexOf("。"),
    description.lastIndexOf(". "),
    description.lastIndexOf("！"),
    description.lastIndexOf("! "),
    description.lastIndexOf("？"),
    description.lastIndexOf("? "),
  );

  if (punctuationIndex <= 0) {
    return { main: description, highlight: "" };
  }

  return {
    main: description.slice(0, punctuationIndex + 1),
    highlight: description.slice(punctuationIndex + 1).trim(),
  };
}

function CookPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id, step: initialStep } = Route.useSearch();
  const language = useAppStore((s) => s.language) as AppLanguage;
  const toggleVoiceBadges = useAppStore((s) => s.toggleVoiceBadges);
  const cookingVoiceId = useAppStore((s) => s.cookingVoiceId);
  const wakeWords = useAppStore((s) => s.wakeWords);
  const listenMode = useAppStore((s) => s.listenMode);
  const manualWakeActive = useAppStore((s) => s.manualWakeActive);
  const clearManualWake = useAppStore((s) => s.clearManualWake);
  const hasElevenLabsKey = useAppStore((s) => s.hasElevenLabsKey);

  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);

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
  const qaMessageIdRef = useRef(0);
  const latestStateRef = useRef<LatestCookingState>({
    recipe: null,
    stepIndex: 0,
    timers: [],
    isPaused: false,
  });
  const setMutedRef = useRef<((muted: boolean) => void) | null>(null);
  const announcedStepKeyRef = useRef<string | null>(null);
  const pendingInitialAnnounceStepRef = useRef<number | null>(null);
  const isClosingRef = useRef(false);

  const recipeStepCount = recipe?.steps.length ?? 0;
  const safeStep =
    recipeStepCount > 0 ? Math.max(0, Math.min(currentStep, recipeStepCount - 1)) : 0;
  const step = recipe?.steps[safeStep];
  const stepNumber = safeStep + 1;
  const stepCount = recipeStepCount;
  const resolvedVoiceId = recipe?.voiceId ?? cookingVoiceId ?? undefined;
  const activeWakeWords = useMemo(() => getActiveWakeWords(wakeWords), [wakeWords]);

  const appendQaMessage = useCallback((speaker: QaMessage["speaker"], text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    qaMessageIdRef.current += 1;
    setQaMessages((current) => [
      ...current,
      {
        id: qaMessageIdRef.current,
        speaker,
        text: trimmed,
      },
    ]);
  }, []);

  const resetQaMessagesForStep = useCallback((prompt: string) => {
    qaMessageIdRef.current = 1;
    setQaMessages([
      {
        id: 1,
        speaker: "assistant",
        text: prompt,
      },
    ]);
  }, []);

  useEffect(() => {
    document.title = t("cook.metaTitle");
  }, [t, language]);

  const handleClose = useCallback(() => {
    isClosingRef.current = true;
    stopActiveVoicePlayback();
    endCooking();
    navigate({ to: id ? "/recipe-detail" : "/recipes", search: id ? { id } : {} });
  }, [endCooking, id, navigate]);

  const updateLatestState = useCallback((nextState: Partial<LatestCookingState>) => {
    latestStateRef.current = {
      ...latestStateRef.current,
      ...nextState,
    };
  }, []);

  const speak = useCallback(
    async (text: string, options?: { skipCard?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (!options?.skipCard) {
        appendQaMessage("assistant", trimmed);
      }

      if (!hasElevenLabsKey) return;

      setIsSpeaking(true);
      setVoiceError(null);
      try {
        await speakWithElevenLabs(trimmed, resolvedVoiceId, language);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("cook.speechFailed");
        setVoiceError(message);
        toast.error(message);
      } finally {
        setIsSpeaking(false);
      }
    },
    [appendQaMessage, hasElevenLabsKey, language, resolvedVoiceId, t],
  );

  const announceCurrentStep = useCallback(
    async (targetRecipe: Recipe, targetStep: number) => {
      const stepSpeech = buildStepSpeech(targetRecipe, targetStep, language);
      resetQaMessagesForStep(t("cook.voiceQaPrompt"));
      announcedStepKeyRef.current = `${targetRecipe.id}:${targetStep}:${language}`;
      await speak(stepSpeech, { skipCard: true });
    },
    [language, resetQaMessagesForStep, speak, t],
  );

  const handleTranscriptIntent = useCallback(
    async (transcript: string) => {
      const currentRecipe = latestStateRef.current.recipe;
      if (!currentRecipe) return;

      const intent = parseVoiceIntent(transcript);
      const { stepIndex, timers } = latestStateRef.current;

      switch (intent.type) {
        case "next_step": {
          const target = Math.min(stepIndex + 1, currentRecipe.steps.length - 1);
          if (target === stepIndex) {
            await speak(language === "zh" ? "已经是最后一步了。" : "This is the last step.");
            return;
          }
          nextStep();
          updateLatestState({ stepIndex: target });
          return;
        }
        case "previous_step": {
          const target = Math.max(stepIndex - 1, 0);
          if (target === stepIndex) {
            await speak(language === "zh" ? "已经是第一步了。" : "This is the first step.");
            return;
          }
          prevStep();
          updateLatestState({ stepIndex: target });
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
          return;
        }
        case "pause":
          pauseCooking();
          updateLatestState({ isPaused: true });
          await speak(language === "zh" ? "已暂停。" : "Paused.");
          return;
        case "resume":
          resumeCooking();
          updateLatestState({ isPaused: false });
          await announceCurrentStep(currentRecipe, stepIndex);
          return;
        case "repeat_step":
          await announceCurrentStep(currentRecipe, stepIndex);
          return;
        case "read_tip": {
          const tip = currentRecipe.steps[stepIndex]?.tips?.trim();
          await speak(
            tip ||
              (language === "zh"
                ? "这一步没有额外小贴士。"
                : "There is no extra tip for this step."),
          );
          return;
        }
        case "set_timer": {
          const seconds = Math.max(1, intent.seconds ?? 60);
          const label =
            intent.label?.trim() || (language === "zh" ? "烹饪计时器" : "Cooking timer");
          startTimer(label, seconds);
          await speak(
            language === "zh"
              ? `${label}已开始，${formatDurationForSpeech(seconds, language)}。`
              : `${label} started for ${formatDurationForSpeech(seconds, language)}.`,
          );
          return;
        }
        case "cancel_timer": {
          const timer = timers[0];
          if (!timer) {
            await speak(
              language === "zh" ? "当前没有运行中的计时器。" : "There are no active timers.",
            );
            return;
          }
          cancelTimer(timer.id);
          updateLatestState({ timers: timers.filter((item) => item.id !== timer.id) });
          await speak(language === "zh" ? `${timer.label}已取消。` : `${timer.label} cancelled.`);
          return;
        }
        case "extend_timer": {
          const timer = timers[0];
          const seconds = intent.seconds ?? 60;
          if (!timer) {
            await speak(
              language === "zh" ? "当前没有运行中的计时器。" : "There are no active timers.",
            );
            return;
          }
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
          await speak(
            language === "zh"
              ? `${timer.label}已延长${formatDurationForSpeech(seconds, language)}。`
              : `${timer.label} extended by ${formatDurationForSpeech(seconds, language)}.`,
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
          setMutedRef.current?.(true);
          return;
        case "start_listening":
          setMutedRef.current?.(false);
          return;
        case "end_cooking":
          handleClose();
          return;
        case "qa": {
          const answer = await answerCookingQuestion({
            recipe: currentRecipe,
            currentStep: stepIndex,
            question: transcript,
            language,
            timers,
          });
          await speak(answer);
          return;
        }
        default:
          return;
      }
    },
    [
      announceCurrentStep,
      cancelTimer,
      extendTimer,
      handleClose,
      jumpToStep,
      language,
      nextStep,
      pauseCooking,
      prevStep,
      resumeCooking,
      speak,
      startTimer,
      toggleVoiceBadges,
      updateLatestState,
    ],
  );

  const handleTranscriptIntentRef = useRef(handleTranscriptIntent);
  useEffect(() => {
    handleTranscriptIntentRef.current = handleTranscriptIntent;
  }, [handleTranscriptIntent]);

  const voiceSession = useVoiceSession({
    enabled: recipe !== null && recipe !== undefined,
    wakeWords: activeWakeWords,
    language,
    listenMode,
    manualWakeActive,
    awakeResetKey: recipe?.id,
    onWake: () => clearManualWake(),
    onTranscript: async (transcript) => {
      const cleaned = transcript.trim();
      if (!cleaned) return;
      appendQaMessage("user", cleaned);
      setVoiceError(null);
      await handleTranscriptIntentRef.current(cleaned);
    },
    onError: (message) => {
      setVoiceError(message);
      toast.error(message);
    },
  });

  const { error, isMuted, setMuted, status } = voiceSession;
  setMutedRef.current = setMuted;
  const effectiveStatus: VoiceStatus = isSpeaking ? "speaking" : status;

  useEffect(() => {
    if (!id) {
      setRecipe(null);
      return;
    }
    void db.recipes.get(id).then((result) => setRecipe(result ?? null));
  }, [id]);

  useEffect(() => {
    if (!recipe || !id) return;
    const targetStep =
      recipe.steps.length > 0 ? Math.max(0, Math.min(initialStep, recipe.steps.length - 1)) : 0;
    pendingInitialAnnounceStepRef.current = targetStep;
    startCooking(id, recipe.steps.length, targetStep);
  }, [id, initialStep, recipe, startCooking]);

  useEffect(() => {
    if (!recipe) return;
    if (isClosingRef.current) return;

    const targetStep = pendingInitialAnnounceStepRef.current ?? safeStep;
    const stepKey = `${recipe.id}:${targetStep}:${language}`;
    if (announcedStepKeyRef.current === stepKey) return;
    pendingInitialAnnounceStepRef.current = null;
    void announceCurrentStep(recipe, targetStep);
  }, [announceCurrentStep, language, recipe, safeStep]);

  useEffect(() => {
    updateLatestState({
      recipe: recipe ?? null,
      stepIndex: safeStep,
      timers: activeTimers,
      isPaused,
    });
  }, [activeTimers, isPaused, recipe, safeStep, updateLatestState]);

  useEffect(() => {
    return () => {
      isClosingRef.current = true;
      stopActiveVoicePlayback();
    };
  }, []);

  useEffect(() => {
    setOnCompleted((_, label) => {
      const currentRecipe = latestStateRef.current.recipe;
      const currentStep = latestStateRef.current.stepIndex;
      const stepText = currentRecipe?.steps[currentStep]?.description;
      const message =
        language === "zh"
          ? `${label}时间到了。${stepText ? `当前步骤是：${stepText}` : ""}`
          : `${label} is done. ${stepText ? `Current step: ${stepText}` : ""}`;
      void speak(message);
    });
  }, [language, setOnCompleted, speak]);

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

  const voiceStatusLabel = useMemo(
    () => getVoiceStatusLabel(effectiveStatus, isMuted, t),
    [effectiveStatus, isMuted, t],
  );
  const voiceModeLabel = useMemo(
    () => getVoiceModeLabel(effectiveStatus, isMuted, t),
    [effectiveStatus, isMuted, t],
  );

  const voiceDotClass = useMemo(() => {
    if (effectiveStatus === "error" || effectiveStatus === "unsupported") return "bg-destructive";
    if (["recording", "transcribing", "thinking", "speaking"].includes(effectiveStatus)) {
      return "bg-clay animate-pulse";
    }
    if (isMuted) return "bg-destructive";
    if (effectiveStatus === "listening" || effectiveStatus === "awake") return "bg-clay";
    return "bg-muted-foreground";
  }, [effectiveStatus, isMuted]);

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
  const { main: descMain, highlight: descHighlight } = getStepDescriptionParts(description);

  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-x-hidden overflow-y-hidden bg-background">
      <header className="shrink-0 border-b border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 bg-secondary">
              <Volume2 className="h-5 w-5 text-clay" strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{voiceModeLabel}</div>
              <div className="font-display text-base">{recipe.title}</div>
            </div>
          </div>
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${voiceDotClass}`} />
              {voiceStatusLabel}
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

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto lg:overflow-y-hidden">
        <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-7xl flex-1 flex-col px-4 py-4 sm:px-6 sm:py-6">
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t("cook.stepOf", { current: stepNumber, total: stepCount })}
            </div>
            <div className="grid w-full min-w-0 grid-flow-col auto-cols-fr gap-1 sm:w-[18rem] md:w-[24rem]">
              {Array.from({ length: stepCount }).map((_, index) => (
                <span
                  key={index}
                  className={`h-1 rounded-full transition-all ${
                    index < safeStep
                      ? "w-full min-w-0 bg-foreground"
                      : index === safeStep
                        ? "w-full min-w-0 bg-clay"
                        : "w-full min-w-0 bg-border"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 py-3 sm:gap-5 sm:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
            <section className="flex min-h-[24rem] min-w-0 flex-col lg:min-h-0">
              <div className="flex min-h-0 flex-1 flex-col justify-center rounded-[2rem] border border-border bg-card p-5 sm:p-7 lg:p-8">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${voiceDotClass}`} />
                    {voiceStatusLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">{t("cook.stepSpokenOnce")}</span>
                </div>
                <h1 className="mt-5 max-w-full font-display text-[clamp(1.75rem,6.2vw,2.7rem)] font-medium leading-[1.12] tracking-tight md:text-[clamp(2.4rem,4vw,3.8rem)]">
                  {descMain}
                  {descHighlight && <span className="text-clay"> {descHighlight}</span>}
                </h1>
                {step?.tips && (
                  <p className="mt-5 inline-flex w-full items-center gap-2 rounded-full bg-accent/40 px-4 py-2 text-xs sm:w-fit sm:text-sm">
                    <span className="font-medium">{t("cook.tip")}</span> {step.tips}
                  </p>
                )}
              </div>
            </section>

            <aside className="flex min-h-0 min-w-0 flex-col gap-4">
              {activeTimers.length > 0 && (
                <div className="grid shrink-0 gap-3">
                  {activeTimers.map((timer) => {
                    const progress =
                      timer.totalSeconds > 0
                        ? (1 - timer.remainingSeconds / timer.totalSeconds) * 100
                        : 0;

                    return (
                      <div
                        key={timer.id}
                        className="relative flex min-h-[7rem] flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5"
                      >
                        <div
                          className="absolute left-0 top-0 h-full bg-clay/15 transition-all"
                          style={{ width: `${progress}%` }}
                          aria-hidden
                        />
                        <div className="relative flex items-center gap-3">
                          <Timer className="h-5 w-5 text-clay" strokeWidth={1.5} />
                          <div className="min-w-0">
                            <div className="truncate text-xs text-muted-foreground">
                              {timer.label}
                            </div>
                            <div className="font-display text-3xl tabular-nums">
                              {formatTimer(timer.remainingSeconds)}
                            </div>
                          </div>
                        </div>
                        <div className="relative flex items-center justify-between gap-3">
                          <VoiceHint>
                            {t("cook.addTime")} / {t("cook.cancel")}
                          </VoiceHint>
                          <button
                            onClick={() => {
                              cancelTimer(timer.id);
                              updateLatestState({
                                timers: latestStateRef.current.timers.filter(
                                  (item) => item.id !== timer.id,
                                ),
                              });
                              void speak(
                                language === "zh"
                                  ? `${timer.label}已取消。`
                                  : `${timer.label} cancelled.`,
                              );
                            }}
                            className="shrink-0 rounded-full border border-border px-3 py-1 text-xs hover:bg-foreground hover:text-background"
                          >
                            {t("cook.cancel").replaceAll('"', "")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex min-h-[20rem] min-w-0 flex-1 flex-col rounded-[2rem] border border-border bg-card p-4 sm:p-5 lg:min-h-0">
                <div className="flex shrink-0 items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-clay" strokeWidth={1.75} />
                  <div className="text-sm font-medium">{t("cook.voiceQa")}</div>
                </div>
                <div className="mt-4 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
                  {qaMessages.map((message) => {
                    const isAssistant = message.speaker === "assistant";
                    return (
                      <div
                        key={message.id}
                        className="min-w-0 overflow-hidden rounded-[1.5rem] border-2 border-foreground/85 bg-background px-4 py-3"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 h-7 w-7 shrink-0 rounded-full border-2 border-foreground/85 bg-background" />
                          <div className="min-w-0 flex-1">
                            <div className="text-base font-semibold leading-none">
                              {isAssistant ? "cooktalk" : t("cook.youLabel")}
                            </div>
                            <p className="mt-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-foreground/90">
                              {message.text}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(voiceError || error) && (
                    <p className="px-1 text-xs text-destructive">{voiceError || error}</p>
                  )}
                  {!voiceError && !error && qaMessages.length === 0 && (
                    <p className="px-1 text-sm text-muted-foreground">{t("cook.voiceQaBody")}</p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div className="shrink-0 border-t border-border/60 bg-card/50">
          <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-4 sm:px-6 sm:py-6">
            <button
              onClick={() => {
                const target = Math.min(safeStep + 1, Math.max(stepCount - 1, 0));
                if (target === safeStep) return;
                nextStep();
                updateLatestState({ stepIndex: target });
              }}
              disabled={safeStep === stepCount - 1}
              className="inline-flex min-w-[12rem] items-center justify-center rounded-full bg-foreground px-8 py-3 text-base font-medium text-background transition-colors hover:bg-clay disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              {t("cook.nextStepButton")}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function getVoiceStatusLabel(
  status: VoiceStatus,
  isMuted: boolean,
  t: (key: string) => string,
): string {
  if (isMuted) return t("cook.listeningOff");
  if (status === "unsupported") return t("cook.voiceUnsupportedShort");
  if (status === "error") return t("cook.voiceError");
  if (status === "recording") return t("cook.recording");
  if (status === "transcribing") return t("cook.transcribing");
  if (status === "thinking") return t("cook.thinking");
  if (status === "speaking") return t("cook.speaking");
  if (status === "awake") return t("cook.awake");
  if (status === "listening") return t("cook.alwaysListening");
  return t("cook.voiceReady");
}

function getVoiceModeLabel(
  status: VoiceStatus,
  isMuted: boolean,
  t: (key: string) => string,
): string {
  if (status === "speaking") {
    return `${t("cook.nowNarrating")} · ${t("cook.localVoiceMode")}`;
  }
  if (isMuted) {
    return t("cook.localVoiceMode");
  }
  if (status === "listening" || status === "awake") {
    return `${t("cook.alwaysListening")} · ${t("cook.localVoiceMode")}`;
  }
  return t("cook.localVoiceMode");
}
