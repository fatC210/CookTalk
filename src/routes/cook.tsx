import { createFileRoute, Link } from "@tanstack/react-router";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { Mic, Pause, SkipForward, SkipBack, Volume2, Timer, X, MessageCircle, Waves } from "lucide-react";

export const Route = createFileRoute("/cook")({
  head: () => ({
    meta: [
      { title: "Cooking — CookTalk" },
      { name: "description", content: "Full-screen, hands-free cooking mode." },
    ],
  }),
  component: CookPage,
});

function CookPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 bg-secondary">
              <Volume2 className="h-5 w-5 text-clay" strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Now narrating · Mom's voice</div>
              <div className="font-display text-base">Red-braised pork</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-clay animate-pulse" /> Always listening
            </span>
            <Link to="/recipe-detail" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-foreground hover:text-background">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Link>
          </div>
        </div>
      </header>

      {/* Step body */}
      <main className="flex-1 flex flex-col">
        <div className="mx-auto w-full max-w-5xl flex-1 flex flex-col px-6 py-10">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Step 3 of 8</div>
            <div className="flex gap-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} className={`h-1 w-10 rounded-full ${i < 3 ? "bg-foreground" : i === 3 ? "bg-clay" : "bg-border"}`} />
              ))}
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            <h1 className="font-display text-5xl font-medium leading-[1.1] tracking-tight md:text-7xl">
              Add the pork. Toss to coat in caramel <span className="text-clay">until each piece is glossy.</span>
            </h1>
            <p className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-accent/40 px-4 py-2 text-sm">
              <span className="font-medium">Tip ·</span> Don't rush — caramel coating is what gives the dish its color.
            </p>

            <div className="mt-10 flex items-center gap-4">
              <Waves className="h-8 w-8 text-clay animate-pulse" strokeWidth={1.25} />
              <div className="flex h-10 flex-1 items-center gap-1">
                {Array.from({ length: 80 }).map((_, i) => (
                  <span key={i} className="flex-1 rounded-full bg-clay/40" style={{ height: `${20 + Math.abs(Math.sin(i * 0.4)) * 80}%` }} />
                ))}
              </div>
            </div>
          </div>

          {/* Active timers */}
          <div className="grid gap-3 md:grid-cols-2">
            {[
              { label: "Flip pork", remaining: "02:14", total: "03:00", warn: false },
              { label: "Heat off", remaining: "07:38", total: "08:00", warn: false },
            ].map((t, i) => (
              <div key={i} className="relative flex items-center justify-between overflow-hidden rounded-2xl border border-border bg-card p-5">
                <div className="absolute left-0 top-0 h-full bg-clay/15" style={{ width: `${(1 - parseInt(t.remaining) / parseInt(t.total)) * 100}%` }} aria-hidden />
                <div className="relative flex items-center gap-3">
                  <Timer className="h-5 w-5 text-clay" strokeWidth={1.5} />
                  <div>
                    <div className="text-xs text-muted-foreground">{t.label}</div>
                    <div className="font-display text-3xl tabular-nums">{t.remaining}</div>
                  </div>
                </div>
                <VoiceHint className="relative">"add 2 min" · "cancel"</VoiceHint>
              </div>
            ))}
          </div>

          {/* Q&A bubble */}
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <MessageCircle className="mt-0.5 h-4 w-4 text-clay shrink-0" strokeWidth={1.75} />
              <div className="text-sm">
                <div className="text-xs text-muted-foreground">You asked</div>
                <p className="mt-0.5">"What if I don't have rock sugar?"</p>
                <p className="mt-2 text-clay">Use white sugar — about half the amount. Continue with step 3?</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom controls */}
        <div className="border-t border-border/60 bg-card/50">
          <div className="mx-auto flex max-w-5xl items-center justify-center gap-3 px-6 py-6">
            <button className="relative inline-flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background hover:border-foreground">
              <VoiceBadge n={1} className="absolute -top-1 -right-1" />
              <SkipBack className="h-5 w-5" strokeWidth={1.5} />
            </button>
            <button className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background hover:bg-clay">
              <Pause className="h-6 w-6" strokeWidth={1.5} />
            </button>
            <button className="relative inline-flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background hover:border-foreground">
              <VoiceBadge n={2} className="absolute -top-1 -right-1" />
              <SkipForward className="h-5 w-5" strokeWidth={1.5} />
            </button>
            <div className="ml-4 hidden flex-1 items-center gap-2 rounded-full border border-border bg-background px-4 py-3 md:flex">
              <Mic className="h-4 w-4 text-clay" strokeWidth={1.75} />
              <span className="text-sm text-muted-foreground">Listening — say "next step", "repeat", "set 5 min timer"…</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
