import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { RecipeEditShortcuts } from "@/components/recipe-edit-shortcuts";
import {
  RecipeContentDisplayToggle,
  shouldShowIngredients,
  shouldShowSteps,
  type RecipeContentDisplayMode,
} from "@/components/recipe-content-display-toggle";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  AlertCircle,
  ArrowRight,
  AudioLines,
  CheckCircle2,
  FileText,
  FileVideo,
  ImageIcon,
  Loader2,
  RotateCcw,
  GripVertical,
  MessageCircleMore,
  Mic,
  Pencil,
  Plus,
  Send,
  Sparkles,
  StopCircle,
  Trash2,
  UploadCloud,
  Wand2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { TFunction } from "i18next";
import { ElevenLabsService } from "@/lib/elevenlabs";
import {
  DEFAULT_IMAGE_MODEL,
  ImageGenService,
  cleanStructuredRecipePayload,
  getConfiguredLLMService,
} from "@/lib/llm";
import { getApiKey } from "@/lib/crypto";
import { db } from "@/lib/db";
import { deleteVideoImportTask, saveVideoImportTask, type Recipe } from "@/lib/db";
import i18n from "@/lib/i18n";
import {
  createVideoImportTask,
  deriveTaskDisplayTitle,
  MAX_VIDEO_IMPORT_TASKS,
  updateVideoImportTask,
} from "@/lib/video-import-tasks";
import {
  normalizeSpeechText,
  speakWithElevenLabs,
  transcribeWithElevenLabs,
} from "@/lib/voice-pipeline";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppTooltip, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { v4 as uuid } from "uuid";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { useAppStore } from "@/stores/app-store";
import {
  createEmptyIngredient,
  createEmptyManualStep,
  createEmptyRecipeStep,
  createInitialVideoDraftSnapshot,
  hasVideoDraftContent,
  type FollowUpAnswers,
  type FollowUpField,
  type ManualDifficulty,
  type ManualIngredient,
  type ManualStep,
  type PipelineStage,
  type StructuredRecipe,
  type VideoImportDraftSnapshot,
  useImportDraftStore,
} from "@/stores/import-draft-store";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: i18n.t("import.metaTitle") },
      {
        name: "description",
        content: i18n.t("import.metaDescription"),
      },
    ],
  }),
  component: ImportPage,
});

const EMPTY_MANUAL_DIFFICULTY_VALUE = "__empty__";
const ENABLE_GUIDED_FOLLOW_UPS = false;

const pipelineStages = [
  {
    icon: UploadCloud,
    labelKey: "import.stages.upload.label",
    bodyKey: "import.stages.upload.body",
  },
  {
    icon: AudioLines,
    labelKey: "import.stages.stt.label",
    bodyKey: "import.stages.stt.body",
  },
  {
    icon: Wand2,
    labelKey: "import.stages.structure.label",
    bodyKey: "import.stages.structure.body",
  },
  {
    icon: ImageIcon,
    labelKey: "import.stages.cover.label",
    bodyKey: "import.stages.cover.body",
  },
];

const stageToIndex: Record<PipelineStage, number> = {
  idle: -1,
  transcribing: 0,
  structuring: 1,
  "generating-cover": 2,
  preview: 3,
  saving: 3,
  done: 3,
  error: -1,
};

const stageLabelKeys: Partial<Record<PipelineStage, string>> = {
  transcribing: "import.transcribing",
  structuring: "import.structuring",
  "generating-cover": "import.generatingCover",
  saving: "import.saving",
  done: "import.saved",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  if (fromIndex >= items.length || toIndex >= items.length) return items;

  const next = [...items];
  const [movedItem] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, movedItem);
  return next;
}

function reorderRecipeSteps(
  steps: StructuredRecipe["steps"],
  fromIndex: number,
  toIndex: number,
): StructuredRecipe["steps"] {
  return reorderItems(steps, fromIndex, toIndex).map((item, itemIndex) => ({
    ...item,
    order: itemIndex + 1,
  }));
}

function buildVideoDraftSnapshot(values: {
  selectedMediaFile: File | null;
  stage: PipelineStage;
  error: string | null;
  transcript: string;
  structuredRecipe: StructuredRecipe | null;
  coverImage: Blob | null;
  videoCoverSource: Recipe["coverSource"];
  editTitle: string;
  editSteps: StructuredRecipe["steps"];
  editIngredients: StructuredRecipe["ingredients"];
  editDifficulty: ManualDifficulty;
  editTotalTime: string;
  followUpAnswers: FollowUpAnswers;
  followUpProgress: VideoImportDraftSnapshot["followUpProgress"];
  followUpIndex: number;
  followUpInput: string;
  followUpPrompt: string;
  followUpStatus: VideoImportDraftSnapshot["followUpStatus"];
  followUpError: string | null;
  followUpStarted: boolean;
  followUpCompleted: boolean;
}): VideoImportDraftSnapshot {
  return {
    selectedMediaFile: values.selectedMediaFile,
    stage: values.stage,
    error: values.error,
    transcript: values.transcript,
    structuredRecipe: values.structuredRecipe,
    coverImage: values.coverImage,
    videoCoverSource: values.videoCoverSource,
    editTitle: values.editTitle,
    editSteps: values.editSteps,
    editIngredients: values.editIngredients,
    editDifficulty: values.editDifficulty,
    editTotalTime: values.editTotalTime,
    followUpAnswers: values.followUpAnswers,
    followUpProgress: values.followUpProgress,
    followUpIndex: values.followUpIndex,
    followUpInput: values.followUpInput,
    followUpPrompt: values.followUpPrompt,
    followUpStatus: values.followUpStatus,
    followUpError: values.followUpError,
    followUpStarted: values.followUpStarted,
    followUpCompleted: values.followUpCompleted,
  };
}

function getVideoDraftSignature(snapshot: VideoImportDraftSnapshot): string {
  return JSON.stringify({
    fileName: snapshot.selectedMediaFile?.name ?? "",
    fileSize: snapshot.selectedMediaFile?.size ?? 0,
    stage: snapshot.stage,
    error: snapshot.error,
    transcript: snapshot.transcript,
    structuredRecipe: snapshot.structuredRecipe,
    coverSize: snapshot.coverImage?.size ?? 0,
    videoCoverSource: snapshot.videoCoverSource,
    editTitle: snapshot.editTitle,
    editSteps: snapshot.editSteps,
    editIngredients: snapshot.editIngredients,
    editDifficulty: snapshot.editDifficulty,
    editTotalTime: snapshot.editTotalTime,
    followUpAnswers: snapshot.followUpAnswers,
    followUpProgress: snapshot.followUpProgress,
    followUpIndex: snapshot.followUpIndex,
    followUpInput: snapshot.followUpInput,
    followUpPrompt: snapshot.followUpPrompt,
    followUpStatus: snapshot.followUpStatus,
    followUpError: snapshot.followUpError,
    followUpStarted: snapshot.followUpStarted,
    followUpCompleted: snapshot.followUpCompleted,
  });
}

function formatImportError(err: unknown, fallback: string, t: TFunction): string {
  const rawMessage = err instanceof Error ? err.message.trim() : "";
  if (!rawMessage) return fallback;

  if (/not a function|is not defined|Cannot read properties of (?:undefined|null)/i.test(rawMessage)) {
    return t("import.pipelineFailed");
  }

  if (/LLM request timed out/i.test(rawMessage)) {
    return t("import.llmTimeout");
  }

  if (/empty transcript/i.test(rawMessage)) {
    return t("import.emptyTranscript");
  }

  if (/No usable recipe content was extracted/i.test(rawMessage)) {
    return t("import.recipeStructureEmpty");
  }

  if (/LLM failed:\s*502|Upstream request failed|fetch failed/i.test(rawMessage)) {
    return t("import.llmConnectionFailed", { detail: rawMessage });
  }

  if (/Failed to parse .*recipe JSON/i.test(rawMessage)) {
    return t("import.pipelineFailed");
  }

  return rawMessage;
}

function formatCoverGenerationError(err: unknown, t: TFunction): string {
  const status = err instanceof Error ? err.message.match(/Image gen failed:\s*(\d+)/i)?.[1] : null;
  console.warn("Cover generation failed", status ? { status } : undefined);
  return t("import.coverGenerationFailed");
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function formatDurationMinutesInput(durationSec?: number): string {
  if (!durationSec || durationSec <= 0) return "";
  return String(Math.max(1, Math.round(durationSec / 60)));
}

function parseDurationMinutesInput(value: string): number | undefined {
  const minutes = parsePositiveInt(value);
  return minutes ? minutes * 60 : undefined;
}

function isEmptyIngredient(ingredient: ManualIngredient) {
  return !ingredient.name.trim() && !ingredient.amount.trim();
}

function isEmptyRecipeStep(step: StructuredRecipe["steps"][number]) {
  return !step.description.trim() && !step.durationSec && !(step.tips ?? "").trim();
}

function isEmptyManualStep(step: ManualStep) {
  return !step.description.trim() && !step.durationMin.trim() && !step.tips.trim();
}

type StepMetadataFieldsProps = {
  t: TFunction;
  durationValue: string;
  tipsValue: string;
  onDurationChange: (value: string) => void;
  onTipsChange: (value: string) => void;
  disabled?: boolean;
};

function StepMetadataFields({
  t,
  durationValue,
  tipsValue,
  onDurationChange,
  onTipsChange,
  disabled,
}: StepMetadataFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("import.manualStepDuration")}
        </span>
        <div className="flex rounded-xl border border-border bg-card transition-colors focus-within:border-clay">
          <input
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
            value={durationValue}
            onChange={(e) => onDurationChange(e.target.value)}
            placeholder={t("import.manualStepDurationPlaceholder")}
            inputMode="numeric"
            disabled={disabled}
          />
          <span className="flex shrink-0 items-center border-l border-border px-3 text-xs text-muted-foreground">
            {t("import.manualStepDurationUnit")}
          </span>
        </div>
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("import.manualStepTips")}
        </span>
        <input
          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay disabled:cursor-not-allowed disabled:opacity-60"
          value={tipsValue}
          onChange={(e) => onTipsChange(e.target.value)}
          placeholder={t("import.manualStepTipsPlaceholder")}
          disabled={disabled}
        />
      </label>
    </div>
  );
}

type StepDescriptionFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
  placeholder: string;
  disabled?: boolean;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
};

function StepDescriptionField({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  textareaRef,
}: StepDescriptionFieldProps) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{placeholder}</span>
      <AutoResizeTextarea
        ref={textareaRef}
        className="overflow-y-hidden rounded-xl border border-border bg-card px-3 py-3 text-sm outline-none focus-visible:border-clay focus-visible:ring-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        minRows={1}
        maxRows={6}
        disabled={disabled}
      />
    </label>
  );
}

function parseServingsAnswer(value: string): number | undefined {
  const digitsMatch = value.match(/\d+/);
  if (digitsMatch?.[0]) return parsePositiveInt(digitsMatch[0]);

  const cnMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  if (value.includes("十")) {
    const [left, right] = value.split("十");
    const tens = left ? (cnMap[left] ?? 1) : 1;
    const ones = right ? (cnMap[right] ?? 0) : 0;
    return tens * 10 + ones;
  }

  return cnMap[value.trim()];
}

function buildFallbackRefinedRecipe(
  recipe: StructuredRecipe,
  answers: FollowUpAnswers,
): StructuredRecipe {
  const servings = parseServingsAnswer(answers.servings);
  const spiceLevel = answers.spiceLevel.trim();
  const notes = answers.notes.trim();

  return {
    ...recipe,
    tags: {
      ...recipe.tags,
      servings: servings ?? recipe.tags.servings,
      spiceLevel: spiceLevel || recipe.tags.spiceLevel,
      notes: notes ? [recipe.tags.notes, notes].filter(Boolean).join("；") : recipe.tags.notes,
    },
  };
}

async function persistRecipe(recipe: Omit<Recipe, "id" | "createdAt">): Promise<string> {
  const id = uuid();
  await db.recipes.add({
    ...recipe,
    id,
    createdAt: Date.now(),
  });
  return id;
}

function mergeFollowUpRefinedRecipe(
  recipe: StructuredRecipe,
  answers: FollowUpAnswers,
  refinedRecipe?: StructuredRecipe | null,
): StructuredRecipe {
  const baseRecipe = buildFallbackRefinedRecipe(recipe, answers);
  if (!refinedRecipe) return baseRecipe;

  return {
    ...baseRecipe,
    title: refinedRecipe.title.trim() || baseRecipe.title,
    ingredients: recipe.ingredients.map((item) => ({ ...item })),
    steps: recipe.steps.map((item) => ({ ...item })),
    tags: {
      ...baseRecipe.tags,
      ...refinedRecipe.tags,
      servings: baseRecipe.tags.servings,
      spiceLevel: baseRecipe.tags.spiceLevel,
      notes: baseRecipe.tags.notes,
    },
  };
}

function cleanStructuredImportRecipe(
  recipe: StructuredRecipe,
  language: "en" | "zh",
  fallbackText?: string,
): StructuredRecipe {
  return cleanStructuredRecipePayload(recipe, language, fallbackText) as StructuredRecipe;
}

function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const conversationVoiceId = useAppStore((s) => s.conversationVoiceId);
  const language = useAppStore((s) => s.language);
  const hasElevenLabsKey = useAppStore((s) => s.hasElevenLabsKey);
  const hasLlmKey = useAppStore((s) => s.hasLlmKey);
  const hasImageGenKey = useAppStore((s) => s.hasImageGenKey);

  useEffect(() => {
    document.title = t("import.metaTitle");
  }, [t, language]);

  const {
    mode,
    setMode,
    isDragging,
    setIsDragging,
    selectedMediaFile,
    stage,
    setStage,
    error,
    setError,
    transcript,
    setTranscript,
    structuredRecipe,
    setStructuredRecipe,
    coverImage,
    setCoverImage,
    videoCoverSource,
    setVideoCoverSource,
    editTitle,
    setEditTitle,
    editSteps,
    setEditSteps,
    editIngredients,
    setEditIngredients,
    editDifficulty,
    setEditDifficulty,
    editTotalTime,
    setEditTotalTime,
    followUpAnswers,
    setFollowUpAnswers,
    followUpProgress,
    setFollowUpProgress,
    followUpIndex,
    setFollowUpIndex,
    followUpInput,
    setFollowUpInput,
    followUpPrompt,
    setFollowUpPrompt,
    followUpStatus,
    setFollowUpStatus,
    followUpError,
    setFollowUpError,
    followUpStarted,
    setFollowUpStarted,
    followUpCompleted,
    setFollowUpCompleted,
    manualTitle,
    setManualTitle,
    manualCuisine,
    setManualCuisine,
    manualDifficulty,
    setManualDifficulty,
    manualTotalTime,
    setManualTotalTime,
    manualFlavors,
    setManualFlavors,
    manualIngredients,
    setManualIngredients,
    manualSteps,
    setManualSteps,
    manualRawText,
    setManualRawText,
    isManualTextDialogOpen,
    setIsManualTextDialogOpen,
    manualTextImportStatus,
    setManualTextImportStatus,
    manualTextImportError,
    setManualTextImportError,
    manualCoverImage,
    setManualCoverImage,
    manualCoverSource,
    setManualCoverSource,
    isManualGeneratingCover,
    setIsManualGeneratingCover,
    isManualSaving,
    setIsManualSaving,
    replaceVideoDraft,
    clearFollowUpDraft,
    clearVideoDraft,
    clearManualDraft,
  } = useImportDraftStore();
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [manualCoverPreviewUrl, setManualCoverPreviewUrl] = useState<string | null>(null);
  const [expandedCoverPreview, setExpandedCoverPreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [videoEditDisplayMode, setVideoEditDisplayMode] =
    useState<RecipeContentDisplayMode>("all");
  const [manualDisplayMode, setManualDisplayMode] = useState<RecipeContentDisplayMode>("all");
  const videoTasksQuery = useLiveQuery(
    () => db.videoImportTasks.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const isVideoTasksLoaded = videoTasksQuery !== undefined;
  const videoTasks = useMemo(() => videoTasksQuery ?? [], [videoTasksQuery]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const manualCoverInputRef = useRef<HTMLInputElement>(null);
  const editIngredientNameRefs = useRef<Array<HTMLInputElement | null>>([]);
  const editStepDescriptionRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const manualIngredientNameRefs = useRef<Array<HTMLInputElement | null>>([]);
  const manualStepDescriptionRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const draggedEditStepIndexRef = useRef<number | null>(null);
  const draggedManualStepIndexRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderTimeoutRef = useRef<number | null>(null);
  const shouldAutoListenFollowUpRef = useRef(false);
  const followUpSubmitRef = useRef<((answer: string) => Promise<void>) | null>(null);
  const creatingNewVideoTaskRef = useRef(false);
  const initializedVideoTaskRef = useRef(false);
  const lastSavedTaskSignatureRef = useRef<string>("");
  const pipelineRunIdRef = useRef(0);

  const MAX_SIZE = 200 * 1024 * 1024;
  const canUseVoiceFollowUp = hasElevenLabsKey;

  const videoDraftSnapshot = buildVideoDraftSnapshot({
    selectedMediaFile,
    stage,
    error,
    transcript,
    structuredRecipe,
    coverImage,
    videoCoverSource,
    editTitle,
    editSteps,
    editIngredients,
    editDifficulty,
    editTotalTime,
    followUpAnswers,
    followUpProgress,
    followUpIndex,
    followUpInput,
    followUpPrompt,
    followUpStatus,
    followUpError,
    followUpStarted,
    followUpCompleted,
  });
  const hasVideoTaskCapacity = videoTasks.length < MAX_VIDEO_IMPORT_TASKS;

  useEffect(() => {
    if (!isVideoTasksLoaded) return;
    if (initializedVideoTaskRef.current) return;
    initializedVideoTaskRef.current = true;

    if (videoTasks.length > 0) {
      const initialTask = currentTaskId
        ? (videoTasks.find((task) => task.id === currentTaskId) ?? videoTasks[0])
        : videoTasks[0];
      setCurrentTaskId(initialTask.id);
      replaceVideoDraft(initialTask.snapshot);
      return;
    }

    replaceVideoDraft(createInitialVideoDraftSnapshot());
  }, [currentTaskId, isVideoTasksLoaded, replaceVideoDraft, videoTasks]);

  useEffect(() => {
    if (!isVideoTasksLoaded) return;
    if (creatingNewVideoTaskRef.current && hasVideoTaskCapacity) return;
    if (videoTasks.length === 0) {
      if (currentTaskId !== null) setCurrentTaskId(null);
      creatingNewVideoTaskRef.current = false;
      return;
    }

    if (!currentTaskId || !videoTasks.some((task) => task.id === currentTaskId)) {
      const nextTask = videoTasks[0];
      setCurrentTaskId(nextTask.id);
      lastSavedTaskSignatureRef.current = "";
      replaceVideoDraft(nextTask.snapshot);
      setMode("video");
    }
  }, [
    currentTaskId,
    hasVideoTaskCapacity,
    isVideoTasksLoaded,
    replaceVideoDraft,
    setMode,
    videoTasks,
  ]);

  const followUpQuestions = useMemo<
    {
      field: FollowUpField;
      label: string;
      question: string;
      placeholder: string;
    }[]
  >(
    () => [
      {
        field: "servings" as const,
        label: t("import.followUp.servingsLabel"),
        question: t("import.followUp.servingsQuestion"),
        placeholder: t("import.followUp.servingsPlaceholder"),
      },
      {
        field: "spiceLevel" as const,
        label: t("import.followUp.spiceLabel"),
        question: t("import.followUp.spiceQuestion"),
        placeholder: t("import.followUp.spicePlaceholder"),
      },
      {
        field: "notes" as const,
        label: t("import.followUp.notesLabel"),
        question: t("import.followUp.notesQuestion"),
        placeholder: t("import.followUp.notesPlaceholder"),
      },
    ],
    [t],
  );

  const currentFollowUp = followUpQuestions[followUpIndex] ?? null;
  const followUpMessages = followUpQuestions.slice(0, followUpIndex + 1).map((item, index) => ({
    ...item,
    answer: followUpAnswers[item.field]?.trim() ?? "",
    isCurrent: index === followUpIndex,
  }));
  const followUpBusy =
    followUpStatus === "speaking" ||
    followUpStatus === "listening" ||
    followUpStatus === "transcribing" ||
    followUpStatus === "refining";

  const focusElement = (element: HTMLElement | null | undefined) => {
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => element.focus(), 180);
  };

  const focusElementAfterDisplayChange = (elementGetter: () => HTMLElement | null | undefined) => {
    window.requestAnimationFrame(() => focusElement(elementGetter()));
  };

  const jumpToEditIngredient = (index: number) => {
    setVideoEditDisplayMode((current) => (current === "steps" ? "all" : current));
    focusElementAfterDisplayChange(() => editIngredientNameRefs.current[index]);
  };

  const jumpToEditStep = (index: number) => {
    setVideoEditDisplayMode((current) => (current === "ingredients" ? "all" : current));
    focusElementAfterDisplayChange(() => editStepDescriptionRefs.current[index]);
  };

  const jumpToManualIngredient = (index: number) => {
    setManualDisplayMode((current) => (current === "steps" ? "all" : current));
    focusElementAfterDisplayChange(() => manualIngredientNameRefs.current[index]);
  };

  const jumpToManualStep = (index: number) => {
    setManualDisplayMode((current) => (current === "ingredients" ? "all" : current));
    focusElementAfterDisplayChange(() => manualStepDescriptionRefs.current[index]);
  };

  const syncRecipeEditor = (recipe: StructuredRecipe) => {
    setStructuredRecipe(recipe);
    setEditTitle(recipe.title);
    setEditIngredients(recipe.ingredients.map((item) => ({ ...item })));
    setEditSteps(recipe.steps.map((item) => ({ ...item })));
    setEditDifficulty(recipe.tags.difficulty ?? "");
    setEditTotalTime(
      recipe.tags.totalTimeMin && recipe.tags.totalTimeMin > 0
        ? String(recipe.tags.totalTimeMin)
        : "",
    );
  };

  const updateEditIngredient = (index: number, patch: Partial<ManualIngredient>) => {
    setEditIngredients((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };

  const addEditIngredient = () => {
    setVideoEditDisplayMode((current) => (current === "steps" ? "all" : current));
    setEditIngredients((current) => {
      const next = [createEmptyIngredient(), ...current];
      window.requestAnimationFrame(() => {
        editIngredientNameRefs.current[0]?.focus();
      });
      return next;
    });
  };

  const removeEditIngredient = (index: number) => {
    setEditIngredients((current) =>
      current.length > 1
        ? current.filter((_, itemIndex) => itemIndex !== index)
        : [createEmptyIngredient()],
    );
  };

  const handleEditIngredientBlur = (event: React.FocusEvent<HTMLDivElement>, index: number) => {
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement)) return;
    setEditIngredients((current) => {
      const ingredient = current[index];
      if (!ingredient || !isEmptyIngredient(ingredient)) return current;
      return current.length > 1
        ? current.filter((_, itemIndex) => itemIndex !== index)
        : [createEmptyIngredient()];
    });
  };

  const updateEditStep = (index: number, patch: Partial<StructuredRecipe["steps"][number]>) => {
    setEditSteps((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch, order: itemIndex + 1 } : item,
      ),
    );
  };

  const addEditStep = () => {
    setVideoEditDisplayMode((current) => (current === "ingredients" ? "all" : current));
    setEditSteps((current) => {
      const next = [...current, createEmptyRecipeStep(current.length + 1)].map((item, itemIndex) => ({
        ...item,
        order: itemIndex + 1,
      }));
      window.requestAnimationFrame(() => {
        editStepDescriptionRefs.current[next.length - 1]?.focus();
      });
      return next;
    });
  };

  const moveEditStep = (fromIndex: number, toIndex: number) => {
    setEditSteps((current) => reorderRecipeSteps(current, fromIndex, toIndex));
  };

  const removeEditStep = (index: number) => {
    setEditSteps((current) =>
      current.length > 1
        ? current
            .filter((_, itemIndex) => itemIndex !== index)
            .map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }))
        : [createEmptyRecipeStep(1)],
    );
  };

  const handleEditStepBlur = (event: React.FocusEvent<HTMLDivElement>, index: number) => {
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement)) return;
    setEditSteps((current) => {
      const step = current[index];
      if (!step || !isEmptyRecipeStep(step)) return current;
      return current.length > 1
        ? current
            .filter((_, itemIndex) => itemIndex !== index)
            .map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }))
        : [createEmptyRecipeStep(1)];
    });
  };

  const handleManualIngredientBlur = (event: React.FocusEvent<HTMLDivElement>, index: number) => {
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement)) return;
    setManualIngredients((current) => {
      const ingredient = current[index];
      if (!ingredient || !isEmptyIngredient(ingredient)) return current;
      return current.length > 1
        ? current.filter((_, itemIndex) => itemIndex !== index)
        : [createEmptyIngredient()];
    });
  };

  const handleManualStepBlur = (event: React.FocusEvent<HTMLDivElement>, index: number) => {
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement)) return;
    setManualSteps((current) => {
      const step = current[index];
      if (!step || !isEmptyManualStep(step)) return current;
      return current.length > 1
        ? current.filter((_, itemIndex) => itemIndex !== index)
        : [createEmptyManualStep()];
    });
  };

  const addManualStep = () => {
    setManualSteps((current) => {
      const next = [...current, createEmptyManualStep()];
      window.requestAnimationFrame(() => {
        manualStepDescriptionRefs.current[next.length - 1]?.focus();
      });
      return next;
    });
  };

  const moveManualStep = (fromIndex: number, toIndex: number) => {
    setManualSteps((current) => reorderItems(current, fromIndex, toIndex));
  };

  const stopAnswerRecording = useCallback(() => {
    if (recorderTimeoutRef.current) {
      window.clearTimeout(recorderTimeoutRef.current);
      recorderTimeoutRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const cleanupAnswerRecording = useCallback(() => {
    if (recorderTimeoutRef.current) {
      window.clearTimeout(recorderTimeoutRef.current);
      recorderTimeoutRef.current = null;
    }
    recorderRef.current = null;
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  }, []);

  const resetFollowUpFlow = () => {
    shouldAutoListenFollowUpRef.current = false;
    cleanupAnswerRecording();
    clearFollowUpDraft();
  };

  const saveCurrentVideoTaskNow = useCallback(async () => {
    if (!currentTaskId) return;
    const baseTask = videoTasks.find((task) => task.id === currentTaskId);
    if (!baseTask || !hasVideoDraftContent(videoDraftSnapshot)) return;

    const nextTask = updateVideoImportTask(baseTask, videoDraftSnapshot);
    lastSavedTaskSignatureRef.current = `${nextTask.id}:${getVideoDraftSignature(nextTask.snapshot)}`;
    await saveVideoImportTask(nextTask);
  }, [currentTaskId, videoDraftSnapshot, videoTasks]);

  const loadVideoTask = useCallback(
    async (taskId: string) => {
      const task = videoTasks.find((item) => item.id === taskId);
      if (!task) return;
      if (task.id === currentTaskId) return;

      creatingNewVideoTaskRef.current = false;
      await saveCurrentVideoTaskNow();
      stopAnswerRecording();
      cleanupAnswerRecording();
      setCurrentTaskId(task.id);
      lastSavedTaskSignatureRef.current = "";
      replaceVideoDraft(task.snapshot);
      setMode("video");
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [
      cleanupAnswerRecording,
      currentTaskId,
      replaceVideoDraft,
      saveCurrentVideoTaskNow,
      setMode,
      stopAnswerRecording,
      videoTasks,
    ],
  );

  const clearCurrentVideoTask = useCallback(async () => {
    stopAnswerRecording();
    cleanupAnswerRecording();
    if (currentTaskId) {
      await deleteVideoImportTask(currentTaskId);
    }
    clearVideoDraft();
    setCurrentTaskId(null);
    creatingNewVideoTaskRef.current = false;
    lastSavedTaskSignatureRef.current = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [cleanupAnswerRecording, clearVideoDraft, currentTaskId, stopAnswerRecording]);

  const handleDeleteVideoTask = useCallback(
    async (taskId: string) => {
      if (taskId === currentTaskId) {
        await clearCurrentVideoTask();
        return;
      }

      await deleteVideoImportTask(taskId);
    },
    [clearCurrentVideoTask, currentTaskId],
  );

  const returnToUploadStep = async () => {
    if (!hasVideoTaskCapacity) {
      toast.error(t("import.videoTaskLimitReached"));
      return;
    }

    await saveCurrentVideoTaskNow();
    pipelineRunIdRef.current += 1;
    stopAnswerRecording();
    cleanupAnswerRecording();
    shouldAutoListenFollowUpRef.current = false;
    setCurrentTaskId(null);
    creatingNewVideoTaskRef.current = true;
    lastSavedTaskSignatureRef.current = "";
    replaceVideoDraft(createInitialVideoDraftSnapshot());
    setMode("video");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetManualDraft = () => {
    clearManualDraft();
    if (manualCoverInputRef.current) manualCoverInputRef.current.value = "";
  };

  const openMediaPicker = useCallback(() => {
    setMode("video");
    window.setTimeout(() => {
      if (hasVideoTaskCapacity) {
        fileInputRef.current?.click();
        return;
      }

      toast.error(t("import.videoTaskLimitReached"));
    }, 120);
  }, [hasVideoTaskCapacity, setMode, t]);

  const validateFile = (file: File): string | null => {
    const validExts = /\.(mp4|mov|webm|mp3|wav|m4a|flac|aac)$/i;
    const validMimes = [
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/x-m4a",
      "audio/aac",
      "audio/flac",
      "audio/x-flac",
      "audio/webm",
    ];
    if (!validMimes.includes(file.type) && !validExts.test(file.name)) {
      return t("import.invalidMedia");
    }
    if (file.size > MAX_SIZE) {
      return t("import.fileTooLargeWithSize", { size: formatBytes(file.size) });
    }
    return null;
  };

  const selectFile = async (file: File) => {
    const fileError = validateFile(file);
    if (fileError) {
      toast.error(fileError);
      return;
    }
    if (!hasVideoTaskCapacity && (!currentTaskId || creatingNewVideoTaskRef.current)) {
      toast.error(t("import.videoTaskLimitReached"));
      return;
    }

    setMode("video");
    const baseSnapshot = createInitialVideoDraftSnapshot();
    const nextSnapshot: VideoImportDraftSnapshot = {
      ...baseSnapshot,
      selectedMediaFile: file,
    };
    const task = createVideoImportTask(file, nextSnapshot);
    await saveVideoImportTask(task);

    stopAnswerRecording();
    cleanupAnswerRecording();
    creatingNewVideoTaskRef.current = false;
    setCurrentTaskId(task.id);
    replaceVideoDraft(task.snapshot);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void selectFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void selectFile(file);
  };

  const askFollowUpQuestion = useCallback(
    async (index: number) => {
      const question = followUpQuestions[index];
      if (!question) return;
      if (!canUseVoiceFollowUp) {
        setFollowUpError(null);
        setFollowUpPrompt(question.question);
        setFollowUpStatus("idle");
        return;
      }
      stopAnswerRecording();
      cleanupAnswerRecording();
      setFollowUpError(null);
      setFollowUpPrompt(question.question);
      setFollowUpStatus("speaking");

      try {
        await speakWithElevenLabs(question.question, conversationVoiceId, language);
      } catch (err) {
        console.warn("Follow-up voice prompt failed:", err);
        toast.warning(t("import.followUpVoiceWarning"));
      } finally {
        setFollowUpStatus((current) => (current === "speaking" ? "listening" : current));
      }
    },
    [
      canUseVoiceFollowUp,
      cleanupAnswerRecording,
      conversationVoiceId,
      followUpQuestions,
      language,
      setFollowUpError,
      setFollowUpPrompt,
      setFollowUpStatus,
      stopAnswerRecording,
      t,
    ],
  );

  const isSkipAnswer = (value: string) => /^(跳过|不用|不需要|没有|无|skip)$/i.test(value.trim());

  const getAppliedAnswerPatch = (
    field: FollowUpField,
    answer: string,
  ): Partial<FollowUpAnswers> => ({
    [field]: isSkipAnswer(answer) ? "" : answer.trim(),
  });

  const startAnswerRecording = async () => {
    if (followUpStatus === "speaking" || followUpStatus === "refining") return;
    if (!canUseVoiceFollowUp) {
      toast.error(t("import.elevenLabsKeyMissing"));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      recorderStreamRef.current = stream;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];

      recorderRef.current = recorder;
      setFollowUpError(null);
      setFollowUpStatus("listening");

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onerror = () => {
        cleanupAnswerRecording();
        setFollowUpStatus("idle");
        toast.error(t("import.followUpRecordFailed"));
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });

        cleanupAnswerRecording();
        if (audioBlob.size === 0) {
          setFollowUpStatus("idle");
          return;
        }

        setFollowUpStatus("transcribing");
        try {
          const answer = (await transcribeWithElevenLabs(audioBlob, language)).trim();
          setFollowUpInput(answer);
          toast.success(t("import.followUpTranscriptReady"));
          if (shouldAutoListenFollowUpRef.current && answer) {
            await followUpSubmitRef.current?.(answer);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : t("import.followUpTranscribeFailed");
          setFollowUpError(message);
          toast.error(message);
        } finally {
          setFollowUpStatus((current) =>
            current === "transcribing"
              ? shouldAutoListenFollowUpRef.current
                ? "listening"
                : "idle"
              : current,
          );
        }
      };

      recorder.start();
      recorderTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 8000);
    } catch (err) {
      console.warn("Follow-up recording failed:", err);
      cleanupAnswerRecording();
      setFollowUpStatus("idle");
      toast.error(t("import.followUpRecordFailed"));
    }
  };

  const applyFollowUpAnswers = async (
    answers: FollowUpAnswers,
    options?: { markCompleted?: boolean },
  ) => {
    if (!structuredRecipe) return;
    setFollowUpStatus("refining");
    setFollowUpError(null);

    try {
      const llmService = await getConfiguredLLMService();
      const refinedRecipe = llmService
        ? ((await llmService.refineRecipeWithAnswers(
            structuredRecipe,
            answers,
          )) as StructuredRecipe)
        : null;
      const nextRecipe = cleanStructuredImportRecipe(
        mergeFollowUpRefinedRecipe(structuredRecipe, answers, refinedRecipe),
        language,
        transcript,
      );

      syncRecipeEditor(nextRecipe);
      setFollowUpCompleted(Boolean(options?.markCompleted));
      setFollowUpStatus("done");
      toast.success(t("import.followUpApplied"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("import.followUpApplyFailed");
      setFollowUpError(message);
      setFollowUpStatus("idle");
      toast.error(message);
    }
  };

  const submitFollowUpAnswer = async (rawAnswer: string) => {
    if (!currentFollowUp) return;
    const answer = rawAnswer.trim();
    if (!answer) return;

    const nextAnswers = {
      ...followUpAnswers,
      ...getAppliedAnswerPatch(currentFollowUp.field, answer),
    };

    setFollowUpAnswers(nextAnswers);
    setFollowUpProgress((current) => ({
      ...current,
      [currentFollowUp.field]: isSkipAnswer(answer) ? "skipped" : "answered",
    }));
    setFollowUpPrompt(currentFollowUp.question);
    await applyFollowUpAnswers(nextAnswers);

    if (followUpIndex < followUpQuestions.length - 1) {
      const nextIndex = followUpIndex + 1;
      setFollowUpIndex(nextIndex);
      setFollowUpInput(nextAnswers[followUpQuestions[nextIndex].field]);
      await askFollowUpQuestion(nextIndex);
      return;
    }

    setFollowUpInput("");
    setFollowUpStatus("done");
  };

  const handleFollowUpSubmit = async () => {
    await submitFollowUpAnswer(followUpInput);
  };

  useEffect(() => {
    followUpSubmitRef.current = submitFollowUpAnswer;
  });

  const handleFollowUpContinue = async () => {
    const answer = followUpInput.trim();
    const currentField = currentFollowUp?.field;

    let nextAnswers = followUpAnswers;

    if (currentField && answer) {
      nextAnswers = {
        ...followUpAnswers,
        ...getAppliedAnswerPatch(currentField, answer),
      };
      setFollowUpAnswers(nextAnswers);
      setFollowUpProgress((current) => ({
        ...current,
        [currentField]: isSkipAnswer(answer) ? "skipped" : "answered",
      }));
    } else if (currentField && followUpProgress[currentField] === "pending") {
      setFollowUpProgress((current) => ({
        ...current,
        [currentField]: "skipped",
      }));
    }

    await applyFollowUpAnswers(nextAnswers, { markCompleted: true });
  };

  const handleFollowUpSkip = async () => {
    if (!currentFollowUp) return;
    const nextAnswers = {
      ...followUpAnswers,
      [currentFollowUp.field]: "",
    };
    setFollowUpAnswers(nextAnswers);
    setFollowUpProgress((current) => ({
      ...current,
      [currentFollowUp.field]: "skipped",
    }));
    setFollowUpInput("");

    if (followUpIndex < followUpQuestions.length - 1) {
      const nextIndex = followUpIndex + 1;
      setFollowUpIndex(nextIndex);
      await askFollowUpQuestion(nextIndex);
      return;
    }

    setFollowUpStatus("done");
  };

  const startPipeline = async () => {
    if (!selectedMediaFile) return;
    if (!hasElevenLabsKey) {
      toast.error(t("import.elevenLabsKeyMissing"));
      return;
    }

    const pipelineRunId = (pipelineRunIdRef.current += 1);
    resetFollowUpFlow();
    setError(null);
    setTranscript("");
    setStructuredRecipe(null);
    setCoverImage(null);
    setVideoCoverSource("default");
    setEditTitle("");
    setEditIngredients([]);
    setEditSteps([]);
    setEditDifficulty("");
    setEditTotalTime("");

    try {
      setStage("transcribing");
      const elevenLabsKey = await getApiKey("elevenlabs");
      if (!elevenLabsKey) {
        throw new Error(t("import.elevenLabsKeyMissing"));
      }
      const sttService = new ElevenLabsService(elevenLabsKey);
      const rawTranscript = (await sttService.speechToText(selectedMediaFile)).trim();
      if (pipelineRunId !== pipelineRunIdRef.current) return;
      if (!rawTranscript) {
        throw new Error("Cannot structure recipe from empty transcript");
      }
      setTranscript(rawTranscript);

      setStage("structuring");
      let recipe: StructuredRecipe | null = null;
      const llmService = await getConfiguredLLMService();

      if (!llmService) {
        toast.warning(t("import.llmKeyWarning"));
      } else {
        recipe = cleanStructuredImportRecipe(
          (await llmService.structureRecipe(rawTranscript, language)) as StructuredRecipe,
          language,
          rawTranscript,
        );
        if (pipelineRunId !== pipelineRunIdRef.current) return;
        syncRecipeEditor(recipe);
      }

      if (pipelineRunId !== pipelineRunIdRef.current) return;
      setStage("preview");
    } catch (err) {
      if (pipelineRunId !== pipelineRunIdRef.current) return;
      const message = formatImportError(err, t("import.pipelineFailed"), t);
      setError(message);
      setStage("error");
      toast.error(message);
    }
  };

  const restructureVideoDraft = async () => {
    const rawTranscript = transcript.trim();
    if (!rawTranscript) return;

    const pipelineRunId = (pipelineRunIdRef.current += 1);
    resetFollowUpFlow();
    setError(null);
    setCoverImage(null);
    setVideoCoverSource("default");

    try {
      setStage("structuring");
      const llmService = await getConfiguredLLMService();
      if (!llmService) {
        throw new Error(t("import.manualTextLlmRequired"));
      }

      const recipe = cleanStructuredImportRecipe(
        (await llmService.structureRecipe(rawTranscript, language)) as StructuredRecipe,
        language,
        rawTranscript,
      );
      if (pipelineRunId !== pipelineRunIdRef.current) return;

      syncRecipeEditor(recipe);
      setStage("preview");
    } catch (err) {
      if (pipelineRunId !== pipelineRunIdRef.current) return;
      const message = formatImportError(err, t("import.pipelineFailed"), t);
      setError(message);
      setStage("error");
      toast.error(message);
    }
  };

  const handleSaveVideo = async () => {
    setStage("saving");
    try {
      const cleaned = cleanStructuredImportRecipe(
        {
          title: editTitle.trim() || structuredRecipe?.title?.trim() || "",
          ingredients: editIngredients.map((item) => ({ ...item })),
          steps: editSteps.map((item) => ({ ...item })),
          tags: {
            ...(structuredRecipe?.tags ?? {}),
            difficulty: editDifficulty || undefined,
            totalTimeMin: parsePositiveInt(editTotalTime),
          },
        },
        language,
        transcript,
      );
      const title =
        cleaned.title.trim() || structuredRecipe?.title?.trim() || t("import.untitledRecipe");
      const ingredients = cleaned.ingredients
        .map((item) => ({
          name: item.name.trim(),
          amount: item.amount.trim(),
        }))
        .filter((item) => item.name);
      const steps = cleaned.steps
        .map((step, index) => ({
          order: index + 1,
          description: step.description.trim(),
          durationSec: step.durationSec && step.durationSec > 0 ? step.durationSec : undefined,
          tips: step.tips?.trim() || undefined,
        }))
        .filter((step) => step.description);

      const totalTimeMin = cleaned.tags.totalTimeMin ?? parsePositiveInt(editTotalTime);

      const recipeId = await persistRecipe({
        title,
        ingredients,
        steps,
        tags: {
          ...(cleaned.tags ?? {}),
          difficulty: editDifficulty || undefined,
          totalTimeMin,
        },
        coverSource: coverImage ? videoCoverSource : "default",
        coverImage: coverImage ?? undefined,
        rawTranscript: transcript || undefined,
      });

      setStage("done");
      toast.success(t("import.recipeSaved"));
      window.setTimeout(() => {
        void navigate({ to: "/recipe-detail", search: { id: recipeId } });
        void clearCurrentVideoTask();
      }, 900);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("import.saveFailed");
      setError(message);
      setStage("error");
      toast.error(message);
    }
  };

  const handleSaveManual = async () => {
    const title = manualTitle.trim();
    if (!title) {
      toast.error(t("import.manualTitleRequired"));
      return;
    }

    const manualRecipe = cleanStructuredImportRecipe(
      {
        title,
        ingredients: manualIngredients.map((item) => ({
          name: item.name.trim(),
          amount: item.amount.trim(),
        })),
        steps: manualSteps.map((step, index) => {
          const durationMin = parsePositiveInt(step.durationMin);
          return {
            order: index + 1,
            description: step.description.trim(),
            durationSec: durationMin ? durationMin * 60 : undefined,
            tips: step.tips.trim() || undefined,
          };
        }),
        tags: {
          cuisine: manualCuisine.trim() || undefined,
          difficulty: manualDifficulty || undefined,
          flavor: manualFlavors
            .split(/[\uFF0C,]/)
            .map((item) => item.trim())
            .filter(Boolean),
          totalTimeMin: parsePositiveInt(manualTotalTime),
        },
      },
      language,
      manualRawText,
    );

    const ingredients = manualRecipe.ingredients.filter((item) => item.name);
    const steps = manualRecipe.steps.filter((step) => step.description);

    if (steps.length === 0) {
      toast.error(t("import.manualStepRequired"));
      return;
    }

    const flavors = manualRecipe.tags.flavor ?? [];
    const totalTimeMin = manualRecipe.tags.totalTimeMin ?? parsePositiveInt(manualTotalTime);

    setIsManualSaving(true);
    try {
      const recipeId = await persistRecipe({
        title: manualRecipe.title.trim() || title,
        ingredients,
        steps,
        tags: {
          cuisine: manualRecipe.tags.cuisine ?? (manualCuisine.trim() || undefined),
          difficulty: manualDifficulty || undefined,
          flavor: flavors.length > 0 ? flavors : undefined,
          totalTimeMin,
        },
        coverSource: manualCoverImage ? manualCoverSource : "default",
        coverImage: manualCoverImage ?? undefined,
      });

      toast.success(t("import.manualSaved"));
      window.setTimeout(() => {
        void navigate({ to: "/recipe-detail", search: { id: recipeId } });
        clearManualDraft();
      }, 900);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("import.saveFailed");
      toast.error(message);
    } finally {
      setIsManualSaving(false);
    }
  };

  const applyStructuredRecipeToManualForm = (recipe: StructuredRecipe) => {
    const tags = recipe.tags ?? {};
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    const steps = Array.isArray(recipe.steps) ? recipe.steps : [];

    setManualTitle(recipe.title?.trim() ?? "");
    setManualCuisine(tags.cuisine?.trim() ?? "");
    setManualDifficulty(tags.difficulty ?? "");
    setManualTotalTime(tags.totalTimeMin && tags.totalTimeMin > 0 ? String(tags.totalTimeMin) : "");
    setManualFlavors(tags.flavor?.join("、") ?? "");
    setManualIngredients(
      ingredients.length > 0
        ? ingredients.map((item) => ({
            name: item.name ?? "",
            amount: item.amount ?? "",
          }))
        : [createEmptyIngredient()],
    );
    setManualSteps(
      steps.length > 0
        ? steps.map((step) => ({
            description: step.description ?? "",
            durationMin: formatDurationMinutesInput(step.durationSec),
            tips: step.tips ?? "",
          }))
        : [createEmptyManualStep()],
    );
  };

  const resetManualTextDialog = () => {
    setManualRawText("");
    setManualTextImportStatus("idle");
    setManualTextImportError(null);
    setIsManualTextDialogOpen(false);
  };

  const handleStructureManualText = async () => {
    const rawText = manualRawText.trim();
    if (!rawText) {
      toast.error(t("import.manualTextRequired"));
      return;
    }
    if (!canStructureWithLlm) {
      toast.error(t("import.manualTextLlmRequired"));
      return;
    }

    setManualTextImportStatus("structuring");
    setManualTextImportError(null);

    try {
      const llmService = await getConfiguredLLMService();
      if (!llmService) {
        throw new Error(t("import.manualTextLlmRequired"));
      }

      const recipe = (await llmService.structureRecipeFromText(
        rawText,
        language,
      )) as StructuredRecipe;
      applyStructuredRecipeToManualForm(cleanStructuredImportRecipe(recipe, language, rawText));
      resetManualTextDialog();
      toast.success(t("import.manualTextStructured"));
    } catch (err) {
      const message = formatImportError(err, t("import.manualTextStructureFailed"), t);
      setManualTextImportStatus("idle");
      setManualTextImportError(message);
      toast.error(message);
    }
  };

  const handleCoverInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("import.invalidCover"));
      e.target.value = "";
      return;
    }
    setCoverImage(file);
    setVideoCoverSource("user");
    e.target.value = "";
  };

  const handleManualCoverInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("import.invalidCover"));
      e.target.value = "";
      return;
    }
    setManualCoverImage(file);
    setManualCoverSource("user");
    e.target.value = "";
  };

  const handleRegenerateCover = async () => {
    if (!structuredRecipe) return;
    if (!canGenerateAiCover) {
      toast.error(t("import.coverGenerationUnavailable"));
      return;
    }

    try {
      const llmService = await getConfiguredLLMService();
      const imageKey = await getApiKey("imagegen-key");
      const imageEndpoint = await getApiKey("imagegen-endpoint");
      const imageModel = await getApiKey("imagegen-model");

      if (!llmService || !imageKey || !imageEndpoint) {
        toast.error(t("import.coverGenerationUnavailable"));
        return;
      }

      setStage("generating-cover");
      const imgService = new ImageGenService(
        imageEndpoint,
        imageKey,
        imageModel?.trim() || DEFAULT_IMAGE_MODEL,
      );
      const prompt = await llmService.generateCoverPrompt(structuredRecipe.title);
      const cover = await imgService.generateImage(prompt);
      setCoverImage(cover);
      setVideoCoverSource("ai");
      setStage("preview");
      toast.success(t("import.coverGenerated"));
    } catch (err) {
      const message = formatCoverGenerationError(err, t);
      setStage("preview");
      toast.error(message);
    }
  };

  const handleRegenerateManualCover = async () => {
    const title = manualTitle.trim();
    if (!title) {
      toast.error(t("import.manualTitleRequired"));
      return;
    }
    if (!canGenerateAiCover) {
      toast.error(t("import.coverGenerationUnavailable"));
      return;
    }

    setIsManualGeneratingCover(true);

    try {
      const llmService = await getConfiguredLLMService();
      const imageKey = await getApiKey("imagegen-key");
      const imageEndpoint = await getApiKey("imagegen-endpoint");
      const imageModel = await getApiKey("imagegen-model");

      if (!llmService || !imageKey || !imageEndpoint) {
        toast.error(t("import.coverGenerationUnavailable"));
        return;
      }

      const imgService = new ImageGenService(
        imageEndpoint,
        imageKey,
        imageModel?.trim() || DEFAULT_IMAGE_MODEL,
      );
      const prompt = await llmService.generateCoverPrompt(title);
      const cover = await imgService.generateImage(prompt);
      setManualCoverImage(cover);
      setManualCoverSource("ai");
      toast.success(t("import.coverGenerated"));
    } catch (err) {
      const message = formatCoverGenerationError(err, t);
      toast.error(message);
    } finally {
      setIsManualGeneratingCover(false);
    }
  };

  useEffect(() => {
    return () => {
      stopAnswerRecording();
      cleanupAnswerRecording();
    };
  }, [cleanupAnswerRecording, stopAnswerRecording]);

  useEffect(() => {
    const handleVoicePageAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "select-media") openMediaPicker();
    };

    window.addEventListener("cooktalk:voice-page-action", handleVoicePageAction);
    return () => window.removeEventListener("cooktalk:voice-page-action", handleVoicePageAction);
  }, [openMediaPicker]);

  useEffect(() => {
    if (!ENABLE_GUIDED_FOLLOW_UPS) return;

    const handleVoiceCommand = (event: Event) => {
      const isFollowUpActive = Boolean(
        structuredRecipe &&
        (stage === "preview" || stage === "saving" || stage === "done") &&
        !followUpCompleted,
      );
      if (!isFollowUpActive || !currentFollowUp || followUpBusy) return;
      const transcript = (event as CustomEvent<{ transcript?: string }>).detail?.transcript?.trim();
      if (!transcript) return;
      const text = normalizeSpeechText(transcript);

      if (
        /(open|go to|show|back|upload|delete|save|recipe|选择|上传|返回|删除|保存|菜谱)/i.test(text)
      ) {
        return;
      }

      event.preventDefault();
      void submitFollowUpAnswer(transcript);
    };

    window.addEventListener("cooktalk:voice-command", handleVoiceCommand);
    return () => window.removeEventListener("cooktalk:voice-command", handleVoiceCommand);
  }, [
    currentFollowUp,
    followUpBusy,
    followUpCompleted,
    stage,
    structuredRecipe,
    submitFollowUpAnswer,
  ]);

  useEffect(() => {
    if (!coverImage) {
      setCoverPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(coverImage);
    setCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverImage]);

  useEffect(() => {
    if (!manualCoverImage) {
      setManualCoverPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(manualCoverImage);
    setManualCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [manualCoverImage]);

  useEffect(() => {
    if (!ENABLE_GUIDED_FOLLOW_UPS) return;
    if (stage !== "preview" || !structuredRecipe || followUpStarted) return;

    setFollowUpStarted(true);
    setFollowUpIndex(0);
    setFollowUpInput("");
    if (canUseVoiceFollowUp) {
      shouldAutoListenFollowUpRef.current = true;
      void askFollowUpQuestion(0);
    } else {
      setFollowUpPrompt(followUpQuestions[0]?.question ?? "");
    }
  }, [
    askFollowUpQuestion,
    canUseVoiceFollowUp,
    followUpQuestions,
    followUpStarted,
    setFollowUpIndex,
    setFollowUpInput,
    setFollowUpStarted,
    setFollowUpPrompt,
    stage,
    structuredRecipe,
  ]);

  useEffect(() => {
    if (!ENABLE_GUIDED_FOLLOW_UPS) return;
    if (!shouldAutoListenFollowUpRef.current) return;
    if (!canUseVoiceFollowUp || followUpCompleted || !currentFollowUp) return;
    if (followUpStatus !== "listening") return;
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;

    void startAnswerRecording();
  }, [canUseVoiceFollowUp, currentFollowUp, followUpCompleted, followUpStatus]);

  useEffect(() => {
    if (!currentTaskId) return;
    const baseTask = videoTasks.find((task) => task.id === currentTaskId);
    if (!baseTask || !hasVideoDraftContent(videoDraftSnapshot)) return;

    const nextTask = updateVideoImportTask(baseTask, videoDraftSnapshot);
    const nextSignature = `${nextTask.id}:${getVideoDraftSignature(nextTask.snapshot)}`;
    if (lastSavedTaskSignatureRef.current === nextSignature) return;

    lastSavedTaskSignatureRef.current = nextSignature;
    void saveVideoImportTask(nextTask);
  }, [currentTaskId, videoDraftSnapshot, videoTasks]);

  const isRunning = ["transcribing", "structuring", "generating-cover", "saving"].includes(stage);
  const activeIdx = stageToIndex[stage];
  const previewRecipe = structuredRecipe
    ? {
        title: editTitle.trim() || structuredRecipe.title,
        ingredients: editIngredients,
        steps: editSteps,
        tags: {
          ...structuredRecipe.tags,
          difficulty: editDifficulty || undefined,
          totalTimeMin: parsePositiveInt(editTotalTime),
        },
      }
    : null;

  const isPreviewStage = stage === "preview" || stage === "saving" || stage === "done";
  const isGeneratingCover = stage === "generating-cover";
  const showGuidedFollowUp = Boolean(
    ENABLE_GUIDED_FOLLOW_UPS && previewRecipe && isPreviewStage && !followUpCompleted,
  );
  const showGuidedCover = Boolean(previewRecipe && isPreviewStage);
  const showVideoEditIngredients = shouldShowIngredients(videoEditDisplayMode);
  const showVideoEditSteps = shouldShowSteps(videoEditDisplayMode);
  const showManualIngredients = shouldShowIngredients(manualDisplayMode);
  const showManualSteps = shouldShowSteps(manualDisplayMode);
  const answeredFollowUpCount = followUpQuestions.filter(
    (item) => followUpProgress[item.field] !== "pending",
  ).length;
  const isManualTextStructuring = manualTextImportStatus === "structuring";
  const canStructureWithLlm = hasLlmKey;
  const canGenerateAiCover = hasLlmKey && hasImageGenKey;
  const canCreateAnotherVideoTask = hasVideoTaskCapacity;
  const videoTasksPanel = (
    <div className="flex min-h-[34rem] flex-col rounded-[2rem] border border-border bg-card p-5 sm:min-h-[38rem] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            {t("import.videoTasksKicker")}
          </div>
          <h3 className="mt-2 font-display text-2xl">{t("import.videoTasksTitle")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("import.videoTasksDescription", {
              count: videoTasks.length,
              max: MAX_VIDEO_IMPORT_TASKS,
            })}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-clay/25 bg-clay/10 px-4 py-2 text-xs text-clay">
          {videoTasks.length}/{MAX_VIDEO_IMPORT_TASKS}
        </span>
      </div>

      {videoTasks.length > 0 ? (
        <div className="mt-5 space-y-3 overflow-y-auto pr-1">
          {videoTasks.map((task) => {
            const isActiveTask = task.id === currentTaskId;
            const displayTitle = deriveTaskDisplayTitle(task.snapshot, task.fileName);
            const showFileName = displayTitle !== task.fileName;

            return (
              <div
                key={task.id}
                className={`rounded-[1.5rem] border p-4 text-left transition-colors ${
                  isActiveTask
                    ? "border-clay bg-clay/5"
                    : "cursor-pointer border-border bg-background/70 hover:border-foreground/35"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => void loadVideoTask(task.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  void loadVideoTask(task.id);
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{displayTitle}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {showFileName ? `${task.fileName} · ` : ""}
                      {formatBytes(task.fileSize)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs hover:border-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        void loadVideoTask(task.id);
                      }}
                    >
                      {isActiveTask ? t("import.videoTaskCurrent") : t("import.videoTaskResume")}
                    </button>
                    <AppTooltip content={t("import.videoTaskDelete")} side="top" align="end">
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteVideoTask(task.id);
                        }}
                        aria-label={t("import.videoTaskDelete")}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </AppTooltip>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex items-center gap-3">
                    <span className="min-w-8 text-xs text-muted-foreground">
                      {task.progressPercent}%
                    </span>
                    <Progress value={task.progressPercent} className="h-2.5 flex-1" />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{t(task.progressLabelKey)}</span>
                    {task.snapshot.error ? (
                      <span className="truncate text-destructive">{task.snapshot.error}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-[1.5rem] border border-dashed border-border bg-background/50 p-5 text-sm text-muted-foreground">
          {t("import.videoTasksEmpty")}
        </div>
      )}

      {!canCreateAnotherVideoTask && (
        <div className="mt-4 rounded-2xl border border-amber-300/40 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t("import.videoTaskLimitReached")}
        </div>
      )}
    </div>
  );

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <span className="page-kicker">{t("import.subtitle")}</span>
              <h1 className="page-title">{t("import.title")}</h1>
              <p className="page-description">
                {t("import.description")} {t("import.orSay")}{" "}
                <span className="font-mono text-foreground">"{t("import.importNewRecipe")}"</span>
              </p>
            </div>

            <div className="flex w-fit shrink-0 flex-col items-start gap-3 lg:mt-6 lg:items-end">
              <button
                type="button"
                onClick={() => navigate({ to: "/recipes" })}
                className="inline-flex items-center gap-2 rounded-full border border-clay/30 bg-clay/10 px-4 py-2 text-sm text-clay transition-colors hover:border-clay/50 hover:bg-clay/15"
              >
                {t("import.viewRecipes")}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </button>

              <div className="inline-flex rounded-full border border-border bg-card p-1">
                <button
                  type="button"
                  data-voice-label={t("import.videoMode")}
                  data-voice-aliases="视频模式 导入视频 上传视频 选择视频 video mode import video upload video"
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                    mode === "video"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setMode("video")}
                >
                  <FileVideo className="h-4 w-4" strokeWidth={1.75} />
                  {t("import.videoMode")}
                </button>
                <button
                  type="button"
                  data-voice-label={t("import.manualMode")}
                  data-voice-aliases="手动模式 手动录入 手动添加菜谱 manual mode add manually"
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                    mode === "manual"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setMode("manual")}
                >
                  <FileText className="h-4 w-4" strokeWidth={1.75} />
                  {t("import.manualMode")}
                </button>
              </div>
            </div>
          </div>

        </div>
      </section>

      <section className="flex-1">
        <div className="page-content-container">
          <div className="grid gap-8 lg:grid-cols-12">
            <div
              className={`min-w-0 space-y-6 ${
                mode === "video" ? "lg:col-span-8 xl:col-span-8" : "lg:col-span-8"
              }`}
            >
              {mode === "video" && stage === "idle" && (
                <>
                  <div
                    className={`relative flex min-h-[34rem] flex-col justify-center rounded-[2rem] border-2 border-dashed p-6 text-center transition-colors sm:min-h-[38rem] sm:p-14 ${
                      isDragging
                        ? "border-clay bg-clay/5"
                        : "border-border bg-card hover:border-clay/60"
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={openMediaPicker}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openMediaPicker();
                      }
                    }}
                    role="button"
                    tabIndex={canCreateAnotherVideoTask ? 0 : -1}
                    aria-disabled={!canCreateAnotherVideoTask}
                    aria-label={t("import.chooseMedia")}
                    data-voice-label={t("import.chooseMedia")}
                    data-voice-aliases="选择媒体 选择视频 上传视频 导入视频 上传音频 选择音频 select media choose media upload video import video choose video"
                  >
                    <VoiceBadge n={1} className="absolute left-5 top-5" />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/flac,audio/x-flac,audio/webm,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.flac"
                      className="hidden"
                      onClick={(event) => event.stopPropagation()}
                      onChange={handleInputChange}
                    />
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-foreground/30 bg-background">
                      <FileVideo className="h-9 w-9" strokeWidth={1.25} />
                    </div>
                    {selectedMediaFile ? (
                      <>
                        <h3 className="mx-auto mt-6 max-w-xl break-words font-display text-2xl sm:text-3xl">
                          {selectedMediaFile.name}
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {formatBytes(selectedMediaFile.size)}
                        </p>
                        <button
                          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay sm:w-auto"
                          data-voice-label={t("import.startProcessing")}
                          data-voice-aliases="开始处理 开始转菜谱 处理视频 提取菜谱 start processing process video extract recipe"
                          onClick={(e) => {
                            e.stopPropagation();
                            void startPipeline();
                          }}
                          disabled={!hasElevenLabsKey}
                        >
                          <Wand2 className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.startProcessing")}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="mt-6 text-sm font-medium leading-tight text-foreground sm:text-base">
                          {t("import.dropMedia")}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {t("import.orClickBrowse")}
                        </p>
                        <button
                          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay sm:w-auto"
                          onClick={(e) => {
                            e.stopPropagation();
                            openMediaPicker();
                          }}
                          disabled={!canCreateAnotherVideoTask}
                          data-voice-label={t("import.chooseMedia")}
                          data-voice-aliases="选择媒体 选择视频 上传视频 导入视频 上传音频 选择音频 select media choose media upload video import video choose video"
                        >
                          <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.chooseMedia")}
                        </button>
                      </>
                    )}
                    <div className="mt-4 flex justify-center">
                      <VoiceHint>{t("import.orSaySelect")}</VoiceHint>
                    </div>
                    {!canCreateAnotherVideoTask && (
                      <p className="mt-4 text-sm text-destructive">
                        {t("import.videoTaskLimitReached")}
                      </p>
                    )}
                  </div>
                </>
              )}

              {mode === "video" && (stage === "transcribing" || stage === "structuring") && (
                <div className="rounded-[2rem] border border-border bg-card p-8 text-center sm:p-12">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-foreground/30 bg-background">
                    <Loader2 className="h-9 w-9 animate-spin" strokeWidth={1.25} />
                  </div>
                  <span className="mt-6 inline-block text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    {t("import.guided.step2Label")}
                  </span>
                  <h3 className="mt-2 font-display text-2xl sm:text-3xl">
                    {stageLabelKeys[stage] ? t(stageLabelKeys[stage]) : ""}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">{selectedMediaFile?.name}</p>
                  <div className="mt-8 flex justify-center gap-2">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`h-2 w-16 rounded-full ${i <= activeIdx ? "bg-clay" : "bg-border"}`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-5 py-3 text-sm hover:border-foreground sm:w-auto"
                    onClick={() => void returnToUploadStep()}
                    data-voice-label={t("import.backToUploadStep")}
                    data-voice-aliases="返回上传 返回选择文件 回到上传文件 重新选择文件 back to upload choose another file"
                  >
                    <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
                    {t("import.backToUploadStep")}
                  </button>
                  <p className="mx-auto mt-3 max-w-md text-xs text-muted-foreground">
                    {t("import.backToUploadStepHint")}
                  </p>
                </div>
              )}

              {mode === "video" && stage === "error" && (
                <div className="rounded-[2rem] border border-destructive/40 bg-destructive/5 p-8 text-center sm:p-12">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-destructive/30">
                    <XCircle className="h-9 w-9 text-destructive" strokeWidth={1.25} />
                  </div>
                  <h3 className="mt-6 font-display text-2xl text-destructive sm:text-3xl">
                    {t("import.failed")}
                  </h3>
                  <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{error}</p>
                  <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay sm:w-auto"
                      onClick={() => void startPipeline()}
                      disabled={!hasElevenLabsKey}
                    >
                      {t("import.retry")}
                    </button>
                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-6 py-3 text-sm hover:border-foreground sm:w-auto"
                      onClick={() => void returnToUploadStep()}
                      data-voice-label={t("import.backToUploadStep")}
                      data-voice-aliases="返回上传 返回选择文件 回到上传文件 重新选择文件 back to upload choose another file"
                    >
                      <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
                      {t("import.backToUploadStep")}
                    </button>
                  </div>
                </div>
              )}

              {mode === "video" && isPreviewStage && previewRecipe && showGuidedFollowUp && (
                <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                        {t("import.guided.step3Label")}
                      </span>
                      <h3 className="mt-2 font-display text-2xl sm:text-3xl">
                        {t("import.guided.step3Title")}
                      </h3>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-full border border-clay/25 bg-clay/10 px-4 py-2 text-xs text-clay">
                      <MessageCircleMore className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {answeredFollowUpCount}/{followUpQuestions.length}
                    </span>
                  </div>

                  <div className="mt-8 rounded-[1.75rem] border border-border bg-background/70 p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                          {t("import.transcriptionPreview")}
                        </div>
                        <h4 className="mt-2 break-words font-display text-2xl sm:text-3xl">
                          {previewRecipe.title}
                        </h4>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-clay/25 bg-clay/10 px-3 py-1.5 text-xs text-clay">
                        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {t("import.followUpPending")}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {previewRecipe.tags.cuisine && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {previewRecipe.tags.cuisine}
                        </span>
                      )}
                      {previewRecipe.tags.difficulty && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {t(`recipes.difficulty.${previewRecipe.tags.difficulty}`)}
                        </span>
                      )}
                      {previewRecipe.tags.totalTimeMin && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {t("recipes.minutes", { count: previewRecipe.tags.totalTimeMin })}
                        </span>
                      )}
                      {previewRecipe.tags.servings && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {t("recipeDetail.serves", { count: previewRecipe.tags.servings })}
                        </span>
                      )}
                      {previewRecipe.tags.spiceLevel && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {previewRecipe.tags.spiceLevel}
                        </span>
                      )}
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t("import.manualDifficulty")}
                        </span>
                        <Select
                          value={editDifficulty || EMPTY_MANUAL_DIFFICULTY_VALUE}
                          onValueChange={(value) =>
                            setEditDifficulty(
                              value === EMPTY_MANUAL_DIFFICULTY_VALUE
                                ? ""
                                : (value as ManualDifficulty),
                            )
                          }
                        >
                          <SelectTrigger className="h-11 rounded-2xl border-border bg-background text-sm">
                            <SelectValue placeholder={t("import.manualDifficultyPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={EMPTY_MANUAL_DIFFICULTY_VALUE}>
                              {t("import.manualDifficultyPlaceholder")}
                            </SelectItem>
                            <SelectItem value="easy">{t("recipes.difficulty.easy")}</SelectItem>
                            <SelectItem value="medium">{t("recipes.difficulty.medium")}</SelectItem>
                            <SelectItem value="hard">{t("recipes.difficulty.hard")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>

                      <label className="space-y-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t("import.manualTotalTime")}
                        </span>
                        <input
                          className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay"
                          value={editTotalTime}
                          onChange={(e) => setEditTotalTime(e.target.value)}
                          placeholder={t("import.manualTotalTimePlaceholder")}
                          inputMode="numeric"
                        />
                      </label>
                    </div>

                    {previewRecipe.tags.notes && (
                      <div className="mt-6 rounded-2xl border border-clay/20 bg-clay/8 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-clay">
                          {t("import.followUp.notesLabel")}
                        </div>
                        <p className="mt-2 text-sm text-foreground/85">
                          {previewRecipe.tags.notes}
                        </p>
                      </div>
                    )}

                    <div className="mt-6 flex justify-center sm:justify-end">
                      <RecipeContentDisplayToggle
                        value={videoEditDisplayMode}
                        onChange={setVideoEditDisplayMode}
                        allLabel={t("recipeContentDisplay.all")}
                        ingredientsLabel={t("recipeContentDisplay.ingredientsOnly")}
                        stepsLabel={t("recipeContentDisplay.stepsOnly")}
                        ariaLabel={t("recipeContentDisplay.ariaLabel")}
                      />
                    </div>

                    <div className={`mt-8 ${showVideoEditIngredients ? "" : "hidden"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <h5 className="text-sm font-medium">{t("import.manualIngredients")}</h5>
                          <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                            {previewRecipe.ingredients.length}
                          </span>
                        </div>
                        <button
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                          onClick={addEditIngredient}
                          type="button"
                          data-voice-label={t("import.manualAddIngredient")}
                          data-voice-aliases="添加食材 新增食材 add ingredient"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.manualAddIngredient")}
                        </button>
                      </div>
                      <div className="mt-4 space-y-3">
                        {previewRecipe.ingredients.map((ingredient, index) => (
                          <div
                            key={`${ingredient.name}-${index}`}
                            className="group rounded-2xl border border-border bg-background p-4"
                            onBlur={(event) => handleEditIngredientBlur(event, index)}
                          >
                            <div className="grid gap-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                  {t("import.manualIngredients")}
                                </span>
                                {previewRecipe.ingredients.length > 1 && (
                                  <button
                                    className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                    onClick={() => removeEditIngredient(index)}
                                    type="button"
                                  >
                                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                                  </button>
                                )}
                              </div>
                              <input
                                ref={(node) => {
                                  editIngredientNameRefs.current[index] = node;
                                }}
                                className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                                value={editIngredients[index]?.name ?? ""}
                                onChange={(e) =>
                                  updateEditIngredient(index, { name: e.target.value })
                                }
                                placeholder={t("import.manualIngredientName")}
                              />
                              <input
                                className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                                value={editIngredients[index]?.amount ?? ""}
                                onChange={(e) =>
                                  updateEditIngredient(index, { amount: e.target.value })
                                }
                                placeholder={t("import.manualIngredientAmount")}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={`mt-8 ${showVideoEditSteps ? "" : "hidden"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <h5 className="text-sm font-medium">{t("import.manualSteps")}</h5>
                          <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                            {previewRecipe.steps.length}
                          </span>
                        </div>
                        <button
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                          onClick={addEditStep}
                          type="button"
                          data-voice-label={t("import.manualAddStep")}
                          data-voice-aliases="添加步骤 新增步骤 add step"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.manualAddStep")}
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {previewRecipe.steps.map((step, index) => (
                          <div
                            key={index}
                            className="group rounded-2xl border border-border bg-background p-4"
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const fromIndex = draggedEditStepIndexRef.current;
                              if (fromIndex !== null) moveEditStep(fromIndex, index);
                              draggedEditStepIndexRef.current = null;
                            }}
                            onBlur={(event) => handleEditStepBlur(event, index)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <button
                                  className="-ml-1 inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-full border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
                                draggable
                                onDragStart={(event) => {
                                  draggedEditStepIndexRef.current = index;
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", String(index));
                                }}
                                onDragEnd={() => {
                                  draggedEditStepIndexRef.current = null;
                                }}
                                type="button"
                              >
                                <GripVertical className="h-4 w-4" strokeWidth={1.75} />
                                </button>
                                <span className="font-display text-sm">
                                  {t("import.step", { count: index + 1 })}
                                </span>
                              </div>
                              {previewRecipe.steps.length > 1 && (
                                <button
                                  className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                  onClick={() => removeEditStep(index)}
                                  type="button"
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                                </button>
                              )}
                            </div>

                            <div className="mt-3">
                              <StepDescriptionField
                                textareaRef={(node) => {
                                  editStepDescriptionRefs.current[index] = node;
                                }}
                                value={editSteps[index]?.description ?? ""}
                                onChange={(value) => updateEditStep(index, { description: value })}
                                placeholder={t("import.manualStepDescription")}
                              />
                            </div>

                            <div className="mt-3">
                              <StepMetadataFields
                                t={t}
                                durationValue={formatDurationMinutesInput(
                                  editSteps[index]?.durationSec,
                                )}
                                tipsValue={editSteps[index]?.tips ?? ""}
                                onDurationChange={(value) =>
                                  updateEditStep(index, {
                                    durationSec: parseDurationMinutesInput(value),
                                  })
                                }
                                onTipsChange={(value) => updateEditStep(index, { tips: value })}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <RecipeEditShortcuts
                      ingredientCount={editIngredients.length}
                      stepCount={editSteps.length}
                      ingredientsLabel={t("import.manualIngredients")}
                      stepsLabel={t("import.manualSteps")}
                      jumpLabel={t("import.editShortcutsJump")}
                      itemPlaceholder={t("import.editShortcutsItemPlaceholder")}
                      saveLabel={t("import.nextStep")}
                      savingLabel={t("import.saving")}
                      onJumpIngredient={jumpToEditIngredient}
                      onJumpStep={jumpToEditStep}
                      onSave={() => void handleSaveVideo()}
                      disabled={stage === "saving" || stage === "done"}
                      saving={stage === "saving"}
                      saveIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
                      saveVoiceAliases="下一步 继续 next step continue"
                      actions={[
                        {
                          label: t("import.restructure"),
                          onClick: () => void restructureVideoDraft(),
                          icon: <Wand2 className="h-4 w-4" strokeWidth={1.75} />,
                          disabled: !transcript.trim(),
                          voiceAliases: "restructure recipe organize recipe again",
                        },
                        {
                          label: t("import.backToUploadStep"),
                          onClick: () => void returnToUploadStep(),
                          icon: <RotateCcw className="h-4 w-4" strokeWidth={1.75} />,
                          voiceAliases: "back to upload choose another file",
                        },
                      ]}
                    />
                  </div>
                </div>
              )}

              {mode === "video" && isPreviewStage && previewRecipe && showGuidedCover && (
                <>
                  <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                          {t("import.guided.step3Label")}
                        </span>
                        <h3 className="mt-2 font-display text-2xl sm:text-3xl">
                          {t("import.readyToSave")}
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {t("import.step4Helper")}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-clay/25 bg-clay/10 px-3 py-1.5 text-xs text-clay">
                        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {t("import.followUpAppliedBadge")}
                      </span>
                    </div>

                    <input
                      className="mt-6 w-full rounded-2xl border border-border bg-background px-4 py-3 font-display text-2xl outline-none focus:border-clay"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />

                    <div className="mt-4 flex flex-wrap gap-2">
                      {previewRecipe.tags.cuisine && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {previewRecipe.tags.cuisine}
                        </span>
                      )}
                      {previewRecipe.tags.difficulty && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {t(`recipes.difficulty.${previewRecipe.tags.difficulty}`)}
                        </span>
                      )}
                      {previewRecipe.tags.totalTimeMin && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {t("recipes.minutes", { count: previewRecipe.tags.totalTimeMin })}
                        </span>
                      )}
                      {previewRecipe.tags.servings && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {t("recipeDetail.serves", { count: previewRecipe.tags.servings })}
                        </span>
                      )}
                      {previewRecipe.tags.spiceLevel && (
                        <span className="rounded-full border border-border px-3 py-1 text-xs">
                          {previewRecipe.tags.spiceLevel}
                        </span>
                      )}
                    </div>

                    {previewRecipe.tags.notes && (
                      <div className="mt-6 rounded-2xl border border-clay/20 bg-clay/8 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-clay">
                          {t("import.followUp.notesLabel")}
                        </div>
                        <p className="mt-2 text-sm text-foreground/85">
                          {previewRecipe.tags.notes}
                        </p>
                      </div>
                    )}

                    <div className="mt-6 flex justify-center sm:justify-end">
                      <RecipeContentDisplayToggle
                        value={videoEditDisplayMode}
                        onChange={setVideoEditDisplayMode}
                        allLabel={t("recipeContentDisplay.all")}
                        ingredientsLabel={t("recipeContentDisplay.ingredientsOnly")}
                        stepsLabel={t("recipeContentDisplay.stepsOnly")}
                        ariaLabel={t("recipeContentDisplay.ariaLabel")}
                      />
                    </div>

                    <div className={`mt-8 ${showVideoEditIngredients ? "" : "hidden"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <h5 className="text-sm font-medium">{t("import.manualIngredients")}</h5>
                          <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                            {previewRecipe.ingredients.length}
                          </span>
                        </div>
                        <button
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                          onClick={addEditIngredient}
                          type="button"
                          data-voice-label={t("import.manualAddIngredient")}
                          data-voice-aliases="添加食材 新增食材 add ingredient"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.manualAddIngredient")}
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {previewRecipe.ingredients.map((ingredient, index) => (
                          <div
                            key={`${ingredient.name}-${index}`}
                            className="group rounded-2xl border border-border bg-background p-3"
                            onBlur={(event) => handleEditIngredientBlur(event, index)}
                          >
                            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                              <input
                                ref={(node) => {
                                  editIngredientNameRefs.current[index] = node;
                                }}
                                className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                                value={editIngredients[index]?.name ?? ""}
                                onChange={(e) =>
                                  updateEditIngredient(index, { name: e.target.value })
                                }
                                placeholder={t("import.manualIngredientName")}
                              />
                              <input
                                className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                                value={editIngredients[index]?.amount ?? ""}
                                onChange={(e) =>
                                  updateEditIngredient(index, { amount: e.target.value })
                                }
                                placeholder={t("import.manualIngredientAmount")}
                              />
                              {previewRecipe.ingredients.length > 1 && (
                                <button
                                  className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                  onClick={() => removeEditIngredient(index)}
                                  type="button"
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={`mt-8 ${showVideoEditSteps ? "" : "hidden"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <h5 className="text-sm font-medium">{t("import.manualSteps")}</h5>
                          <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                            {previewRecipe.steps.length}
                          </span>
                        </div>
                        <button
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                          onClick={addEditStep}
                          type="button"
                          data-voice-label={t("import.manualAddStep")}
                          data-voice-aliases="添加步骤 新增步骤 add step"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.manualAddStep")}
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {previewRecipe.steps.map((step, index) => (
                          <div
                            key={index}
                            className="group rounded-2xl border border-border bg-background p-4"
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const fromIndex = draggedEditStepIndexRef.current;
                              if (fromIndex !== null) moveEditStep(fromIndex, index);
                              draggedEditStepIndexRef.current = null;
                            }}
                            onBlur={(event) => handleEditStepBlur(event, index)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <button
                                  className="-ml-1 inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-full border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
                                draggable
                                onDragStart={(event) => {
                                  draggedEditStepIndexRef.current = index;
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", String(index));
                                }}
                                onDragEnd={() => {
                                  draggedEditStepIndexRef.current = null;
                                }}
                                type="button"
                              >
                                <GripVertical className="h-4 w-4" strokeWidth={1.75} />
                                </button>
                                <span className="font-display text-sm">
                                  {t("import.step", { count: index + 1 })}
                                </span>
                              </div>
                              {previewRecipe.steps.length > 1 && (
                                <button
                                  className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                  onClick={() => removeEditStep(index)}
                                  type="button"
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                                </button>
                              )}
                            </div>

                            <div className="mt-3">
                              <StepDescriptionField
                                textareaRef={(node) => {
                                  editStepDescriptionRefs.current[index] = node;
                                }}
                                value={editSteps[index]?.description ?? ""}
                                onChange={(value) => updateEditStep(index, { description: value })}
                                placeholder={t("import.manualStepDescription")}
                              />
                            </div>

                            <div className="mt-3">
                              <StepMetadataFields
                                  t={t}
                                  durationValue={formatDurationMinutesInput(
                                    editSteps[index]?.durationSec,
                                  )}
                                  tipsValue={editSteps[index]?.tips ?? ""}
                                  onDurationChange={(value) =>
                                    updateEditStep(index, {
                                      durationSec: parseDurationMinutesInput(value),
                                    })
                                  }
                                  onTipsChange={(value) => updateEditStep(index, { tips: value })}
                                />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <RecipeEditShortcuts
                      ingredientCount={editIngredients.length}
                      stepCount={editSteps.length}
                      ingredientsLabel={t("import.manualIngredients")}
                      stepsLabel={t("import.manualSteps")}
                      jumpLabel={t("import.editShortcutsJump")}
                      itemPlaceholder={t("import.editShortcutsItemPlaceholder")}
                      saveLabel={t("import.nextStep")}
                      savingLabel={t("import.saving")}
                      onJumpIngredient={jumpToEditIngredient}
                      onJumpStep={jumpToEditStep}
                      onSave={() => void handleSaveVideo()}
                      disabled={stage === "saving" || stage === "done"}
                      saving={stage === "saving"}
                      saveIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
                      saveVoiceAliases="下一步 继续 next step continue"
                      actions={[
                        {
                          label: t("import.restructure"),
                          onClick: () => void restructureVideoDraft(),
                          icon: <Wand2 className="h-4 w-4" strokeWidth={1.75} />,
                          disabled: !transcript.trim(),
                          voiceAliases: "restructure recipe organize recipe again",
                        },
                        {
                          label: t("import.backToUploadStep"),
                          onClick: () => void returnToUploadStep(),
                          icon: <RotateCcw className="h-4 w-4" strokeWidth={1.75} />,
                          voiceAliases: "back to upload choose another file",
                        },
                      ]}
                    />
                  </div>

                  <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                          {t("import.guided.step3Label")}
                        </span>
                        <h3 className="mt-2 font-display text-2xl sm:text-3xl">
                          {t("import.coverStepTitle")}
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {t("import.coverStepBody")}
                        </p>
                      </div>
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleCoverInputChange}
                      />
                    </div>

                    <div className="mt-8 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                      <div
                        className={`group/guided-cover relative aspect-[4/3] overflow-hidden rounded-[1.75rem] border border-border bg-background transition-colors ${
                          coverPreviewUrl
                            ? "cursor-zoom-in hover:border-foreground"
                            : stage === "saving"
                              ? "cursor-not-allowed opacity-60"
                              : "cursor-pointer hover:border-foreground"
                        }`}
                        role="button"
                        tabIndex={stage === "saving" ? -1 : 0}
                        aria-disabled={stage === "saving"}
                        aria-label={
                          coverPreviewUrl ? t("import.coverPreviewOpen") : t("import.uploadCover")
                        }
                        data-voice-label={
                          coverPreviewUrl ? t("import.coverPreviewOpen") : t("import.uploadCover")
                        }
                        data-voice-aliases="上传封面 选择封面 换张封面 查看封面 放大封面 upload cover choose cover replace cover preview cover"
                        onClick={() => {
                          if (coverPreviewUrl) {
                            setExpandedCoverPreview({
                              src: coverPreviewUrl,
                              alt: previewRecipe.title,
                            });
                            return;
                          }
                          if (stage !== "saving") coverInputRef.current?.click();
                        }}
                        onKeyDown={(event) => {
                          if (stage === "saving") return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            if (coverPreviewUrl) {
                              setExpandedCoverPreview({
                                src: coverPreviewUrl,
                                alt: previewRecipe.title,
                              });
                              return;
                            }
                            coverInputRef.current?.click();
                          }
                        }}
                      >
                        {coverPreviewUrl ? (
                          <>
                            <img
                              src={coverPreviewUrl}
                              alt={previewRecipe.title}
                              className="h-full w-full object-cover"
                            />
                          </>
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
                            <ImageIcon className="h-10 w-10" strokeWidth={1.25} />
                            <span className="text-sm">{t("import.coverMissing")}</span>
                          </div>
                        )}
                        <div className="absolute right-3 top-3 z-20 flex gap-2 opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover/guided-cover:pointer-events-auto sm:group-hover/guided-cover:opacity-100 sm:group-focus-within/guided-cover:pointer-events-auto sm:group-focus-within/guided-cover:opacity-100">
                          <AppTooltip
                            content={t("import.uploadCover")}
                            disabled={stage === "saving"}
                          >
                            <button
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (stage !== "saving") coverInputRef.current?.click();
                              }}
                              onKeyDown={(event) => event.stopPropagation()}
                              disabled={stage === "saving"}
                              type="button"
                              aria-label={t("import.uploadCover")}
                              data-voice-label={t("import.uploadCover")}
                              data-voice-aliases="上传封面 选择封面 换张封面 upload cover choose cover replace cover"
                            >
                              <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          </AppTooltip>
                          <AppTooltip
                            content={t("import.aiGenerateCover")}
                            disabled={
                              isGeneratingCover || stage === "saving" || !canGenerateAiCover
                            }
                          >
                            <button
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (stage !== "saving") void handleRegenerateCover();
                              }}
                              onKeyDown={(event) => event.stopPropagation()}
                              disabled={
                                isGeneratingCover || stage === "saving" || !canGenerateAiCover
                              }
                              type="button"
                              aria-label={t("import.aiGenerateCover")}
                              data-voice-label={t("import.aiGenerateCover")}
                              data-voice-aliases="重新生成封面 生成封面 AI生成封面 regenerate cover generate cover ai generate cover"
                            >
                              {isGeneratingCover ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                              )}
                            </button>
                          </AppTooltip>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-border bg-background p-4">
                          <div className="text-sm font-medium">{t("import.coverCurrentState")}</div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {coverImage ? t("import.coverReady") : t("import.coverMissing")}
                          </p>
                        </div>

                        <VoiceHint>{t("import.coverVoiceHint")}</VoiceHint>

                        <button
                          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm text-background hover:bg-clay disabled:opacity-50"
                          onClick={() => void handleSaveVideo()}
                          disabled={stage === "saving" || stage === "done"}
                          data-voice-label={t("import.saveToRecipes")}
                          data-voice-aliases="保存到我的菜谱 保存到菜谱 保存菜谱 save to recipes save recipe"
                        >
                          {stage === "saving" ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" /> {t("import.saving")}
                            </>
                          ) : stage === "done" ? (
                            <>
                              <CheckCircle2 className="h-4 w-4" /> {t("import.saved")}
                            </>
                          ) : (
                            <>
                              <VoiceBadge
                                className="!border-background/40 !bg-transparent !text-background !opacity-100"
                                n={2}
                              />
                              {t("import.saveToRecipes")}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {mode === "video" &&
                (stage === "preview" || stage === "saving" || stage === "done") &&
                !structuredRecipe &&
                transcript && (
                  <div className="rounded-[2rem] border border-border bg-card p-6">
                    <div className="flex items-center justify-between gap-4">
                      <h4 className="font-display text-lg">{t("import.transcriptOnly")}</h4>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {t("import.noLlmKey")}
                      </span>
                    </div>
                    <p className="mt-4 text-sm text-muted-foreground">{transcript}</p>
                    <RecipeEditShortcuts
                      ingredientCount={0}
                      stepCount={0}
                      ingredientsLabel={t("import.manualIngredients")}
                      stepsLabel={t("import.manualSteps")}
                      jumpLabel={t("import.editShortcutsJump")}
                      itemPlaceholder={t("import.editShortcutsItemPlaceholder")}
                      saveLabel={t("import.saveTranscript")}
                      savingLabel={t("import.saving")}
                      onJumpIngredient={jumpToEditIngredient}
                      onJumpStep={jumpToEditStep}
                      onSave={() => void handleSaveVideo()}
                      disabled={stage === "saving" || stage === "done"}
                      saving={stage === "saving"}
                      showJumpControls={false}
                      actions={[
                        {
                          label: t("import.restructure"),
                          onClick: () => void restructureVideoDraft(),
                          icon: <Wand2 className="h-4 w-4" strokeWidth={1.75} />,
                          disabled: !transcript.trim(),
                          voiceAliases: "restructure recipe organize recipe again",
                        },
                        {
                          label: t("import.backToUploadStep"),
                          onClick: () => void returnToUploadStep(),
                          icon: <RotateCcw className="h-4 w-4" strokeWidth={1.75} />,
                          voiceAliases: "back to upload choose another file",
                        },
                      ]}
                    />
                  </div>
                )}

              {mode === "manual" && (
                <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background">
                        <Pencil className="h-5 w-5" strokeWidth={1.75} />
                      </div>
                      <div>
                        <h3 className="font-display text-2xl">{t("import.manualFormTitle")}</h3>
                        <p className="text-sm text-muted-foreground">
                          {t("import.manualFormDescription")}
                        </p>
                      </div>
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="inline-flex h-10 w-10 shrink-0 appearance-none items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-foreground shadow-none ring-0 transition-colors hover:border-border hover:bg-transparent hover:text-clay focus-visible:border-border focus-visible:ring-0 active:bg-transparent disabled:opacity-50"
                          onClick={() => setIsManualTextDialogOpen(true)}
                          disabled={isManualSaving}
                          type="button"
                          aria-label={t("import.manualTextOpenDialog")}
                          data-voice-label={t("import.manualTextOpenDialog")}
                          data-voice-aliases="粘贴菜谱 从文字导入 AI整理菜谱 structure recipe from text paste recipe import text"
                        >
                          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("import.manualTextTooltip")}</TooltipContent>
                    </Tooltip>
                  </div>

                  <VoiceHint className="mt-4">{t("import.manualVoiceHint")}</VoiceHint>

                  <Dialog
                    open={isManualTextDialogOpen}
                    onOpenChange={(open) => {
                      if (open) {
                        setIsManualTextDialogOpen(true);
                        return;
                      }
                      resetManualTextDialog();
                    }}
                  >
                    <DialogContent className="max-w-2xl rounded-[1.75rem] border-border p-0">
                      <div className="p-6 sm:p-7">
                        <DialogHeader>
                          <DialogTitle className="font-display text-2xl">
                            {t("import.manualTextImportTitle")}
                          </DialogTitle>
                          <DialogDescription className="pt-2 text-sm">
                            {t("import.manualTextImportDescription")}
                          </DialogDescription>
                        </DialogHeader>

                        <textarea
                          className="mt-5 min-h-[260px] w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-clay"
                          value={manualRawText}
                          onChange={(e) => setManualRawText(e.target.value)}
                          placeholder={t("import.manualTextPlaceholder")}
                        />

                        {manualTextImportError && (
                          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                            {manualTextImportError}
                          </div>
                        )}

                        <div className="mt-5 flex justify-end">
                          <button
                            className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm text-background disabled:opacity-50 ${
                              isManualTextStructuring
                                ? "bg-foreground"
                                : "bg-foreground hover:bg-clay"
                            }`}
                            onClick={() => void handleStructureManualText()}
                            disabled={
                              isManualTextStructuring || isManualSaving || !canStructureWithLlm
                            }
                            type="button"
                          >
                            {isManualTextStructuring ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t("import.manualTextStructuring")}
                              </>
                            ) : (
                              <>
                                <Wand2 className="h-4 w-4" strokeWidth={1.75} />
                                {t("import.manualTextStructureAction")}
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <input
                    ref={manualCoverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleManualCoverInputChange}
                  />

                  <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualRecipeTitle")}</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay"
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                        placeholder={t("import.manualRecipeTitlePlaceholder")}
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualCuisine")}</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay"
                        value={manualCuisine}
                        onChange={(e) => setManualCuisine(e.target.value)}
                        placeholder={t("import.manualCuisinePlaceholder")}
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualDifficulty")}</span>
                      <Select
                        value={manualDifficulty || EMPTY_MANUAL_DIFFICULTY_VALUE}
                        onValueChange={(value) =>
                          setManualDifficulty(
                            value === EMPTY_MANUAL_DIFFICULTY_VALUE
                              ? ""
                              : (value as ManualDifficulty),
                          )
                        }
                      >
                        <SelectTrigger className="h-12 rounded-2xl border-border bg-background text-sm">
                          <SelectValue placeholder={t("import.manualDifficultyPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY_MANUAL_DIFFICULTY_VALUE}>
                            {t("import.manualDifficultyPlaceholder")}
                          </SelectItem>
                          <SelectItem value="easy">{t("recipes.difficulty.easy")}</SelectItem>
                          <SelectItem value="medium">{t("recipes.difficulty.medium")}</SelectItem>
                          <SelectItem value="hard">{t("recipes.difficulty.hard")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualTotalTime")}</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay"
                        value={manualTotalTime}
                        onChange={(e) => setManualTotalTime(e.target.value)}
                        placeholder={t("import.manualTotalTimePlaceholder")}
                        inputMode="numeric"
                      />
                    </label>
                  </div>

                  <label className="mt-4 block space-y-2">
                    <span className="text-sm font-medium">{t("import.manualFlavors")}</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay"
                      value={manualFlavors}
                      onChange={(e) => setManualFlavors(e.target.value)}
                      placeholder={t("import.manualFlavorsPlaceholder")}
                    />
                  </label>

                  <div className="mt-6 flex justify-center sm:justify-end">
                    <RecipeContentDisplayToggle
                      value={manualDisplayMode}
                      onChange={setManualDisplayMode}
                      allLabel={t("recipeContentDisplay.all")}
                      ingredientsLabel={t("recipeContentDisplay.ingredientsOnly")}
                      stepsLabel={t("recipeContentDisplay.stepsOnly")}
                      ariaLabel={t("recipeContentDisplay.ariaLabel")}
                    />
                  </div>

                  <div className={`mt-8 ${showManualIngredients ? "" : "hidden"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <h4 className="font-display text-xl">{t("import.manualIngredients")}</h4>
                        <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                          {manualIngredients.length}
                        </span>
                      </div>
                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                        onClick={() => {
                          setManualDisplayMode((current) => (current === "steps" ? "all" : current));
                          setManualIngredients((current) => {
                            const next = [createEmptyIngredient(), ...current];
                            window.requestAnimationFrame(() => {
                              manualIngredientNameRefs.current[0]?.focus();
                            });
                            return next;
                          });
                        }}
                        type="button"
                        data-voice-label={t("import.manualAddIngredient")}
                        data-voice-aliases="添加食材 新增食材 add ingredient"
                      >
                        <Plus className="h-4 w-4" strokeWidth={1.75} />
                        {t("import.manualAddIngredient")}
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {manualIngredients.map((ingredient, index) => (
                        <div
                          key={index}
                          className="group rounded-2xl border border-border bg-background p-4"
                          onBlur={(event) => handleManualIngredientBlur(event, index)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              {t("import.manualIngredients")}
                            </span>
                            {manualIngredients.length > 1 && (
                              <button
                                className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 disabled:opacity-50 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                onClick={() =>
                                  setManualIngredients((current) =>
                                    current.length > 1
                                      ? current.filter((_, itemIndex) => itemIndex !== index)
                                      : [createEmptyIngredient()],
                                  )
                                }
                                disabled={isManualSaving}
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                              </button>
                            )}
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                            <input
                              ref={(node) => {
                                manualIngredientNameRefs.current[index] = node;
                              }}
                              className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                              value={ingredient.name}
                              onChange={(e) =>
                                setManualIngredients((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, name: e.target.value } : item,
                                  ),
                                )
                              }
                              placeholder={t("import.manualIngredientName")}
                            />
                            <input
                              className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                              value={ingredient.amount}
                              onChange={(e) =>
                                setManualIngredients((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, amount: e.target.value }
                                      : item,
                                  ),
                                )
                              }
                              placeholder={t("import.manualIngredientAmount")}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`mt-8 ${showManualSteps ? "" : "hidden"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <h4 className="font-display text-xl">{t("import.manualSteps")}</h4>
                        <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                          {manualSteps.length}
                        </span>
                      </div>
                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                        onClick={() => {
                          setManualDisplayMode((current) => (current === "ingredients" ? "all" : current));
                          addManualStep();
                        }}
                        type="button"
                        data-voice-label={t("import.manualAddStep")}
                        data-voice-aliases="添加步骤 新增步骤 add step"
                      >
                        <Plus className="h-4 w-4" strokeWidth={1.75} />
                        {t("import.manualAddStep")}
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {manualSteps.map((step, index) => (
                        <div
                          key={index}
                          className="group rounded-2xl border border-border bg-background p-4"
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const fromIndex = draggedManualStepIndexRef.current;
                            if (fromIndex !== null) moveManualStep(fromIndex, index);
                            draggedManualStepIndexRef.current = null;
                          }}
                          onBlur={(event) => handleManualStepBlur(event, index)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <button
                                className="-ml-1 inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-full border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
                                draggable
                                onDragStart={(event) => {
                                  draggedManualStepIndexRef.current = index;
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", String(index));
                                }}
                                onDragEnd={() => {
                                  draggedManualStepIndexRef.current = null;
                                }}
                                type="button"
                              >
                                <GripVertical className="h-4 w-4" strokeWidth={1.75} />
                              </button>
                              <span className="font-display text-sm">
                                {t("import.step", { count: index + 1 })}
                              </span>
                            </div>
                            {manualSteps.length > 1 && (
                              <button
                                className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 disabled:opacity-50 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                onClick={() =>
                                  setManualSteps((current) =>
                                    current.length > 1
                                      ? current.filter((_, itemIndex) => itemIndex !== index)
                                      : [createEmptyManualStep()],
                                  )
                                }
                                disabled={isManualSaving}
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                              </button>
                            )}
                          </div>

                          <div className="mt-3">
                            <StepDescriptionField
                              textareaRef={(node) => {
                                manualStepDescriptionRefs.current[index] = node;
                              }}
                              value={step.description}
                              onChange={(value) =>
                                setManualSteps((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, description: value } : item,
                                  ),
                                )
                              }
                              placeholder={t("import.manualStepDescription")}
                              disabled={isManualSaving}
                            />
                          </div>

                          <div className="mt-3">
                            <StepMetadataFields
                              t={t}
                              durationValue={step.durationMin}
                              tipsValue={step.tips}
                              onDurationChange={(value) =>
                                setManualSteps((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, durationMin: value } : item,
                                  ),
                                )
                              }
                              onTipsChange={(value) =>
                                setManualSteps((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, tips: value } : item,
                                  ),
                                )
                              }
                              disabled={isManualSaving}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <RecipeEditShortcuts
                    ingredientCount={manualIngredients.length}
                    stepCount={manualSteps.length}
                    ingredientsLabel={t("import.manualIngredients")}
                    stepsLabel={t("import.manualSteps")}
                    jumpLabel={t("import.editShortcutsJump")}
                    itemPlaceholder={t("import.editShortcutsItemPlaceholder")}
                    saveLabel={t("import.manualSave")}
                    savingLabel={t("import.saving")}
                    onJumpIngredient={jumpToManualIngredient}
                    onJumpStep={jumpToManualStep}
                    onSave={() => void handleSaveManual()}
                    disabled={isManualSaving}
                    saving={isManualSaving}
                  />

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay disabled:opacity-50 sm:flex-1"
                      onClick={() => void handleSaveManual()}
                      disabled={isManualSaving}
                      data-voice-label={t("import.manualSave")}
                      data-voice-aliases="保存手动菜谱 保存到菜谱 保存菜谱 save manual recipe save recipe"
                    >
                      {isManualSaving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> {t("import.saving")}
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.manualSave")}
                        </>
                      )}
                    </button>
                    <button
                      className="w-full rounded-full border border-border px-6 py-3 text-sm hover:border-foreground sm:w-auto"
                      onClick={resetManualDraft}
                      disabled={isManualSaving}
                      data-voice-label={t("import.manualReset")}
                      data-voice-aliases="重置手动菜谱 清空表单 reset manual recipe reset form"
                    >
                      {t("import.manualReset")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            {(mode === "video" || mode === "manual") && (
              <div className="min-w-0 lg:col-span-4">
                {mode === "video" ? (
                  <div className="space-y-4 lg:sticky lg:top-24">
                    {showGuidedFollowUp ? (
                      <div className="rounded-[2rem] border-2 border-foreground/85 bg-card p-5 shadow-[0_20px_60px_-32px_oklch(0.24_0.02_60_/_0.45)] sm:p-6">
                        <div className="flex min-h-[34rem] flex-col sm:min-h-[38rem]">
                          <div className="flex items-start justify-between gap-4">
                            <div className="font-display text-sm text-muted-foreground sm:text-base">
                              {t("import.followUpStepTag")}
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-tl-2xl rounded-br-2xl border border-clay/20 bg-clay/10 px-3 py-2 text-xs text-clay">
                              <MessageCircleMore className="h-3.5 w-3.5" strokeWidth={1.75} />
                              {answeredFollowUpCount}/{followUpQuestions.length}
                            </span>
                          </div>

                          <div className="mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
                            {followUpMessages.map((message) => (
                              <div key={message.field} className="space-y-4">
                                <div className="flex items-start gap-3">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-foreground/85 bg-background sm:h-11 sm:w-11">
                                    <img
                                      src="/logo.png"
                                      alt={`${t("app.name")} logo`}
                                      className="h-7 w-7 rounded-full object-contain dark:hidden"
                                    />
                                    <img
                                      src="/logo-dark.png"
                                      alt={`${t("app.name")} logo`}
                                      className="hidden h-7 w-7 rounded-full object-contain dark:block"
                                    />
                                  </div>
                                  <div
                                    className={`max-w-[78%] rounded-[0.8rem] border-2 border-foreground/85 bg-background px-4 py-3 text-sm leading-6 text-foreground shadow-sm ${
                                      followUpStatus === "speaking" && message.isCurrent
                                        ? "animate-pulse"
                                        : ""
                                    }`}
                                  >
                                    {message.question || t("import.followUpWaiting")}
                                  </div>
                                </div>

                                {message.answer && (
                                  <div className="ml-auto max-w-[58%] break-words px-3 py-1 text-right text-sm leading-6 text-foreground">
                                    {message.answer}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {followUpError && (
                            <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                              {followUpError}
                            </div>
                          )}

                          {currentFollowUp && (
                            <div className="mt-5 space-y-3">
                              <div className="flex items-center gap-3">
                                <Input
                                  value={followUpInput}
                                  onChange={(event) => setFollowUpInput(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                                      event.preventDefault();
                                      if (followUpInput.trim() && !followUpBusy) {
                                        void handleFollowUpSubmit();
                                      }
                                    }
                                  }}
                                  placeholder={currentFollowUp.placeholder}
                                  className="h-11 flex-1 rounded-xl border-2 border-foreground/85 bg-background px-4 text-sm shadow-none focus-visible:ring-0 sm:h-12"
                                />
                                <Button
                                  type="button"
                                  size="icon"
                                  disabled={
                                    followUpStatus === "speaking" ||
                                    followUpStatus === "refining" ||
                                    (!followUpInput.trim() && !canUseVoiceFollowUp)
                                  }
                                  onClick={() => {
                                    if (followUpInput.trim()) {
                                      void handleFollowUpSubmit();
                                      return;
                                    }
                                    if (followUpStatus === "listening") {
                                      stopAnswerRecording();
                                    } else {
                                      void startAnswerRecording();
                                    }
                                  }}
                                  className={`h-11 w-11 shrink-0 rounded-full border-2 border-foreground/85 bg-background text-foreground shadow-none transition-all hover:bg-card hover:text-clay sm:h-12 sm:w-12 ${
                                    followUpStatus === "listening" ? "scale-105 animate-pulse text-clay" : ""
                                  }`}
                                  aria-label={
                                    followUpInput.trim()
                                      ? t("import.followUpNext")
                                      : followUpStatus === "listening"
                                        ? t("import.followUpStopRecording")
                                        : t("import.followUpRecordAnswer")
                                  }
                                >
                                  {followUpStatus === "transcribing" || followUpStatus === "refining" ? (
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                  ) : followUpInput.trim() ? (
                                    <Send className="h-5 w-5" />
                                  ) : followUpStatus === "listening" ? (
                                    <StopCircle className="h-5 w-5" />
                                  ) : (
                                    <Mic className="h-5 w-5" />
                                  )}
                                </Button>
                              </div>

                            </div>
                          )}
                        </div>

                        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                          <button
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3.5 text-sm text-background hover:bg-clay disabled:opacity-50"
                            onClick={() => void handleFollowUpContinue()}
                            disabled={followUpBusy}
                            type="button"
                          >
                            {followUpStatus === "refining" ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t("import.followUpApplying")}
                              </>
                            ) : (
                              <>
                                {t("import.followUpContinueNext")}
                                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {videoTasksPanel}
                    {showGuidedCover ? (
                      <div className="rounded-[2rem] border border-border bg-card p-6">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-clay" strokeWidth={1.75} />
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                              {t("import.guided.step3Label")}
                            </div>
                            <h4 className="font-display text-2xl">{t("import.coverStepTitle")}</h4>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-clay" strokeWidth={1.75} />
                        <span className="text-sm font-medium">{t("import.manualCoverTitle")}</span>
                      </div>

                      <div
                        className={`group/manual-cover relative mt-4 flex aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-background transition-colors ${
                          isManualSaving
                            ? "cursor-not-allowed opacity-60"
                            : manualCoverPreviewUrl
                              ? "cursor-zoom-in hover:border-foreground"
                              : "cursor-pointer hover:border-foreground"
                        }`}
                        role="button"
                        tabIndex={isManualSaving ? -1 : 0}
                        aria-disabled={isManualSaving}
                        aria-label={
                          manualCoverPreviewUrl
                            ? t("import.coverPreviewOpen")
                            : t("import.uploadCover")
                        }
                        data-voice-label={
                          manualCoverPreviewUrl
                            ? t("import.coverPreviewOpen")
                            : t("import.uploadCover")
                        }
                        data-voice-aliases="上传封面 选择封面 换张封面 查看封面 放大封面 upload cover choose cover replace cover preview cover"
                        onClick={() => {
                          if (isManualSaving) return;
                          if (manualCoverPreviewUrl) {
                            setExpandedCoverPreview({
                              src: manualCoverPreviewUrl,
                              alt: manualTitle.trim() || t("import.untitledRecipe"),
                            });
                            return;
                          }
                          manualCoverInputRef.current?.click();
                        }}
                        onKeyDown={(event) => {
                          if (isManualSaving) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            if (manualCoverPreviewUrl) {
                              setExpandedCoverPreview({
                                src: manualCoverPreviewUrl,
                                alt: manualTitle.trim() || t("import.untitledRecipe"),
                              });
                              return;
                            }
                            manualCoverInputRef.current?.click();
                          }
                        }}
                      >
                        {manualCoverPreviewUrl ? (
                          <>
                            <img
                              src={manualCoverPreviewUrl}
                              alt={manualTitle.trim() || t("import.untitledRecipe")}
                              className="h-full w-full object-cover"
                            />
                          </>
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
                            <ImageIcon className="h-10 w-10" strokeWidth={1.25} />
                            <span className="text-sm">
                              {t("import.manualCoverUploadPlaceholder")}
                            </span>
                          </div>
                        )}
                        <div className="absolute right-3 top-3 z-20 flex gap-2 opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover/manual-cover:pointer-events-auto sm:group-hover/manual-cover:opacity-100 sm:group-focus-within/manual-cover:pointer-events-auto sm:group-focus-within/manual-cover:opacity-100">
                          <AppTooltip content={t("import.uploadCover")} disabled={isManualSaving}>
                            <button
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isManualSaving) manualCoverInputRef.current?.click();
                              }}
                              onKeyDown={(event) => event.stopPropagation()}
                              disabled={isManualSaving}
                              type="button"
                              aria-label={t("import.uploadCover")}
                              data-voice-label={t("import.uploadCover")}
                              data-voice-aliases="上传封面 选择封面 换张封面 upload cover choose cover replace cover"
                            >
                              <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          </AppTooltip>
                          <AppTooltip
                            content={t("import.aiGenerateCover")}
                            disabled={
                              isManualGeneratingCover || isManualSaving || !canGenerateAiCover
                            }
                          >
                            <button
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isManualSaving) void handleRegenerateManualCover();
                              }}
                              onKeyDown={(event) => event.stopPropagation()}
                              disabled={
                                isManualGeneratingCover || isManualSaving || !canGenerateAiCover
                              }
                              type="button"
                              aria-label={t("import.aiGenerateCover")}
                              data-voice-label={t("import.aiGenerateCover")}
                              data-voice-aliases="重新生成封面 生成封面 AI生成封面 regenerate cover generate cover ai generate cover"
                            >
                              {isManualGeneratingCover ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                              )}
                            </button>
                          </AppTooltip>
                        </div>
                      </div>
                    </div>

                    <h4 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {t("import.manualSidebarTitle")}
                    </h4>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2">
                        <Pencil className="h-4 w-4 text-clay" strokeWidth={1.75} />
                        <span className="text-sm font-medium">
                          {t("import.manualSidebarHeading")}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t("import.manualSidebarBody")}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-clay" strokeWidth={1.75} />
                        <span className="text-sm font-medium">
                          {t("import.manualSidebarStepsTitle")}
                        </span>
                      </div>
                      <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                        <li>{t("import.manualSidebarStep1")}</li>
                        <li>{t("import.manualSidebarStep2")}</li>
                        <li>{t("import.manualSidebarStep3")}</li>
                      </ol>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-clay" strokeWidth={1.75} />
                        <span className="text-sm font-medium">
                          {t("import.manualTextSidebarTitle")}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t("import.manualTextSidebarBody")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <Dialog
        open={Boolean(expandedCoverPreview)}
        onOpenChange={(open) => {
          if (!open) setExpandedCoverPreview(null);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-5xl border-0 bg-transparent p-0 shadow-none">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("import.coverPreviewTitle")}</DialogTitle>
            <DialogDescription>{t("import.coverPreviewDescription")}</DialogDescription>
          </DialogHeader>
          {expandedCoverPreview && (
            <img
              src={expandedCoverPreview.src}
              alt={expandedCoverPreview.alt}
              className="max-h-[88vh] w-full rounded-2xl object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
