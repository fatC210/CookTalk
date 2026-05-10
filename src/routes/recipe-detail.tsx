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
} from "lucide-react";
import { db, deleteRecipe, type Recipe } from "@/lib/db";
import { getApiKey } from "@/lib/crypto";
import { DEFAULT_IMAGE_MODEL, ImageGenService, getConfiguredLLMService } from "@/lib/llm";
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
import { Textarea } from "@/components/ui/textarea";
import { useElevenLabsVoices, type ElevenLabsVoiceOption } from "@/hooks/use-elevenlabs-voices";
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

const DEFAULT_RECIPE_VOICE_VALUE = "__default_recipe_voice__";

type RecipeVoiceOption = ElevenLabsVoiceOption;
type EditIngredient = { name: string; amount: string };
type EditStep = { description: string; durationMin: string; tips: string };
type EditDifficulty = Recipe["tags"]["difficulty"] | "";

function formatTimeAgo(
  ts: number | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!ts) return t("common.never");
  const diffMs = Date.now() - ts;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return t("common.today");
  if (diffDays === 1) return t("common.yesterday");
  if (diffDays < 7) return t("common.daysAgo", { count: diffDays });
  const diffWeeks = Math.floor(diffDays / 7);
  return t("common.weeksAgo", { count: diffWeeks });
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

function DetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const cookingVoiceId = useAppStore((s) => s.cookingVoiceId);
  const coverInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    document.title = recipe?.title ? `${recipe.title} - CookTalk` : t("recipeDetail.metaTitle");
  }, [recipe?.title, t, i18n.language]);

  const voiceOptions = useMemo<RecipeVoiceOption[]>(() => {
    const clonedVoices = liveClonedVoices ?? [];
    const elevenLabsVoiceOptionIds = new Set(elevenLabsVoiceOptions.map((option) => option.value));
    const formatClonedVoiceDescription = (language: string, description: string) => {
      const languageLabel = language
        ? t(`voices.languages.${language}`, { defaultValue: language })
        : t("common.unknown");
      const voiceDescription =
        description === "Cloned voice" ? t("voices.clonedVoice") : description;

      return `${languageLabel} · ${voiceDescription || t("voices.clonedVoice")}`;
    };

    return [
      ...elevenLabsVoiceOptions,
      ...clonedVoices
        .filter(
          (voice) =>
            voice.elevenLabsVoiceId && !elevenLabsVoiceOptionIds.has(voice.elevenLabsVoiceId),
        )
        .map((voice) => ({
          label: voice.name,
          value: voice.elevenLabsVoiceId!,
          description: formatClonedVoiceDescription(voice.language, voice.description),
          displayLabel: `${voice.name} - ${formatClonedVoiceDescription(
            voice.language,
            voice.description,
          )}`,
          previewUrl: null,
        })),
    ];
  }, [liveClonedVoices, elevenLabsVoiceOptions, t]);

  useEffect(() => {
    if (!id) {
      setRecipe(null);
      return;
    }
    db.recipes.get(id).then((r) => setRecipe(r ?? null));
  }, [id]);

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
      toast.error(error instanceof Error ? error.message : t("import.coverGenerationWarning"));
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
    const updatedRecipe: Recipe = {
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
    };

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
    lastCookedAt,
    coverSource,
  } = recipe;
  const totalMin =
    tags.totalTimeMin ??
    steps.reduce((s, st) => s + (st.durationSec ? Math.ceil(st.durationSec / 60) : 0), 0);
  const difficultyLabel = tags.difficulty ? t(`recipes.difficulty.${tags.difficulty}`) : "—";
  const coverLabel = t(
    coverSource === "ai"
      ? "recipeDetail.coverAi"
      : coverSource === "user"
        ? "recipeDetail.coverUser"
        : "recipeDetail.coverDefault",
  );
  const firstIngredientName = ingredients[0]?.name ?? t("recipeDetail.ingredient");
  const selectedVoice = voiceOptions.find((option) => option.value === voiceId);
  const globalCookingVoice = voiceOptions.find((option) => option.value === cookingVoiceId);
  const defaultVoiceLabel = globalCookingVoice
    ? t("recipeDetail.defaultVoiceWithName", { name: globalCookingVoice.label })
    : t("recipeDetail.defaultVoice");
  const voiceSelectDisabled = !hasElevenLabsKey || voiceOptions.length === 0;
  const voiceHelperText = selectedVoice
    ? selectedVoice.displayLabel
    : voiceSelectDisabled
      ? t("recipeDetail.voiceSelectDisabled")
      : defaultVoiceLabel;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      {/* Hero */}
      <section className="relative border-b border-border/60">
        <div
          className="absolute inset-0 bg-gradient-to-br from-[#c4654a]/20 via-transparent to-[#8b7355]/15"
          aria-hidden
        />
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
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
              <p className="mt-4 max-w-lg text-muted-foreground">
                {t("recipeDetail.summary", { count: steps.length })}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
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
                <div className="min-w-[11rem]">
                  <Select
                    value={voiceId ?? DEFAULT_RECIPE_VOICE_VALUE}
                    onValueChange={(nextValue) =>
                      void handleRecipeVoiceChange(
                        nextValue === DEFAULT_RECIPE_VOICE_VALUE ? null : nextValue,
                      )
                    }
                    disabled={voiceSelectDisabled}
                  >
                    <SelectTrigger
                      aria-label={t("recipeDetail.voiceSelectLabel")}
                      className="h-auto rounded-full border-clay bg-clay/10 px-3 py-1.5 text-xs text-clay shadow-none [&>span]:line-clamp-1"
                    >
                      <Volume2 className="mr-1.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      <SelectValue placeholder={defaultVoiceLabel} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_RECIPE_VOICE_VALUE}>
                        {defaultVoiceLabel}
                      </SelectItem>
                      {voiceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.displayLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(isLoadingElevenLabsVoices || elevenLabsVoicesError) && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {isLoadingElevenLabsVoices
                        ? t("settings.voice.loadingElevenLabsVoices")
                        : elevenLabsVoicesError}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{voiceHelperText}</div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  onClick={() => handleStartCooking()}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-7 py-4 text-base text-background hover:bg-clay sm:w-auto"
                >
                  <VoiceBadge
                    n={1}
                    className="!border-background/40 !text-background !bg-transparent !opacity-100"
                  />
                  <Play className="h-5 w-5" strokeWidth={1.75} />
                  {t("recipeDetail.startCooking")}
                </button>
                <button
                  onClick={openEditDialog}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-foreground/80 px-5 py-4 text-sm hover:bg-foreground hover:text-background sm:w-auto"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} /> {t("recipeDetail.edit")}
                </button>
                <button
                  onClick={handleExport}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-5 py-4 text-sm hover:border-foreground sm:w-auto"
                >
                  <Share2 className="h-4 w-4" strokeWidth={1.75} /> {t("recipeDetail.export")}
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-destructive/40 px-5 py-4 text-sm text-destructive hover:bg-destructive hover:text-destructive-foreground sm:w-auto">
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

            {/* Cover */}
            <div className="lg:col-span-5">
              <div className="group/cover relative aspect-square overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-[#c4654a]/40 via-[#a0522d]/30 to-[#8b7355]/40 shadow-[var(--shadow-warm)]">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleCoverInputChange}
                />
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={title}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <div className="absolute inset-0 grain opacity-50" aria-hidden />
                    <ChefHat
                      className="absolute inset-0 m-auto h-40 w-40 text-foreground/15"
                      strokeWidth={0.75}
                    />
                  </>
                )}
                <div className="absolute right-4 top-4 flex gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/cover:opacity-100">
                  <button
                    type="button"
                    aria-label={t("recipeDetail.uploadCover")}
                    title={t("recipeDetail.uploadCover")}
                    onClick={() => coverInputRef.current?.click()}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-foreground hover:text-background"
                  >
                    <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("recipeDetail.aiGenerateCover")}
                    title={t("recipeDetail.aiGenerateCover")}
                    onClick={() => void handleGenerateCover()}
                    disabled={isGeneratingCover}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isGeneratingCover ? (
                      <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-2xl bg-background/80 px-4 py-3 backdrop-blur">
                  <div className="text-xs">
                    <div className="text-muted-foreground">{coverLabel}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Body */}
      <section className="flex-1">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-12">
          {/* Ingredients */}
          <aside className="lg:col-span-4">
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

              <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-4">
                <div className="text-xs text-muted-foreground">{t("recipeDetail.lastCooked")}</div>
                <div className="mt-1 font-display text-lg">{formatTimeAgo(lastCookedAt, t)}</div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {t("recipeDetail.source")} ·{" "}
                  {recipe.sourceUrl || recipe.rawTranscript
                    ? t("recipeDetail.imported")
                    : t("recipeDetail.manual")}
                  <br />
                  {t("recipeDetail.saved")} · {formatSaved(createdAt, i18n.language, t)}
                </div>
              </div>
            </div>
          </aside>

          {/* Steps */}
          <div className="lg:col-span-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="font-display text-2xl">{t("recipeDetail.steps")}</h2>
              <VoiceHint>{t("recipeDetail.stepsHint")}</VoiceHint>
            </div>
            <ol className="mt-4 space-y-3">
              {steps.map((s, i) => (
                <li
                  key={i}
                  className="group relative flex min-h-28 flex-col gap-4 rounded-2xl border border-border bg-card p-4 hover:border-clay/60 sm:flex-row sm:items-center sm:gap-5 sm:p-5"
                >
                  <VoiceBadge
                    n={i + 1}
                    className="absolute left-4 top-4 !bg-card sm:-left-3 sm:top-1/2 sm:-translate-y-1/2"
                  />
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary font-display text-lg sm:h-12 sm:w-12 sm:text-xl">
                    {i + 1}
                  </div>
                  <div className="flex min-h-16 flex-1 flex-col justify-center">
                    <p className="text-base leading-relaxed">{s.description}</p>
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
                    className="inline-flex h-10 w-10 self-center items-center justify-center rounded-full border border-border bg-transparent text-foreground opacity-100 transition-opacity hover:border-clay hover:bg-transparent hover:text-clay focus-visible:border-border sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Play className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t("recipeDetail.editRecipeTitle")}</DialogTitle>
            <DialogDescription>{t("recipeDetail.editRecipeBody")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("import.manualRecipeTitle")}</span>
                <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
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
                  <Input
                    inputMode="numeric"
                    value={editTotalTime}
                    onChange={(event) => setEditTotalTime(event.target.value)}
                  />
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

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">{t("recipeDetail.ingredients")}</h3>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs hover:border-foreground"
                    onClick={() =>
                      setEditIngredients((current) => [...current, createEmptyIngredient()])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t("import.manualAddIngredient")}
                  </button>
                </div>
                <div className="space-y-2">
                  {editIngredients.map((ingredient, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <Input
                        value={ingredient.name}
                        placeholder={t("import.manualIngredientName")}
                        onChange={(event) =>
                          updateEditIngredient(index, { name: event.target.value })
                        }
                      />
                      <Input
                        value={ingredient.amount}
                        placeholder={t("import.manualIngredientAmount")}
                        onChange={(event) =>
                          updateEditIngredient(index, { amount: event.target.value })
                        }
                      />
                      <button
                        type="button"
                        aria-label={t("common.delete")}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:border-destructive hover:text-destructive"
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
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{t("recipeDetail.steps")}</h3>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs hover:border-foreground"
                  onClick={() => setEditSteps((current) => [...current, createEmptyStep()])}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("import.manualAddStep")}
                </button>
              </div>
              <div className="space-y-3">
                {editSteps.map((step, index) => (
                  <div key={index} className="rounded-2xl border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="font-display text-lg">{index + 1}</span>
                      <button
                        type="button"
                        aria-label={t("common.delete")}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border hover:border-destructive hover:text-destructive"
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
                    </div>
                    <Textarea
                      value={step.description}
                      placeholder={t("import.manualStepDescription")}
                      className="min-h-24 resize-y"
                      onChange={(event) =>
                        updateEditStep(index, { description: event.target.value })
                      }
                    />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Input
                        inputMode="numeric"
                        value={step.durationMin}
                        placeholder={t("import.manualStepDuration")}
                        onChange={(event) =>
                          updateEditStep(index, { durationMin: event.target.value })
                        }
                      />
                      <Input
                        value={step.tips}
                        placeholder={t("import.manualStepTips")}
                        onChange={(event) => updateEditStep(index, { tips: event.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
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
    </div>
  );
}
