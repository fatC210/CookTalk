import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { Play, Pencil, Trash2, Share2, Volume2, Clock, Flame, ChefHat, RefreshCw, Check } from "lucide-react";

export const Route = createFileRoute("/recipe-detail")({
  head: () => ({
    meta: [
      { title: "Mom's red-braised pork — CookTalk" },
      { name: "description", content: "Traditional Sichuan-style red-braised pork belly. Hands-free recipe." },
      { property: "og:title", content: "Mom's red-braised pork — CookTalk" },
    ],
  }),
  component: DetailPage,
});

const ingredients = [
  { name: "Pork belly", amount: "500g" },
  { name: "Rock sugar", amount: "30g" },
  { name: "Light soy sauce", amount: "2 tbsp" },
  { name: "Dark soy sauce", amount: "1 tbsp" },
  { name: "Shaoxing wine", amount: "3 tbsp" },
  { name: "Ginger", amount: "4 slices" },
  { name: "Star anise", amount: "2 pieces" },
  { name: "Scallion whites", amount: "2 stalks" },
];

const steps = [
  { d: "Cut pork belly into 2cm cubes. Blanch for 2 minutes, drain.", time: 5, tip: "Cold water start releases more impurities." },
  { d: "Heat 1 tbsp oil over medium, add rock sugar. Stir until amber caramel forms.", time: 3, tip: "Watch closely — burns fast." },
  { d: "Add the pork. Toss to coat in caramel until each piece is glossy.", time: 4 },
  { d: "Pour in Shaoxing wine, both soy sauces, and just enough hot water to cover.", time: 2 },
  { d: "Add ginger, star anise, scallion whites. Bring to a boil, reduce to low.", time: 3 },
  { d: "Simmer covered for 45 minutes, stirring every 10.", time: 45, tip: "Sauce should reduce by half." },
  { d: "Uncover, increase heat. Reduce until sauce coats the back of a spoon.", time: 6 },
  { d: "Plate, garnish with scallion greens. Serve with steamed rice.", time: 2 },
];

function DetailPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      {/* Hero */}
      <section className="relative border-b border-border/60">
        <div className="absolute inset-0 bg-gradient-to-br from-[#c4654a]/20 via-transparent to-[#8b7355]/15" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-6 py-14">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Link to="/recipes" className="hover:text-foreground">My recipes</Link>
                <span>/</span>
                <span>Sichuan</span>
                <span>/</span>
                <span className="text-foreground">Red-braised pork</span>
              </div>
              <h1 className="mt-4 font-display text-6xl font-semibold leading-[1.05] tracking-tight">
                Mom's <span className="italic font-light">red-braised</span> pork.
              </h1>
              <p className="mt-4 max-w-lg text-muted-foreground">
                Imported from a 12-minute home video. 8 steps, glossy caramel sauce, melts on the spoon. Narrated in Mom's cloned voice.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5"><Clock className="h-3.5 w-3.5" strokeWidth={1.75} /> 75 min total</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5"><Flame className="h-3.5 w-3.5" strokeWidth={1.75} /> Medium difficulty</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5"><ChefHat className="h-3.5 w-3.5" strokeWidth={1.75} /> Sichuan</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-clay bg-clay/10 px-3 py-1.5 text-clay">
                  <Volume2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Mom's voice
                </span>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <button className="group inline-flex items-center gap-2 rounded-full bg-foreground px-7 py-4 text-base text-background hover:bg-clay">
                  <VoiceBadge n={1} className="!border-background/40 !text-background !bg-transparent !opacity-100" />
                  <Play className="h-5 w-5" strokeWidth={1.75} />
                  Start cooking — hands free
                </button>
                <button className="inline-flex items-center gap-2 rounded-full border border-foreground/80 px-5 py-4 text-sm hover:bg-foreground hover:text-background">
                  <Pencil className="h-4 w-4" strokeWidth={1.75} /> Edit
                </button>
                <button className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-4 text-sm hover:border-foreground">
                  <Share2 className="h-4 w-4" strokeWidth={1.75} /> Export
                </button>
                <button className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-4 text-sm hover:border-foreground">
                  <RefreshCw className="h-4 w-4" strokeWidth={1.75} /> New cover
                </button>
              </div>
              <VoiceHint className="mt-4">Or say "start cooking" · "switch to Grandma" · "delete this recipe"</VoiceHint>
            </div>

            {/* Cover */}
            <div className="lg:col-span-5">
              <div className="relative aspect-square overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-[#c4654a]/40 via-[#a0522d]/30 to-[#8b7355]/40 shadow-[var(--shadow-warm)]">
                <div className="absolute inset-0 grain opacity-50" aria-hidden />
                <ChefHat className="absolute inset-0 m-auto h-40 w-40 text-foreground/15" strokeWidth={0.75} />
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-2xl bg-background/80 px-4 py-3 backdrop-blur">
                  <div className="text-xs">
                    <div className="text-muted-foreground">Cover · AI generated</div>
                    <div className="mt-0.5">"top-down food photography, ceramic plate, natural light"</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Body */}
      <section className="flex-1">
        <div className="mx-auto max-w-7xl px-6 py-14 grid gap-12 lg:grid-cols-12">
          {/* Ingredients */}
          <aside className="lg:col-span-4">
            <div className="sticky top-24">
              <div className="flex items-end justify-between">
                <h2 className="font-display text-2xl">Ingredients</h2>
                <span className="text-xs text-muted-foreground">Serves 4</span>
              </div>
              <VoiceHint className="mt-2">Say "check off pork belly"</VoiceHint>
              <ul className="mt-4 space-y-2">
                {ingredients.map((ing, i) => (
                  <li key={ing.name} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${i === 0 ? "bg-foreground border-foreground text-background" : "border-border"}`}>
                        {i === 0 && <Check className="h-3 w-3" strokeWidth={2.5} />}
                      </span>
                      <span className="text-sm">{ing.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{ing.amount}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-4">
                <div className="text-xs text-muted-foreground">Last cooked</div>
                <div className="mt-1 font-display text-lg">2 days ago</div>
                <div className="mt-3 text-xs text-muted-foreground">Source · imported video<br/>Saved · 3 weeks ago</div>
              </div>
            </div>
          </aside>

          {/* Steps */}
          <div className="lg:col-span-8">
            <div className="flex items-end justify-between">
              <h2 className="font-display text-2xl">Steps</h2>
              <VoiceHint>"Read step three" · "next step" · "repeat"</VoiceHint>
            </div>
            <ol className="mt-4 space-y-3">
              {steps.map((s, i) => (
                <li key={i} className="group relative flex gap-5 rounded-2xl border border-border bg-card p-5 hover:border-clay/60">
                  <VoiceBadge n={i + 1} className="absolute -left-3 top-5 !bg-card" />
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary font-display text-xl">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-base leading-relaxed">{s.d}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" strokeWidth={1.75} /> {s.time} min</span>
                      {s.tip && <span className="rounded-full bg-accent/40 px-2 py-0.5 text-accent-foreground">Tip · {s.tip}</span>}
                    </div>
                  </div>
                  <button className="self-start opacity-0 group-hover:opacity-100 transition-opacity inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-foreground hover:text-background">
                    <Play className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex items-center justify-between rounded-2xl border border-dashed border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <Trash2 className="h-5 w-5 text-destructive" strokeWidth={1.5} />
                <div>
                  <div className="text-sm font-medium">Delete this recipe</div>
                  <VoiceHint className="mt-0.5">Says "delete" then asks for confirmation</VoiceHint>
                </div>
              </div>
              <button className="rounded-full border border-destructive/40 px-4 py-2 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground">
                Delete
              </button>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
