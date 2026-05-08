import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { Mic, Play, Plus, Star, Trash2, Sparkles, Volume2 } from "lucide-react";

export const Route = createFileRoute("/voices")({
  head: () => ({
    meta: [
      { title: "Voice library — CookTalk" },
      { name: "description", content: "Manage default voices and clone family voices to narrate your recipes." },
    ],
  }),
  component: VoicesPage,
});

const cloned = [
  { name: "Mom", lang: "Mandarin · warm", default: true, samples: 3 },
  { name: "Grandma", lang: "Mandarin · slow", default: false, samples: 5 },
  { name: "Dad", lang: "English · deep", default: false, samples: 2 },
];

const presets = [
  { name: "Aria", lang: "EN-US · neutral" },
  { name: "Roger", lang: "EN-US · narrator" },
  { name: "Sarah", lang: "EN-GB · cheerful" },
  { name: "Charlotte", lang: "EN-AU · soft" },
  { name: "晓晓", lang: "ZH-CN · warm" },
  { name: "云希", lang: "ZH-CN · bright" },
];

function VoicesPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Voice cloning · ElevenLabs</span>
            <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">Voices</h1>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground">
              Preset narrators for everyday cooking, plus your own cloned family voices. Bind a voice per recipe — or globally.
            </p>
          </div>
          <button className="inline-flex items-center gap-2 self-start rounded-full bg-foreground px-5 py-3 text-sm text-background hover:bg-clay">
            <Plus className="h-4 w-4" strokeWidth={1.75} /> Clone a new voice
          </button>
        </div>
      </section>

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl">My cloned voices</h2>
            <VoiceHint>Say "play Mom" or "set Grandma as default"</VoiceHint>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {cloned.map((v, i) => (
              <article key={v.name} className="relative rounded-3xl border border-border bg-card p-6">
                <VoiceBadge n={i + 1} className="absolute top-4 left-4" />
                <div className="flex items-center justify-between">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-clay/40 bg-secondary">
                    <Volume2 className="h-6 w-6 text-clay" strokeWidth={1.5} />
                  </div>
                  {v.default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-[10px] uppercase tracking-wider text-background">
                      <Star className="h-3 w-3" strokeWidth={2} /> default
                    </span>
                  )}
                </div>
                <h3 className="mt-4 font-display text-2xl">{v.name}</h3>
                <p className="text-xs text-muted-foreground">{v.lang} · {v.samples} samples</p>
                {/* waveform */}
                <div className="mt-4 flex h-10 items-center gap-1">
                  {Array.from({ length: 40 }).map((_, k) => (
                    <span key={k} className="flex-1 rounded-full bg-clay/40" style={{ height: `${20 + Math.abs(Math.sin(k * 0.6 + i)) * 80}%` }} />
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <button className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-foreground/80 py-2 text-xs hover:bg-foreground hover:text-background">
                    <Play className="h-3.5 w-3.5" strokeWidth={1.75} /> Preview
                  </button>
                  <button className="inline-flex items-center justify-center rounded-full border border-border p-2 text-muted-foreground hover:border-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              </article>
            ))}

            {/* New voice slot */}
            <button className="group flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border bg-card hover:border-clay transition-colors">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-foreground/30 group-hover:border-clay">
                <Mic className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <div className="font-display text-base">Record 30 seconds</div>
                <VoiceHint className="justify-center mt-1">Say "add a new voice"</VoiceHint>
              </div>
            </button>
          </div>
        </div>
      </section>

      <section className="flex-1">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-display text-2xl">Preset narrators</h2>
              <p className="text-sm text-muted-foreground">Free with your ElevenLabs key.</p>
            </div>
            <Link to="/settings" className="text-sm text-clay hover:underline inline-flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} /> Configure key
            </Link>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {presets.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4">
                <div className="flex items-center gap-3">
                  <VoiceBadge n={i + 1} />
                  <div>
                    <div className="font-display text-base">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.lang}</div>
                  </div>
                </div>
                <button className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-foreground/30 hover:bg-foreground hover:text-background">
                  <Play className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
