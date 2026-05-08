import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  Mic, Timer, Sparkles, Volume2, FileVideo, ChefHat,
  ArrowUpRight, Radio, Waves, MessageCircle, ShieldCheck, Languages,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CookTalk — Voice-first AI kitchen assistant" },
      { name: "description", content: "Hands-free cooking. Turn videos into recipes, clone family voices, run multiple timers — all with your voice." },
      { property: "og:title", content: "CookTalk — Voice-first AI kitchen" },
      { property: "og:description", content: "100% voice-controlled cooking companion. Never touch the screen with greasy hands again." },
    ],
  }),
  component: HomePage,
});

const features = [
  { icon: Mic, title: "Voice-first everywhere", body: "Every tap has an equivalent voice command. Navigate, edit, search, set timers — all hands-free.", hint: 'Try "open recipes"' },
  { icon: FileVideo, title: "Video → recipe", body: "Drop in any cooking video. ffmpeg.wasm + ElevenLabs STT structures it into ingredients & steps.", hint: 'Say "import a new recipe"' },
  { icon: Volume2, title: "Clone any voice", body: "30 seconds of audio is enough. Have grandma narrate her dumpling recipe — forever.", hint: 'Say "add a new voice"' },
  { icon: Timer, title: "Parallel timers", body: "“Remind me to flip in 3 minutes and turn off heat at 8.” Done — in one sentence.", hint: 'Say "how much time left"' },
  { icon: Sparkles, title: "AI recipe search", body: "Local-first: searches your library before reaching the web. You own the knowledge base.", hint: 'Say "something spicy tonight"' },
  { icon: ShieldCheck, title: "100% local data", body: "IndexedDB + AES-GCM encrypted keys. Your recipes never leave the device.", hint: '"Export all recipes"' },
];

function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grain opacity-60" aria-hidden />
        <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-accent/40 blur-3xl" aria-hidden />
        <div className="absolute -bottom-40 left-0 h-[400px] w-[400px] rounded-full bg-primary/20 blur-3xl" aria-hidden />

        <div className="relative mx-auto max-w-7xl px-6 pt-20 pb-28">
          <div className="grid items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
                <Radio className="h-3 w-3 text-clay" strokeWidth={2} />
                <span className="font-medium">Now listening for "Hey CookTalk"</span>
              </div>

              <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
                Cook with your <span className="italic font-light">voice</span>.
                <br />
                Never with your <span className="relative inline-block">
                  <span className="relative z-10">screen</span>
                  <span className="absolute inset-x-0 bottom-2 h-3 bg-accent/60 -z-0" />
                </span>.
              </h1>

              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                A 100% voice-controlled AI kitchen assistant. Turn videos into structured recipes, clone family voices, run parallel timers, and ask "what can I substitute for soy sauce?" — all without touching the screen.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/recipes"
                  className="group relative inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
                >
                  <VoiceBadge n={1} className="!border-background/40 !text-background !bg-transparent !opacity-100" />
                  Browse my recipes
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={1.75} />
                </Link>
                <Link
                  to="/import"
                  className="inline-flex items-center gap-2 rounded-full border border-foreground/80 px-6 py-3.5 text-sm font-medium hover:bg-foreground hover:text-background transition-colors"
                >
                  <VoiceBadge n={2} />
                  Import a video
                </Link>
                <Link
                  to="/onboarding"
                  className="inline-flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground hover:text-foreground"
                >
                  Or say <span className="font-mono text-foreground">"start setup"</span>
                </Link>
              </div>

              <div className="mt-10 flex items-center gap-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-clay" />ElevenLabs Conversational AI</div>
                <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-clay" />Local-first, encrypted</div>
                <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-clay" />EN · 中文</div>
              </div>
            </div>

            {/* Voice card */}
            <div className="lg:col-span-5">
              <div className="relative rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-warm)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40">
                      <ChefHat className="h-5 w-5 text-clay" strokeWidth={1.5} />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Now cooking</div>
                      <div className="text-xs text-muted-foreground">Mom's red-braised pork · step 3 of 8</div>
                    </div>
                  </div>
                  <span className="inline-flex h-7 items-center rounded-full bg-secondary px-2.5 text-[10px] uppercase tracking-wider">live</span>
                </div>

                <div className="mt-6 rounded-2xl bg-background p-5">
                  <div className="text-xs text-muted-foreground">CookTalk · in Mom's voice</div>
                  <p className="mt-2 font-display text-xl leading-snug">
                    "Add the soy sauce and a tablespoon of rock sugar. Stir until the pork is glossy."
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <Waves className="h-5 w-5 text-clay animate-pulse" strokeWidth={1.5} />
                    <div className="flex h-1 flex-1 items-center gap-1">
                      {Array.from({ length: 28 }).map((_, i) => (
                        <span
                          key={i}
                          className="flex-1 rounded-full bg-clay/30"
                          style={{ height: `${20 + Math.sin(i * 0.7) * 16 + 12}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Flip</span>
                      <Timer className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </div>
                    <div className="mt-1 font-display text-2xl tabular-nums">02:14</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Heat off</span>
                      <Timer className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </div>
                    <div className="mt-1 font-display text-2xl tabular-nums">07:38</div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-dashed border-border p-3">
                  <div className="flex items-start gap-2">
                    <MessageCircle className="mt-0.5 h-4 w-4 text-clay shrink-0" strokeWidth={1.5} />
                    <div className="text-xs">
                      <div className="text-muted-foreground">You asked</div>
                      <div className="mt-0.5 text-foreground">"What can I use instead of dark soy sauce?"</div>
                    </div>
                  </div>
                </div>

                <VoiceHint className="mt-4">Say "next step", "repeat", or "pause"</VoiceHint>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE GRID */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">What's inside</span>
              <h2 className="mt-2 max-w-2xl font-display text-4xl font-semibold tracking-tight md:text-5xl">
                Six pillars. One promise — your hands stay where they belong.
              </h2>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              Every interaction in CookTalk has both a touch path and a voice path. The voice path is always primary.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <article
                key={f.title}
                className="group relative flex flex-col rounded-3xl border border-border bg-card p-7 transition-colors hover:border-clay/60"
              >
                <VoiceBadge n={i + 1} className="absolute top-4 left-4" />
                <div className="self-end">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary group-hover:bg-foreground group-hover:text-background transition-colors">
                    <f.icon className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                </div>
                <h3 className="mt-8 font-display text-xl font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
                <VoiceHint className="mt-6">{f.hint}</VoiceHint>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-border/60 bg-secondary/40">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">A typical session</span>
              <h2 className="mt-2 font-display text-4xl font-semibold tracking-tight md:text-5xl">
                Phone on the counter. Hands in the dough.
              </h2>
              <p className="mt-4 text-sm text-muted-foreground">
                Below: a real flow — wake, navigate, cook, ask, time, finish. Zero touches.
              </p>
              <Link
                to="/recipes"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay"
              >
                See it live <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            </div>

            <ol className="lg:col-span-8 space-y-3">
              {[
                { you: "Hey CookTalk.", ai: "I'm listening." },
                { you: "Open my recipes.", ai: "Showing 18 recipes. Say a number or a name." },
                { you: "Open the third one — red-braised pork.", ai: "Got it. Tap or say 'start cooking'." },
                { you: "Start cooking.", ai: "Step 1: cut the pork belly into 2cm cubes." },
                { you: "Remind me to flip in 3 minutes and turn off heat at 8.", ai: "Two timers set. I'll let you know." },
                { you: "What can I use instead of rock sugar?", ai: "White sugar, halve the amount. Continue?" },
                { you: "Continue.", ai: "Step 2: heat oil and brown the pork on all sides." },
              ].map((row, i) => (
                <li key={i} className="grid grid-cols-12 gap-3 rounded-2xl border border-border bg-background p-4">
                  <div className="col-span-1 text-xs text-muted-foreground tabular-nums pt-0.5">0{i + 1}</div>
                  <div className="col-span-11 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-foreground" />
                      <span className="text-sm"><span className="text-muted-foreground mr-2">You</span>{row.you}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-clay" />
                      <span className="text-sm"><span className="text-clay mr-2">CookTalk</span>{row.ai}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="relative overflow-hidden rounded-[2rem] bg-foreground p-10 md:p-16 text-background">
            <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-clay/40 blur-3xl" aria-hidden />
            <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <Languages className="h-6 w-6 text-cream/70" strokeWidth={1.5} />
                <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight md:text-5xl">
                  Ready when your hands aren't.
                </h2>
                <p className="mt-4 max-w-md text-sm text-cream/70">
                  Configure your ElevenLabs key once — by voice or by paste. Then never look back.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Link
                  to="/onboarding"
                  className="inline-flex items-center justify-between rounded-2xl bg-background px-6 py-5 text-foreground hover:bg-accent transition-colors"
                >
                  <span className="font-display text-xl">Start the voice setup</span>
                  <ArrowUpRight className="h-5 w-5" strokeWidth={1.5} />
                </Link>
                <Link
                  to="/settings"
                  className="inline-flex items-center justify-between rounded-2xl border border-cream/20 px-6 py-5 hover:bg-cream/10 transition-colors"
                >
                  <span className="font-display text-xl">Paste my API key manually</span>
                  <ArrowUpRight className="h-5 w-5" strokeWidth={1.5} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
