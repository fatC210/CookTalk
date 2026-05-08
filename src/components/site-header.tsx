import { Link } from "@tanstack/react-router";
import { Mic, Radio } from "lucide-react";

const links = [
  { to: "/", label: "Home" },
  { to: "/recipes", label: "Recipes" },
  { to: "/import", label: "Import" },
  { to: "/voices", label: "Voices" },
  { to: "/settings", label: "Settings" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/80 group-hover:bg-foreground group-hover:text-background transition-colors">
            <Mic className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="flex flex-col leading-none">
            <span className="font-display text-lg font-semibold tracking-tight">CookTalk</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Voice-first kitchen</span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeOptions={{ exact: l.to === "/" }}
              className="relative rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground data-[status=active]:text-foreground data-[status=active]:bg-secondary"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <Radio className="h-3.5 w-3.5 text-clay animate-pulse" strokeWidth={2} />
          <span className="text-xs font-medium">Listening</span>
          <span className="voice-hint hidden sm:inline">Hey CookTalk</span>
        </div>
      </div>
    </header>
  );
}
