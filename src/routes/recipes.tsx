import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { Search, Filter, ArrowUpDown, Plus, Clock, Flame, ChefHat, Mic } from "lucide-react";

export const Route = createFileRoute("/recipes")({
  head: () => ({
    meta: [
      { title: "My recipes — CookTalk" },
      { name: "description", content: "Your personal voice-controlled recipe library." },
    ],
  }),
  component: RecipesPage,
});

const recipes = [
  { title: "Mom's red-braised pork", cuisine: "Sichuan", time: 75, difficulty: "medium", flavor: "savory · sweet", voice: "Mom", cooked: "2 days ago", color: "from-[#c4654a]/30 to-[#8b7355]/20" },
  { title: "Tomato & egg stir-fry", cuisine: "Home", time: 12, difficulty: "easy", flavor: "savory", voice: "Default · Aria", cooked: "today", color: "from-[#e8a87c]/40 to-[#c9b99a]/30" },
  { title: "Mapo tofu", cuisine: "Sichuan", time: 25, difficulty: "medium", flavor: "spicy · numbing", voice: "Default · Aria", cooked: "1 week ago", color: "from-[#c4654a]/40 to-[#4a3328]/30" },
  { title: "Grandma's pork dumplings", cuisine: "Northern", time: 90, difficulty: "hard", flavor: "savory", voice: "Grandma", cooked: "3 weeks ago", color: "from-[#c9b99a]/40 to-[#8b7355]/30" },
  { title: "Cold sesame noodles", cuisine: "Sichuan", time: 20, difficulty: "easy", flavor: "spicy · nutty", voice: "Default · Aria", cooked: "yesterday", color: "from-[#87a878]/30 to-[#c9b99a]/30" },
  { title: "Steamed sea bass", cuisine: "Cantonese", time: 25, difficulty: "easy", flavor: "umami", voice: "Default · Roger", cooked: "5 days ago", color: "from-[#a8c0d8]/30 to-[#c9b99a]/30" },
  { title: "Kung Pao chicken", cuisine: "Sichuan", time: 30, difficulty: "medium", flavor: "spicy · sweet", voice: "Mom", cooked: "2 weeks ago", color: "from-[#c4654a]/30 to-[#e8a87c]/30" },
  { title: "Scallion oil noodles", cuisine: "Shanghai", time: 15, difficulty: "easy", flavor: "savory", voice: "Default · Aria", cooked: "4 days ago", color: "from-[#c9b99a]/40 to-[#a39071]/30" },
  { title: "Braised eggplant", cuisine: "Home", time: 35, difficulty: "easy", flavor: "savory · sweet", voice: "Default · Aria", cooked: "—", color: "from-[#7a5b8e]/20 to-[#c9b99a]/30" },
];

function RecipesPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Personal knowledge base · 18 recipes</span>
              <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">My recipes</h1>
              <VoiceHint className="mt-3">Say "open the third one" or "show me Sichuan only"</VoiceHint>
            </div>
            <Link to="/import" className="inline-flex items-center gap-2 self-start rounded-full bg-foreground px-5 py-3 text-sm text-background hover:bg-clay">
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Import a video
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 min-w-[280px]">
              <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <input className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Search recipes…" />
              <span className="voice-hint">or say "search spicy"</span>
              <Mic className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} />
            </div>
            {["All", "Sichuan", "Cantonese", "Home", "Northern"].map((c, i) => (
              <button key={c} className={`relative inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs ${i === 0 ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:border-foreground"}`}>
                {c}
              </button>
            ))}
            <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs hover:border-foreground">
              <Filter className="h-3.5 w-3.5" strokeWidth={1.75} /> Filter
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs hover:border-foreground">
              <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.75} /> Last cooked
            </button>
          </div>
        </div>
      </section>

      <section className="flex-1">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((r, i) => (
              <Link
                key={r.title}
                to="/recipes"
                className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card hover:border-clay/60 transition-colors"
              >
                <VoiceBadge n={i + 1} className="absolute top-4 left-4 z-10 !bg-card !opacity-90" />
                <div className={`relative aspect-[4/3] overflow-hidden bg-gradient-to-br ${r.color}`}>
                  <div className="absolute inset-0 grain opacity-50" aria-hidden />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <ChefHat className="h-20 w-20 text-foreground/20" strokeWidth={1} />
                  </div>
                  <div className="absolute bottom-3 right-3 rounded-full bg-background/80 px-2.5 py-1 text-[10px] uppercase tracking-wider backdrop-blur">
                    {r.difficulty}
                  </div>
                </div>
                <div className="flex flex-col gap-2 p-5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{r.cuisine}</span>
                    <span>Last cooked · {r.cooked}</span>
                  </div>
                  <h3 className="font-display text-xl font-semibold leading-tight group-hover:text-clay">{r.title}</h3>
                  <p className="text-xs text-muted-foreground">{r.flavor}</p>
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-3 text-xs">
                    <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" strokeWidth={1.75} />{r.time} min</span>
                    <span className="inline-flex items-center gap-1.5 text-clay"><Flame className="h-3.5 w-3.5" strokeWidth={1.75} />{r.voice}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
