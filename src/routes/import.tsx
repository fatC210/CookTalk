import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
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
  MessageCircleMore,
  Mic,
  Pencil,
  Plus,
  Sparkles,
  StopCircle,
  Trash2,
  UploadCloud,
  Wand2,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { ElevenLabsService } from "@/lib/elevenlabs";
import { DEFAULT_IMAGE_MODEL, ImageGenService, getConfiguredLLMService } from "@/lib/llm";
import { getApiKey } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { Recipe } from "@/lib/db";
import { speakWithElevenLabs, transcribeWithElevenLabs } from "@/lib/voice-pipeline";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { v4 as uuid } from "uuid";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Import - CookTalk" },
      {
        name: "description",
        content:
          "Import a cooking video or type a recipe manually, then save it into your recipe library.",
      },
    ],
  }),
  component: ImportPage,
});

type PipelineStage =
  | "idle"
  | "transcribing"
  | "structuring"
  | "generating-cover"
  | "preview"
  | "saving"
  | "done"
  | "error";

type ImportMode = "video" | "manual";
type FollowUpField = "servings" | "spiceLevel" | "notes" | "adjustments";
type FollowUpStatus = "idle" | "speaking" | "listening" | "transcribing" | "refining" | "done";
type FollowUpProgressState = "pending" | "answered" | "skipped";

type StructuredRecipe = {
  title: string;
  ingredients: { name: string; amount: string }[];
  steps: { order: number; description: string; durationSec?: number; tips?: string }[];
  tags: Recipe["tags"];
};

type FollowUpAnswers = Record<FollowUpField, string>;
type FollowUpProgress = Record<FollowUpField, FollowUpProgressState>;
type ManualIngredient = StructuredRecipe["ingredients"][number];
type ManualDifficulty = Exclude<Recipe["tags"]["difficulty"], undefined> | "";
type ManualStep = {
  description: string;
  durationMin: string;
  tips: string;
};

type ManualTextImportStatus = "idle" | "structuring";

const EMPTY_MANUAL_DIFFICULTY_VALUE = "__empty__";

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

function createEmptyIngredient(): ManualIngredient {
  return { name: "", amount: "" };
}

function createEmptyManualStep(): ManualStep {
  return { description: "", durationMin: "", tips: "" };
}

function createEmptyRecipeStep(order = 1): StructuredRecipe["steps"][number] {
  return { order, description: "", durationSec: undefined, tips: "" };
}

function createEmptyFollowUpAnswers(): FollowUpAnswers {
  return {
    servings: "",
    spiceLevel: "",
    notes: "",
    adjustments: "",
  };
}

function createEmptyFollowUpProgress(): FollowUpProgress {
  return {
    servings: "pending",
    spiceLevel: "pending",
    notes: "pending",
    adjustments: "pending",
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
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
  const adjustments = answers.adjustments.trim();

  return {
    ...recipe,
    tags: {
      ...recipe.tags,
      servings: servings ?? recipe.tags.servings,
      spiceLevel: spiceLevel || recipe.tags.spiceLevel,
      notes:
        notes || adjustments
          ? [recipe.tags.notes, notes, adjustments ? `额外调整：${adjustments}` : ""]
              .filter(Boolean)
              .join("；")
          : recipe.tags.notes,
    },
  };
}

async function persistRecipe(recipe: Omit<Recipe, "id" | "createdAt">): Promise<void> {
  await db.recipes.add({
    ...recipe,
    id: uuid(),
    createdAt: Date.now(),
  });
}

function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [mode, setMode] = useState<ImportMode>("video");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedMediaFile, setSelectedMediaFile] = useState<File | null>(null);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [structuredRecipe, setStructuredRecipe] = useState<StructuredRecipe | null>(null);
  const [coverImage, setCoverImage] = useState<Blob | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [videoCoverSource, setVideoCoverSource] = useState<Recipe["coverSource"]>("default");
  const [editTitle, setEditTitle] = useState("");
  const [editSteps, setEditSteps] = useState<StructuredRecipe["steps"]>([]);
  const [editIngredients, setEditIngredients] = useState<StructuredRecipe["ingredients"]>([]);
  const [editDifficulty, setEditDifficulty] = useState<ManualDifficulty>("");
  const [editTotalTime, setEditTotalTime] = useState("");

  const [followUpAnswers, setFollowUpAnswers] = useState<FollowUpAnswers>(
    createEmptyFollowUpAnswers(),
  );
  const [followUpProgress, setFollowUpProgress] = useState<FollowUpProgress>(
    createEmptyFollowUpProgress(),
  );
  const [followUpIndex, setFollowUpIndex] = useState(0);
  const [followUpInput, setFollowUpInput] = useState("");
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [followUpStatus, setFollowUpStatus] = useState<FollowUpStatus>("idle");
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [followUpStarted, setFollowUpStarted] = useState(false);
  const [followUpCompleted, setFollowUpCompleted] = useState(false);

  const [manualTitle, setManualTitle] = useState("");
  const [manualCuisine, setManualCuisine] = useState("");
  const [manualDifficulty, setManualDifficulty] = useState<ManualDifficulty>("");
  const [manualTotalTime, setManualTotalTime] = useState("");
  const [manualFlavors, setManualFlavors] = useState("");
  const [manualIngredients, setManualIngredients] = useState<ManualIngredient[]>([
    createEmptyIngredient(),
  ]);
  const [manualSteps, setManualSteps] = useState<ManualStep[]>([createEmptyManualStep()]);
  const [manualRawText, setManualRawText] = useState("");
  const [isManualTextDialogOpen, setIsManualTextDialogOpen] = useState(false);
  const [manualTextImportStatus, setManualTextImportStatus] =
    useState<ManualTextImportStatus>("idle");
  const [manualTextImportError, setManualTextImportError] = useState<string | null>(null);
  const [manualCoverImage, setManualCoverImage] = useState<Blob | null>(null);
  const [manualCoverPreviewUrl, setManualCoverPreviewUrl] = useState<string | null>(null);
  const [manualCoverSource, setManualCoverSource] = useState<Recipe["coverSource"]>("default");
  const [isManualGeneratingCover, setIsManualGeneratingCover] = useState(false);
  const [isManualSaving, setIsManualSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const manualCoverInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderTimeoutRef = useRef<number | null>(null);

  const MAX_SIZE = 200 * 1024 * 1024;

  const followUpQuestions = [
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
    {
      field: "adjustments" as const,
      label: "最终调整",
      question: "菜谱还有没有其他需要调整的？如果没有，你可以直接说没有，或直接进入下一步。",
      placeholder: "例如：少一点盐，把猪肝切薄一些；没有的话也可以留空",
    },
  ];

  const currentFollowUp = followUpQuestions[followUpIndex] ?? null;

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
    setEditIngredients((current) => [...current, createEmptyIngredient()]);
  };

  const removeEditIngredient = (index: number) => {
    setEditIngredients((current) =>
      current.length > 1 ? current.filter((_, itemIndex) => itemIndex !== index) : [createEmptyIngredient()],
    );
  };

  const updateEditStep = (
    index: number,
    patch: Partial<StructuredRecipe["steps"][number]>,
  ) => {
    setEditSteps((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch, order: itemIndex + 1 } : item,
      ),
    );
  };

  const addEditStep = () => {
    setEditSteps((current) => [...current, createEmptyRecipeStep(current.length + 1)]);
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

  const selectFollowUpQuestion = (index: number) => {
    const question = followUpQuestions[index];
    if (!question || followUpBusy) return;
    setFollowUpIndex(index);
    setFollowUpInput(followUpAnswers[question.field] ?? "");
    setFollowUpPrompt(question.question);
    setFollowUpError(null);
  };

  const stopAnswerRecording = () => {
    if (recorderTimeoutRef.current) {
      window.clearTimeout(recorderTimeoutRef.current);
      recorderTimeoutRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  };

  const cleanupAnswerRecording = () => {
    if (recorderTimeoutRef.current) {
      window.clearTimeout(recorderTimeoutRef.current);
      recorderTimeoutRef.current = null;
    }
    recorderRef.current = null;
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  };

  const resetFollowUpFlow = () => {
    setFollowUpAnswers(createEmptyFollowUpAnswers());
    setFollowUpProgress(createEmptyFollowUpProgress());
    setFollowUpIndex(0);
    setFollowUpInput("");
    setFollowUpPrompt("");
    setFollowUpStatus("idle");
    setFollowUpError(null);
    setFollowUpStarted(false);
    setFollowUpCompleted(false);
    cleanupAnswerRecording();
  };

  const resetVideoDraft = () => {
    stopAnswerRecording();
    cleanupAnswerRecording();
    setSelectedMediaFile(null);
    setStage("idle");
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
    resetFollowUpFlow();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetManualDraft = () => {
    setManualTitle("");
    setManualCuisine("");
    setManualDifficulty("");
    setManualTotalTime("");
    setManualFlavors("");
    setManualIngredients([createEmptyIngredient()]);
    setManualSteps([createEmptyManualStep()]);
    setManualRawText("");
    setIsManualTextDialogOpen(false);
    setManualTextImportStatus("idle");
    setManualTextImportError(null);
    setManualCoverImage(null);
    setManualCoverSource("default");
    setIsManualGeneratingCover(false);
    if (manualCoverInputRef.current) manualCoverInputRef.current.value = "";
  };

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

  const selectFile = (file: File) => {
    const fileError = validateFile(file);
    if (fileError) {
      toast.error(fileError);
      return;
    }
    setMode("video");
    setSelectedMediaFile(file);
    setStage("idle");
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
    resetFollowUpFlow();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) selectFile(file);
  };

  const askFollowUpQuestion = async (index: number) => {
    const question = followUpQuestions[index];
    if (!question) return;
    stopAnswerRecording();
    cleanupAnswerRecording();
    setFollowUpError(null);
    setFollowUpPrompt(question.question);
    setFollowUpStatus("speaking");

    try {
      await speakWithElevenLabs(question.question);
    } catch (err) {
      console.warn("Follow-up voice prompt failed:", err);
      toast.warning(t("import.followUpVoiceWarning"));
    } finally {
      setFollowUpStatus((current) => (current === "speaking" ? "idle" : current));
    }
  };

  const isSkipAnswer = (value: string) => /^(跳过|不用|不需要|没有|无|skip)$/i.test(value.trim());

  const getAppliedAnswerPatch = (
    field: FollowUpField,
    answer: string,
  ): Partial<FollowUpAnswers> => ({
    [field]: isSkipAnswer(answer) ? "" : answer.trim(),
  });

  const startAnswerRecording = async () => {
    if (followUpStatus === "speaking" || followUpStatus === "refining") return;

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
          const answer = (await transcribeWithElevenLabs(audioBlob)).trim();
          setFollowUpInput(answer);
          toast.success(t("import.followUpTranscriptReady"));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : t("import.followUpTranscribeFailed");
          setFollowUpError(message);
          toast.error(message);
        } finally {
          setFollowUpStatus("idle");
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
      const nextRecipe = llmService
        ? ((await llmService.refineRecipeWithAnswers(structuredRecipe, answers)) as StructuredRecipe)
        : buildFallbackRefinedRecipe(structuredRecipe, answers);

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

  const handleFollowUpSubmit = async () => {
    if (!currentFollowUp) return;
    const answer = followUpInput.trim();
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

    resetFollowUpFlow();

    try {
      setStage("transcribing");
      const elevenLabsKey = await getApiKey("elevenlabs");
      if (!elevenLabsKey) {
        throw new Error(t("import.elevenLabsKeyMissing"));
      }
      const sttService = new ElevenLabsService(elevenLabsKey);
      const rawTranscript = await sttService.speechToText(selectedMediaFile);
      setTranscript(rawTranscript);

      setStage("structuring");
      let recipe: StructuredRecipe | null = null;
      const llmService = await getConfiguredLLMService();

      if (!llmService) {
        toast.warning(t("import.llmKeyWarning"));
      } else {
        recipe = (await llmService.structureRecipe(rawTranscript)) as StructuredRecipe;
        syncRecipeEditor(recipe);
      }

      setStage("preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : t("import.pipelineFailed");
      setError(message);
      setStage("error");
      toast.error(message);
    }
  };

  const handleSaveVideo = async () => {
    setStage("saving");
    try {
      const title =
        editTitle.trim() || structuredRecipe?.title?.trim() || t("import.untitledRecipe");
      const ingredients = editIngredients
        .map((item) => ({
          name: item.name.trim(),
          amount: item.amount.trim(),
        }))
        .filter((item) => item.name);
      const steps = editSteps
        .map((step, index) => ({
          order: index + 1,
          description: step.description.trim(),
          durationSec: step.durationSec,
          tips: step.tips?.trim() || undefined,
        }))
        .filter((step) => step.description);

      const totalTimeMin = parsePositiveInt(editTotalTime);

      await persistRecipe({
        title,
        ingredients,
        steps,
        tags: {
          ...(structuredRecipe?.tags ?? {}),
          difficulty: editDifficulty || undefined,
          totalTimeMin,
        },
        coverSource: coverImage ? videoCoverSource : "default",
        coverImage: coverImage ?? undefined,
        rawTranscript: transcript || undefined,
      });

      setStage("done");
      toast.success(t("import.recipeSaved"));
      window.setTimeout(() => navigate({ to: "/recipes" }), 900);
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

    const ingredients = manualIngredients
      .map((item) => ({
        name: item.name.trim(),
        amount: item.amount.trim(),
      }))
      .filter((item) => item.name);

    const steps = manualSteps
      .map((step, index) => {
        const durationMin = parsePositiveInt(step.durationMin);
        return {
          order: index + 1,
          description: step.description.trim(),
          durationSec: durationMin ? durationMin * 60 : undefined,
          tips: step.tips.trim() || undefined,
        };
      })
      .filter((step) => step.description);

    if (steps.length === 0) {
      toast.error(t("import.manualStepRequired"));
      return;
    }

    const flavors = manualFlavors
      .split(/[\uFF0C,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const totalTimeMin = parsePositiveInt(manualTotalTime);

    setIsManualSaving(true);
    try {
      await persistRecipe({
        title,
        ingredients,
        steps,
        tags: {
          cuisine: manualCuisine.trim() || undefined,
          difficulty: manualDifficulty || undefined,
          flavor: flavors.length > 0 ? flavors : undefined,
          totalTimeMin,
        },
        coverSource: manualCoverImage ? manualCoverSource : "default",
        coverImage: manualCoverImage ?? undefined,
      });

      toast.success(t("import.manualSaved"));
      window.setTimeout(() => navigate({ to: "/recipes" }), 900);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("import.saveFailed");
      toast.error(message);
    } finally {
      setIsManualSaving(false);
    }
  };

  const applyStructuredRecipeToManualForm = (recipe: StructuredRecipe) => {
    setManualTitle(recipe.title?.trim() ?? "");
    setManualCuisine(recipe.tags.cuisine?.trim() ?? "");
    setManualDifficulty(recipe.tags.difficulty ?? "");
    setManualTotalTime(
      recipe.tags.totalTimeMin && recipe.tags.totalTimeMin > 0
        ? String(recipe.tags.totalTimeMin)
        : "",
    );
    setManualFlavors(recipe.tags.flavor?.join("、") ?? "");
    setManualIngredients(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((item) => ({
            name: item.name ?? "",
            amount: item.amount ?? "",
          }))
        : [createEmptyIngredient()],
    );
    setManualSteps(
      recipe.steps.length > 0
        ? recipe.steps.map((step) => ({
            description: step.description ?? "",
            durationMin:
              step.durationSec && step.durationSec > 0
                ? String(Math.max(1, Math.round(step.durationSec / 60)))
                : "",
            tips: step.tips ?? "",
          }))
        : [createEmptyManualStep()],
    );
  };

  const handleStructureManualText = async () => {
    const rawText = manualRawText.trim();
    if (!rawText) {
      toast.error(t("import.manualTextRequired"));
      return;
    }

    setManualTextImportStatus("structuring");
    setManualTextImportError(null);

    try {
      const llmService = await getConfiguredLLMService();
      if (!llmService) {
        throw new Error(t("import.manualTextLlmRequired"));
      }

      const recipe = (await llmService.structureRecipeFromText(rawText)) as StructuredRecipe;
      applyStructuredRecipeToManualForm(recipe);
      setIsManualTextDialogOpen(false);
      setManualTextImportStatus("idle");
      toast.success(t("import.manualTextStructured"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("import.manualTextStructureFailed");
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
      return;
    }
    setCoverImage(file);
    setVideoCoverSource("user");
  };

  const handleManualCoverInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("import.invalidCover"));
      return;
    }
    setManualCoverImage(file);
    setManualCoverSource("user");
  };

  const handleRegenerateCover = async () => {
    if (!structuredRecipe) return;

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
      const message = err instanceof Error ? err.message : t("import.coverGenerationWarning");
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
      const message = err instanceof Error ? err.message : t("import.coverGenerationWarning");
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
  }, []);

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
    if (stage !== "preview" || !structuredRecipe || followUpStarted) return;

    setFollowUpStarted(true);
    setFollowUpIndex(0);
    setFollowUpInput("");
    void askFollowUpQuestion(0);
  }, [stage, structuredRecipe, followUpStarted]);

  const isRunning = [
    "transcribing",
    "structuring",
    "generating-cover",
    "saving",
  ].includes(stage);
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

  const guidedStepIndex =
    stage === "idle"
      ? 0
      : stage === "transcribing" ||
          stage === "structuring" ||
          stage === "error"
        ? 1
        : !previewRecipe || !followUpCompleted
          ? 2
          : 3;

  const guidedSteps = [
    {
      label: t("import.guided.step1Label"),
      title: t("import.guided.step1Title"),
    },
    {
      label: t("import.guided.step2Label"),
      title: t("import.guided.step2Title"),
    },
    {
      label: t("import.guided.step3Label"),
      title: t("import.guided.step3Title"),
    },
    {
      label: t("import.guided.step4Label"),
      title: t("import.guided.step4Title"),
    },
  ];

  const isPreviewStage = stage === "preview" || stage === "saving" || stage === "done";
  const isGeneratingCover = stage === "generating-cover";
  const showGuidedFollowUp = Boolean(previewRecipe && isPreviewStage && !followUpCompleted);
  const showGuidedCover = Boolean(previewRecipe && isPreviewStage && followUpCompleted);
  const showVideoSidebar = showGuidedFollowUp || showGuidedCover;
  const answeredFollowUpCount = followUpQuestions.filter(
    (item) => followUpProgress[item.field] !== "pending",
  ).length;
  const followUpBusy =
    followUpStatus === "speaking" ||
    followUpStatus === "listening" ||
    followUpStatus === "transcribing" ||
    followUpStatus === "refining";
  const isManualTextStructuring = manualTextImportStatus === "structuring";

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container">
          <span className="page-kicker">{t("import.subtitle")}</span>
          <h1 className="page-title">{t("import.title")}</h1>
          <p className="page-description">
            {t("import.description")} {t("import.orSay")}{" "}
            <span className="font-mono text-foreground">"{t("import.importNewRecipe")}"</span>
          </p>

          <div className="mt-6 inline-flex rounded-full border border-border bg-card p-1">
            <button
              type="button"
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

          {mode === "video" && (
            <div className="import-stepper mt-8">
              {guidedSteps.map((item, index) => {
                const isCurrent = guidedStepIndex === index;
                const isDone = index < guidedStepIndex || (index === 3 && stage === "done");

                return (
                  <div key={item.label} className="import-stepper-item">
                    {index > 0 ? (
                      <div
                        aria-hidden="true"
                        className={`import-stepper-line ${
                          isDone ? "bg-clay/30" : "bg-border/80"
                        }`}
                      />
                    ) : null}
                    <div className="flex flex-col items-center text-center">
                      <span
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm font-medium transition-colors ${
                          isCurrent
                            ? "border-clay bg-clay text-background shadow-[0_10px_24px_-16px_oklch(0.48_0.04_55_/_0.6)]"
                            : isDone
                              ? "border-clay/30 bg-card text-clay"
                              : "border-border bg-card/70 text-muted-foreground"
                        }`}
                      >
                        {isDone ? <CheckCircle2 className="h-4 w-4" strokeWidth={2} /> : index + 1}
                      </span>
                      <span
                        className={`mt-3 text-sm transition-colors ${
                          isCurrent ? "text-clay" : "text-foreground"
                        }`}
                      >
                        {item.title}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="flex-1">
        <div className="page-content-container">
          <div className="grid gap-8 lg:grid-cols-12">
            <div
              className={`min-w-0 space-y-6 ${
                mode === "video"
                  ? showVideoSidebar
                    ? "lg:col-span-7"
                    : "lg:col-span-12 lg:mx-auto lg:max-w-4xl"
                  : "lg:col-span-8"
              }`}
            >
              {mode === "video" && stage === "idle" && (
                <>
                  <div
                    className={`relative rounded-[2rem] border-2 border-dashed p-6 text-center transition-colors sm:p-14 ${
                      isDragging ? "border-clay bg-clay/5" : "border-border bg-card hover:border-clay/60"
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <VoiceBadge n={1} className="absolute left-5 top-5" />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/flac,audio/x-flac,audio/webm,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.flac"
                      className="hidden"
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
                          onClick={(e) => {
                            e.stopPropagation();
                            void startPipeline();
                          }}
                        >
                          <Wand2 className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.startProcessing")}
                        </button>
                      </>
                    ) : (
                      <>
                        <h3 className="mt-6 font-display text-2xl sm:text-3xl">{t("import.dropMedia")}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">{t("import.orClickBrowse")}</p>
                        <button
                          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay sm:w-auto"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                        >
                          <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.chooseMedia")}
                        </button>
                      </>
                    )}
                    <VoiceHint className="mt-6 justify-center">{t("import.orSaySelect")}</VoiceHint>
                  </div>

                </>
              )}

              {mode === "video" &&
                (stage === "transcribing" || stage === "structuring") && (
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
                  </div>
                )}

              {mode === "video" && stage === "error" && (
                <div className="rounded-[2rem] border border-destructive/40 bg-destructive/5 p-8 text-center sm:p-12">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-destructive/30">
                    <XCircle className="h-9 w-9 text-destructive" strokeWidth={1.25} />
                  </div>
                  <h3 className="mt-6 font-display text-2xl text-destructive sm:text-3xl">{t("import.failed")}</h3>
                  <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{error}</p>
                  <button
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay sm:w-auto"
                    onClick={resetVideoDraft}
                  >
                    {t("import.retry")}
                  </button>
                </div>
              )}

              {mode === "video" && isPreviewStage && previewRecipe && showGuidedFollowUp && (
                <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                        {t("import.guided.step3Label")}
                      </span>
                      <h3 className="mt-2 font-display text-2xl sm:text-3xl">{t("import.guided.step3Title")}</h3>
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
                          <h4 className="mt-2 break-words font-display text-2xl sm:text-3xl">{previewRecipe.title}</h4>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-clay/25 bg-clay/10 px-3 py-1.5 text-xs text-clay">
                          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                          {t("import.followUpPending")}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {previewRecipe.tags.cuisine && <span className="rounded-full border border-border px-3 py-1 text-xs">{previewRecipe.tags.cuisine}</span>}
                        {previewRecipe.tags.difficulty && <span className="rounded-full border border-border px-3 py-1 text-xs">{t(`recipes.difficulty.${previewRecipe.tags.difficulty}`)}</span>}
                        {previewRecipe.tags.totalTimeMin && <span className="rounded-full border border-border px-3 py-1 text-xs">{t("recipes.minutes", { count: previewRecipe.tags.totalTimeMin })}</span>}
                        {previewRecipe.tags.servings && <span className="rounded-full border border-border px-3 py-1 text-xs">{t("recipeDetail.serves", { count: previewRecipe.tags.servings })}</span>}
                        {previewRecipe.tags.spiceLevel && <span className="rounded-full border border-border px-3 py-1 text-xs">{previewRecipe.tags.spiceLevel}</span>}
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-xs font-medium text-muted-foreground">{t("import.manualDifficulty")}</span>
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
                          <span className="text-xs font-medium text-muted-foreground">{t("import.manualTotalTime")}</span>
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
                          <div className="text-xs uppercase tracking-[0.18em] text-clay">{t("import.followUp.notesLabel")}</div>
                          <p className="mt-2 text-sm text-foreground/85">{previewRecipe.tags.notes}</p>
                        </div>
                      )}

                      <div className="mt-8">
                        <div className="flex items-center justify-between gap-3">
                          <h5 className="text-sm font-medium">{t("import.manualIngredients")}</h5>
                          <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                            {previewRecipe.ingredients.length}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                          {previewRecipe.ingredients.map((ingredient, index) => (
                            <div
                              key={`${ingredient.name}-${index}`}
                              className="rounded-2xl border border-border bg-background px-3 py-3"
                            >
                              <div className="grid gap-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                    {t("import.manualIngredients")}
                                  </span>
                                  <button
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
                                    onClick={() => removeEditIngredient(index)}
                                    type="button"
                                  >
                                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                                  </button>
                                </div>
                                <input
                                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-clay"
                                  value={editIngredients[index]?.name ?? ""}
                                  onChange={(e) => updateEditIngredient(index, { name: e.target.value })}
                                  placeholder={t("import.manualIngredientName")}
                                />
                                <input
                                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-clay"
                                  value={editIngredients[index]?.amount ?? ""}
                                  onChange={(e) => updateEditIngredient(index, { amount: e.target.value })}
                                  placeholder={t("import.manualIngredientAmount")}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                          onClick={addEditIngredient}
                          type="button"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.75} />
                          {t("import.manualAddIngredient")}
                        </button>
                      </div>

                      <div className="mt-8">
                        <div className="flex items-center justify-between gap-3">
                          <h5 className="text-sm font-medium">{t("import.manualSteps")}</h5>
                          <button
                            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                            onClick={addEditStep}
                            type="button"
                          >
                            <Plus className="h-4 w-4" strokeWidth={1.75} />
                            {t("import.manualAddStep")}
                          </button>
                        </div>
                        <div className="mt-3 space-y-2">
                          {previewRecipe.steps.map((step, index) => (
                            <div key={index} className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4">
                              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-foreground/40 font-display text-xs">
                                {index + 1}
                              </span>
                              <div className="flex-1 space-y-3">
                                <div className="flex justify-end">
                                  <button
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
                                    onClick={() => removeEditStep(index)}
                                    type="button"
                                  >
                                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                                  </button>
                                </div>
                                <textarea
                                  className="min-h-[88px] w-full resize-none rounded-xl border border-border bg-card px-3 py-3 text-sm outline-none focus:border-clay"
                                  value={editSteps[index]?.description ?? ""}
                                  rows={3}
                                  onChange={(e) =>
                                    updateEditStep(index, { description: e.target.value })
                                  }
                                  placeholder={t("import.manualStepDescription")}
                                />
                                <input
                                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                                  value={editSteps[index]?.tips ?? ""}
                                  onChange={(e) => updateEditStep(index, { tips: e.target.value })}
                                  placeholder={t("import.manualStepTips")}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        <button className="w-full rounded-full border border-border px-5 py-3 text-sm hover:border-foreground sm:w-auto" onClick={resetVideoDraft}>
                          {t("import.startOver")}
                        </button>
                      </div>
                  </div>
                </div>
              )}

              {mode === "video" && isPreviewStage && previewRecipe && showGuidedCover && (
                <>
                  <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                          {t("import.guided.step4Label")}
                        </span>
                        <h3 className="mt-2 font-display text-2xl sm:text-3xl">{t("import.readyToSave")}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">{t("import.step4Helper")}</p>
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
                      {previewRecipe.tags.cuisine && <span className="rounded-full border border-border px-3 py-1 text-xs">{previewRecipe.tags.cuisine}</span>}
                      {previewRecipe.tags.difficulty && <span className="rounded-full border border-border px-3 py-1 text-xs">{t(`recipes.difficulty.${previewRecipe.tags.difficulty}`)}</span>}
                      {previewRecipe.tags.totalTimeMin && <span className="rounded-full border border-border px-3 py-1 text-xs">{t("recipes.minutes", { count: previewRecipe.tags.totalTimeMin })}</span>}
                      {previewRecipe.tags.servings && <span className="rounded-full border border-border px-3 py-1 text-xs">{t("recipeDetail.serves", { count: previewRecipe.tags.servings })}</span>}
                      {previewRecipe.tags.spiceLevel && <span className="rounded-full border border-border px-3 py-1 text-xs">{previewRecipe.tags.spiceLevel}</span>}
                    </div>

                    {previewRecipe.tags.notes && (
                      <div className="mt-6 rounded-2xl border border-clay/20 bg-clay/8 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-clay">{t("import.followUp.notesLabel")}</div>
                        <p className="mt-2 text-sm text-foreground/85">{previewRecipe.tags.notes}</p>
                      </div>
                    )}

                    <div className="mt-8">
                      <div className="flex items-center justify-between gap-3">
                        <h5 className="text-sm font-medium">{t("import.manualIngredients")}</h5>
                        <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                          {previewRecipe.ingredients.length}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {previewRecipe.ingredients.map((ingredient, index) => (
                          <div key={`${ingredient.name}-${index}`} className="rounded-2xl border border-border bg-background p-3">
                            <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                              <input
                                className="rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-clay"
                                value={editIngredients[index]?.name ?? ""}
                                onChange={(e) => updateEditIngredient(index, { name: e.target.value })}
                                placeholder={t("import.manualIngredientName")}
                              />
                              <input
                                className="rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-clay"
                                value={editIngredients[index]?.amount ?? ""}
                                onChange={(e) => updateEditIngredient(index, { amount: e.target.value })}
                                placeholder={t("import.manualIngredientAmount")}
                              />
                              <button
                                className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
                                onClick={() => removeEditIngredient(index)}
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-8">
                      <h5 className="text-sm font-medium">{t("import.manualSteps")}</h5>
                      <div className="mt-3 space-y-2">
                        {previewRecipe.steps.map((step, index) => (
                          <div key={index} className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4">
                            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-foreground/40 font-display text-xs">
                              {index + 1}
                            </span>
                            <div className="flex-1 space-y-3">
                              <textarea
                                className="min-h-[88px] w-full resize-none rounded-xl border border-border bg-card px-3 py-3 text-sm outline-none focus:border-clay"
                                value={editSteps[index]?.description ?? ""}
                                rows={3}
                                onChange={(e) => updateEditStep(index, { description: e.target.value })}
                              />
                              <div className="flex gap-3">
                                <input
                                  className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                                  value={editSteps[index]?.tips ?? ""}
                                  onChange={(e) => updateEditStep(index, { tips: e.target.value })}
                                  placeholder={t("import.manualStepTips")}
                                />
                                <button
                                  className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
                                  onClick={() => removeEditStep(index)}
                                  type="button"
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-8 flex flex-wrap gap-3">
                      <button className="rounded-full border border-border px-5 py-3 text-sm hover:border-foreground" onClick={resetVideoDraft}>
                        {t("import.startOver")}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-8">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                            {t("import.guided.step4Label")}
                          </span>
                          <h3 className="mt-2 font-display text-2xl sm:text-3xl">{t("import.coverStepTitle")}</h3>
                          <p className="mt-2 text-sm text-muted-foreground">{t("import.coverStepBody")}</p>
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
                        <div className="overflow-hidden rounded-[1.75rem] border border-border bg-background aspect-[4/3]">
                          {coverPreviewUrl ? (
                            <img src={coverPreviewUrl} alt={previewRecipe.title} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground">
                              <ImageIcon className="h-10 w-10" strokeWidth={1.25} />
                            </div>
                          )}
                        </div>

                        <div className="space-y-4">
                          <div className="rounded-2xl border border-border bg-background p-4">
                            <div className="text-sm font-medium">{t("import.coverCurrentState")}</div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {coverImage ? t("import.coverReady") : t("import.coverMissing")}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <button
                              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-3 text-sm hover:border-foreground"
                              onClick={() => coverInputRef.current?.click()}
                            >
                              <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                              {t("import.uploadCover")}
                            </button>
                            <button
                              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-3 text-sm hover:border-foreground disabled:opacity-50"
                              onClick={() => void handleRegenerateCover()}
                              disabled={isGeneratingCover || stage === "saving"}
                            >
                              {isGeneratingCover ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t("import.generatingCover")}
                                </>
                              ) : (
                                <>
                                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                                  {t("import.regenerateCover")}
                                </>
                              )}
                            </button>
                          </div>

                          <VoiceHint>{t("import.coverVoiceHint")}</VoiceHint>

                          <button
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm text-background hover:bg-clay disabled:opacity-50"
                            onClick={() => void handleSaveVideo()}
                            disabled={stage === "saving" || stage === "done"}
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
                                <VoiceBadge className="!border-background/40 !bg-transparent !text-background !opacity-100" n={2} />
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
                    <div className="mt-5 flex gap-2">
                      <button
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay disabled:opacity-50"
                        onClick={() => void handleSaveVideo()}
                        disabled={stage === "saving" || stage === "done"}
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
                          t("import.saveTranscript")
                        )}
                      </button>
                      <button
                        className="rounded-full border border-border px-5 py-2.5 text-sm hover:border-foreground"
                        onClick={resetVideoDraft}
                      >
                        {t("import.startOver")}
                      </button>
                    </div>
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

                    <TooltipProvider delayDuration={120}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="inline-flex h-10 w-10 shrink-0 appearance-none items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-foreground shadow-none ring-0 transition-colors hover:border-border hover:bg-transparent hover:text-clay focus-visible:border-border focus-visible:ring-0 active:bg-transparent disabled:opacity-50"
                            onClick={() => setIsManualTextDialogOpen(true)}
                            disabled={isManualSaving}
                            type="button"
                            aria-label={t("import.manualTextOpenDialog")}
                          >
                            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t("import.manualTextTooltip")}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  <VoiceHint className="mt-4">{t("import.manualVoiceHint")}</VoiceHint>

                  <Dialog open={isManualTextDialogOpen} onOpenChange={setIsManualTextDialogOpen}>
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
                            className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm text-background hover:bg-clay disabled:opacity-50"
                            onClick={() => void handleStructureManualText()}
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

                  <div className="mt-8">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-display text-xl">{t("import.manualIngredients")}</h4>
                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                        onClick={() =>
                          setManualIngredients((current) => [...current, createEmptyIngredient()])
                        }
                        type="button"
                      >
                        <Plus className="h-4 w-4" strokeWidth={1.75} />
                        {t("import.manualAddIngredient")}
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {manualIngredients.map((ingredient, index) => (
                        <div
                          key={index}
                          className="rounded-2xl border border-border bg-background p-4"
                        >
                          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
                            <input
                              className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                              value={ingredient.name}
                              onChange={(e) =>
                                setManualIngredients((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, name: e.target.value }
                                      : item,
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
                            <button
                              className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2.5 text-sm transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 disabled:opacity-50"
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
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-8">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-display text-xl">{t("import.manualSteps")}</h4>
                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:border-foreground"
                        onClick={() =>
                          setManualSteps((current) => [...current, createEmptyManualStep()])
                        }
                        type="button"
                      >
                        <Plus className="h-4 w-4" strokeWidth={1.75} />
                        {t("import.manualAddStep")}
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {manualSteps.map((step, index) => (
                        <div
                          key={index}
                          className="rounded-2xl border border-border bg-background p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-display text-sm">
                              {t("import.step", { count: index + 1 })}
                            </span>
                            <button
                              className="inline-flex items-center justify-center rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:border-destructive/35 disabled:opacity-50"
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
                          </div>

                          <textarea
                            className="mt-3 w-full resize-none rounded-xl border border-border bg-card px-3 py-3 text-sm outline-none focus:border-clay"
                            value={step.description}
                            onChange={(e) =>
                              setManualSteps((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, description: e.target.value }
                                    : item,
                                ),
                              )
                            }
                            rows={3}
                            placeholder={t("import.manualStepDescription")}
                          />

                          <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
                            <input
                              className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                              value={step.durationMin}
                              onChange={(e) =>
                                setManualSteps((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, durationMin: e.target.value }
                                      : item,
                                  ),
                                )
                              }
                              placeholder={t("import.manualStepDuration")}
                              inputMode="numeric"
                            />
                            <input
                              className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
                              value={step.tips}
                              onChange={(e) =>
                                setManualSteps((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, tips: e.target.value } : item,
                                  ),
                                )
                              }
                              placeholder={t("import.manualStepTips")}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-8 rounded-[2rem] border border-border bg-background p-5 sm:p-6">
                    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                      <button
                        className="group relative aspect-[4/3] overflow-hidden rounded-[1.5rem] border border-border bg-card text-left transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => manualCoverInputRef.current?.click()}
                        disabled={isManualSaving}
                        type="button"
                      >
                        {manualCoverPreviewUrl ? (
                          <>
                            <img
                              src={manualCoverPreviewUrl}
                              alt={manualTitle.trim() || t("import.untitledRecipe")}
                              className="h-full w-full object-cover"
                            />
                            <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/45 via-black/10 to-transparent p-4 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                              <span className="rounded-full bg-white/90 px-3 py-1 text-xs text-foreground">
                                {t("import.uploadCover")}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                            <ImageIcon className="h-10 w-10" strokeWidth={1.25} />
                            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground">
                              <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                              {t("import.uploadCover")}
                            </span>
                          </div>
                        )}
                      </button>

                      <div className="flex items-start">
                        <button
                          className="inline-flex min-h-14 items-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm hover:border-foreground disabled:opacity-50"
                          onClick={() => void handleRegenerateManualCover()}
                          disabled={isManualGeneratingCover || isManualSaving}
                          type="button"
                        >
                          {isManualGeneratingCover ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t("import.generatingCover")}
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                              {t("import.aiGenerateCover")}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay disabled:opacity-50 sm:flex-1"
                      onClick={() => void handleSaveManual()}
                      disabled={isManualSaving}
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
                    >
                      {t("import.manualReset")}
                    </button>
                  </div>
                </div>
              )}

              {mode === "video" && !showVideoSidebar && (
                <div className="flex justify-center">
                  <button
                    onClick={() => navigate({ to: "/recipes" })}
                    className="inline-flex text-sm text-clay hover:underline"
                  >
                    {t("import.viewRecipes")} {">"}
                  </button>
                </div>
              )}
            </div>
            {(mode === "manual" || showVideoSidebar) && (
              <div className={`min-w-0 ${showVideoSidebar ? "lg:col-span-5" : "lg:col-span-4"}`}>
              {mode === "video" ? (
                <div className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
                  {showGuidedFollowUp ? (
                    <>
                      <div className="rounded-[2rem] border border-border bg-card p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background">
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
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                                {t("import.followUpStepTag")}
                              </div>
                              <h4 className="font-display text-2xl">{t("import.followUpPanelTitle")}</h4>
                            </div>
                          </div>
                          <span className="inline-flex items-center gap-2 rounded-full border border-clay/25 bg-clay/10 px-4 py-2 text-xs text-clay">
                            <MessageCircleMore className="h-3.5 w-3.5" strokeWidth={1.75} />
                            {answeredFollowUpCount}/{followUpQuestions.length}
                          </span>
                        </div>
                        <div className="mt-5 space-y-4 rounded-[1.5rem] border border-border bg-background p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-card">
                              <AudioLines className="h-4 w-4 text-clay" strokeWidth={1.75} />
                            </div>
                            <div className="max-w-full rounded-[1.35rem] rounded-tl-sm border border-border bg-card px-4 py-3 sm:max-w-[88%]">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                {followUpStatus === "speaking"
                                  ? t("import.followUpSpeaking")
                                  : t("import.followUpPromptTitle")}
                              </div>
                              <p className="mt-2 text-sm leading-6 text-foreground">
                                {currentFollowUp?.question || t("import.followUpWaiting")}
                              </p>
                            </div>
                          </div>

                          {!!followUpInput.trim() && (
                            <div className="flex justify-end">
                              <div className="max-w-full rounded-[1.35rem] rounded-br-sm bg-clay px-4 py-3 text-sm leading-6 text-background shadow-sm sm:max-w-[88%]">
                                {followUpInput.trim()}
                              </div>
                            </div>
                          )}

                          {!!followUpAnswers[currentFollowUp?.field ?? "servings"]?.trim() &&
                            !followUpInput.trim() && (
                              <div className="flex justify-end">
                                <div className="max-w-full rounded-[1.35rem] rounded-br-sm bg-clay px-4 py-3 text-sm leading-6 text-background shadow-sm sm:max-w-[88%]">
                                  {followUpAnswers[currentFollowUp?.field ?? "servings"]}
                                </div>
                              </div>
                            )}

                          {followUpError && (
                            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                              {followUpError}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        {followUpQuestions.map((item, index) => {
                          const state = followUpProgress[item.field];
                          const answered = state === "answered";
                          const skipped = state === "skipped";
                          const isCurrent = index === followUpIndex;
                          return (
                            <button
                              key={item.field}
                              type="button"
                              onClick={() => selectFollowUpQuestion(index)}
                              className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
                                isCurrent
                                  ? "border-clay bg-clay/5"
                                  : answered
                                    ? "border-border bg-card"
                                    : "border-border bg-background/70"
                              } w-full text-left transition-colors hover:border-clay/40`}
                            >
                              <div className="min-w-0 pr-3">
                                <div className="text-sm font-medium">{item.label}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {answered
                                    ? followUpAnswers[item.field]
                                    : skipped
                                      ? "已跳过"
                                      : item.question}
                                </div>
                              </div>
                              <div
                                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${
                                  answered
                                    ? "border-clay/30 text-clay"
                                    : skipped
                                      ? "border-border bg-secondary text-muted-foreground"
                                    : isCurrent
                                      ? "border-clay bg-clay text-background"
                                      : "border-border text-muted-foreground"
                                }`}
                              >
                                {answered ? (
                                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                                ) : skipped ? (
                                  "-"
                                ) : (
                                  index + 1
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {currentFollowUp && (
                        <div className="rounded-[1.75rem] border border-border bg-card p-5">
                          <div className="text-sm font-medium">{currentFollowUp.label}</div>
                          <textarea
                            className="mt-4 min-h-[140px] w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay"
                            value={followUpInput}
                            onChange={(e) => setFollowUpInput(e.target.value)}
                            placeholder={currentFollowUp.placeholder}
                          />
                          <div className="mt-6 flex flex-wrap gap-3">
                            <button
                              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-3 text-sm hover:border-foreground disabled:opacity-50"
                              onClick={() => (followUpStatus === "listening" ? stopAnswerRecording() : void startAnswerRecording())}
                              disabled={followUpStatus === "speaking" || followUpStatus === "refining"}
                            >
                              {followUpStatus === "listening" ? (
                                <>
                                  <StopCircle className="h-4 w-4" strokeWidth={1.75} />
                                  {t("import.followUpStopRecording")}
                                </>
                              ) : followUpStatus === "transcribing" ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t("import.followUpTranscribing")}
                                </>
                              ) : (
                                <>
                                  <Mic className="h-4 w-4" strokeWidth={1.75} />
                                  {t("import.followUpRecordAnswer")}
                                </>
                              )}
                            </button>
                            <button
                              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-3 text-sm hover:border-foreground disabled:opacity-50"
                              onClick={() => void askFollowUpQuestion(followUpIndex)}
                              disabled={followUpStatus !== "idle" && followUpStatus !== "done"}
                            >
                              <AudioLines className="h-4 w-4" strokeWidth={1.75} />
                              {t("import.followUpReplay")}
                            </button>
                            <button
                              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-3 text-sm hover:border-foreground disabled:opacity-50"
                              onClick={() => void handleFollowUpSkip()}
                              disabled={followUpBusy}
                              type="button"
                            >
                              跳过问题
                            </button>
                            <button
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm text-background hover:bg-clay disabled:opacity-50"
                              onClick={() => void handleFollowUpSubmit()}
                              disabled={followUpBusy || !followUpInput.trim()}
                            >
                              {followUpStatus === "refining" ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t("import.followUpApplying")}
                                </>
                              ) : followUpIndex < followUpQuestions.length - 1 ? (
                                <>
                                  {t("import.followUpNext")}
                                  <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                                </>
                              ) : (
                                <>
                                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                                  应用这次调整
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      <button
                        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3.5 text-sm text-background hover:bg-clay disabled:opacity-50"
                        onClick={() => void handleFollowUpContinue()}
                        disabled={followUpBusy || answeredFollowUpCount < followUpQuestions.length}
                        type="button"
                      >
                        {followUpStatus === "refining" ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("import.followUpApplying")}
                          </>
                        ) : (
                          <>
                            直接进入下一步
                            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                          </>
                        )}
                      </button>
                    </>
                  ) : showGuidedCover ? (
                    <div className="rounded-[2rem] border border-border bg-card p-6">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-clay" strokeWidth={1.75} />
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                            {t("import.guided.step4Label")}
                          </div>
                          <h4 className="font-display text-2xl">{t("import.coverStepTitle")}</h4>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <button
                    onClick={() => navigate({ to: "/recipes" })}
                    className="inline-flex text-sm text-clay hover:underline"
                  >
                    {t("import.viewRecipes")} {">"}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
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
                  <button
                    onClick={() => navigate({ to: "/recipes" })}
                    className="inline-flex text-sm text-clay hover:underline"
                  >
                    {t("import.viewRecipes")} {">"}
                  </button>
                </div>
              )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
