import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export function VoiceBadge({ n, className }: { n: number; className?: string }) {
  const visible = useAppStore((s) => s.voiceBadgesVisible);
  if (!visible) return null;
  return <span className={cn("voice-badge", className)}>{n}</span>;
}

export function VoiceHint({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const visible = useAppStore((s) => s.voiceBadgesVisible);
  if (!visible) return null;
  return (
    <span className={cn("voice-hint inline-flex items-center gap-1", className)}>
      <span className="inline-block h-1 w-1 rounded-full bg-clay/60" />
      {children}
    </span>
  );
}
