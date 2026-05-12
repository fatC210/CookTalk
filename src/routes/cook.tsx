import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChefHat,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageCircle,
  Send,
  Timer,
  Waves,
  X,
} from "lucide-react";
import { VoiceHint } from "@/components/voice-badge";
import {
  answerCookingQuestion,
  buildStepSpeech,
  formatDurationForSpeech,
  parseVoiceIntent,
  speakWithElevenLabs,
  VoicePlaybackInterruptedError,
  type VoiceIntentType,
  type VoiceStatus,
} from "@/lib/voice-pipeline";
import { db, type Recipe } from "@/lib/db";
import i18n from "@/lib/i18n";
import { cleanStructuredRecipePayload } from "@/lib/llm";
import { stopActiveVoicePlayback } from "@/lib/voice-playback";
import { cn } from "@/lib/utils";
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

const hiddenQaTranscriptIntentTypes = new Set<VoiceIntentType>([
  "next_step",
  "previous_step",
  "pause",
  "resume",
  "jump_step",
  "end_cooking",
  "show_badges",
  "hide_badges",
  "stop_listening",
  "start_listening",
]);

function shouldAppendTranscriptToQa(intentType: VoiceIntentType): boolean {
  return !hiddenQaTranscriptIntentTypes.has(intentType);
}

function cleanRecipeForCooking(recipe: Recipe, language: AppLanguage): Recipe {
  const cleaned = cleanStructuredRecipePayload(recipe, language, recipe.rawTranscript);
  return {
    ...recipe,
    title: cleaned.title || recipe.title,
    ingredients: cleaned.ingredients.length > 0 ? cleaned.ingredients : recipe.ingredients,
    steps: cleaned.steps.length > 0 ? cleaned.steps : recipe.steps,
    tags: cleaned.tags,
  };
}

function recipeNeedsContentUpdate(current: Recipe, cleaned: Recipe): boolean {
  return (
    current.title !== cleaned.title ||
    JSON.stringify(current.ingredients) !== JSON.stringify(cleaned.ingredients) ||
    JSON.stringify(current.steps) !== JSON.stringify(cleaned.steps) ||
    JSON.stringify(current.tags) !== JSON.stringify(cleaned.tags)
  );
}

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
  const [spokenStepKeys, setSpokenStepKeys] = useState<Set<string>>(() => new Set());
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);
  const [qaInput, setQaInput] = useState("");
  const [isQaSubmitting, setIsQaSubmitting] = useState(false);

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
  const qaScrollRef = useRef<HTMLDivElement | null>(null);
  const qaMessageIdRef = useRef(0);
  const activeQaRequestsRef = useRef(0);
  const latestStateRef = useRef<LatestCookingState>({
    recipe: null,
    stepIndex: 0,
    timers: [],
    isPaused: false,
  });
  const setMutedRef = useRef<((muted: boolean) => void) | null>(null);
  const autoAnnouncedStepKeysRef = useRef<Set<string>>(new Set());
  const announcedStepKeysRef = useRef<Set<string>>(new Set());
  const announcingStepKeyRef = useRef<string | null>(null);
  const pendingInitialAnnounceStepRef = useRef<number | null>(null);
  const speechAbortControllerRef = useRef<AbortController | null>(null);
  const isClosingRef = useRef(false);

  const recipeStepCount = recipe?.steps.length ?? 0;
  const safeStep =
    recipeStepCount > 0 ? Math.max(0, Math.min(currentStep, recipeStepCount - 1)) : 0;
  const step = recipe?.steps[safeStep];
  const stepNumber = safeStep + 1;
  const stepCount = recipeStepCount;
  const isFirstStep = safeStep <= 0;
  const isFinalStep = stepCount > 0 && safeStep === stepCount - 1;
  const recipeId = recipe?.id;
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

  const updateQaSubmitting = useCallback((delta: 1 | -1) => {
    activeQaRequestsRef.current = Math.max(0, activeQaRequestsRef.current + delta);
    setIsQaSubmitting(activeQaRequestsRef.current > 0);
  }, []);

  const resetQaMessagesForRecipe = useCallback((prompt: string) => {
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

  const cancelPendingSpeech = useCallback(() => {
    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = null;
    announcingStepKeyRef.current = null;
    stopActiveVoicePlayback();
    setIsSpeaking(false);
  }, []);

  const handleClose = useCallback(() => {
    isClosingRef.current = true;
    cancelPendingSpeech();
    endCooking();
    navigate({ to: id ? "/recipe-detail" : "/recipes", search: id ? { id } : {} });
  }, [cancelPendingSpeech, endCooking, id, navigate]);

  const updateLatestState = useCallback((nextState: Partial<LatestCookingState>) => {
    latestStateRef.current = {
      ...latestStateRef.current,
      ...nextState,
    };
  }, []);

  const handlePreviousStep = useCallback(() => {
    const target = Math.max(safeStep - 1, 0);
    if (target === safeStep) return;
    cancelPendingSpeech();
    prevStep();
    updateLatestState({ stepIndex: target });
  }, [cancelPendingSpeech, prevStep, safeStep, updateLatestState]);

  const handleNextStep = useCallback(() => {
    const target = Math.min(safeStep + 1, Math.max(stepCount - 1, 0));
    if (target === safeStep) return;
    cancelPendingSpeech();
    nextStep();
    updateLatestState({ stepIndex: target });
  }, [cancelPendingSpeech, nextStep, safeStep, stepCount, updateLatestState]);

  const speak = useCallback(
    async (text: string, options?: { skipCard?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed) return false;

      if (!options?.skipCard) {
        appendQaMessage("assistant", trimmed);
      }

      if (!hasElevenLabsKey) return false;

      speechAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      speechAbortControllerRef.current = abortController;
      setIsSpeaking(true);
      setVoiceError(null);
      try {
        await speakWithElevenLabs(trimmed, resolvedVoiceId, language, {
          signal: abortController.signal,
        });
        return true;
      } catch (error) {
        if (error instanceof VoicePlaybackInterruptedError) return false;
        const message = error instanceof Error ? error.message : t("cook.speechFailed");
        setVoiceError(message);
        toast.error(message);
        return false;
      } finally {
        if (speechAbortControllerRef.current === abortController) {
          speechAbortControllerRef.current = null;
          setIsSpeaking(false);
        }
      }
    },
    [appendQaMessage, hasElevenLabsKey, language, resolvedVoiceId, t],
  );

  const announceCurrentStep = useCallback(
    async (targetRecipe: Recipe, targetStep: number, options?: { force?: boolean }) => {
      const stepKey = `${targetRecipe.id}:${targetStep}:${language}`;
      if (
        (!options?.force && autoAnnouncedStepKeysRef.current.has(stepKey)) ||
        announcingStepKeyRef.current === stepKey
      ) {
        return;
      }

      if (!options?.force) {
        autoAnnouncedStepKeysRef.current.add(stepKey);
      }
      announcingStepKeyRef.current = stepKey;
      const stepSpeech = buildStepSpeech(targetRecipe, targetStep, language);
      try {
        const didSpeak = await speak(stepSpeech, { skipCard: true });
        if (didSpeak) {
          announcedStepKeysRef.current.add(stepKey);
          setSpokenStepKeys(new Set(announcedStepKeysRef.current));
        }
      } finally {
        if (announcingStepKeyRef.current === stepKey) {
          announcingStepKeyRef.current = null;
        }
      }
    },
    [language, speak],
  );

  const askCookingQuestion = useCallback(
    async (question: string, options?: { appendUser?: boolean }) => {
      const cleaned = question.trim();
      const currentRecipe = latestStateRef.current.recipe;
      if (!cleaned || !currentRecipe) return;

      if (options?.appendUser) {
        appendQaMessage("user", cleaned);
      }

      const { stepIndex, timers } = latestStateRef.current;
      setVoiceError(null);
      updateQaSubmitting(1);
      const answer = await (async () => {
        try {
          return await answerCookingQuestion({
            recipe: currentRecipe,
            currentStep: stepIndex,
            question: cleaned,
            language,
            timers,
          });
        } finally {
          updateQaSubmitting(-1);
        }
      })();

      await speak(answer);
    },
    [appendQaMessage, language, speak, updateQaSubmitting],
  );

  const handleTranscriptIntent = useCallback(
    async (transcript: string) => {
      const currentRecipe = latestStateRef.current.recipe;
      if (!currentRecipe) return;

      const intent = parseVoiceIntent(transcript);
      if (shouldAppendTranscriptToQa(intent.type)) {
        appendQaMessage("user", transcript);
      }
      const { stepIndex, timers } = latestStateRef.current;

      switch (intent.type) {
        case "next_step": {
          const target = Math.min(stepIndex + 1, currentRecipe.steps.length - 1);
          if (target === stepIndex) {
            await speak(language === "zh" ? "已经是最后一步了。" : "This is the last step.");
            return;
          }
          cancelPendingSpeech();
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
          cancelPendingSpeech();
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
          cancelPendingSpeech();
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
          await announceCurrentStep(currentRecipe, stepIndex, { force: true });
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
            intent.label?.trim() ||
            (language === "zh"
              ? `${formatDurationForSpeech(seconds, language)}计时器`
              : `${formatDurationForSpeech(seconds, language)} timer`);
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
          await askCookingQuestion(transcript);
          return;
        }
        default:
          return;
      }
    },
    [
      announceCurrentStep,
      appendQaMessage,
      askCookingQuestion,
      cancelPendingSpeech,
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

  const handleQaSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const question = qaInput.trim();
      if (!question) return;
      setQaInput("");
      setVoiceError(null);
      void handleTranscriptIntentRef.current(question);
    },
    [qaInput],
  );

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
    void db.recipes.get(id).then((result) => {
      if (!result) {
        setRecipe(null);
        return;
      }

      const cleaned = cleanRecipeForCooking(result, language);
      setRecipe(cleaned);

      if (recipeNeedsContentUpdate(result, cleaned)) {
        void db.recipes.update(id, {
          title: cleaned.title,
          ingredients: cleaned.ingredients,
          steps: cleaned.steps,
          tags: cleaned.tags,
        });
      }
    });
  }, [id, language]);

  useEffect(() => {
    if (!recipe || !id) return;
    const targetStep =
      recipe.steps.length > 0 ? Math.max(0, Math.min(initialStep, recipe.steps.length - 1)) : 0;
    pendingInitialAnnounceStepRef.current = targetStep;
    startCooking(id, recipe.steps.length, targetStep);
  }, [id, initialStep, recipe, startCooking]);

  useEffect(() => {
    if (!recipeId) return;
    autoAnnouncedStepKeysRef.current = new Set();
    announcedStepKeysRef.current = new Set();
    setSpokenStepKeys(new Set());
    resetQaMessagesForRecipe(t("cook.voiceQaPrompt"));
    setQaInput("");
    activeQaRequestsRef.current = 0;
    setIsQaSubmitting(false);
  }, [recipeId, resetQaMessagesForRecipe, t]);

  useEffect(() => {
    const scrollElement = qaScrollRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: "smooth" });
  }, [isQaSubmitting, qaMessages]);

  useEffect(() => {
    isClosingRef.current = false;

    return () => {
      isClosingRef.current = true;
      cancelPendingSpeech();
    };
  }, [cancelPendingSpeech]);

  useEffect(() => {
    if (!recipe) return;
    if (isClosingRef.current) return;

    const targetStep = pendingInitialAnnounceStepRef.current ?? safeStep;
    const stepKey = `${recipe.id}:${targetStep}:${language}`;
    if (announcedStepKeysRef.current.has(stepKey)) return;
    pendingInitialAnnounceStepRef.current = null;
    void announceCurrentStep(recipe, targetStep);
  }, [announceCurrentStep, hasElevenLabsKey, language, recipe, resolvedVoiceId, safeStep]);

  useEffect(() => {
    updateLatestState({
      recipe: recipe ?? null,
      stepIndex: safeStep,
      timers: activeTimers,
      isPaused,
    });
  }, [activeTimers, isPaused, recipe, safeStep, updateLatestState]);

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
  const currentStepKey = recipe ? `${recipe.id}:${safeStep}:${language}` : null;
  const hasSpokenCurrentStep = currentStepKey ? spokenStepKeys.has(currentStepKey) : false;
  const displayedTimers = activeTimers;
  const hasTimerCards = displayedTimers.length > 0 || Boolean(step?.durationSec);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background px-3 py-3 text-foreground sm:px-5 sm:py-6">
      <main className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col rounded-[1.75rem] border border-border bg-card/70 shadow-[0_22px_70px_-45px_oklch(0.28_0.02_60/0.7)] sm:min-h-[calc(100dvh-3rem)] sm:rounded-[2.25rem]">
        <header className="flex shrink-0 items-start gap-3 px-4 pb-4 pt-4 sm:items-center sm:px-8 sm:pb-5 sm:pt-7">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-clay/35 bg-background text-clay sm:h-14 sm:w-14">
            <ChefHat className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.65} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex min-w-0 items-start gap-2 sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-xl leading-tight sm:text-2xl">
                  {language === "zh" ? "正在烹饪" : "Now cooking"}
                </div>
                <div className="mt-0.5 truncate text-sm text-muted-foreground sm:text-base">
                  {recipe.title} · {t("cook.stepOf", { current: stepNumber, total: stepCount })}
                </div>
              </div>
              <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs text-foreground sm:inline-flex">
                <span className={`h-1.5 w-1.5 rounded-full ${voiceDotClass}`} />
                {voiceStatusLabel}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
              <span className={`h-1.5 w-1.5 rounded-full ${voiceDotClass}`} />
              <span className="truncate">{voiceStatusLabel}</span>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("cook.backToRecipeButton")}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 sm:gap-5 sm:px-8 sm:pb-7">
          <section className="overflow-hidden rounded-[1.6rem] bg-background/78 px-5 py-5 sm:rounded-[1.85rem] sm:px-8 sm:py-7">
            <div className="text-sm text-muted-foreground sm:text-base">
              CookTalk · {voiceModeLabel}
            </div>
            <h1 className="mt-4 max-h-[14rem] overflow-y-auto break-words font-display text-[clamp(1.8rem,8vw,2.45rem)] font-medium leading-[1.22] sm:mt-5 sm:max-h-[18rem] sm:text-[clamp(2.35rem,5vw,4.05rem)] sm:leading-[1.14]">
              <span>“</span>
              {descMain}
              {descHighlight && <span className="text-clay"> {descHighlight}</span>}
              <span>”</span>
            </h1>
            {step?.tips && (
              <p className="mt-4 rounded-2xl bg-secondary/60 px-4 py-3 text-sm leading-6 text-foreground/85 sm:text-base">
                <span className="font-medium text-clay">{t("cook.tip")}</span>
                <span className="ml-2">{step.tips}</span>
              </p>
            )}
            <div className="mt-5 flex items-center gap-4 text-muted-foreground">
              <Waves className="h-7 w-7 shrink-0 text-clay/55" strokeWidth={1.6} />
              <div className="grid min-w-0 flex-1 grid-flow-col auto-cols-fr gap-1.5">
                {Array.from({ length: stepCount }).map((_, index) => (
                  <span
                    key={index}
                    className={cn(
                      "h-0.5 min-w-0 rounded-full transition-all sm:h-1",
                      index < safeStep
                        ? "bg-foreground/65"
                        : index === safeStep
                          ? "bg-clay"
                          : "bg-border",
                    )}
                  />
                ))}
                {stepCount === 0 && <span className="h-0.5 rounded-full bg-border sm:h-1" />}
              </div>
              {hasSpokenCurrentStep && (
                <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground sm:inline-flex">
                  <CheckCircle2 className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} />
                  {t("cook.stepSpokenOnce")}
                </span>
              )}
            </div>
          </section>

          {hasTimerCards && (
            <section className="grid grid-cols-2 gap-3 sm:gap-4">
              {step?.durationSec && displayedTimers.length === 0 && (
                <div className="col-span-2 rounded-[1.35rem] border border-border bg-background/70 p-4 sm:rounded-[1.5rem] sm:p-5">
                  <div className="flex items-start justify-between gap-2 text-sm text-muted-foreground">
                    <span className="truncate">
                      {t("cook.stepOf", { current: stepNumber, total: stepCount })}
                    </span>
                    <Clock3 className="h-4 w-4 shrink-0 text-foreground" strokeWidth={1.65} />
                  </div>
                  <div className="mt-3 font-display text-3xl leading-none tabular-nums sm:text-5xl">
                    {formatTimer(step.durationSec)}
                  </div>
                </div>
              )}
              {displayedTimers.map((timer) => {
                const progress =
                  timer.totalSeconds > 0
                    ? (1 - timer.remainingSeconds / timer.totalSeconds) * 100
                    : 0;

                return (
                  <div
                    key={timer.id}
                    className="relative overflow-hidden rounded-[1.35rem] border border-border bg-background/70 p-4 sm:rounded-[1.5rem] sm:p-5"
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-clay/12 transition-all"
                      style={{ width: `${progress}%` }}
                      aria-hidden
                    />
                    <div className="relative flex items-start justify-between gap-2 text-sm text-muted-foreground">
                      <span className="min-w-0 truncate">{timer.label}</span>
                      <Timer className="h-4 w-4 shrink-0 text-foreground" strokeWidth={1.65} />
                    </div>
                    <div className="relative mt-3 font-display text-3xl leading-none tabular-nums sm:text-5xl">
                      {formatTimer(timer.remainingSeconds)}
                    </div>
                    <div className="relative mt-3 flex items-center justify-between gap-2">
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
                        className="shrink-0 rounded-full border border-border bg-card/60 px-3 py-1 text-xs hover:bg-foreground hover:text-background"
                      >
                        {t("cook.cancel").replaceAll('"', "")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          <section className="rounded-[1.35rem] border border-dashed border-border bg-background/45 p-4 sm:rounded-[1.5rem] sm:p-5">
            <div className="flex items-start gap-3">
              <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-clay" strokeWidth={1.65} />
              <div className="min-w-0 flex-1">
                <div
                  ref={qaScrollRef}
                  className="flex max-h-32 min-h-0 min-w-0 flex-col gap-2 overflow-y-auto sm:max-h-44"
                >
                  {qaMessages.map((message) => {
                    const isUser = message.speaker === "user";
                    return (
                      <p
                        key={message.id}
                        className={cn(
                          "whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere] sm:text-base",
                          isUser ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {isUser ? (
                          <>
                            <span className="text-muted-foreground">{t("cook.youAsked")} </span>
                            <span>“{message.text}”</span>
                          </>
                        ) : (
                          message.text
                        )}
                      </p>
                    );
                  })}
                  {isQaSubmitting && <QaLoadingDots />}
                  {(voiceError || error) && (
                    <p className="text-xs text-destructive">{voiceError || error}</p>
                  )}
                  {!voiceError && !error && qaMessages.length === 0 && (
                    <p className="text-sm leading-6 text-muted-foreground">
                      {t("cook.voiceQaBody")}
                    </p>
                  )}
                </div>
                <form
                  onSubmit={handleQaSubmit}
                  className="mt-3 flex items-center gap-2 rounded-full border border-clay/30 bg-card/70 px-3 py-2 shadow-[0_1px_0_oklch(1_0_0/0.4)_inset] transition-colors focus-within:border-clay/70 focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/15"
                >
                  <input
                    value={qaInput}
                    onChange={(event) => setQaInput(event.target.value)}
                    placeholder={t("cook.voiceQaPlaceholder")}
                    className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground sm:text-base"
                  />
                  <button
                    type="submit"
                    disabled={!qaInput.trim()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-clay disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                    aria-label={t("cook.voiceQaSend")}
                  >
                    <Send className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </form>
              </div>
            </div>
          </section>

          <footer className="mt-auto space-y-4 pb-[max(env(safe-area-inset-bottom),0px)]">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handlePreviousStep}
                disabled={isFirstStep}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-clay hover:text-clay disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/50 disabled:text-muted-foreground sm:text-base"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
                {t("cook.previousStepButton")}
              </button>
              {isFinalStep ? (
                <button
                  onClick={handleClose}
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-clay sm:text-base"
                >
                  {t("cook.backToRecipeButton")}
                </button>
              ) : (
                <button
                  onClick={handleNextStep}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-clay sm:text-base"
                >
                  {t("cook.nextStepButton")}
                  <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm leading-6 text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay/60" />
              <span>{t("cook.listeningHint")}</span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}

function QaLoadingDots() {
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="AI is replying">
      <div className="flex items-center gap-1.5 py-1.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-2 w-2 animate-bounce rounded-full bg-clay"
            style={{ animationDelay: `${index * 140}ms` }}
          />
        ))}
      </div>
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
