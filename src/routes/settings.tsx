import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { Key, Mic2, Image as ImageIcon, Globe, Moon, Lock, Download, Upload, Trash2, Eye } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — CookTalk" },
      { name: "description", content: "Configure API keys, voice wake-words, language, theme, and data — all by voice." },
    ],
  }),
  component: SettingsPage,
});

function Field({
  n, label, hint, value, type = "password", placeholder,
}: { n: number; label: string; hint?: string; value?: string; type?: string; placeholder?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <VoiceBadge n={n} />
        <div className="flex-1">
          <label className="text-sm font-medium">{label}</label>
          {hint && <div className="voice-hint mt-0.5">{hint}</div>}
        </div>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
          <Eye className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
        <input
          type={type}
          placeholder={placeholder}
          defaultValue={value}
          className="flex-1 bg-transparent text-sm tracking-wider outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

function Toggle({ n, label, hint, on = false }: { n: number; label: string; hint?: string; on?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-3">
        <VoiceBadge n={n} />
        <div>
          <div className="text-sm font-medium">{label}</div>
          {hint && <div className="voice-hint mt-0.5">{hint}</div>}
        </div>
      </div>
      <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border ${on ? "bg-foreground border-foreground" : "border-border bg-background"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background border border-border transition-all ${on ? "left-[22px] bg-cream" : "left-0.5"}`} />
      </span>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Configuration · all voice-controllable</span>
          <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">Settings</h1>
          <VoiceHint className="mt-3">Try "switch to dark mode", "set sensitivity to high", or "export all recipes"</VoiceHint>
        </div>
      </section>

      <section className="flex-1">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-10 lg:grid-cols-12">
            {/* Sidebar */}
            <aside className="lg:col-span-3">
              <nav className="sticky top-24 space-y-1">
                {[
                  { icon: Key, label: "API keys" },
                  { icon: Mic2, label: "Voice & wake" },
                  { icon: ImageIcon, label: "Cover images" },
                  { icon: Globe, label: "Language" },
                  { icon: Moon, label: "Appearance" },
                  { icon: Download, label: "Data" },
                ].map((s, i) => (
                  <a key={s.label} href={`#s${i}`} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${i === 0 ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}`}>
                    <s.icon className="h-4 w-4" strokeWidth={1.75} /> {s.label}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="lg:col-span-9 space-y-12">
              {/* API keys */}
              <section id="s0">
                <h2 className="font-display text-2xl">API keys</h2>
                <p className="mt-1 text-sm text-muted-foreground">Encrypted with AES-GCM and stored locally. Never sent anywhere except the providers below.</p>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <Field n={1} label="ElevenLabs API key" hint='Required · say "save" after pasting' value="sk_••••••••••••••••" placeholder="sk_..." />
                  <Field n={2} label="LLM key (OpenAI / DeepSeek)" hint="Choose one or both" placeholder="sk-..." />
                  <Field n={3} label="Image gen endpoint" hint="OpenAI-compatible URL" type="text" value="https://api.openai.com/v1" />
                  <Field n={4} label="Image gen API key" hint="For recipe covers" placeholder="sk-..." />
                </div>
                <div className="mt-3 flex items-center justify-between rounded-2xl border border-dashed border-border bg-card px-5 py-4 text-sm">
                  <span className="text-muted-foreground">Estimated usage this month</span>
                  <span className="font-display text-lg">$2.41 <span className="text-xs text-muted-foreground">/ ~140 minutes</span></span>
                </div>
              </section>

              {/* Voice */}
              <section id="s1">
                <h2 className="font-display text-2xl">Voice & wake-word</h2>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center gap-3">
                      <VoiceBadge n={5} />
                      <div className="flex-1">
                        <div className="text-sm font-medium">Wake words</div>
                        <div className="voice-hint mt-0.5">Say "add wake word XX"</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["Hey CookTalk", "嗨厨语", "+ Add"].map((w, i) => (
                        <span key={w} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${i === 2 ? "border border-dashed border-border text-muted-foreground" : "bg-foreground text-background"}`}>
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center gap-3">
                      <VoiceBadge n={6} />
                      <div className="flex-1">
                        <div className="text-sm font-medium">Sensitivity</div>
                        <div className="voice-hint mt-0.5">"Set sensitivity to high"</div>
                      </div>
                      <span className="text-xs text-muted-foreground">Medium</span>
                    </div>
                    <div className="mt-4 flex gap-1">
                      {["Low", "Medium", "High"].map((s, i) => (
                        <button key={s} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${i === 1 ? "border-foreground bg-foreground text-background" : "border-border"}`}>{s}</button>
                      ))}
                    </div>
                  </div>

                  <Toggle n={7} label="Voice badges visible" hint='"Hide voice badges"' on />
                  <Toggle n={8} label="Always-listen in cooking mode" hint='Default in /cook' on />
                  <Toggle n={9} label="Screen wake-lock" hint='"Keep screen on"' on />
                  <Toggle n={10} label="Sound effect on confirm" hint='Subtle click' />
                </div>
              </section>

              {/* Language & appearance */}
              <section id="s3" className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <VoiceBadge n={11} />
                    <span className="text-sm font-medium">Interface language</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {["English", "中文"].map((l, i) => (
                      <button key={l} className={`flex-1 rounded-xl border px-3 py-2.5 text-sm ${i === 0 ? "border-foreground bg-foreground text-background" : "border-border"}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <VoiceBadge n={12} />
                    <span className="text-sm font-medium">Appearance</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {["Light", "Dark", "Auto"].map((l, i) => (
                      <button key={l} className={`flex-1 rounded-xl border px-3 py-2.5 text-sm ${i === 0 ? "border-foreground bg-foreground text-background" : "border-border"}`}>{l}</button>
                    ))}
                  </div>
                </div>
              </section>

              {/* Data */}
              <section id="s5">
                <h2 className="font-display text-2xl">Data management</h2>
                <p className="mt-1 text-sm text-muted-foreground">All recipes live in IndexedDB on this device.</p>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <button className="group flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-5 text-left hover:border-foreground">
                    <Download className="h-5 w-5" strokeWidth={1.5} />
                    <div className="font-display text-base">Export all</div>
                    <VoiceHint>"Export all recipes"</VoiceHint>
                  </button>
                  <button className="group flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-5 text-left hover:border-foreground">
                    <Upload className="h-5 w-5" strokeWidth={1.5} />
                    <div className="font-display text-base">Import JSON</div>
                    <VoiceHint>"Import recipes"</VoiceHint>
                  </button>
                  <button className="group flex flex-col items-start gap-2 rounded-2xl border border-destructive/30 bg-card p-5 text-left text-destructive hover:border-destructive">
                    <Trash2 className="h-5 w-5" strokeWidth={1.5} />
                    <div className="font-display text-base">Clear all data</div>
                    <VoiceHint>Requires verbal confirmation</VoiceHint>
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
