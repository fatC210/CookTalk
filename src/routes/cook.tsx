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
  answerCookingQuestion,
  buildStepSpeech,
  formatDurationForSpeech,
  parseVoiceIntent,
  speakWithElevenLabs,
  type VoiceStatus,
} from "@/lib/voice-pipeline";
import { db, type Recipe } from "@/lib/db";
import { stopActiveVoicePlayback } from "@/lib/voice-playback";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { useTimers, type TimerInfo } from "@/hooks/use-timers";
import { useAppStore } from "@/stores/app-store";
import { useCookingStore } from "@/stores/cooking-store";

export const Route = createFileRoute("/cook")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || "",
    step: Number.isFinite(Number(search.step)) ? Number(search.step) : 0,
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
  const [spokenReply, setSpokenReply] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

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
  const latestStateRef = useRef<LatestCookingState>({
    recipe: null,
    stepIndex: 0,
    timers: [],
    isPaused: false,
  });
  const setMutedRef = useRef<((muted: boolean) => void) | null>(null);

  const recipeStepCount = recipe?.steps.length ?? 0;
  const safeStep =
    recipeStepCount > 0 ? Math.max(0, Math.min(currentStep, recipeStepCount - 1)) : 0;
  const step = recipe?.steps[safeStep];
  const stepNumber = safeStep + 1;
  const stepCount = recipeStepCount;
  const resolvedVoiceId = recipe?.voiceId ?? cookingVoiceId ?? undefined;

  const handleClose = useCallback(() => {
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
    async (text: string) => {
      if (!text.trim()) return;
      setSpokenReply(text);

      if (!hasElevenLabsKey) return;

      setIsSpeaking(true);
      setVoiceError(null);
      try {
        await speakWithElevenLabs(text, resolvedVoiceId);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("cook.speechFailed");
        setVoiceError(message);
        toast.error(message);
      } finally {
        setIsSpeaking(false);
      }
    },
    [hasElevenLabsKey, resolvedVoiceId, t],
  );

  const announceCurrentStep = useCallback(
    async (targetRecipe: Recipe, targetStep: number) => {
      await speak(buildStepSpeech(targetRecipe, targetStep, language));
    },
    [language, speak],
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
          await announceCurrentStep(currentRecipe, target);
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
          await announceCurrentStep(currentRecipe, target);
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
          await announceCurrentStep(currentRecipe, target);
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
          await speak(language === "zh" ? `已取消${timer.label}。` : `${timer.label} cancelled.`);
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
          });
          await speak(answer);
          return;
        }
        default:
          return;
      }
    },
    [
      cancelTimer,
      announceCurrentStep,
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
    wakeWords,
    language,
    listenMode,
    manualWakeActive,
    awakeResetKey: recipe?.id,
    onWake: () => clearManualWake(),
    onTranscript: async (transcript) => {
      const cleaned = transcript.trim();
      if (!cleaned) return;
      setLastTranscript(cleaned);
      setVoiceError(null);
      await handleTranscriptIntentRef.current(cleaned);
    },
    onError: (message) => {
      setVoiceError(message);
      toast.error(message);
    },
  });

  const { captureCommand, error, isMuted, isSupported, setMuted, status } = voiceSession;
  setMutedRef.current = setMuted;
  const effectiveStatus: VoiceStatus = isSpeaking ? "speaking" : status;

  const handleManualStepChange = useCallback(
    (targetStep: number) => {
      if (!recipe) return;
      updateLatestState({ stepIndex: targetStep });
      void announceCurrentStep(recipe, targetStep);
    },
    [announceCurrentStep, recipe, updateLatestState],
  );

  const handleToggleMic = useCallback(() => {
    if (!hasElevenLabsKey) {
      toast.error(t("cook.voiceRequired"), {
        action: {
          label: t("cook.openSettings"),
          onClick: () => void navigate({ to: "/settings" }),
        },
      });
      return;
    }

    if (!isSupported) {
      toast.error(t("cook.voiceUnsupported"));
      return;
    }

    if (isMuted) {
      setMuted(false);
      void captureCommand({ force: true });
      return;
    }

    void captureCommand();
  }, [captureCommand, hasElevenLabsKey, isMuted, isSupported, navigate, setMuted, t]);

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
      if (initialStep > 0) {
        jumpToStep(initialStep);
      }
    }
  }, [id, initialStep, jumpToStep, recipe, startCooking]);

  useEffect(() => {
    if (!recipe) return;
    setSpokenReply(buildStepSpeech(recipe, safeStep, language));
  }, [language, recipe, safeStep]);

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
  const splitIndex = Math.max(description.lastIndexOf("，"), description.lastIndexOf("。"));
  const descMain = splitIndex > 0 ? description.slice(0, splitIndex + 1) : description;
  const descHighlight = splitIndex > 0 ? description.slice(splitIndex + 1) : "";
  const micButtonLabel = isMuted
    ? t("cook.resumeMic")
    : effectiveStatus === "recording"
      ? t("cook.recording")
      : t("cook.askNow");

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
                {t("cook.nowNarrating")} · {t("cook.localVoiceMode")}
              </div>
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
                            timers: latestStateRef.current.timers.filter(
                              (item) => item.id !== timer.id,
                            ),
                          });
                          void speak(
                            language === "zh"
                              ? `已取消${timer.label}。`
                              : `${timer.label} cancelled.`,
                          );
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
                {(voiceError || error) && (
                  <p className="mt-1 text-xs text-destructive">{voiceError || error}</p>
                )}
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
                handleManualStepChange(target);
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
                  if (recipe) void announceCurrentStep(recipe, safeStep);
                } else {
                  pauseCooking();
                  updateLatestState({ isPaused: true });
                  void speak(language === "zh" ? "已暂停。" : "Paused.");
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
                handleManualStepChange(target);
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
              disabled={effectiveStatus === "transcribing" || effectiveStatus === "thinking"}
              className="order-4 flex w-full items-center gap-2 rounded-full border border-border bg-background px-4 py-3 text-left hover:border-clay disabled:cursor-wait disabled:opacity-70 md:ml-4 md:flex-1"
            >
              <Mic
                className={`h-4 w-4 ${isMuted ? "text-destructive" : "text-clay"}`}
                strokeWidth={1.75}
              />
              <span className="text-sm text-muted-foreground">
                {voiceStatusLabel} · {micButtonLabel}
              </span>
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
