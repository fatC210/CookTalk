export type RecipeContentDisplayMode = "all" | "ingredients" | "steps";

type RecipeContentDisplayToggleProps = {
  value: RecipeContentDisplayMode;
  onChange: (value: RecipeContentDisplayMode) => void;
  allLabel: string;
  ingredientsLabel: string;
  stepsLabel: string;
  ariaLabel: string;
  className?: string;
};

const displayModes: Array<{
  value: RecipeContentDisplayMode;
  labelKey: "allLabel" | "ingredientsLabel" | "stepsLabel";
  voiceAliases: string;
}> = [
  { value: "all", labelKey: "allLabel", voiceAliases: "全部 显示全部 show all all content" },
  {
    value: "ingredients",
    labelKey: "ingredientsLabel",
    voiceAliases: "只看食材 只看材料 显示食材 ingredients only show ingredients",
  },
  {
    value: "steps",
    labelKey: "stepsLabel",
    voiceAliases: "只看步骤 只看做法 显示步骤 steps only show steps",
  },
];

export function shouldShowIngredients(mode: RecipeContentDisplayMode) {
  return mode === "all" || mode === "ingredients";
}

export function shouldShowSteps(mode: RecipeContentDisplayMode) {
  return mode === "all" || mode === "steps";
}

export function RecipeContentDisplayToggle({
  value,
  onChange,
  allLabel,
  ingredientsLabel,
  stepsLabel,
  ariaLabel,
  className = "",
}: RecipeContentDisplayToggleProps) {
  const labels = { allLabel, ingredientsLabel, stepsLabel };

  return (
    <div
      className={`grid max-w-full grid-cols-3 rounded-full border border-border bg-card/80 p-1 text-xs shadow-sm ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      {displayModes.map((mode) => {
        const active = value === mode.value;

        return (
          <button
            key={mode.value}
            type="button"
            className={`min-h-9 whitespace-nowrap rounded-full px-3 py-1.5 text-center transition-colors sm:px-4 ${
              active
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            }`}
            aria-pressed={active}
            data-voice-label={labels[mode.labelKey]}
            data-voice-aliases={mode.voiceAliases}
            onClick={() => onChange(mode.value)}
          >
            {labels[mode.labelKey]}
          </button>
        );
      })}
    </div>
  );
}
