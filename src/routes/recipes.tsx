import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge } from "@/components/voice-badge";
import {
  Search,
  Filter,
  ArrowUpDown,
  Plus,
  Clock,
  ChefHat,
  Mic,
  UtensilsCrossed,
  ChevronDown,
  LayoutGrid,
  List,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Recipe } from "@/lib/db";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AppTooltip } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/recipes")({
  head: () => ({
    meta: [
      { title: `${i18n.t("recipes.title")} - CookTalk` },
      { name: "description", content: i18n.t("recipes.metaDescription") },
    ],
  }),
  component: RecipesPage,
});

type SortKey = "lastCookedAt" | "createdAt" | "totalTimeMin" | "difficulty";
type RecipeViewMode = "cards" | "compact";

type FilterOption = {
  id: string;
  label: string;
  group: "cuisine" | "difficulty";
};

type Difficulty = NonNullable<Recipe["tags"]["difficulty"]>;

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
const DEFAULT_DIFFICULTY: Difficulty = "easy";

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

function matchesFilter(recipe: Recipe, option: FilterOption): boolean {
  switch (option.group) {
    case "cuisine":
      return recipe.tags.cuisine === option.label;
    case "difficulty":
      return (
        (recipe.tags.difficulty ?? DEFAULT_DIFFICULTY) === option.id.replace("difficulty:", "")
      );
  }
}

function filterAndSort(
  recipes: Recipe[],
  search: string,
  activeFilterIds: Set<string>,
  filterOptions: FilterOption[],
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

  if (activeFilterIds.size > 0) {
    const activeFilters = filterOptions.filter((option) => activeFilterIds.has(option.id));
    result = result.filter((recipe) =>
      activeFilters.every((option) => matchesFilter(recipe, option)),
    );
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
  const { t, i18n: activeI18n } = useTranslation();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [activeFilterIds, setActiveFilterIds] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("lastCookedAt");
  const [viewMode, setViewMode] = useState<RecipeViewMode | null>(null);

  const liveRecipes = useLiveQuery(() => db.recipes.toArray(), []);
  const allRecipes = useMemo(() => liveRecipes ?? [], [liveRecipes]);

  useEffect(() => {
    document.title = `${t("recipes.title")} - CookTalk`;
  }, [t, activeI18n.language]);

  const filterOptions = useMemo<FilterOption[]>(() => {
    const cuisines = new Set<string>();
    const difficulties = new Set<Difficulty>();

    allRecipes.forEach((recipe) => {
      const cuisine = recipe.tags.cuisine?.trim();
      if (cuisine) cuisines.add(cuisine);

      difficulties.add(recipe.tags.difficulty ?? DEFAULT_DIFFICULTY);
    });

    return [
      ...Array.from(cuisines)
        .sort()
        .map((label) => ({ id: `cuisine:${label}`, label, group: "cuisine" as const })),
      ...Array.from(difficulties)
        .sort((a, b) => DIFFICULTY_ORDER[a] - DIFFICULTY_ORDER[b])
        .map((difficulty) => ({
          id: `difficulty:${difficulty}`,
          label: t(`recipes.difficulty.${difficulty}`),
          group: "difficulty" as const,
        })),
    ];
  }, [allRecipes, t]);

  const activeFilterIdSet = useMemo(() => new Set(activeFilterIds), [activeFilterIds]);

  const displayed = useMemo(
    () => filterAndSort(allRecipes, search, activeFilterIdSet, filterOptions, sort),
    [allRecipes, search, activeFilterIdSet, filterOptions, sort],
  );

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
    lastCookedAt: t("recipes.sortLastCooked"),
    createdAt: t("recipes.sortCreated"),
    totalTimeMin: t("recipes.sortTotalTime"),
    difficulty: t("recipes.sortDifficulty"),
  };

  const activeFilters = filterOptions.filter((option) => activeFilterIdSet.has(option.id));
  const activeViewMode: RecipeViewMode = viewMode ?? (isMobile ? "compact" : "cards");

  const importButton = (
    <Link
      to="/import"
      className="inline-flex w-full items-center justify-center gap-2 self-center rounded-full bg-foreground px-4 py-2.5 text-sm text-background hover:bg-clay sm:w-auto sm:px-5"
    >
      <Plus className="h-4 w-4" strokeWidth={1.75} />
      <span className="sm:hidden">{t("nav.import")}</span>
      <span className="hidden sm:inline">{t("recipes.importVideo")}</span>
    </Link>
  );

  function cycleSortKey() {
    const keys: SortKey[] = ["lastCookedAt", "createdAt", "totalTimeMin", "difficulty"];
    const idx = keys.indexOf(sort);
    setSort(keys[(idx + 1) % keys.length]);
  }

  function toggleFilter(id: string) {
    setActiveFilterIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function clearFilters() {
    setActiveFilterIds([]);
  }

  const hasFilterOptions = filterOptions.length > 0;

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="page-title">{t("recipes.title")}</h1>
            </div>
            <div className="hidden md:block">{importButton}</div>
          </div>

          <div className="mt-5 flex w-full min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:gap-2">
              <div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 sm:px-4 lg:flex-1">
                <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  placeholder={t("recipes.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span className="voice-hint hidden xl:inline">{t("recipes.orSaySearch")}</span>
                <Mic className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} />
              </div>

              <div className="flex min-w-0 w-full items-center gap-2 overflow-x-auto pb-1 lg:w-auto lg:max-w-full lg:justify-end lg:pb-0">
                <button
                  onClick={clearFilters}
                  className={cn(
                    "relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs",
                    activeFilterIds.length === 0
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:border-foreground",
                  )}
                >
                  {t("recipes.all")}
                </button>

                <SplitFilterButton
                  hasOptions={hasFilterOptions}
                  activeFilters={activeFilters}
                  allOptions={filterOptions}
                  activeFilterIds={activeFilterIdSet}
                  onToggleFilter={toggleFilter}
                  onClearFilters={clearFilters}
                  t={t}
                />

                <button
                  onClick={cycleSortKey}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs hover:border-foreground"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.75} /> {sortLabels[sort]}
                </button>

                <RecipeViewModeToggle
                  value={activeViewMode}
                  onChange={(next) => setViewMode(next)}
                  cardsLabel={t("recipes.viewCards")}
                  compactLabel={t("recipes.viewCompact")}
                  ariaLabel={t("recipes.viewMode")}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="flex-1">
        <div className="page-content-container">
          {displayed.length === 0 ? (
            <EmptyState search={search} t={t} importButton={importButton} />
          ) : activeViewMode === "compact" ? (
            <div className="recipe-compact-list">
              {displayed.map((r, i) => (
                <RecipeCompactItem
                  key={r.id}
                  recipe={r}
                  index={i}
                  coverUrl={coverUrls.get(r.id)}
                  t={t}
                />
              ))}
            </div>
          ) : (
            <div className="recipe-card-grid">
              {displayed.map((r, i) => (
                <RecipeCard key={r.id} recipe={r} index={i} coverUrl={coverUrls.get(r.id)} t={t} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function RecipeViewModeToggle({
  value,
  onChange,
  cardsLabel,
  compactLabel,
  ariaLabel,
}: {
  value: RecipeViewMode;
  onChange: (value: RecipeViewMode) => void;
  cardsLabel: string;
  compactLabel: string;
  ariaLabel: string;
}) {
  const modes: Array<{
    value: RecipeViewMode;
    label: string;
    icon: typeof LayoutGrid;
  }> = [
    { value: "cards", label: cardsLabel, icon: LayoutGrid },
    { value: "compact", label: compactLabel, icon: List },
  ];

  return (
    <div
      className="inline-flex shrink-0 rounded-full border border-border bg-card p-0.5"
      role="group"
      aria-label={ariaLabel}
    >
      {modes.map((mode) => {
        const active = value === mode.value;
        const Icon = mode.icon;

        return (
          <AppTooltip key={mode.value} content={mode.label} side="top" align="center">
            <button
              type="button"
              aria-label={mode.label}
              aria-pressed={active}
              onClick={() => onChange(mode.value)}
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs transition-colors",
                active
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">{mode.label}</span>
            </button>
          </AppTooltip>
        );
      })}
    </div>
  );
}

function SplitFilterButton({
  hasOptions,
  activeFilters,
  allOptions,
  activeFilterIds,
  onToggleFilter,
  onClearFilters,
  t,
}: {
  hasOptions: boolean;
  activeFilters: FilterOption[];
  allOptions: FilterOption[];
  activeFilterIds: Set<string>;
  onToggleFilter: (id: string) => void;
  onClearFilters: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [open, setOpen] = useState(false);
  const activeFilterCount = activeFilters.length;

  const cuisines = allOptions.filter((option) => option.group === "cuisine");
  const difficulties = allOptions.filter((option) => option.group === "difficulty");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <div
        className="inline-flex shrink-0 overflow-hidden rounded-full border border-border bg-card text-xs hover:border-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 transition-colors",
              activeFilters.length > 0
                ? "bg-foreground text-background hover:bg-clay"
                : "hover:bg-accent/60",
            )}
            aria-label={t("recipes.filter")}
          >
            <Filter className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>{t("recipes.filter")}</span>
          </button>
        </DropdownMenuTrigger>
        <span className="w-px bg-border" aria-hidden />
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex min-w-9 items-center justify-center gap-1 px-2 py-2 text-muted-foreground hover:bg-accent/60"
            aria-label={t("recipes.filterMenuTitle")}
          >
            {activeFilterCount > 0 && (
              <span className="min-w-3 text-center tabular-nums">{activeFilterCount}</span>
            )}
            <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          </button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        align="end"
        className="w-48"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <DropdownMenuLabel>{t("recipes.filterMenuTitle")}</DropdownMenuLabel>
        {hasOptions ? (
          <>
            {cuisines.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t("recipes.filterGroupCuisine")}
                </DropdownMenuLabel>
                {cuisines.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={activeFilterIds.has(option.id)}
                    onCheckedChange={() => onToggleFilter(option.id)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}

            {difficulties.length > 0 && (
              <>
                {cuisines.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t("recipes.filterGroupDifficulty")}
                </DropdownMenuLabel>
                {difficulties.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={activeFilterIds.has(option.id)}
                    onCheckedChange={() => onToggleFilter(option.id)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}

            <DropdownMenuSeparator />
            <button
              type="button"
              onClick={() => {
                onClearFilters();
                setOpen(false);
              }}
              className="flex w-full items-center justify-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t("recipes.clearFilter")}
            </button>
          </>
        ) : (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            {t("recipes.noFilterOptions")}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const difficulty = recipe.tags.difficulty ?? DEFAULT_DIFFICULTY;
  const difficultyLabel = t(`recipes.difficulty.${difficulty}`);
  const flavorStr = recipe.tags.flavor?.join(" · ") ?? "";
  const cuisineLabel = recipe.tags.cuisine?.trim() || t("recipes.uncategorizedCuisine");
  const ingredientCountKey =
    recipe.ingredients.length === 1 ? "recipes.ingredientCountOne" : "recipes.ingredientCountOther";

  return (
    <Link
      to="/recipe-detail"
      search={{ id: recipe.id }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-clay/60"
    >
      <VoiceBadge n={index + 1} className="absolute left-3 top-3 z-10 !bg-card !opacity-90" />
      <div
        className={`relative aspect-[16/10] overflow-hidden ${coverUrl ? "" : `bg-gradient-to-br ${gradient}`}`}
      >
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
              <ChefHat className="h-14 w-14 text-foreground/20" strokeWidth={1} />
            </div>
          </>
        )}
        <div className="absolute bottom-3 right-3 rounded-full bg-background/80 px-2.5 py-1 text-[10px] uppercase tracking-wider backdrop-blur">
          {difficultyLabel}
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center text-xs text-muted-foreground">
          <span>{cuisineLabel}</span>
        </div>
        <h3 className="font-display text-lg font-semibold leading-tight group-hover:text-clay">
          {recipe.title}
        </h3>
        {flavorStr && <p className="text-xs text-muted-foreground">{flavorStr}</p>}
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            {recipe.tags.totalTimeMin != null
              ? t("recipes.minutes", { count: recipe.tags.totalTimeMin })
              : "—"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-clay">
            <UtensilsCrossed className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t(ingredientCountKey, { count: recipe.ingredients.length })}
          </span>
        </div>
      </div>
    </Link>
  );
}

function RecipeCompactItem({
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
  const difficulty = recipe.tags.difficulty ?? DEFAULT_DIFFICULTY;
  const difficultyLabel = t(`recipes.difficulty.${difficulty}`);
  const cuisineLabel = recipe.tags.cuisine?.trim() || t("recipes.uncategorizedCuisine");
  const firstFlavor = recipe.tags.flavor?.find((flavor) => flavor.trim())?.trim();
  const ingredientCountKey =
    recipe.ingredients.length === 1 ? "recipes.ingredientCountOne" : "recipes.ingredientCountOther";

  return (
    <Link
      to="/recipe-detail"
      search={{ id: recipe.id }}
      className="group grid min-h-24 grid-cols-[4.75rem_minmax(0,1fr)] gap-3 rounded-2xl border border-border bg-card p-2.5 transition-colors hover:border-clay/60 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4 sm:p-3"
    >
      <div
        className={`relative overflow-hidden rounded-xl ${coverUrl ? "" : `bg-gradient-to-br ${gradient}`}`}
      >
        <div className="aspect-square sm:aspect-[4/3]" />
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
              <ChefHat className="h-8 w-8 text-foreground/20" strokeWidth={1} />
            </div>
          </>
        )}
        <VoiceBadge
          n={index + 1}
          className="absolute left-1.5 top-1.5 !h-5 !w-5 !bg-card !text-[0.62rem] !opacity-90"
        />
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-2 py-0.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{cuisineLabel}</span>
          <span className="h-1 w-1 shrink-0 rounded-full bg-border" aria-hidden />
          <span className="shrink-0">{difficultyLabel}</span>
        </div>
        <h3 className="truncate font-display text-base font-semibold leading-tight group-hover:text-clay sm:text-lg">
          {recipe.title}
        </h3>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            {recipe.tags.totalTimeMin != null
              ? t("recipes.minutes", { count: recipe.tags.totalTimeMin })
              : "—"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <UtensilsCrossed className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t(ingredientCountKey, { count: recipe.ingredients.length })}
          </span>
          {firstFlavor && <span className="max-w-full truncate text-clay">{firstFlavor}</span>}
        </div>
      </div>
    </Link>
  );
}

function EmptyState({
  search,
  t,
  importButton,
}: {
  search: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  importButton: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full border border-border bg-card">
        <ChefHat className="h-12 w-12 text-muted-foreground/40" strokeWidth={1} />
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold">{t("recipes.noRecipes")}</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {search ? t("recipes.noRecipesMatch", { search }) : t("recipes.noRecipesBody")}
        </p>
      </div>
      {!search && importButton}
    </div>
  );
}
