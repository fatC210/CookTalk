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
  Pencil,
  Plus,
  Sparkles,
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

import { promptConfigureApiKey } from "@/lib/api-key-prompts";

import { db } from "@/lib/db";

import { deleteVideoImportTask, saveVideoImportTask, type Recipe } from "@/lib/db";

import i18n from "@/lib/i18n";

import {
  createVideoImportTask,
  createTextImportTask,
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

function isRecipeReadyForTaskSwitch(snapshot: VideoImportDraftSnapshot): boolean {
  return Boolean(
    snapshot.structuredRecipe &&
    snapshot.editTitle.trim() &&
    snapshot.editIngredients.some((item) => item.name.trim()) &&
    snapshot.editSteps.some((step) => step.description.trim()),
  );
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

  if (
    /not a function|is not defined|Cannot read properties of (?:undefined|null)/i.test(rawMessage)
  ) {
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
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e24": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9,
    "\u5341": 10,
  };

  if (value.includes("\u5341")) {
    const [left, right] = value.split("\u5341");
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

      notes: notes ? [recipe.tags.notes, notes].filter(Boolean).join(", ") : recipe.tags.notes,
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

  const [isMediaImportDialogOpen, setIsMediaImportDialogOpen] = useState(false);

  const [pendingMediaFile, setPendingMediaFile] = useState<File | null>(null);

  const [videoEditDisplayMode, setVideoEditDisplayMode] = useState<RecipeContentDisplayMode>("all");

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

      setMode("video");

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

  const resetVideoEditForm = () => {
    if (!structuredRecipe) return;

    syncRecipeEditor(structuredRecipe);
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
      const next = [...current, createEmptyRecipeStep(current.length + 1)].map(
        (item, itemIndex) => ({
          ...item,

          order: itemIndex + 1,
        }),
      );

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

  const addManualIngredient = () => {
    setManualDisplayMode((current) => (current === "steps" ? "all" : current));

    setManualIngredients((current) => {
      const next = [createEmptyIngredient(), ...current];

      window.requestAnimationFrame(() => {
        manualIngredientNameRefs.current[0]?.focus();
      });

      return next;
    });
  };

  const addManualStep = () => {
    setManualDisplayMode((current) => (current === "ingredients" ? "all" : current));

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

      if (task.id === currentTaskId) {
        setMode("video");

        return;
      }

      if (!isRecipeReadyForTaskSwitch(task.snapshot)) {
        toast.warning(t("import.videoTaskNotReady"));

        return;
      }

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

      t,

      stopAnswerRecording,

      videoTasks,
    ],
  );

  const startFreshManualRecipe = useCallback(() => {
    clearManualDraft();

    setMode("manual");

    if (manualCoverInputRef.current) manualCoverInputRef.current.value = "";
  }, [clearManualDraft, setMode]);

  const clearCurrentVideoTask = useCallback(async () => {
    stopAnswerRecording();

    cleanupAnswerRecording();

    if (currentTaskId) {
      await deleteVideoImportTask(currentTaskId);
    }

    clearVideoDraft();

    setCurrentTaskId(null);

    creatingNewVideoTaskRef.current = true;

    lastSavedTaskSignatureRef.current = "";

    startFreshManualRecipe();

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [
    cleanupAnswerRecording,
    clearVideoDraft,
    currentTaskId,
    startFreshManualRecipe,
    stopAnswerRecording,
  ]);

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
    await saveCurrentVideoTaskNow();

    pipelineRunIdRef.current += 1;

    stopAnswerRecording();

    cleanupAnswerRecording();

    shouldAutoListenFollowUpRef.current = false;

    setCurrentTaskId(null);

    creatingNewVideoTaskRef.current = true;

    lastSavedTaskSignatureRef.current = "";

    replaceVideoDraft(createInitialVideoDraftSnapshot());

    startFreshManualRecipe();

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetManualDraft = () => {
    clearManualDraft();

    if (manualCoverInputRef.current) manualCoverInputRef.current.value = "";
  };

  const openMediaImportDialog = useCallback(() => {
    if (!hasVideoTaskCapacity) {
      toast.error(t("import.videoTaskLimitReached"));

      return;
    }

    setPendingMediaFile(null);

    setIsMediaImportDialogOpen(true);
  }, [hasVideoTaskCapacity, t]);

  const openMediaPicker = useCallback(() => {
    if (!hasVideoTaskCapacity) {
      toast.error(t("import.videoTaskLimitReached"));

      return;
    }

    fileInputRef.current?.click();
  }, [hasVideoTaskCapacity, t]);

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

    setPendingMediaFile(file);

    setIsMediaImportDialogOpen(true);

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

  const isSkipAnswer = (value: string) =>
    /^(\u8df3\u8fc7|\u4e0d\u7528|\u4e0d\u9700\u8981|\u6ca1\u6709|\u65e0|skip)$/i.test(value.trim());

  const getAppliedAnswerPatch = (
    field: FollowUpField,

    answer: string,
  ): Partial<FollowUpAnswers> => ({
    [field]: isSkipAnswer(answer) ? "" : answer.trim(),
  });

  const startAnswerRecording = async () => {
    if (followUpStatus === "speaking" || followUpStatus === "refining") return;

    if (!canUseVoiceFollowUp) {
      promptConfigureApiKey("elevenlabs", t, navigate);

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

  const startPipeline = async (fileToProcess = selectedMediaFile) => {
    if (!fileToProcess) return;

    const isNewTask = fileToProcess !== selectedMediaFile || !currentTaskId;

    if (isNewTask && !hasVideoTaskCapacity) {
      toast.error(t("import.videoTaskLimitReached"));

      return;
    }

    if (!hasElevenLabsKey) {
      promptConfigureApiKey("elevenlabs", t, navigate);

      return;
    }

    const pipelineRunId = (pipelineRunIdRef.current += 1);

    resetFollowUpFlow();

    setIsMediaImportDialogOpen(false);

    setIsDragging(false);

    setPendingMediaFile(null);

    if (isNewTask) {
      await saveCurrentVideoTaskNow();

      const baseSnapshot = createInitialVideoDraftSnapshot();

      const taskSnapshot: VideoImportDraftSnapshot = {
        ...baseSnapshot,

        selectedMediaFile: fileToProcess,

        stage: "transcribing",
      };

      const task = createVideoImportTask(fileToProcess, taskSnapshot);

      await saveVideoImportTask(task);

      setMode("video");

      setCurrentTaskId(task.id);

      creatingNewVideoTaskRef.current = false;

      lastSavedTaskSignatureRef.current = `${task.id}:${getVideoDraftSignature(task.snapshot)}`;

      replaceVideoDraft(taskSnapshot);
    }

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
        promptConfigureApiKey("elevenlabs", t, navigate);
        throw new Error(t("import.elevenLabsKeyMissing"));
      }

      const sttService = new ElevenLabsService(elevenLabsKey);

      const rawTranscript = (await sttService.speechToText(fileToProcess)).trim();

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

    setManualFlavors(tags.flavor?.join(", ") ?? "");

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
      promptConfigureApiKey("llm", t, navigate);

      return;
    }

    if (!hasVideoTaskCapacity) {
      toast.error(t("import.videoTaskLimitReached"));

      return;
    }

    setManualTextImportStatus("structuring");

    setManualTextImportError(null);

    setIsManualTextDialogOpen(false);

    setManualRawText("");

    setManualTextImportStatus("idle");

    const initialTaskSnapshot: VideoImportDraftSnapshot = {
      ...createInitialVideoDraftSnapshot(),

      stage: "structuring",

      transcript: rawText,
    };

    const task = createTextImportTask(
      rawText,

      initialTaskSnapshot,

      t("import.textTaskFallbackName"),
    );

    await saveVideoImportTask(task);

    setCurrentTaskId(task.id);

    replaceVideoDraft(initialTaskSnapshot);

    creatingNewVideoTaskRef.current = false;

    lastSavedTaskSignatureRef.current = `${task.id}:${getVideoDraftSignature(task.snapshot)}`;

    try {
      const llmService = await getConfiguredLLMService();

      if (!llmService) {
        throw new Error(t("import.manualTextLlmRequired"));
      }

      const recipe = (await llmService.structureRecipeFromText(
        rawText,

        language,
      )) as StructuredRecipe;

      const cleanedRecipe = cleanStructuredImportRecipe(recipe, language, rawText);

      const nextSnapshot: VideoImportDraftSnapshot = {
        ...createInitialVideoDraftSnapshot(),

        stage: "preview",

        transcript: rawText,

        structuredRecipe: cleanedRecipe,

        editTitle: cleanedRecipe.title,

        editIngredients: cleanedRecipe.ingredients.map((item) => ({ ...item })),

        editSteps: cleanedRecipe.steps.map((step) => ({ ...step })),

        editDifficulty: cleanedRecipe.tags.difficulty ?? "",

        editTotalTime:
          cleanedRecipe.tags.totalTimeMin && cleanedRecipe.tags.totalTimeMin > 0
            ? String(cleanedRecipe.tags.totalTimeMin)
            : "",
      };

      const nextTask = updateVideoImportTask(task, nextSnapshot);

      lastSavedTaskSignatureRef.current = `${nextTask.id}:${getVideoDraftSignature(nextTask.snapshot)}`;

      await saveVideoImportTask(nextTask);

      replaceVideoDraft(nextSnapshot);

      applyStructuredRecipeToManualForm(cleanedRecipe);

      toast.success(t("import.manualTextStructured"));
    } catch (err) {
      const message = formatImportError(err, t("import.manualTextStructureFailed"), t);

      const errorSnapshot: VideoImportDraftSnapshot = {
        ...initialTaskSnapshot,

        stage: "error",

        error: message,
      };

      const errorTask = updateVideoImportTask(task, errorSnapshot);

      lastSavedTaskSignatureRef.current = `${errorTask.id}:${getVideoDraftSignature(errorTask.snapshot)}`;

      await saveVideoImportTask(errorTask);

      replaceVideoDraft(errorSnapshot);

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
      promptConfigureApiKey(!hasLlmKey ? "llm" : "imagegen", t, navigate);

      return;
    }

    try {
      const llmService = await getConfiguredLLMService();

      const imageKey = await getApiKey("imagegen-key");

      const imageEndpoint = await getApiKey("imagegen-endpoint");

      const imageModel = await getApiKey("imagegen-model");

      if (!llmService || !imageKey || !imageEndpoint) {
        promptConfigureApiKey(!llmService ? "llm" : "imagegen", t, navigate);

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
      promptConfigureApiKey(!hasLlmKey ? "llm" : "imagegen", t, navigate);

      return;
    }

    setIsManualGeneratingCover(true);

    try {
      const llmService = await getConfiguredLLMService();

      const imageKey = await getApiKey("imagegen-key");

      const imageEndpoint = await getApiKey("imagegen-endpoint");

      const imageModel = await getApiKey("imagegen-model");

      if (!llmService || !imageKey || !imageEndpoint) {
        promptConfigureApiKey(!llmService ? "llm" : "imagegen", t, navigate);

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

      if (action === "select-media") openMediaImportDialog();
    };

    window.addEventListener("cooktalk:voice-page-action", handleVoicePageAction);

    return () => window.removeEventListener("cooktalk:voice-page-action", handleVoicePageAction);
  }, [openMediaImportDialog]);

  useEffect(() => {
    const handleImportVoiceCommand = (event: Event) => {
      const transcript = (event as CustomEvent<{ transcript?: string }>).detail?.transcript ?? "";
      const text = normalizeSpeechText(transcript);
      if (!text) return;

      if (/(手动|文本|粘贴|输入).*(菜谱|食谱|做法)|manual.*recipe|paste.*recipe|text.*recipe/i.test(text)) {
        event.preventDefault();
        setMode("manual");
        setIsManualTextDialogOpen(true);
        return;
      }

      if (/(视频|音频|媒体).*(导入|上传|选择)|导入.*(视频|音频|媒体)|import.*(video|audio|media)|upload.*(video|audio|media)|choose.*(video|audio|media)/i.test(text)) {
        event.preventDefault();
        setMode("video");
        openMediaImportDialog();
        return;
      }

      if (/(选择|更换|重新选择).*(文件|视频|音频|媒体)|choose.*file|select.*file|choose another file/i.test(text)) {
        event.preventDefault();
        openMediaImportDialog();
        return;
      }

      if (/(开始|处理|提取|整理).*(视频|音频|媒体|文件)|start processing|process video|extract recipe/i.test(text)) {
        if (pendingMediaFile) {
          event.preventDefault();
          void startPipeline(pendingMediaFile);
          return;
        }
        if (selectedMediaFile) {
          event.preventDefault();
          void startPipeline();
          return;
        }
      }

      if (/(重新整理|重新生成结构|重新识别|restructure|organize again|extract again)/i.test(text)) {
        event.preventDefault();
        void restructureVideoDraft();
        return;
      }

      if (/(返回上传|重新上传|重新选择文件|back to upload|choose another file)/i.test(text)) {
        event.preventDefault();
        void returnToUploadStep();
        return;
      }

      if (/(生成|重新生成).*(封面|cover)|generate.*cover|regenerate.*cover/i.test(text)) {
        event.preventDefault();
        if (mode === "manual") {
          void handleRegenerateManualCover();
        } else {
          void handleRegenerateCover();
        }
        return;
      }

      if (/(上传|选择|更换).*(封面|图片|cover|image)|upload.*cover|choose.*cover|replace.*cover/i.test(text)) {
        event.preventDefault();
        if (mode === "manual") manualCoverInputRef.current?.click();
        else coverInputRef.current?.click();
        return;
      }

      if (/(添加|新增).*(食材|材料|ingredient)|add.*ingredient/i.test(text)) {
        event.preventDefault();
        if (mode === "manual") addManualIngredient();
        else addEditIngredient();
        return;
      }

      if (/(添加|新增).*(步骤|做法|step)|add.*step/i.test(text)) {
        event.preventDefault();
        if (mode === "manual") addManualStep();
        else addEditStep();
        return;
      }

      if (/(保存|完成|创建).*(菜谱|食谱|recipe)|save.*recipe|create.*recipe/i.test(text)) {
        event.preventDefault();
        if (mode === "manual") {
          void handleSaveManual();
        } else if (stage === "preview" || stage === "error") {
          void handleSaveVideo();
        }
      }
    };

    window.addEventListener("cooktalk:voice-command", handleImportVoiceCommand);
    return () => window.removeEventListener("cooktalk:voice-command", handleImportVoiceCommand);
  }, [
    addEditIngredient,
    addEditStep,
    addManualIngredient,
    addManualStep,
    handleRegenerateCover,
    handleRegenerateManualCover,
    handleSaveManual,
    handleSaveVideo,
    mode,
    openMediaImportDialog,
    pendingMediaFile,
    returnToUploadStep,
    selectedMediaFile,
    setIsManualTextDialogOpen,
    setMode,
    stage,
    startPipeline,
    restructureVideoDraft,
  ]);

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

      if (/(open|go to|show|back|upload|delete|save|recipe)/i.test(text)) {
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

  const isPreviewStage =
    stage === "generating-cover" || stage === "preview" || stage === "saving" || stage === "done";

  const isGeneratingCover = stage === "generating-cover";

  const showGuidedCover = Boolean(previewRecipe && isPreviewStage);

  const showVideoEditIngredients = shouldShowIngredients(videoEditDisplayMode);

  const showVideoEditSteps = shouldShowSteps(videoEditDisplayMode);

  const showManualIngredients = shouldShowIngredients(manualDisplayMode);

  const showManualSteps = shouldShowSteps(manualDisplayMode);

  const isManualTextStructuring = manualTextImportStatus === "structuring";

  const canStructureWithLlm = hasLlmKey;

  const canGenerateAiCover = hasLlmKey && hasImageGenKey;

  const canCreateAnotherVideoTask = hasVideoTaskCapacity;

  const showImportSidePanel = mode === "manual" || mode === "video";

  const showVideoTasksPanel = mode === "manual" || mode === "video";

  const shouldPrioritizeImportSidePanel =
    mode === "manual" ||
    (mode === "video" &&
      (videoTasks.length > 0 || (showGuidedCover && Boolean(previewRecipe))));

  const videoTasksPanel = (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            {t("import.videoTasksKicker")}
          </div>

          <h3 className="mt-2 font-display text-xl">{t("import.videoTasksTitle")}</h3>

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

            const isTaskReadyForSwitch = isRecipeReadyForTaskSwitch(task.snapshot);

            const displayTitle = deriveTaskDisplayTitle(task.snapshot, task.fileName);

            const showFileName = task.kind === "media" && task.fileName.trim().length > 0 && displayTitle !== task.fileName;

            return (
              <div
                key={task.id}
                className={`rounded-[1.5rem] border p-4 text-left transition-colors ${
                  isActiveTask
                    ? "border-clay bg-clay/5"
                    : isTaskReadyForSwitch
                      ? "cursor-pointer border-border bg-background/70 hover:border-foreground/35"
                      : "cursor-not-allowed border-border bg-background/50 opacity-65"
                }`}
                role="button"
                tabIndex={isActiveTask || isTaskReadyForSwitch ? 0 : -1}
                aria-disabled={!isActiveTask && !isTaskReadyForSwitch}
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
                      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
                      onClick={(event) => {
                        event.stopPropagation();

                        void loadVideoTask(task.id);
                      }}
                      disabled={!isActiveTask && !isTaskReadyForSwitch}
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
                    ) : !isActiveTask && !isTaskReadyForSwitch ? (
                      <span className="truncate text-amber-700">
                        {t("import.videoTaskNotReadyInline")}
                      </span>
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
            </div>
          </div>
        </div>
      </section>

      <section className="flex-1">
        <div className="page-content-container">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/flac,audio/x-flac,audio/webm,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.flac"
            className="hidden"
            onChange={handleInputChange}
          />

          <div className="grid gap-8 lg:grid-cols-12">
            <div
              className={`min-w-0 space-y-6 ${shouldPrioritizeImportSidePanel ? "order-2 lg:order-1" : ""} ${showImportSidePanel ? "lg:col-span-8" : "lg:col-span-12"}`}
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
                    data-voice-aliases="选择媒体 选择视频 选择音频 上传视频 上传音频 导入视频 导入音频 select media choose media upload video import video choose video"
                  >
                    <VoiceBadge n={1} className="absolute left-5 top-5" />

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
                          data-voice-aliases="开始处理 开始整理 提取菜谱 整理视频 start processing process video extract recipe"
                          onClick={(e) => {
                            e.stopPropagation();

                            if (!hasElevenLabsKey) {
                              promptConfigureApiKey("elevenlabs", t, navigate);
                              return;
                            }

                            void startPipeline();
                          }}
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
                          data-voice-aliases="选择媒体 选择视频 选择音频 上传视频 上传音频 导入视频 导入音频 select media choose media upload video import video choose video"
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
                    data-voice-aliases="返回上传 重新上传 重新选择文件 back to upload choose another file"
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
                      onClick={() => {
                        if (!hasElevenLabsKey) {
                          promptConfigureApiKey("elevenlabs", t, navigate);
                          return;
                        }
                        void startPipeline();
                      }}
                    >
                      {t("import.retry")}
                    </button>

                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-6 py-3 text-sm hover:border-foreground sm:w-auto"
                      onClick={() => void returnToUploadStep()}
                      data-voice-label={t("import.backToUploadStep")}
                      data-voice-aliases="返回上传 重新上传 重新选择文件 back to upload choose another file"
                    >
                      <RotateCcw className="h-4 w-4" strokeWidth={1.75} />

                      {t("import.backToUploadStep")}
                    </button>
                  </div>
                </div>
              )}

              {mode === "video" && isPreviewStage && previewRecipe && showGuidedCover && (
                <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                        {t("import.taskProgress.readyToSave")}
                      </span>

                      <h3 className="mt-2 font-display text-3xl">{previewRecipe.title}</h3>
                    </div>

                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
                      onClick={() => void restructureVideoDraft()}
                      disabled={stage === "saving" || stage === "done" || !transcript.trim()}
                      data-voice-label={t("import.restructure")}
                      data-voice-aliases="重新整理 重新整理菜谱 重新生成结构 restructure recipe organize recipe again"
                    >
                      <Wand2 className="h-4 w-4" strokeWidth={1.75} />

                      {t("import.restructure")}
                    </button>
                  </div>

                  {transcript && (
                    <details className="mt-5 rounded-2xl border border-border bg-background p-4 text-sm text-muted-foreground">
                      <summary className="cursor-pointer font-medium text-foreground">
                        {t("import.transcriptionPreview")}
                      </summary>

                      <p className="mt-3 whitespace-pre-wrap leading-6">{transcript}</p>
                    </details>
                  )}

                  <div className="mt-6 flex justify-start">
                    <RecipeContentDisplayToggle
                      value={videoEditDisplayMode}
                      onChange={setVideoEditDisplayMode}
                      allLabel={t("recipeContentDisplay.all")}
                      ingredientsLabel={t("recipeContentDisplay.ingredientsOnly")}
                      stepsLabel={t("recipeContentDisplay.stepsOnly")}
                      ariaLabel={t("recipeContentDisplay.ariaLabel")}
                    />
                  </div>

                  <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualRecipeTitle")}</span>

                      <input
                        className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay disabled:cursor-not-allowed disabled:opacity-60"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder={t("import.manualRecipeTitlePlaceholder")}
                        disabled={stage === "saving" || stage === "done"}
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualDifficulty")}</span>

                      <Select
                        value={editDifficulty || EMPTY_MANUAL_DIFFICULTY_VALUE}
                        onValueChange={(value) =>
                          setEditDifficulty(
                            value === EMPTY_MANUAL_DIFFICULTY_VALUE ? "" : (value as ManualDifficulty),
                          )
                        }
                        disabled={stage === "saving" || stage === "done"}
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

                    <label className="space-y-2 lg:col-span-2">
                      <span className="text-sm font-medium">{t("import.manualTotalTime")}</span>

                      <input
                        className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay disabled:cursor-not-allowed disabled:opacity-60"
                        value={editTotalTime}
                        onChange={(e) => setEditTotalTime(e.target.value)}
                        placeholder={t("import.manualTotalTimePlaceholder")}
                        inputMode="numeric"
                        disabled={stage === "saving" || stage === "done"}
                      />
                    </label>
                  </div>

                  <div className={`mt-8 ${showVideoEditIngredients ? "" : "hidden"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <h4 className="font-display text-xl">{t("import.manualIngredients")}</h4>

                        <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                          {editIngredients.length}
                        </span>
                      </div>

                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={addEditIngredient}
                        type="button"
                        disabled={stage === "saving" || stage === "done"}
                        data-voice-label={t("import.manualAddIngredient")}
                        data-voice-aliases="添加食材 新增食材 添加材料 add ingredient"
                      >
                        <Plus className="h-4 w-4" strokeWidth={1.75} />

                        {t("import.manualAddIngredient")}
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {editIngredients.map((ingredient, index) => (
                        <div
                          key={index}
                          className="group rounded-2xl border border-border bg-background p-4"
                          onBlur={(event) => handleEditIngredientBlur(event, index)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              {t("import.manualIngredients")}
                            </span>

                            {editIngredients.length > 1 && (
                              <button
                                className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 disabled:opacity-50 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                onClick={() => removeEditIngredient(index)}
                                disabled={stage === "saving" || stage === "done"}
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                              </button>
                            )}
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                            <input
                              ref={(node) => {
                                editIngredientNameRefs.current[index] = node;
                              }}
                              className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay disabled:cursor-not-allowed disabled:opacity-60"
                              value={ingredient.name}
                              onChange={(e) => updateEditIngredient(index, { name: e.target.value })}
                              placeholder={t("import.manualIngredientName")}
                              disabled={stage === "saving" || stage === "done"}
                            />

                            <input
                              className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay disabled:cursor-not-allowed disabled:opacity-60"
                              value={ingredient.amount}
                              onChange={(e) => updateEditIngredient(index, { amount: e.target.value })}
                              placeholder={t("import.manualIngredientAmount")}
                              disabled={stage === "saving" || stage === "done"}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`mt-8 ${showVideoEditSteps ? "" : "hidden"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <h4 className="font-display text-xl">{t("import.manualSteps")}</h4>

                        <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                          {editSteps.length}
                        </span>
                      </div>

                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={addEditStep}
                        type="button"
                        disabled={stage === "saving" || stage === "done"}
                        data-voice-label={t("import.manualAddStep")}
                        data-voice-aliases="添加步骤 新增步骤 add step"
                      >
                        <Plus className="h-4 w-4" strokeWidth={1.75} />

                        {t("import.manualAddStep")}
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {editSteps.map((step, index) => (
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
                                className="-ml-1 inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-full border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                                draggable={stage !== "saving" && stage !== "done"}
                                onDragStart={(event) => {
                                  draggedEditStepIndexRef.current = index;

                                  event.dataTransfer.effectAllowed = "move";

                                  event.dataTransfer.setData("text/plain", String(index));
                                }}
                                onDragEnd={() => {
                                  draggedEditStepIndexRef.current = null;
                                }}
                                disabled={stage === "saving" || stage === "done"}
                                type="button"
                              >
                                <GripVertical className="h-4 w-4" strokeWidth={1.75} />
                              </button>

                              <span className="font-display text-sm">
                                {t("import.step", { count: index + 1 })}
                              </span>
                            </div>

                            {editSteps.length > 1 && (
                              <button
                                className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 disabled:opacity-50 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                onClick={() => removeEditStep(index)}
                                disabled={stage === "saving" || stage === "done"}
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
                              value={step.description}
                              onChange={(value) => updateEditStep(index, { description: value })}
                              placeholder={t("import.manualStepDescription")}
                              disabled={stage === "saving" || stage === "done"}
                            />
                          </div>

                          <div className="mt-3">
                            <StepMetadataFields
                              t={t}
                              durationValue={formatDurationMinutesInput(step.durationSec)}
                              tipsValue={step.tips ?? ""}
                              onDurationChange={(value) =>
                                updateEditStep(index, { durationSec: parseDurationMinutesInput(value) })
                              }
                              onTipsChange={(value) => updateEditStep(index, { tips: value })}
                              disabled={stage === "saving" || stage === "done"}
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
                    saveLabel={t("import.saveToRecipes")}
                    savingLabel={t("import.saving")}
                    onJumpIngredient={jumpToEditIngredient}
                    onJumpStep={jumpToEditStep}
                    onSave={() => void handleSaveVideo()}
                    disabled={stage === "saving" || stage === "done"}
                    saving={stage === "saving"}
                    actionsPosition="before-save"
                    actions={[
                      {
                        label: t("import.manualReset"),
                        onClick: resetVideoEditForm,
                        icon: <RotateCcw className="h-4 w-4" strokeWidth={1.75} />,
                        disabled: !structuredRecipe,
                        voiceAliases: "reset recipe reset form clear form",
                      },
                    ]}
                  />
                </div>
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

              {mode !== "video" && (
                <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background">
                        <Pencil className="h-5 w-5" strokeWidth={1.75} />
                      </div>

                      <div>
                        <h3 className="font-display text-2xl">{t("import.manualFormTitle")}</h3>

                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="inline-flex h-10 w-10 shrink-0 appearance-none items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-foreground shadow-none ring-0 transition-colors hover:border-border hover:bg-transparent hover:text-clay focus-visible:border-border focus-visible:ring-0 active:bg-transparent disabled:opacity-50"
                            onClick={() => setIsManualTextDialogOpen(true)}
                            disabled={isManualSaving}
                            type="button"
                            aria-label={t("import.manualTextOpenDialog")}
                            data-voice-label={t("import.manualTextOpenDialog")}
                            data-voice-aliases="粘贴菜谱 手动输入菜谱 导入文本 从文本整理菜谱 paste recipe import text structure recipe from text"
                          >
                            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        </TooltipTrigger>

                        <TooltipContent>{t("import.manualTextTooltip")}</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="inline-flex h-10 w-10 shrink-0 appearance-none items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-foreground shadow-none ring-0 transition-colors hover:border-border hover:bg-transparent hover:text-clay focus-visible:border-border focus-visible:ring-0 active:bg-transparent disabled:opacity-50"
                            onClick={openMediaImportDialog}
                            disabled={!canCreateAnotherVideoTask}
                            type="button"
                            aria-label={t("import.chooseMedia")}
                            data-voice-label={t("import.chooseMedia")}
                            data-voice-aliases="导入媒体 选择媒体 上传视频 上传音频 import media choose media upload video upload audio"
                          >
                            <FileVideo className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        </TooltipTrigger>

                        <TooltipContent>{t("import.chooseMedia")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

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
                            onClick={() => {
                              if (!canStructureWithLlm) {
                                promptConfigureApiKey("llm", t, navigate);
                                return;
                              }
                              void handleStructureManualText();
                            }}
                            disabled={isManualTextStructuring || isManualSaving}
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

                  <div className="mt-6 flex justify-start">
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
                          setManualDisplayMode((current) =>
                            current === "steps" ? "all" : current,
                          );

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
                        data-voice-aliases="添加食材 新增食材 添加材料 add ingredient"
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
                          setManualDisplayMode((current) =>
                            current === "ingredients" ? "all" : current,
                          );

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
                    actionsPosition="before-save"
                    actions={[
                      {
                        label: t("import.manualReset"),
                        onClick: resetManualDraft,
                        voiceAliases:
                          "\u6e05\u7a7a\u624b\u52a8\u83dc\u8c31 \u6e05\u7a7a\u8868\u5355 reset manual recipe reset form",
                      },
                    ]}
                  />
                </div>
              )}
            </div>

            {showImportSidePanel && (
              <div
                className={`min-w-0 ${shouldPrioritizeImportSidePanel ? "order-1 lg:order-2" : ""} lg:col-span-4`}
              >
                {mode === "video" ? (
                  <div className="space-y-4 lg:sticky lg:top-24">
                    {showGuidedCover && previewRecipe ? (
                      <div className="rounded-2xl border border-border bg-card p-5">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="h-4 w-4 text-clay" strokeWidth={1.75} />

                          <span className="text-sm font-medium">{t("import.manualCoverTitle")}</span>
                        </div>

                        <input
                          ref={coverInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleCoverInputChange}
                        />

                        <div
                          className={`group/guided-cover relative mt-4 flex aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-background transition-colors ${
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
                          data-voice-aliases="上传封面 选择封面 更换封面 查看封面 upload cover choose cover replace cover preview cover"
                          onClick={() => {
                            if (stage === "saving") return;

                            if (coverPreviewUrl) {
                              setExpandedCoverPreview({
                                src: coverPreviewUrl,

                                alt: previewRecipe.title,
                              });

                              return;
                            }

                            coverInputRef.current?.click();
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
                            <img
                              src={coverPreviewUrl}
                              alt={previewRecipe.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
                              <ImageIcon className="h-10 w-10" strokeWidth={1.25} />

                              <span className="text-sm">{t("import.coverMissing")}</span>
                            </div>
                          )}

                          <div className="absolute right-3 top-3 z-20 flex gap-2 opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover/guided-cover:pointer-events-auto sm:group-hover/guided-cover:opacity-100 sm:group-focus-within/guided-cover:pointer-events-auto sm:group-focus-within/guided-cover:opacity-100">
                            <AppTooltip content={t("import.uploadCover")} disabled={stage === "saving"}>
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
                                data-voice-aliases="上传封面 选择封面 更换封面 upload cover choose cover replace cover"
                              >
                                <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                              </button>
                            </AppTooltip>

                            <AppTooltip
                              content={t("import.aiGenerateCover")}
                              disabled={isGeneratingCover || stage === "saving"}
                            >
                              <button
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={(event) => {
                                  event.stopPropagation();

                                  if (stage !== "saving") void handleRegenerateCover();
                                }}
                                onKeyDown={(event) => event.stopPropagation()}
                                disabled={isGeneratingCover || stage === "saving"}
                                type="button"
                                aria-label={t("import.aiGenerateCover")}
                                data-voice-label={t("import.aiGenerateCover")}
                                data-voice-aliases="生成封面 重新生成封面 AI生成封面 regenerate cover generate cover ai generate cover"
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

                        <div className="mt-4 space-y-4">
                          <div className="rounded-2xl border border-border bg-background p-4">
                            <div className="text-sm font-medium">{t("import.coverCurrentState")}</div>

                            <p className="mt-2 text-sm text-muted-foreground">
                              {coverImage ? t("import.coverReady") : t("import.coverMissing")}
                            </p>
                          </div>

                          <VoiceHint>{t("import.coverVoiceHint")}</VoiceHint>
                        </div>
                      </div>
                    ) : null}

                    {showVideoTasksPanel ? videoTasksPanel : null}
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
                        data-voice-aliases="上传封面 选择封面 更换封面 查看封面 upload cover choose cover replace cover preview cover"
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
                              data-voice-aliases="上传封面 选择封面 更换封面 upload cover choose cover replace cover"
                            >
                              <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          </AppTooltip>

                          <AppTooltip
                            content={t("import.aiGenerateCover")}
                            disabled={isManualGeneratingCover || isManualSaving}
                          >
                            <button
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={(event) => {
                                event.stopPropagation();

                                if (!isManualSaving) void handleRegenerateManualCover();
                              }}
                              onKeyDown={(event) => event.stopPropagation()}
                              disabled={isManualGeneratingCover || isManualSaving}
                              type="button"
                              aria-label={t("import.aiGenerateCover")}
                              data-voice-label={t("import.aiGenerateCover")}
                              data-voice-aliases="生成封面 重新生成封面 AI生成封面 regenerate cover generate cover ai generate cover"
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

                    {showVideoTasksPanel ? videoTasksPanel : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <Dialog
        open={isMediaImportDialogOpen}
        onOpenChange={(open) => {
          setIsMediaImportDialogOpen(open);
          if (!open) setIsDragging(false);
        }}
      >
        <DialogContent className="max-w-2xl rounded-[1.75rem] border-border p-0">
          <div className="p-6 sm:p-7">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">{t("import.chooseMedia")}</DialogTitle>
              <DialogDescription className="pt-2 text-sm">
                {t("import.orClickBrowse")}
              </DialogDescription>
            </DialogHeader>

            <div
              className={`mt-5 flex min-h-[18rem] flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed p-6 text-center transition-colors ${
                pendingMediaFile
                  ? "border-border bg-card"
                  : isDragging
                    ? "border-clay bg-clay/5"
                    : "border-border bg-card hover:border-clay/60"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={pendingMediaFile ? undefined : openMediaPicker}
              onKeyDown={(event) => {
                if (pendingMediaFile) return;

                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openMediaPicker();
                }
              }}
              role={pendingMediaFile ? undefined : "button"}
              tabIndex={!pendingMediaFile && canCreateAnotherVideoTask ? 0 : -1}
              aria-disabled={!canCreateAnotherVideoTask}
              aria-label={t("import.chooseMedia")}
              data-voice-label={t("import.chooseMedia")}
              data-voice-aliases="导入媒体 选择媒体 上传视频 上传音频 import media choose media upload video upload audio"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-foreground/30 bg-background">
                <FileVideo className="h-7 w-7" strokeWidth={1.25} />
              </div>
              {pendingMediaFile ? (
                <>
                  <h3 className="mx-auto mt-5 max-w-xl break-words font-display text-2xl">
                    {pendingMediaFile.name}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatBytes(pendingMediaFile.size)}
                  </p>
                  <div className="mt-6 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-6 py-3 text-sm hover:border-foreground disabled:opacity-50"
                      onClick={(event) => {
                        event.stopPropagation();
                        openMediaPicker();
                      }}
                      disabled={!canCreateAnotherVideoTask}
                      type="button"
                    >
                      <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                      {t("import.chooseMedia")}
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay disabled:opacity-50"
                      data-voice-label={t("import.startProcessing")}
                      data-voice-aliases="开始处理 开始整理 提取菜谱 整理视频 start processing process video extract recipe"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!hasElevenLabsKey) {
                          promptConfigureApiKey("elevenlabs", t, navigate);
                          return;
                        }
                        void startPipeline(pendingMediaFile);
                      }}
                      type="button"
                    >
                      <Wand2 className="h-4 w-4" strokeWidth={1.75} />
                      {t("import.startProcessing")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-5 text-sm font-medium leading-tight text-foreground sm:text-base">
                    {t("import.dropMedia")}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{t("import.orClickBrowse")}</p>
                  <button
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay disabled:opacity-50 sm:w-auto"
                    onClick={(event) => {
                      event.stopPropagation();
                      openMediaPicker();
                    }}
                    disabled={!canCreateAnotherVideoTask}
                    type="button"
                  >
                    <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                    {t("import.chooseMedia")}
                  </button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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




