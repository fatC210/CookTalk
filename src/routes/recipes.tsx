import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { Search, Filter, ArrowUpDown, Plus, Clock, ChefHat, Mic, UtensilsCrossed } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Recipe } from "@/lib/db";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useMemo } from "react";

export const Route = createFileRoute("/recipes")({
  head: () => ({
    meta: [
      { title: "My recipes — CookTalk" },
      { name: "description", content: "Your personal voice-controlled recipe library." },
    ],
  }),
  component: RecipesPage,
});

type SortKey = "lastCookedAt" | "createdAt" | "totalTimeMin" | "difficulty";

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

const CARD_GRADIENTS = [
  "from-[#c4654a]/30 to-[#8b7355]/20",
  "from-[#e8a87c]/40 to-[#c9b99a]/30",
  "from-[#c4654a]/40 to-[#4a3328]/30",
  "from-[#c9b99a]/40 to-[#8b7355]/30",
  "from-[#87a878]/30 to-[#c9b99a]/30",
  "from-[#a8c0d8]/30 to-[#c9b99a]/30",
  "from-[#c4654a]/30 to-[#e8a87c]/30",
  "from-[#c9b99a]/40 to-[#a39071]/30",
  "from-[#7a5b8e]/20 to-[#c9b99a]/30",
];

function gradientForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CARD_GRADIENTS[hash % CARD_GRADIENTS.length];
}

function formatLastCooked(ts: number | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!ts) return t("common.never");
  const diffMs = Date.now() - ts;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return t("common.today");
  if (diffDays === 1) return t("common.yesterday");
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks >= 1) return t("common.weeksAgo", { count: diffWeeks });
  return t("common.daysAgo", { count: diffDays });
}

function filterAndSort(
  recipes: Recipe[],
  search: string,
  cuisine: string,
  sort: SortKey,
): Recipe[] {
  const q = search.trim().toLowerCase();

  let result = recipes;

  if (q) {
    result = result.filter((r) => {
      if (r.title.toLowerCase().includes(q)) return true;
      if (r.tags.cuisine?.toLowerCase().includes(q)) return true;
      if (r.tags.flavor?.some((f) => f.toLowerCase().includes(q))) return true;
      if (r.ingredients.some((i) => i.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  if (cuisine !== "all") {
    result = result.filter((r) => r.tags.cuisine === cuisine);
  }

  result = [...result].sort((a, b) => {
    switch (sort) {
      case "lastCookedAt":
        return (b.lastCookedAt ?? 0) - (a.lastCookedAt ?? 0);
      case "createdAt":
        return b.createdAt - a.createdAt;
      case "totalTimeMin":
        return (a.tags.totalTimeMin ?? 0) - (b.tags.totalTimeMin ?? 0);
      case "difficulty":
        return (
          (DIFFICULTY_ORDER[a.tags.difficulty ?? "easy"] ?? 0) -
          (DIFFICULTY_ORDER[b.tags.difficulty ?? "easy"] ?? 0)
        );
    }
  });

  return result;
}

function RecipesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [activeCuisine, setActiveCuisine] = useState("all");
  const [sort, setSort] = useState<SortKey>("lastCookedAt");

  const allRecipes = useLiveQuery(() => db.recipes.toArray(), []) ?? [];

  // Extract unique cuisines from loaded recipes
  const cuisines = useMemo<string[]>(() => {
    const set = new Set<string>();
    allRecipes.forEach((r) => {
      if (r.tags.cuisine) set.add(r.tags.cuisine);
    });
    return Array.from(set).sort();
  }, [allRecipes]);

  // Filtered & sorted list
  const displayed = useMemo(
    () => filterAndSort(allRecipes, search, activeCuisine, sort),
    [allRecipes, search, activeCuisine, sort],
  );

  // Build cover image object URLs and revoke on cleanup
  const coverUrls = useMemo(() => {
    const map = new Map<string, string>();
    allRecipes.forEach((r) => {
      if (r.coverImage) {
        map.set(r.id, URL.createObjectURL(r.coverImage));
      }
    });
    return map;
  }, [allRecipes]);

  useEffect(() => {
    return () => {
      coverUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [coverUrls]);

  const sortLabels: Record<SortKey, string> = {
    lastCookedAt: t("recipes.lastCooked"),
    createdAt: t("common.save"),
    totalTimeMin: t("recipes.minutes", { count: 0 }).replace("0 ", ""),
    difficulty: t("recipes.difficulty.medium").replace("Medium", "Difficulty"),
  };

  function cycleSortKey() {
    const keys: SortKey[] = ["lastCookedAt", "createdAt", "totalTimeMin", "difficulty"];
    const idx = keys.indexOf(sort);
    setSort(keys[(idx + 1) % keys.length]);
  }

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="page-kicker">
                {t("recipes.personalKb")} · {t("recipes.recipesCount", { count: allRecipes.length })}
              </span>
              <h1 className="page-title">{t("recipes.title")}</h1>
              <VoiceHint className="mt-2">{t("recipes.voiceHint")}</VoiceHint>
            </div>
            <Link
              to="/import"
              className="inline-flex w-full items-center justify-center gap-2 self-start rounded-full bg-foreground px-4 py-2.5 text-sm text-background hover:bg-clay sm:w-auto sm:px-5"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              {t("recipes.importVideo")}
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-2.5 sm:min-w-[280px] sm:px-4">
              <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <input
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder={t("recipes.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="voice-hint hidden sm:inline">{t("recipes.orSaySearch")}</span>
              <Mic className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} />
            </div>

            <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <button
                onClick={() => setActiveCuisine("all")}
                className={`relative inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs ${
                  activeCuisine === "all"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:border-foreground"
                }`}
              >
                {t("recipes.all")}
              </button>
              {cuisines.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCuisine(c)}
                  className={`relative inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs ${
                    activeCuisine === c
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:border-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}

              <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs hover:border-foreground">
                <Filter className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("recipes.filter")}
              </button>
              <button
                onClick={cycleSortKey}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs hover:border-foreground"
              >
                <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.75} /> {sortLabels[sort]}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="flex-1">
        <div className="page-content-container">
          {displayed.length === 0 ? (
            <EmptyState search={search} t={t} />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {displayed.map((r, i) => (
                <RecipeCard
                  key={r.id}
                  recipe={r}
                  index={i}
                  coverUrl={coverUrls.get(r.id)}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function RecipeCard({
  recipe,
  index,
  coverUrl,
  t,
}: {
  recipe: Recipe;
  index: number;
  coverUrl: string | undefined;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const gradient = gradientForId(recipe.id);
  const difficulty = recipe.tags.difficulty ?? "easy";
  const difficultyLabel = t(`recipes.difficulty.${difficulty}`);
  const flavorStr = recipe.tags.flavor?.join(" · ") ?? "";
  const lastCookedStr = formatLastCooked(recipe.lastCookedAt, t);

  return (
    <Link
      to="/recipe-detail"
      search={{ id: recipe.id }}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card hover:border-clay/60 transition-colors"
    >
      <VoiceBadge n={index + 1} className="absolute top-4 left-4 z-10 !bg-card !opacity-90" />
      <div className={`relative aspect-[4/3] overflow-hidden ${coverUrl ? "" : `bg-gradient-to-br ${gradient}`}`}>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={recipe.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <>
            <div className="absolute inset-0 grain opacity-50" aria-hidden />
            <div className="absolute inset-0 flex items-center justify-center">
              <ChefHat className="h-20 w-20 text-foreground/20" strokeWidth={1} />
            </div>
          </>
        )}
        <div className="absolute bottom-3 right-3 rounded-full bg-background/80 px-2.5 py-1 text-[10px] uppercase tracking-wider backdrop-blur">
          {difficultyLabel}
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4 sm:p-5">
        <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>{recipe.tags.cuisine ?? "—"}</span>
          <span>{t("recipes.lastCooked")} · {lastCookedStr}</span>
        </div>
        <h3 className="font-display text-lg font-semibold leading-tight group-hover:text-clay sm:text-xl">{recipe.title}</h3>
        {flavorStr && <p className="text-xs text-muted-foreground">{flavorStr}</p>}
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            {recipe.tags.totalTimeMin != null
              ? t("recipes.minutes", { count: recipe.tags.totalTimeMin })
              : "—"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-clay">
            <UtensilsCrossed className="h-3.5 w-3.5" strokeWidth={1.75} />
            {recipe.ingredients.length} {recipe.ingredients.length === 1 ? "ingredient" : "ingredients"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({
  search,
  t,
}: {
  search: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full border border-border bg-card">
        <ChefHat className="h-12 w-12 text-muted-foreground/40" strokeWidth={1} />
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold">{t("recipes.noRecipes")}</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {search ? `No recipes match "${search}".` : t("recipes.noRecipesBody")}
        </p>
      </div>
      {!search && (
        <Link
          to="/import"
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay sm:w-auto"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          {t("recipes.importVideo")}
        </Link>
      )}
    </div>
  );
}
