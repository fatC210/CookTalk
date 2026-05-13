import { CheckCircle2, Loader2, LocateFixed } from "lucide-react";
import type { ReactNode } from "react";

type RecipeEditShortcutAction = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  voiceAliases?: string;
};

type RecipeEditShortcutsProps = {
  ingredientCount: number;
  stepCount: number;
  ingredientsLabel: string;
  stepsLabel: string;
  saveLabel: string;
  savingLabel?: string;
  jumpLabel: string;
  itemPlaceholder: string;
  onJumpIngredient: (index: number) => void;
  onJumpStep: (index: number) => void;
  onSave: () => void;
  disabled?: boolean;
  saving?: boolean;
  saveIcon?: ReactNode;
  saveVoiceAliases?: string;
  actions?: RecipeEditShortcutAction[];
  actionsPosition?: "before-save" | "after-save";
  showJumpControls?: boolean;
  className?: string;
};

export function RecipeEditShortcuts({
  ingredientCount,
  stepCount,
  ingredientsLabel,
  stepsLabel,
  saveLabel,
  savingLabel,
  jumpLabel,
  itemPlaceholder,
  onJumpIngredient,
  onJumpStep,
  onSave,
  disabled,
  saving,
  saveIcon,
  saveVoiceAliases,
  actions = [],
  actionsPosition = "before-save",
  showJumpControls = true,
  className = "",
}: RecipeEditShortcutsProps) {
  const actionButtons = actions.map((action) => (
    <button
      key={action.label}
      type="button"
      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
      onClick={action.onClick}
      disabled={action.disabled || disabled || saving}
      data-voice-label={action.label}
      data-voice-aliases={action.voiceAliases}
    >
      {action.icon}
      <span>{action.label}</span>
    </button>
  ));

  return (
    <>
      <div aria-hidden="true" className="mt-6 h-56 sm:h-44 md:h-24" />
      <div
        className={`group/shortcuts fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 sm:px-6 md:pointer-events-auto ${className}`}
      >
        <div className="pointer-events-auto mx-auto w-full max-w-5xl translate-y-0 rounded-[1.5rem] border border-border/80 bg-card/95 p-3 opacity-100 shadow-[0_20px_60px_-28px_oklch(0.25_0.03_55_/_0.45)] backdrop-blur-xl transition-[opacity,transform] duration-200 md:pointer-events-none md:translate-y-[calc(100%+1rem)] md:opacity-0 md:group-hover/shortcuts:pointer-events-auto md:group-hover/shortcuts:translate-y-0 md:group-hover/shortcuts:opacity-100 md:focus-within:pointer-events-auto md:focus-within:translate-y-0 md:focus-within:opacity-100 motion-reduce:transition-none">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {showJumpControls && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <LocateFixed className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {jumpLabel}
                </span>
                <JumpTargetSelect
                  label={ingredientsLabel}
                  count={ingredientCount}
                  placeholder={itemPlaceholder}
                  onJump={onJumpIngredient}
                />
                <JumpTargetSelect
                  label={stepsLabel}
                  count={stepCount}
                  placeholder={itemPlaceholder}
                  onJump={onJumpStep}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {actionsPosition === "before-save" ? actionButtons : null}
              <button
                type="button"
                className="inline-flex flex-1 shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm text-background transition-colors hover:bg-clay disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                onClick={onSave}
                disabled={disabled || saving}
                data-voice-label={saveLabel}
                data-voice-aliases={saveVoiceAliases}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  saveIcon || <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                )}
                <span>{saving ? savingLabel || saveLabel : saveLabel}</span>
              </button>
              {actionsPosition === "after-save" ? actionButtons : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

type JumpTargetSelectProps = {
  label: string;
  count: number;
  placeholder: string;
  onJump: (index: number) => void;
};

function JumpTargetSelect({ label, count, placeholder, onJump }: JumpTargetSelectProps) {
  return (
    <label className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs">
      <span className="shrink-0 text-muted-foreground">
        {label} / {count}
      </span>
      <input
        type="number"
        min={1}
        max={Math.max(1, count)}
        inputMode="numeric"
        placeholder={placeholder}
        className="h-6 w-14 rounded-full border border-border bg-card px-2 text-center outline-none focus:border-clay disabled:cursor-not-allowed disabled:opacity-50"
        disabled={count === 0}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const value = Number.parseInt(event.currentTarget.value, 10);
          if (!Number.isFinite(value)) return;
          onJump(Math.min(Math.max(value, 1), count) - 1);
          event.currentTarget.select();
        }}
      />
    </label>
  );
}
