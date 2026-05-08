import { useCallback, useEffect, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  Mic,
  Pause,
  Play,
  SkipForward,
  SkipBack,
  Volume2,
  Timer,
  X,
  MessageCircle,
  Waves,
} from "lucide-react";
import { db, type Recipe } from "@/lib/db";
import { useCookingStore } from "@/stores/cooking-store";
import { useTimers } from "@/hooks/use-timers";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ManualWakeButton } from "@/components/manual-wake-button";
import { useAppStore } from "@/stores/app-store";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { toast } from "sonner";
import {
  answerCookingQuestion,
  buildStepSpeech,
  formatDurationForSpeech,
  parseVoiceIntent,
  speakWithElevenLabs,
  type VoiceStatus,
} from "@/lib/voice-pipeline";

export const Route = createFileRoute("/cook")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || "",
  }),
  head: () => ({
    meta: [
      { title: "Cooking — CookTalk" },
      { name: "description", content: "Full-screen, hands-free cooking mode." },
    ],
  }),
  component: CookPage,
});

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function CookPage() {
  const { t } = useTranslation();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const manualWakeActive = useAppStore((s) => s.manualWakeActive);
  const clearManualWake = useAppStore((s) => s.clearManualWake);
  const wakeWords = useAppStore((s) => s.wakeWords);
  const language = useAppStore((s) => s.language);
  const listenModeSetting = useAppStore((s) => s.listenMode);
  const toggleVoiceBadges = useAppStore((s) => s.toggleVoiceBadges);

  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [spokenReply, setSpokenReply] = useState("");

  const {
    isActive,
    currentStep,
    totalSteps,
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
  const hasAnnouncedRecipeRef = useRef(false);
  const latestStateRef = useRef({ currentStep: 0, activeTimers });
  const voiceMutedSetterRef = useRef<(muted: boolean) => void>(() => {});
  const cookingVoiceId = useAppStore((s) => s.cookingVoiceId);

  const recipeStepCount = recipe?.steps.length ?? 0;
  const safeStep =
    recipeStepCount > 0 ? Math.max(0, Math.min(currentStep, recipeStepCount - 1)) : 0;
  const step = recipe?.steps[safeStep];
  const stepNumber = safeStep + 1;
  const stepCount = recipeStepCount;

  const handleClose = useCallback(() => {
    endCooking();
    navigate({ to: id ? "/recipe-detail" : "/recipes", search: id ? { id } : {} });
  }, [endCooking, id, navigate]);

  const speak = useCallback(
    async (message: string) => {
      setSpokenReply(message);
      try {
        await speakWithElevenLabs(message, cookingVoiceId ?? recipe?.voiceId ?? null);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Voice playback failed";
        toast.error(errorMessage);
      }
    },
    [cookingVoiceId, recipe?.voiceId],
  );

  const handleVoiceCommand = useCallback(
    async (transcript: string) => {
      if (!recipe) return;
      const intent = parseVoiceIntent(transcript);
      const state = latestStateRef.current;
      const stepIndex = state.currentStep;
      const timers = state.activeTimers;

      switch (intent.type) {
        case "next_step": {
          const target = Math.min(stepIndex + 1, recipe.steps.length - 1);
          if (target === stepIndex) {
            await speak("Already at the last step. You can ask me anything about this step.");
            return;
          }
          nextStep();
          await speak(buildStepSpeech(recipe, target));
          return;
        }
        case "previous_step": {
          const target = Math.max(stepIndex - 1, 0);
          if (target === stepIndex) {
            await speak("Already at the first step.");
            return;
          }
          prevStep();
          await speak(buildStepSpeech(recipe, target));
          return;
        }
        case "jump_step": {
          const target = Math.max(
            0,
            Math.min((intent.stepNumber ?? 1) - 1, recipe.steps.length - 1),
          );
          jumpToStep(target);
          await speak(buildStepSpeech(recipe, target));
          return;
        }
        case "pause":
          pauseCooking();
          await speak("Cooking narration is paused. Say continue to resume.");
          return;
        case "resume":
          resumeCooking();
          await speak(buildStepSpeech(recipe, stepIndex));
          return;
        case "repeat_step":
          await speak(buildStepSpeech(recipe, stepIndex));
          return;
        case "read_tip":
          await speak(recipe.steps[stepIndex]?.tips ?? "No extra tip for this step.");
          return;
        case "set_timer": {
          const seconds = Math.max(1, intent.seconds ?? 60);
          const label = intent.label ?? "Cooking timer";
          startTimer(label, seconds);
          await speak(`Timer set: ${label}, ${formatDurationForSpeech(seconds)}.`);
          return;
        }
        case "cancel_timer": {
          const timer = timers[0];
          if (!timer) {
            await speak("There is no active timer.");
            return;
          }
          cancelTimer(timer.id);
          await speak(`Cancelled ${timer.label}.`);
          return;
        }
        case "extend_timer": {
          const timer = timers[0];
          const seconds = intent.seconds ?? 60;
          if (!timer) {
            await speak("There is no timer to extend.");
            return;
          }
          extendTimer(timer.id, seconds);
          await speak(`Extended ${timer.label} by ${formatDurationForSpeech(seconds)}.`);
          return;
        }
        case "hide_badges":
          toggleVoiceBadges(false);
          await speak("Voice badges hidden.");
          return;
        case "show_badges":
          toggleVoiceBadges(true);
          await speak("Voice badges shown.");
          return;
        case "stop_listening":
          voiceMutedSetterRef.current(true);
          await speak("Listening stopped. Tap the microphone button to start again.");
          return;
        case "start_listening":
          voiceMutedSetterRef.current(false);
          await speak("Listening started.");
          return;
        case "end_cooking":
          await speak("Cooking mode ended.");
          handleClose();
          return;
        case "qa":
        default: {
          const answer = await answerCookingQuestion({
            recipe,
            currentStep: stepIndex,
            question: transcript,
          });
          await speak(answer);
        }
      }
    },
    [
      cancelTimer,
      extendTimer,
      jumpToStep,
      nextStep,
      pauseCooking,
      prevStep,
      recipe,
      resumeCooking,
      speak,
      handleClose,
      startTimer,
      toggleVoiceBadges,
    ],
  );

  const activeListenMode = listenModeSetting === "always" || isActive ? "always" : "wake-word";

  const voiceSession = useVoiceSession({
    enabled: !!recipe,
    wakeWords,
    language,
    listenMode: activeListenMode,
    manualWakeActive,
    onWake: () => clearManualWake(),
    onTranscript: handleVoiceCommand,
    onError: (message) => toast.error(message),
  });

  useEffect(() => {
    voiceMutedSetterRef.current = voiceSession.setMuted;
  }, [voiceSession.setMuted]);

  // Load recipe
  useEffect(() => {
    if (!id) {
      setRecipe(null);
      return;
    }
    db.recipes.get(id).then((r) => setRecipe(r ?? null));
  }, [id]);

  // Start cooking when recipe loads
  useEffect(() => {
    if (recipe && id) {
      startCooking(id, recipe.steps.length);
    }
  }, [recipe, id, startCooking]);

  useEffect(() => {
    latestStateRef.current = { currentStep: safeStep, activeTimers };
  }, [activeTimers, safeStep]);

  useEffect(() => {
    if (!recipe || hasAnnouncedRecipeRef.current) return;
    hasAnnouncedRecipeRef.current = true;
    void speak(`Starting ${recipe.title}. ${buildStepSpeech(recipe, 0)}`);
  }, [recipe, speak]);

  useEffect(() => {
    setOnCompleted((_, label) => {
      void speak(`${label} is done.`);
    });
  }, [setOnCompleted, speak]);

  // WakeLock
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
        wakeLockRef.current = sentinel;
      } catch {
        // not supported or permission denied
      }
    };
    acquire();
    return () => {
      sentinel?.release().catch(() => {});
    };
  }, []);

  if (recipe === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (recipe === null) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
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

  // Split description at the last sentence to highlight the final clause
  const desc = step?.description ?? "";
  const commaIdx = desc.lastIndexOf("，");
  const dotIdx = desc.lastIndexOf("，");
  const splitIdx = Math.max(commaIdx, dotIdx);
  const descMain = splitIdx > 0 ? desc.slice(0, splitIdx + 1) : desc;
  const descHighlight = splitIdx > 0 ? desc.slice(splitIdx + 1) : "";
  const voiceStatusLabel = getVoiceStatusLabel(
    voiceSession.status,
    activeListenMode,
    voiceSession.isMuted,
  );
  const voiceDotClass =
    voiceSession.isMuted || voiceSession.status === "unsupported" || voiceSession.status === "error"
      ? "bg-destructive"
      : voiceSession.status === "recording" ||
          voiceSession.status === "transcribing" ||
          voiceSession.status === "thinking"
        ? "bg-amber-500 animate-pulse"
        : "bg-clay animate-pulse";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 bg-secondary">
              <Volume2 className="h-5 w-5 text-clay" strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {t("cook.nowNarrating")} · {cookingVoiceId ?? recipe.voiceId ?? t("common.default")}
              </div>
              <div className="font-display text-base">{recipe.title}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ManualWakeButton />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${voiceDotClass}`} />{" "}
              {manualWakeActive ? t("app.awake") : voiceStatusLabel}
            </span>
            <button
              onClick={handleClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-foreground hover:text-background"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>

      {/* Step body */}
      <main className="flex-1 flex flex-col">
        <div className="mx-auto w-full max-w-5xl flex-1 flex flex-col px-6 py-10">
          {/* Progress */}
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t("cook.stepOf", { current: stepNumber, total: stepCount })}
            </div>
            <div className="flex gap-1">
              {Array.from({ length: stepCount }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1 rounded-full transition-all ${
                    i < safeStep
                      ? "bg-foreground w-10"
                      : i === safeStep
                        ? "bg-clay w-10"
                        : "bg-border w-10"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Current step text */}
          <div className="flex-1 flex flex-col justify-center">
            <h1 className="font-display text-5xl font-medium leading-[1.1] tracking-tight md:text-7xl">
              {descMain}
              {descHighlight && <span className="text-clay">{descHighlight}</span>}
            </h1>
            {step?.tips && (
              <p className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-accent/40 px-4 py-2 text-sm">
                <span className="font-medium">{t("cook.tip")} ·</span> {step.tips}
              </p>
            )}

            <div className="mt-10 flex items-center gap-4">
              <Waves className="h-8 w-8 text-clay animate-pulse" strokeWidth={1.25} />
              <div className="flex h-10 flex-1 items-center gap-1">
                {Array.from({ length: 80 }).map((_, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full bg-clay/40"
                    style={{ height: `${20 + Math.abs(Math.sin(i * 0.4)) * 80}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Active timers */}
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
                    className="relative flex items-center justify-between overflow-hidden rounded-2xl border border-border bg-card p-5"
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
                    <div className="relative flex flex-col items-end gap-1">
                      <VoiceHint>
                        {t("cook.addTime")} · {t("cook.cancel")}
                      </VoiceHint>
                      <button
                        onClick={() => cancelTimer(timer.id)}
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

          {/* Q&A bubble */}
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <MessageCircle className="mt-0.5 h-4 w-4 text-clay shrink-0" strokeWidth={1.75} />
              <div className="text-sm">
                <div className="text-xs text-muted-foreground">{t("cook.voiceQa")}</div>
                <p className="mt-0.5 text-muted-foreground">
                  {spokenReply || voiceSession.lastTranscript || t("cook.voiceQaBody")}
                </p>
                {voiceSession.error && (
                  <p className="mt-1 text-xs text-destructive">{voiceSession.error}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom controls */}
        <div className="border-t border-border/60 bg-card/50">
          <div className="mx-auto flex max-w-5xl items-center justify-center gap-3 px-6 py-6">
            <button
              onClick={prevStep}
              disabled={safeStep === 0}
              className="relative inline-flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <VoiceBadge n={1} className="absolute -top-1 -right-1" />
              <SkipBack className="h-5 w-5" strokeWidth={1.5} />
            </button>
            <button
              onClick={isPaused ? resumeCooking : pauseCooking}
              className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background hover:bg-clay"
            >
              {isPaused ? (
                <Play className="h-6 w-6" strokeWidth={1.5} />
              ) : (
                <Pause className="h-6 w-6" strokeWidth={1.5} />
              )}
            </button>
            <button
              onClick={nextStep}
              disabled={safeStep === stepCount - 1}
              className="relative inline-flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <VoiceBadge n={2} className="absolute -top-1 -right-1" />
              <SkipForward className="h-5 w-5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (voiceSession.isMuted) {
                  voiceSession.setMuted(false);
                } else {
                  void voiceSession.captureCommand();
                }
              }}
              className="ml-4 hidden flex-1 items-center gap-2 rounded-full border border-border bg-background px-4 py-3 text-left hover:border-clay md:flex"
            >
              <Mic
                className={`h-4 w-4 ${voiceSession.isMuted ? "text-destructive" : "text-clay"}`}
                strokeWidth={1.75}
              />
              <span className="text-sm text-muted-foreground">
                {voiceSession.isSupported
                  ? `${voiceStatusLabel} ? ${t("cook.listeningHint")}`
                  : "Voice recognition is not supported in this browser"}
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
  listenMode: "always" | "wake-word",
  muted: boolean,
): string {
  if (muted) return "Listening off";
  switch (status) {
    case "unsupported":
      return "Voice unsupported";
    case "awake":
      return "Wake word detected";
    case "recording":
      return "Recording command";
    case "transcribing":
      return "Transcribing";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    case "error":
      return "Voice error";
    case "listening":
      return listenMode === "always" ? "Always listening" : "Waiting for wake word";
    case "idle":
    default:
      return listenMode === "always" ? "Ready to listen" : "Say Hey CookTalk";
  }
}
