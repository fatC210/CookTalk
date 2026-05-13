import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ChangeEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  Play,
  Pencil,
  Trash2,
  Share2,
  Volume2,
  Clock,
  Flame,
  ChefHat,
  RefreshCw,
  Check,
  ArrowLeft,
  UploadCloud,
  Sparkles,
  Plus,
  X,
  GripVertical,
} from "lucide-react";
import { db, deleteRecipe, type Recipe } from "@/lib/db";
import { getApiKey } from "@/lib/crypto";
import {
  DEFAULT_IMAGE_MODEL,
  ImageGenService,
  cleanStructuredRecipePayload,
  getConfiguredLLMService,
} from "@/lib/llm";
import appI18n from "@/lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  RecipeContentDisplayToggle,
  shouldShowIngredients,
  shouldShowSteps,
  type RecipeContentDisplayMode,
} from "@/components/recipe-content-display-toggle";
import {
  toCombinedVoiceOptions,
  useElevenLabsVoices,
  type ElevenLabsVoiceOption,
} from "@/hooks/use-elevenlabs-voices";
import { useAppStore } from "@/stores/app-store";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/recipe-detail")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || "",
  }),
  head: () => ({
    meta: [
      { title: appI18n.t("recipeDetail.metaTitle") },
      { name: "description", content: appI18n.t("recipeDetail.metaDescription") },
    ],
  }),
  component: DetailPage,
});

type RecipeVoiceOption = ElevenLabsVoiceOption;
type EditIngredient = { name: string; amount: string };
type EditStep = { description: string; durationMin: string; tips: string };
type EditDifficulty = Recipe["tags"]["difficulty"] | "";

function cleanEditedRecipe(recipe: Recipe, language: "en" | "zh", fallbackText?: string): Recipe {
  const cleaned = cleanStructuredRecipePayload(recipe, language, fallbackText);
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

function formatSaved(
  ts: number | undefined,
  locale: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!ts) return t("common.unknown");
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(ts));
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function createEmptyIngredient(): EditIngredient {
  return { name: "", amount: "" };
}

function createEmptyStep(): EditStep {
  return { description: "", durationMin: "", tips: "" };
}

function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  if (fromIndex >= items.length || toIndex >= items.length) return items;

  const next = [...items];
  const [movedItem] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, movedItem);
  return next;
}

function isEmptyIngredient(ingredient: EditIngredient) {
  return !ingredient.name.trim() && !ingredient.amount.trim();
}

function isEmptyStep(step: EditStep) {
  return !step.description.trim() && !step.durationMin.trim() && !step.tips.trim();
}

function isInteractiveDragTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(target.closest("input, textarea, button, select, [role='button']"))
    : false;
}

type EditPanelHeaderProps = {
  title: string;
  count?: number;
  action?: React.ReactNode;
  className?: string;
};

function EditPanelHeader({ title, count, action, className = "" }: EditPanelHeaderProps) {
  return (
    <div
      className={`sticky top-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/95 px-3 py-2 backdrop-blur lg:bg-card/95 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <h3 className="truncate text-sm font-medium">{title}</h3>
        {typeof count === "number" && (
          <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

type EditPanelProps = {
  children: React.ReactNode;
  className?: string;
};

function EditPanel({ children, className = "" }: EditPanelProps) {
  return (
    <section
      className={`scrollbar-hover min-h-0 space-y-5 rounded-3xl border border-border/70 bg-card/35 p-4 lg:overflow-y-auto ${className}`}
    >
      {children}
    </section>
  );
}

type StepDescriptionFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
  placeholder: string;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
};

function StepDescriptionField({
  value,
  onChange,
  onBlur,
  placeholder,
  textareaRef,
}: StepDescriptionFieldProps) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{placeholder}</span>
      <AutoResizeTextarea
        ref={textareaRef}
        className="overflow-y-hidden rounded-xl border border-border bg-card px-3 py-3 text-sm outline-none focus-visible:border-clay focus-visible:ring-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        minRows={1}
        maxRows={6}
      />
    </label>
  );
}

type StepMetadataFieldsProps = {
  durationValue: string;
  tipsValue: string;
  onDurationChange: (value: string) => void;
  onTipsChange: (value: string) => void;
  durationLabel: string;
  durationPlaceholder: string;
  durationUnit: string;
  tipsLabel: string;
  tipsPlaceholder: string;
};

function StepMetadataFields({
  durationValue,
  tipsValue,
  onDurationChange,
  onTipsChange,
  durationLabel,
  durationPlaceholder,
  durationUnit,
  tipsLabel,
  tipsPlaceholder,
}: StepMetadataFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">{durationLabel}</span>
        <div className="flex rounded-xl border border-border bg-card transition-colors focus-within:border-clay">
          <input
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
            value={durationValue}
            onChange={(event) => onDurationChange(event.target.value)}
            placeholder={durationPlaceholder}
            inputMode="numeric"
          />
          <span className="flex shrink-0 items-center border-l border-border px-3 text-xs text-muted-foreground">
            {durationUnit}
          </span>
        </div>
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">{tipsLabel}</span>
        <input
          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-clay"
          value={tipsValue}
          onChange={(event) => onTipsChange(event.target.value)}
          placeholder={tipsPlaceholder}
        />
      </label>
    </div>
  );
}

function DetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const cookingVoiceId = useAppStore((s) => s.cookingVoiceId);
  const hasLlmKey = useAppStore((s) => s.hasLlmKey);
  const hasImageGenKey = useAppStore((s) => s.hasImageGenKey);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const editIngredientNameRefs = useRef<Array<HTMLInputElement | null>>([]);
  const editStepDescriptionRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const draggedEditStepIndexRef = useRef<number | null>(null);
  const liveClonedVoices = useLiveQuery(() => db.voices.orderBy("createdAt").toArray(), []);
  const {
    options: elevenLabsVoiceOptions,
    isLoading: isLoadingElevenLabsVoices,
    error: elevenLabsVoicesError,
    hasElevenLabsKey,
  } = useElevenLabsVoices();

  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editCuisine, setEditCuisine] = useState("");
  const [editDifficulty, setEditDifficulty] = useState<EditDifficulty>("");
  const [editTotalTime, setEditTotalTime] = useState("");
  const [editFlavors, setEditFlavors] = useState("");
  const [editIngredients, setEditIngredients] = useState<EditIngredient[]>([
    createEmptyIngredient(),
  ]);
  const [editSteps, setEditSteps] = useState<EditStep[]>([createEmptyStep()]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [draggingEditStepIndex, setDraggingEditStepIndex] = useState<number | null>(null);
  const [dragOverEditStepIndex, setDragOverEditStepIndex] = useState<number | null>(null);
  const [detailDisplayMode, setDetailDisplayMode] = useState<RecipeContentDisplayMode>("all");
  const [editDisplayMode, setEditDisplayMode] = useState<RecipeContentDisplayMode>("all");
  const [expandedCoverPreview, setExpandedCoverPreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  useEffect(() => {
    document.title = recipe?.title ? `${recipe.title} - CookTalk` : t("recipeDetail.metaTitle");
  }, [recipe?.title, t, i18n.language]);

  const voiceOptions = useMemo<RecipeVoiceOption[]>(() => {
    const clonedVoices = liveClonedVoices ?? [];
    const formatClonedVoiceDescription = (voice: (typeof clonedVoices)[number]) => {
      const languageLabel = voice.language
        ? t(`voices.languages.${voice.language}`, { defaultValue: voice.language })
        : t("common.unknown");
      const voiceDescription =
        voice.description === "Cloned voice" ? t("voices.clonedVoice") : voice.description;

      return `${languageLabel} · ${voiceDescription || t("voices.clonedVoice")}`;
    };

    return toCombinedVoiceOptions(
      clonedVoices,
      elevenLabsVoiceOptions,
      formatClonedVoiceDescription,
    );
  }, [liveClonedVoices, elevenLabsVoiceOptions, t]);

  useEffect(() => {
    if (!id) {
      setRecipe(null);
      return;
    }
    db.recipes.get(id).then((r) => {
      if (!r) {
        setRecipe(null);
        return;
      }

      const cleaned = cleanEditedRecipe(
        r,
        i18n.language.startsWith("zh") ? "zh" : "en",
        r.rawTranscript,
      );
      setRecipe(cleaned);

      if (recipeNeedsContentUpdate(r, cleaned)) {
        void db.recipes.update(id, {
          title: cleaned.title,
          ingredients: cleaned.ingredients,
          steps: cleaned.steps,
          tags: cleaned.tags,
        });
      }
    });
  }, [id, i18n.language]);

  useEffect(() => {
    if (recipe?.coverImage) {
      const url = URL.createObjectURL(recipe.coverImage);
      setCoverUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setCoverUrl(null);
    }
  }, [recipe?.coverImage]);

  const syncEditForm = useCallback((currentRecipe: Recipe) => {
    setEditTitle(currentRecipe.title);
    setEditCuisine(currentRecipe.tags.cuisine ?? "");
    setEditDifficulty(currentRecipe.tags.difficulty ?? "");
    setEditTotalTime(
      currentRecipe.tags.totalTimeMin && currentRecipe.tags.totalTimeMin > 0
        ? String(currentRecipe.tags.totalTimeMin)
        : "",
    );
    setEditFlavors(currentRecipe.tags.flavor?.join("、") ?? "");
    setEditIngredients(
      currentRecipe.ingredients.length > 0
        ? currentRecipe.ingredients.map((item) => ({
            name: item.name,
            amount: item.amount,
          }))
        : [createEmptyIngredient()],
    );
    setEditSteps(
      currentRecipe.steps.length > 0
        ? currentRecipe.steps.map((step) => ({
            description: step.description,
            durationMin:
              step.durationSec && step.durationSec > 0
                ? String(Math.max(1, Math.round(step.durationSec / 60)))
                : "",
            tips: step.tips ?? "",
          }))
        : [createEmptyStep()],
    );
  }, []);

  const openEditDialog = useCallback(() => {
    if (!recipe) return;
    syncEditForm(recipe);
    setIsEditOpen(true);
  }, [recipe, syncEditForm]);

  const toggleChecked = useCallback((i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    await deleteRecipe(id);
    navigate({ to: "/recipes" });
  }, [id, navigate]);

  const handleExport = useCallback(() => {
    if (!recipe) return;
    const exportData = {
      ...recipe,
      coverImage: undefined,
      rawVideo: undefined,
      rawAudio: undefined,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recipe.title.replace(/\s+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recipe]);

  const handleStartCooking = useCallback(
    (stepIndex = 0) => {
      if (!id) return;
      navigate({ to: "/cook", search: { id, step: stepIndex } });
    },
    [id, navigate],
  );

  const handleCoverInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !id || !recipe) return;

      if (!file.type.startsWith("image/")) {
        toast.error(t("import.invalidCover"));
        event.target.value = "";
        return;
      }

      const nextRecipe = { ...recipe, coverImage: file, coverSource: "user" as const };
      setRecipe(nextRecipe);

      try {
        await db.recipes.update(id, { coverImage: file, coverSource: "user" });
        toast.success(t("recipeDetail.coverUploaded"));
      } catch (error) {
        setRecipe(recipe);
        toast.error(error instanceof Error ? error.message : t("recipeDetail.coverSaveFailed"));
      } finally {
        event.target.value = "";
      }
    },
    [id, recipe, t],
  );

  const handleGenerateCover = useCallback(async () => {
    if (!id || !recipe || isGeneratingCover) return;

    setIsGeneratingCover(true);
    try {
      const llmService = await getConfiguredLLMService();
      const imageKey = await getApiKey("imagegen-key");
      const imageEndpoint = await getApiKey("imagegen-endpoint");
      const imageModel = await getApiKey("imagegen-model");

      if (!llmService || !imageKey || !imageEndpoint) {
        toast.error(t("import.coverGenerationUnavailable"));
        return;
      }

      const imageService = new ImageGenService(
        imageEndpoint,
        imageKey,
        imageModel?.trim() || DEFAULT_IMAGE_MODEL,
      );
      const prompt = await llmService.generateCoverPrompt(recipe.title);
      const cover = await imageService.generateImage(prompt);
      const nextRecipe = { ...recipe, coverImage: cover, coverSource: "ai" as const };
      setRecipe(nextRecipe);
      await db.recipes.update(id, { coverImage: cover, coverSource: "ai" });
      toast.success(t("import.coverGenerated"));
    } catch (error) {
      const status =
        error instanceof Error ? error.message.match(/Image gen failed:\s*(\d+)/i)?.[1] : null;
      console.warn("Cover generation failed", status ? { status } : undefined);
      toast.error(t("import.coverGenerationFailed"));
    } finally {
      setIsGeneratingCover(false);
    }
  }, [id, isGeneratingCover, recipe, t]);

  const updateEditIngredient = useCallback((index: number, patch: Partial<EditIngredient>) => {
    setEditIngredients((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }, []);

  const updateEditStep = useCallback((index: number, patch: Partial<EditStep>) => {
    setEditSteps((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }, []);

  const handleEditIngredientBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>, index: number) => {
      const nextFocusedElement = event.relatedTarget;
      if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement)) return;
      setEditIngredients((current) => {
        const ingredient = current[index];
        if (!ingredient || !isEmptyIngredient(ingredient)) return current;
        return current.length > 1
          ? current.filter((_, itemIndex) => itemIndex !== index)
          : [createEmptyIngredient()];
      });
    },
    [],
  );

  const handleEditStepBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>, index: number) => {
      const nextFocusedElement = event.relatedTarget;
      if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement)) return;
      setEditSteps((current) => {
        const step = current[index];
        if (!step || !isEmptyStep(step)) return current;
        return current.length > 1
          ? current.filter((_, itemIndex) => itemIndex !== index)
          : [createEmptyStep()];
      });
    },
    [],
  );

  const addEditIngredient = useCallback(() => {
    setEditDisplayMode((current) => (current === "steps" ? "all" : current));
    setEditIngredients((current) => {
      const next = [createEmptyIngredient(), ...current];
      window.requestAnimationFrame(() => {
        editIngredientNameRefs.current[0]?.focus();
      });
      return next;
    });
  }, []);

  const addEditStep = useCallback(() => {
    setEditDisplayMode((current) => (current === "ingredients" ? "all" : current));
    setEditSteps((current) => {
      const next = [...current, createEmptyStep()];
      window.requestAnimationFrame(() => {
        editStepDescriptionRefs.current[next.length - 1]?.focus();
      });
      return next;
    });
  }, []);

  const moveEditStep = useCallback((fromIndex: number, toIndex: number) => {
    setEditSteps((current) => reorderItems(current, fromIndex, toIndex));
  }, []);

  const clearEditStepDragState = useCallback(() => {
    draggedEditStepIndexRef.current = null;
    setDraggingEditStepIndex(null);
    setDragOverEditStepIndex(null);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!id || !recipe) return;

    const title = editTitle.trim();
    if (!title) {
      toast.error(t("import.manualTitleRequired"));
      return;
    }

    const ingredients = editIngredients
      .map((item) => ({
        name: item.name.trim(),
        amount: item.amount.trim(),
      }))
      .filter((item) => item.name);

    const steps = editSteps
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

    const flavors = editFlavors
      .split(/[\uFF0C,、]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const totalTimeMin = parsePositiveInt(editTotalTime);
    const updatedRecipe = cleanEditedRecipe(
      {
        ...recipe,
        title,
        ingredients,
        steps,
        tags: {
          ...recipe.tags,
          cuisine: editCuisine.trim() || undefined,
          difficulty: editDifficulty || undefined,
          flavor: flavors.length > 0 ? flavors : undefined,
          totalTimeMin,
        },
      },
      i18n.language.startsWith("zh") ? "zh" : "en",
    );

    setIsSavingEdit(true);
    try {
      await db.recipes.update(id, {
        title: updatedRecipe.title,
        ingredients: updatedRecipe.ingredients,
        steps: updatedRecipe.steps,
        tags: updatedRecipe.tags,
      });
      setRecipe(updatedRecipe);
      setIsEditOpen(false);
      toast.success(t("recipeDetail.editSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("recipeDetail.editSaveFailed"));
    } finally {
      setIsSavingEdit(false);
    }
  }, [
    editCuisine,
    editDifficulty,
    editFlavors,
    editIngredients,
    editSteps,
    editTitle,
    editTotalTime,
    id,
    i18n.language,
    recipe,
    t,
  ]);

  const handleRecipeVoiceChange = useCallback(
    async (nextVoiceId: string | null) => {
      if (!id || !recipe) return;

      const previousVoiceId = recipe.voiceId;
      const nextRecipe = { ...recipe, voiceId: nextVoiceId ?? undefined };
      setRecipe(nextRecipe);

      try {
        await db.recipes.update(id, { voiceId: nextVoiceId ?? undefined });
        const selectedVoice = voiceOptions.find((option) => option.value === nextVoiceId);
        toast.success(
          nextVoiceId && selectedVoice
            ? t("recipeDetail.voiceSaved", { name: selectedVoice.label })
            : t("recipeDetail.voiceReset"),
        );
      } catch (error) {
        setRecipe({ ...recipe, voiceId: previousVoiceId });
        toast.error(error instanceof Error ? error.message : t("recipeDetail.voiceSaveFailed"));
      }
    },
    [id, recipe, t, voiceOptions],
  );

  if (recipe === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (recipe === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">{t("recipeDetail.notFound")}</p>
          <Link
            to="/recipes"
            className="rounded-full border border-border px-5 py-2 text-sm hover:bg-foreground hover:text-background"
          >
            {t("recipeDetail.back")}
          </Link>
        </div>
      </div>
    );
  }

  const {
    title,
    ingredients = [],
    steps = [],
    tags = {},
    voiceId,
    createdAt,
  } = recipe;
  const totalMin =
    tags.totalTimeMin ??
    steps.reduce((s, st) => s + (st.durationSec ? Math.ceil(st.durationSec / 60) : 0), 0);
  const difficultyLabel = tags.difficulty ? t(`recipes.difficulty.${tags.difficulty}`) : "—";
  const firstIngredientName = ingredients[0]?.name ?? t("recipeDetail.ingredient");
  const selectedVoice = voiceOptions.find((option) => option.value === voiceId);
  const defaultCookingVoice =
    voiceOptions.find((option) => option.value === cookingVoiceId) ?? voiceOptions[0];
  const defaultVoiceLabel = defaultCookingVoice
    ? t("recipeDetail.defaultVoiceWithName", { name: defaultCookingVoice.label })
    : t("recipeDetail.defaultVoice");
  const displayedVoiceId = voiceId ?? defaultCookingVoice?.value;
  const voiceSelectDisabled = !hasElevenLabsKey || voiceOptions.length === 0;
  const voiceHelperText = selectedVoice
    ? selectedVoice.displayLabel
    : voiceSelectDisabled
      ? t("recipeDetail.voiceSelectDisabled")
      : defaultVoiceLabel;
  const voiceStatusText = isLoadingElevenLabsVoices
    ? t("settings.voice.loadingElevenLabsVoices")
    : elevenLabsVoicesError;
  const canGenerateCover = hasLlmKey && hasImageGenKey;
  const recipeSourceLabel =
    recipe.sourceUrl || recipe.rawTranscript ? t("recipeDetail.imported") : t("recipeDetail.manual");
  const showDetailIngredients = shouldShowIngredients(detailDisplayMode);
  const showDetailSteps = shouldShowSteps(detailDisplayMode);
  const showEditIngredients = shouldShowIngredients(editDisplayMode);
  const showEditSteps = shouldShowSteps(editDisplayMode);
  const renderEditIngredientsEditor = () => (
    <>
      <EditPanelHeader
        title={t("recipeDetail.ingredients")}
        count={editIngredients.length}
        action={
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-background px-3 text-xs hover:border-foreground"
            onClick={addEditIngredient}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("import.manualAddIngredient")}
          </button>
        }
      />
      <div className="space-y-3">
        {editIngredients.map((ingredient, index) => (
          <div
            key={index}
            className="group rounded-2xl border border-border bg-background p-4 shadow-sm transition-all duration-150 hover:border-clay/70 hover:shadow-md"
            onBlur={(event) => handleEditIngredientBlur(event, index)}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-muted/50 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground"
                >
                  <ChefHat className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="font-display text-lg">{index + 1}</span>
              </div>
              {editIngredients.length > 1 && (
                <button
                  type="button"
                  aria-label={t("common.delete")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-destructive hover:text-destructive sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                  onClick={() =>
                    setEditIngredients((current) =>
                      current.length > 1
                        ? current.filter((_, itemIndex) => itemIndex !== index)
                        : [createEmptyIngredient()],
                    )
                  }
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                ref={(node) => {
                  editIngredientNameRefs.current[index] = node;
                }}
                value={ingredient.name}
                placeholder={t("import.manualIngredientName")}
                onChange={(event) => updateEditIngredient(index, { name: event.target.value })}
              />
              <Input
                value={ingredient.amount}
                placeholder={t("import.manualIngredientAmount")}
                onChange={(event) => updateEditIngredient(index, { amount: event.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <SiteHeader />

      {/* Hero */}
      <section className="relative border-b border-border/60">
        <div
          className="absolute inset-0 bg-gradient-to-br from-[#c4654a]/20 via-transparent to-[#8b7355]/15"
          aria-hidden
        />
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="grid min-w-0 gap-6 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-10">
            <div className="min-w-0 lg:col-span-7 lg:row-start-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Link
                  to="/recipes"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-foreground hover:border-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("recipeDetail.back")}
                </Link>
                {tags.cuisine && (
                  <>
                    <span>/</span>
                    <span>{tags.cuisine}</span>
                  </>
                )}
                <span>/</span>
                <span className="text-foreground">{title}</span>
              </div>
              <h1 className="mt-4 font-display text-[clamp(2.4rem,12vw,4.5rem)] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                {title}
              </h1>
            </div>

            {/* Cover */}
            <div className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
              <div className="group/cover relative aspect-square overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-[#c4654a]/40 via-[#a0522d]/30 to-[#8b7355]/40 shadow-[var(--shadow-warm)]">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleCoverInputChange}
                />
                {coverUrl ? (
                  <AppTooltip content={t("recipeDetail.coverPreviewOpen")}>
                    <button
                      type="button"
                      aria-label={t("recipeDetail.coverPreviewOpen")}
                      onClick={() => setExpandedCoverPreview({ src: coverUrl, alt: title })}
                      className="absolute inset-0 cursor-zoom-in overflow-hidden text-left"
                    >
                      <img src={coverUrl} alt={title} className="h-full w-full object-cover" />
                    </button>
                  </AppTooltip>
                ) : (
                  <>
                    <div className="absolute inset-0 grain opacity-50" aria-hidden />
                    <ChefHat
                      className="absolute inset-0 m-auto h-40 w-40 text-foreground/15"
                      strokeWidth={0.75}
                    />
                  </>
                )}
                <div className="absolute right-4 top-4 z-20 flex gap-2 opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover/cover:pointer-events-auto sm:group-hover/cover:opacity-100 sm:group-focus-within/cover:pointer-events-auto sm:group-focus-within/cover:opacity-100">
                  <AppTooltip content={t("recipeDetail.uploadCover")}>
                    <button
                      type="button"
                      aria-label={t("recipeDetail.uploadCover")}
                      onClick={(event) => {
                        event.stopPropagation();
                        coverInputRef.current?.click();
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-background/95 text-foreground shadow-[0_10px_24px_-10px_oklch(0.18_0.02_60_/_0.55)] ring-1 ring-black/15 backdrop-blur transition-colors hover:bg-foreground hover:text-background"
                    >
                      <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </AppTooltip>
                  <AppTooltip
                    content={t("recipeDetail.aiGenerateCover")}
                    disabled={isGeneratingCover || !canGenerateCover}
                  >
                    <button
                      type="button"
                      aria-label={t("recipeDetail.aiGenerateCover")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleGenerateCover();
                      }}
                      disabled={isGeneratingCover || !canGenerateCover}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-background/95 text-foreground shadow-[0_10px_24px_-10px_oklch(0.18_0.02_60_/_0.55)] ring-1 ring-black/15 backdrop-blur transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isGeneratingCover ? (
                        <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                      )}
                    </button>
                  </AppTooltip>
                </div>
              </div>
            </div>

            <div className="min-w-0 lg:col-span-7 lg:row-start-2">
              <div className="mt-6 flex min-w-0 max-w-full flex-wrap items-start gap-2 text-xs">
                {totalMin > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
                    <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />{" "}
                    {t("recipeDetail.totalTime", { count: totalMin })}
                  </span>
                )}
                {tags.difficulty && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
                    <Flame className="h-3.5 w-3.5" strokeWidth={1.75} /> {difficultyLabel}
                  </span>
                )}
                {tags.cuisine && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
                    <ChefHat className="h-3.5 w-3.5" strokeWidth={1.75} /> {tags.cuisine}
                  </span>
                )}
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
                  {t("recipeDetail.source")} · {recipeSourceLabel}
                </span>
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
                  {t("recipeDetail.saved")} · {formatSaved(createdAt, i18n.language, t)}
                </span>
                <div className="flex w-full min-w-0 max-w-full flex-col gap-1 sm:w-[22rem] lg:w-[24rem]">
                  <Select
                    value={displayedVoiceId}
                    onValueChange={(nextValue) => void handleRecipeVoiceChange(nextValue)}
                    disabled={voiceSelectDisabled}
                  >
                    <SelectTrigger
                      aria-label={t("recipeDetail.voiceSelectLabel")}
                      className="h-auto min-w-0 max-w-full rounded-full border-clay bg-clay/10 px-3 py-1.5 text-xs text-clay shadow-none [&>span]:line-clamp-1"
                    >
                      <Volume2 className="mr-1.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      <SelectValue placeholder={defaultVoiceLabel} />
                    </SelectTrigger>
                    <SelectContent>
                      {voiceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.displayLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="min-h-[1rem] text-[11px] leading-4 text-muted-foreground">
                    {voiceStatusText ?? ""}
                  </div>
                </div>
              </div>
              <div className="mt-2 min-h-[1rem] text-xs text-muted-foreground">
                {voiceHelperText}
              </div>

              <div className="mt-8 flex min-w-0 max-w-full flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  onClick={() => handleStartCooking()}
                  className="group inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-full bg-foreground px-7 py-4 text-base text-background hover:bg-clay sm:w-auto"
                >
                  <VoiceBadge
                    n={1}
                    className="!border-background/40 !text-background !bg-transparent !opacity-100"
                  />
                  <Play className="h-5 w-5" strokeWidth={1.75} />
                  <span className="min-w-0 truncate">{t("recipeDetail.startCooking")}</span>
                </button>
                <button
                  onClick={openEditDialog}
                  className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-full border border-foreground/80 px-5 py-4 text-sm hover:bg-foreground hover:text-background sm:w-auto"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} /> {t("recipeDetail.edit")}
                </button>
                <button
                  onClick={handleExport}
                  className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-full border border-border px-5 py-4 text-sm hover:border-foreground sm:w-auto"
                >
                  <Share2 className="h-4 w-4" strokeWidth={1.75} /> {t("recipeDetail.export")}
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-full border border-destructive bg-destructive/10 px-5 py-4 text-sm font-medium text-destructive shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground sm:w-auto">
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />{" "}
                      {t("recipeDetail.deleteConfirm")}
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("recipeDetail.deleteTitle", { title })}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("recipeDetail.deleteBody")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {t("recipeDetail.deleteConfirm")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <VoiceHint className="mt-4">{t("recipeDetail.voiceHint")}</VoiceHint>
            </div>

          </div>
        </div>
      </section>

      {/* Body */}
      <section className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="mb-6 flex justify-center sm:justify-end">
            <RecipeContentDisplayToggle
              value={detailDisplayMode}
              onChange={setDetailDisplayMode}
              allLabel={t("recipeContentDisplay.all")}
              ingredientsLabel={t("recipeContentDisplay.ingredientsOnly")}
              stepsLabel={t("recipeContentDisplay.stepsOnly")}
              ariaLabel={t("recipeContentDisplay.ariaLabel")}
              className="w-full max-w-xs sm:w-auto sm:max-w-full"
            />
          </div>

          <div className="grid gap-12 lg:grid-cols-12">
            {/* Ingredients */}
            {showDetailIngredients && (
              <aside className={showDetailSteps ? "lg:col-span-4" : "lg:col-span-12"}>
                <div className="lg:sticky lg:top-24">
                  <div className="flex items-end justify-between">
                    <h2 className="font-display text-2xl">{t("recipeDetail.ingredients")}</h2>
                  </div>
                  <VoiceHint className="mt-2">
                    {t("recipeDetail.checkOff", { item: firstIngredientName })}
                  </VoiceHint>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {ingredients.map((ing, i) => (
                      <li
                        key={i}
                        className="inline-flex max-w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                        onClick={() => toggleChecked(i)}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                            checked.has(i)
                              ? "bg-foreground border-foreground text-background"
                              : "border-border"
                          }`}
                        >
                          {checked.has(i) && <Check className="h-3 w-3" strokeWidth={2.5} />}
                        </span>
                        <span
                          className={`min-w-0 text-sm transition-opacity ${checked.has(i) ? "opacity-40 line-through" : ""}`}
                        >
                          <span className="break-words">{ing.name}</span>
                          {ing.amount && (
                            <span className="ml-2 text-xs text-muted-foreground">{ing.amount}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                </div>
              </aside>
            )}

            {/* Steps */}
            {showDetailSteps && (
              <div className={showDetailIngredients ? "lg:col-span-8" : "lg:col-span-12"}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <h2 className="font-display text-2xl">{t("recipeDetail.steps")}</h2>
                  <VoiceHint>{t("recipeDetail.stepsHint")}</VoiceHint>
                </div>
                <ol className="mt-4 space-y-3 sm:space-y-4">
                  {steps.map((s, i) => (
                    <li
                      key={i}
                      className="group relative flex items-start gap-3 rounded-[1.35rem] border border-border/80 bg-card/90 p-3.5 shadow-sm transition-colors hover:border-clay/60 sm:min-h-28 sm:items-center sm:gap-5 sm:rounded-2xl sm:p-5"
                    >
                      <VoiceBadge
                        n={i + 1}
                        className="absolute left-4 top-4 !bg-card sm:-left-3 sm:top-1/2 sm:-translate-y-1/2"
                      />
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-secondary/80 font-display text-base sm:h-12 sm:w-12 sm:rounded-xl sm:text-xl">
                        {i + 1}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col pt-1 sm:self-stretch sm:justify-center sm:pt-0">
                        <p className="text-[15px] leading-7 sm:text-base sm:leading-relaxed">{s.description}</p>
                        {(s.durationSec || s.tips) && (
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            {s.durationSec && (
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" strokeWidth={1.75} />{" "}
                                {t("recipes.minutes", { count: Math.ceil(s.durationSec / 60) })}
                              </span>
                            )}
                            {s.tips && (
                              <span className="rounded-full bg-accent/40 px-2 py-0.5 text-accent-foreground">
                                {t("recipeDetail.tip")} · {s.tips}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={t("recipeDetail.startFromStep", { count: i + 1 })}
                        onClick={() => handleStartCooking(i)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full border border-border bg-background/60 text-foreground shadow-sm transition-colors hover:border-clay hover:bg-transparent hover:text-clay focus-visible:border-border sm:h-10 sm:w-10 sm:bg-transparent sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
                      >
                        <Play className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </section>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="grid h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none border-0 bg-background p-0 sm:h-[92dvh] sm:w-[calc(100vw-2rem)] sm:max-w-7xl sm:rounded-[1.75rem] sm:border sm:border-border sm:p-0">
          <DialogHeader className="space-y-0 border-b border-border/70 py-4 pl-5 pr-16 text-left sm:pl-6 sm:pr-20">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-1.5">
                <DialogTitle className="font-display text-2xl">
                  {t("recipeDetail.editRecipeTitle")}
                </DialogTitle>
                <DialogDescription className="max-w-2xl">
                  {t("recipeDetail.editRecipeBody")}
                </DialogDescription>
              </div>
              <RecipeContentDisplayToggle
                value={editDisplayMode}
                onChange={setEditDisplayMode}
                allLabel={t("recipeContentDisplay.all")}
                ingredientsLabel={t("recipeContentDisplay.ingredientsOnly")}
                stepsLabel={t("recipeContentDisplay.stepsOnly")}
                ariaLabel={t("recipeContentDisplay.ariaLabel")}
                className="shrink-0 self-start"
              />
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto bg-secondary/20 p-4 lg:overflow-hidden lg:p-5">
            <div
              className={`grid gap-4 lg:h-full lg:min-h-0 ${
                showEditIngredients || showEditSteps
                  ? "lg:grid-cols-[minmax(20rem,0.82fr)_minmax(0,1.18fr)]"
                  : "lg:grid-cols-1"
              }`}
            >
              <EditPanel>
                <div className="space-y-4 rounded-2xl border border-border/70 bg-background p-4 shadow-sm">
                  <EditPanelHeader
                    title={t("recipeDetail.editRecipeTitle")}
                    className="static -mx-0 mb-1 border-0 bg-transparent px-0 py-0 shadow-none"
                  />
                  <label className="space-y-2">
                    <span className="text-sm font-medium">{t("import.manualRecipeTitle")}</span>
                    <Input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualCuisine")}</span>
                      <Input
                        value={editCuisine}
                        onChange={(event) => setEditCuisine(event.target.value)}
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualTotalTime")}</span>
                      <div className="flex rounded-xl border border-border bg-card shadow-sm transition-colors focus-within:border-clay">
                        <input
                          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
                          inputMode="numeric"
                          value={editTotalTime}
                          onChange={(event) => setEditTotalTime(event.target.value)}
                          placeholder={t("import.manualTotalTimePlaceholder")}
                        />
                        <span className="flex shrink-0 items-center border-l border-border px-3 text-xs text-muted-foreground">
                          {t("import.manualStepDurationUnit")}
                        </span>
                      </div>
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualDifficulty")}</span>
                      <Select
                        value={editDifficulty || "__empty__"}
                        onValueChange={(next) =>
                          setEditDifficulty(next === "__empty__" ? "" : (next as EditDifficulty))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("import.manualDifficultyPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__empty__">{t("common.unknown")}</SelectItem>
                          <SelectItem value="easy">{t("recipes.difficulty.easy")}</SelectItem>
                          <SelectItem value="medium">{t("recipes.difficulty.medium")}</SelectItem>
                          <SelectItem value="hard">{t("recipes.difficulty.hard")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium">{t("import.manualFlavors")}</span>
                      <Input
                        value={editFlavors}
                        onChange={(event) => setEditFlavors(event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                {showEditIngredients && showEditSteps && (
                  <div className="space-y-3">
                    {renderEditIngredientsEditor()}
                  </div>
                )}
              </EditPanel>

              {showEditIngredients && !showEditSteps && (
                <EditPanel className="space-y-3">{renderEditIngredientsEditor()}</EditPanel>
              )}

              {showEditSteps && (
                <EditPanel className="space-y-3">
                  <EditPanelHeader
                    title={t("recipeDetail.steps")}
                    count={editSteps.length}
                    action={
                      <button
                        type="button"
                        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-background px-3 text-xs hover:border-foreground"
                        onClick={addEditStep}
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {t("import.manualAddStep")}
                      </button>
                    }
                  />
                  <div className="space-y-3">
                    {editSteps.map((step, index) => (
                      <div
                        key={index}
                        className={`group rounded-2xl border bg-background p-4 shadow-sm transition-all duration-150 ${
                          draggingEditStepIndex === index
                            ? "scale-[0.99] cursor-grabbing border-clay bg-clay/5 opacity-70 shadow-lg"
                            : "cursor-grab border-border hover:border-clay/70 hover:shadow-md active:cursor-grabbing"
                        } ${
                          dragOverEditStepIndex === index && draggingEditStepIndex !== index
                            ? "ring-2 ring-clay/35"
                            : ""
                        }`}
                        draggable
                        onDragStart={(event) => {
                          if (isInteractiveDragTarget(event.target)) {
                            event.preventDefault();
                            return;
                          }
                          draggedEditStepIndexRef.current = index;
                          setDraggingEditStepIndex(index);
                          setDragOverEditStepIndex(index);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", String(index));
                        }}
                        onDragOver={(event) => {
                          if (draggedEditStepIndexRef.current === null) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragOverEditStepIndex(index);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const fromIndex = draggedEditStepIndexRef.current;
                          if (fromIndex !== null) moveEditStep(fromIndex, index);
                          clearEditStepDragState();
                        }}
                        onDragEnd={clearEditStepDragState}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                            setDragOverEditStepIndex((current) =>
                              current === index ? null : current,
                            );
                          }
                        }}
                        onBlur={(event) => handleEditStepBlur(event, index)}
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-muted/50 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground"
                            >
                              <GripVertical className="h-4 w-4" strokeWidth={1.75} />
                            </span>
                            <span className="font-display text-lg">{index + 1}</span>
                          </div>
                          {editSteps.length > 1 && (
                            <button
                              type="button"
                              aria-label={t("common.delete")}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-destructive hover:text-destructive sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                              onClick={() =>
                                setEditSteps((current) =>
                                  current.length > 1
                                    ? current.filter((_, itemIndex) => itemIndex !== index)
                                    : [createEmptyStep()],
                                )
                              }
                            >
                              <X className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          )}
                        </div>
                        <StepDescriptionField
                          textareaRef={(node) => {
                            editStepDescriptionRefs.current[index] = node;
                          }}
                          value={step.description}
                          onChange={(value) => updateEditStep(index, { description: value })}
                          placeholder={t("import.manualStepDescription")}
                        />
                        <div className="mt-3">
                          <StepMetadataFields
                            durationValue={step.durationMin}
                            tipsValue={step.tips}
                            onDurationChange={(value) =>
                              updateEditStep(index, { durationMin: value })
                            }
                            onTipsChange={(value) => updateEditStep(index, { tips: value })}
                            durationLabel={t("import.manualStepDuration")}
                            durationPlaceholder={t("import.manualStepDurationPlaceholder")}
                            durationUnit={t("import.manualStepDurationUnit")}
                            tipsLabel={t("import.manualStepTips")}
                            tipsPlaceholder={t("import.manualStepTipsPlaceholder")}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </EditPanel>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 bg-background/95 px-5 py-4 backdrop-blur sm:px-6">
            <button
              type="button"
              className="mt-2 rounded-full border border-border px-5 py-2.5 text-sm hover:border-foreground sm:mt-0"
              onClick={() => setIsEditOpen(false)}
              disabled={isSavingEdit}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay disabled:opacity-50"
              onClick={() => void handleSaveEdit()}
              disabled={isSavingEdit}
            >
              {isSavingEdit ? t("import.saving") : t("common.save")}
            </button>
          </DialogFooter>
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
            <DialogTitle>{t("recipeDetail.coverPreviewTitle")}</DialogTitle>
            <DialogDescription>{t("recipeDetail.coverPreviewDescription")}</DialogDescription>
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
