import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { FileVideo, UploadCloud, Wand2, CheckCircle2, AudioLines, Mic, ImageIcon } from "lucide-react";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Import a video — CookTalk" },
      { name: "description", content: "Drop in a cooking video. We'll extract audio, transcribe with ElevenLabs, and structure it into a recipe." },
    ],
  }),
  component: ImportPage,
});

const stages = [
  { icon: UploadCloud, label: "Upload video", body: "MP4, MOV, WebM up to 200MB. Audio is extracted in-browser via ffmpeg.wasm." },
  { icon: AudioLines, label: "Speech to text", body: "ElevenLabs STT transcribes the narration with speaker diarization." },
  { icon: Wand2, label: "Structure with LLM", body: "OpenAI / DeepSeek extracts ingredients, steps, timings, and tips." },
  { icon: ImageIcon, label: "Generate cover", body: "AI-generated cover via your custom OpenAI-compatible endpoint, or upload your own." },
];

function ImportPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recipe ingestion</span>
          <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">Turn any video into a recipe.</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Drop a cooking video — yours, downloaded, anything. CookTalk extracts the audio, transcribes it, structures the steps, and adds it to your private library. Or just say <span className="font-mono text-foreground">"import a new recipe"</span>.
          </p>
        </div>
      </section>

      <section className="flex-1">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-8 lg:grid-cols-12">
            {/* Drop zone */}
            <div className="lg:col-span-7">
              <div className="relative rounded-3xl border-2 border-dashed border-border bg-card p-12 text-center hover:border-clay/60 transition-colors">
                <VoiceBadge n={1} className="absolute top-4 left-4" />
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-foreground/30">
                  <FileVideo className="h-9 w-9" strokeWidth={1.25} />
                </div>
                <h3 className="mt-6 font-display text-2xl">Drop a video here</h3>
                <p className="mt-2 text-sm text-muted-foreground">or click to browse — MP4, MOV, WebM</p>
                <button className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay">
                  <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                  Choose video
                </button>
                <VoiceHint className="mt-6 justify-center">Or say "select video"</VoiceHint>
              </div>

              {/* Mini preview of detected steps */}
              <div className="mt-6 rounded-3xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-lg">Last extraction · preview</h4>
                  <span className="inline-flex items-center gap-1.5 text-xs text-clay"><CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Ready to save</span>
                </div>
                <div className="mt-4 space-y-2">
                  {[
                    "Cut pork belly into 2cm cubes.",
                    "Heat oil to medium-high; brown on all sides.",
                    "Add Shaoxing wine, soy sauce, rock sugar.",
                    "Simmer covered for 45 minutes, stirring occasionally.",
                  ].map((s, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                      <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-foreground/40 font-display text-xs">{i + 1}</span>
                      <span className="text-sm">{s}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay">
                    <VoiceBadge n={2} className="!border-background/40 !text-background !bg-transparent !opacity-100" />
                    Save to my recipes
                  </button>
                  <button className="rounded-full border border-border px-5 py-2.5 text-sm hover:border-foreground">Edit fields</button>
                  <button className="rounded-full border border-border px-5 py-2.5 text-sm hover:border-foreground">Regenerate cover</button>
                </div>
              </div>
            </div>

            {/* Pipeline */}
            <div className="lg:col-span-5">
              <h4 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Pipeline</h4>
              <ol className="mt-3 space-y-3">
                {stages.map((s, i) => (
                  <li key={s.label} className="flex gap-4 rounded-2xl border border-border bg-card p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                      <s.icon className="h-5 w-5" strokeWidth={1.5} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-display text-base">{s.label}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">step {i + 1}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-6 rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-clay" strokeWidth={1.75} />
                  <span className="text-sm font-medium">AI follow-up questions</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  After extraction, CookTalk asks a few short questions by voice — servings, spice level, your notes — to enrich the recipe.
                </p>
                <Link to="/recipes" className="mt-4 inline-flex text-sm text-clay hover:underline">View existing recipes →</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
