import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export function ManualWakeButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const manualWakeActive = useAppStore((s) => s.manualWakeActive);
  const manualWakeExpiresAt = useAppStore((s) => s.manualWakeExpiresAt);
  const triggerManualWake = useAppStore((s) => s.triggerManualWake);
  const clearManualWake = useAppStore((s) => s.clearManualWake);

  useEffect(() => {
    if (!manualWakeActive || !manualWakeExpiresAt) return;

    const delay = Math.max(0, manualWakeExpiresAt - Date.now());
    const timer = window.setTimeout(clearManualWake, delay);
    return () => window.clearTimeout(timer);
  }, [clearManualWake, manualWakeActive, manualWakeExpiresAt]);

  const label = manualWakeActive ? t("app.awake") : t("app.manualWake");

  const handleClick = () => {
    triggerManualWake();
    window.dispatchEvent(new CustomEvent("cooktalk:manual-wake"));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={manualWakeActive}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        manualWakeActive
          ? "border-clay bg-clay text-white shadow-sm shadow-clay/20"
          : "border-border bg-background text-foreground hover:border-clay hover:text-clay",
        className,
      )}
    >
      <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
