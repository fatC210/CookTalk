import { useState, useEffect, useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import { db, deleteRecipe, type Recipe } from "@/lib/db";
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
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/recipe-detail")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || "",
  }),
  head: () => ({
    meta: [
      { title: "Recipe Detail — CookTalk" },
      { name: "description", content: "Recipe detail page." },
    ],
  }),
  component: DetailPage,
});

function formatTimeAgo(ts: number | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!ts) return t("common.never");
  const diffMs = Date.now() - ts;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return t("common.today");
  if (diffDays === 1) return t("common.yesterday");
  if (diffDays < 7) return t("common.daysAgo", { count: diffDays });
  const diffWeeks = Math.floor(diffDays / 7);
  return t("common.weeksAgo", { count: diffWeeks });
}

function formatSaved(ts: number | undefined, locale: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!ts) return t("common.unknown");
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(ts));
}

function DetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = Route.useSearch();
  const navigate = useNavigate();

  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

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
    const exportData = { ...recipe, coverImage: undefined, rawVideo: undefined, rawAudio: undefined };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recipe.title.replace(/\s+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recipe]);

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
          <Link to="/recipes" className="rounded-full border border-border px-5 py-2 text-sm hover:bg-foreground hover:text-background">
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
  const totalMin = tags.totalTimeMin ?? steps.reduce((s, st) => s + (st.durationSec ? Math.ceil(st.durationSec / 60) : 0), 0);
  const difficultyLabel = tags.difficulty ? t(`recipes.difficulty.${tags.difficulty}`) : "—";
  const coverLabel = t(
    coverSource === "ai"
      ? "recipeDetail.coverAi"
      : coverSource === "user"
        ? "recipeDetail.coverUser"
        : "recipeDetail.coverDefault",
  );
  const firstIngredientName = ingredients[0]?.name ?? t("recipeDetail.ingredient");

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      {/* Hero */}
      <section className="relative border-b border-border/60">
        <div className="absolute inset-0 bg-gradient-to-br from-[#c4654a]/20 via-transparent to-[#8b7355]/15" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Link to="/recipes" className="hover:text-foreground">{t("recipeDetail.back")}</Link>
                <span>/</span>
                {tags.cuisine && <><span>{tags.cuisine}</span><span>/</span></>}
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
                    <Clock className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("recipeDetail.totalTime", { count: totalMin })}
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
                <span className="inline-flex items-center gap-1.5 rounded-full border border-clay bg-clay/10 px-3 py-1.5 text-clay">
                  <Volume2 className="h-3.5 w-3.5" strokeWidth={1.75} /> {voiceId ?? t("common.default")}
                </span>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  onClick={() => navigate({ to: "/cook", search: { id } })}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-7 py-4 text-base text-background hover:bg-clay sm:w-auto"
                >
                  <VoiceBadge n={1} className="!border-background/40 !text-background !bg-transparent !opacity-100" />
                  <Play className="h-5 w-5" strokeWidth={1.75} />
                  {t("recipeDetail.startCooking")}
                </button>
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-foreground/80 px-5 py-4 text-sm hover:bg-foreground hover:text-background sm:w-auto">
                  <Pencil className="h-4 w-4" strokeWidth={1.75} /> {t("recipeDetail.edit")}
                </button>
                <button
                  onClick={handleExport}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-5 py-4 text-sm hover:border-foreground sm:w-auto"
                >
                  <Share2 className="h-4 w-4" strokeWidth={1.75} /> {t("recipeDetail.export")}
                </button>
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-5 py-4 text-sm hover:border-foreground sm:w-auto">
                  <RefreshCw className="h-4 w-4" strokeWidth={1.75} /> {t("recipeDetail.newCover")}
                </button>
              </div>
              <VoiceHint className="mt-4">{t("recipeDetail.voiceHint")}</VoiceHint>
            </div>

            {/* Cover */}
            <div className="lg:col-span-5">
              <div className="relative aspect-square overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-[#c4654a]/40 via-[#a0522d]/30 to-[#8b7355]/40 shadow-[var(--shadow-warm)]">
                {coverUrl ? (
                  <img src={coverUrl} alt={title} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <>
                    <div className="absolute inset-0 grain opacity-50" aria-hidden />
                    <ChefHat className="absolute inset-0 m-auto h-40 w-40 text-foreground/15" strokeWidth={0.75} />
                  </>
                )}
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
              <VoiceHint className="mt-2">{t("recipeDetail.checkOff", { item: firstIngredientName })}</VoiceHint>
              <ul className="mt-4 space-y-2">
                {ingredients.map((ing, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 cursor-pointer"
                    onClick={() => toggleChecked(i)}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                          checked.has(i) ? "bg-foreground border-foreground text-background" : "border-border"
                        }`}
                      >
                        {checked.has(i) && <Check className="h-3 w-3" strokeWidth={2.5} />}
                      </span>
                      <span className={`text-sm transition-opacity ${checked.has(i) ? "opacity-40 line-through" : ""}`}>
                        {ing.name}
                      </span>
                    </div>
                    <span className="shrink-0 pt-0.5 text-right text-xs text-muted-foreground">{ing.amount}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-4">
                <div className="text-xs text-muted-foreground">{t("recipeDetail.lastCooked")}</div>
                <div className="mt-1 font-display text-lg">{formatTimeAgo(lastCookedAt, t)}</div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {t("recipeDetail.source")} · {(recipe.sourceUrl || recipe.rawTranscript) ? t("recipeDetail.imported") : t("recipeDetail.manual")}<br />
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
                <li key={i} className="group relative flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 hover:border-clay/60 sm:flex-row sm:gap-5 sm:p-5">
                  <VoiceBadge n={i + 1} className="absolute left-4 top-4 !bg-card sm:-left-3 sm:top-5" />
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary font-display text-lg sm:h-12 sm:w-12 sm:text-xl">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-base leading-relaxed">{s.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {s.durationSec && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" strokeWidth={1.75} /> {t("recipes.minutes", { count: Math.ceil(s.durationSec / 60) })}
                        </span>
                      )}
                      {s.tips && (
                        <span className="rounded-full bg-accent/40 px-2 py-0.5 text-accent-foreground">
                          {t("recipeDetail.tip")} · {s.tips}
                        </span>
                      )}
                    </div>
                  </div>
                  <button className="inline-flex h-9 w-9 self-start items-center justify-center rounded-full border border-transparent bg-transparent text-foreground opacity-100 transition-opacity hover:border-border hover:bg-transparent hover:text-clay focus-visible:border-border sm:opacity-0 sm:group-hover:opacity-100">
                    <Play className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-dashed border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Trash2 className="h-5 w-5 text-destructive" strokeWidth={1.5} />
                <div>
                  <div className="text-sm font-medium">{t("recipeDetail.delete")}</div>
                  <VoiceHint className="mt-0.5">{t("recipeDetail.deleteHint")}</VoiceHint>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button className="w-full rounded-full border border-destructive/40 px-4 py-2 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground sm:w-auto">
                    {t("recipeDetail.deleteConfirm")}
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("recipeDetail.deleteTitle", { title })}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("recipeDetail.deleteBody")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      {t("recipeDetail.deleteConfirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
