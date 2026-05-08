import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { Mic, Volume2, ChefHat, Sparkles, ArrowRight, Check } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Welcome — CookTalk" },
      { name: "description", content: "A 4-step voice-guided setup." },
    ],
  }),
  component: OnboardingPage,
});

const steps = [
  { icon: Mic, title: "Allow microphone", body: "Required for wake-word and voice commands. Audio never leaves your device unless transcribed by ElevenLabs." },
  { icon: Sparkles, title: "Add your ElevenLabs key", body: "Paste it, or read it aloud. Encrypted locally with AES-GCM." },
  { icon: Volume2, title: "Pick a default voice", body: "Choose a preset, or clone a family voice from a 30-second sample." },
  { icon: ChefHat, title: "Try a sample recipe", body: 'Say "open the sample recipe" and start cooking — entirely hands-free.' },
];

function OnboardingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden">
        <div className="absolute -top-40 -right-20 h-[500px] w-[500px] rounded-full bg-accent/30 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-6 py-20">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-clay animate-pulse" />
              Voice-guided setup · ~ 90 seconds
            </span>
            <h1 className="mt-6 font-display text-5xl font-semibold tracking-tight md:text-6xl">
              Welcome to CookTalk.
            </h1>
            <p className="mt-4 mx-auto max-w-xl text-muted-foreground">
              Four steps. You can complete every single one with your voice. Or click. Or both. Your hands, your call.
            </p>
          </div>

          <ol className="mt-14 space-y-3">
            {steps.map((s, i) => (
              <li
                key={s.title}
                className={`relative flex items-start gap-5 rounded-3xl border border-border p-6 transition-colors ${i === 0 ? "bg-card" : "bg-card/40"}`}
              >
                <VoiceBadge n={i + 1} className="absolute -left-3 top-6" />
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${i === 0 ? "bg-foreground text-background" : "bg-secondary"}`}>
                  {i === 0 ? <Check className="h-6 w-6" strokeWidth={1.75} /> : <s.icon className="h-6 w-6" strokeWidth={1.5} />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-display text-2xl">{s.title}</h3>
                    {i === 0 && <span className="text-xs text-clay">Done</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                </div>
                <button className="hidden items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay md:inline-flex">
                  {i === 0 ? "Re-grant" : "Continue"} <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ol>

          <div className="mt-12 flex flex-col items-center gap-4">
            <Link to="/recipes" className="inline-flex items-center gap-2 rounded-full bg-foreground px-7 py-4 text-base text-background hover:bg-clay">
              I'm ready · open my kitchen <ArrowRight className="h-5 w-5" strokeWidth={1.75} />
            </Link>
            <VoiceHint>Or just say "I'm ready"</VoiceHint>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
