import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function SiteHeader() {
  const { t } = useTranslation();
  const headerRef = useRef<HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { to: "/" as const, label: t("nav.home") },
    { to: "/recipes" as const, label: t("nav.recipes") },
    { to: "/import" as const, label: t("nav.import") },
    { to: "/voices" as const, label: t("nav.voices") },
    { to: "/settings" as const, label: t("nav.settings") },
  ];

  useEffect(() => {
    if (!mobileOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setMobileOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [mobileOpen]);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-border/20 bg-background/65 backdrop-blur-xl"
    >
      <div className="mx-auto grid h-14 max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:h-16 sm:gap-4 sm:px-6">
        <Link to="/" className="group flex min-w-0 items-center gap-2.5">
          <img
            src="/logo.png"
            alt={`${t("app.name")} logo`}
            className="h-9 w-9 rounded-full object-contain transition-transform group-hover:scale-105 sm:h-10 sm:w-10 dark:hidden"
          />
          <img
            src="/logo-dark.png"
            alt={`${t("app.name")} logo`}
            className="hidden h-9 w-9 rounded-full object-contain transition-transform group-hover:scale-105 sm:h-10 sm:w-10 dark:block"
          />
          <div className="flex flex-col leading-none">
            <span className="font-display text-base font-semibold tracking-tight sm:text-lg">
              {t("app.name")}
            </span>
            <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground sm:text-[10px] sm:tracking-[0.18em]">
              {t("app.tagline")}
            </span>
          </div>
        </Link>

        <nav className="hidden min-w-0 items-center justify-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeOptions={{ exact: l.to === "/" }}
              className="relative inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-sm leading-none text-muted-foreground transition-colors before:absolute before:inset-0 before:rounded-full before:bg-secondary before:opacity-0 before:transition-opacity hover:text-foreground data-[status=active]:text-foreground data-[status=active]:before:opacity-100"
            >
              <span className="relative z-10">{l.label}</span>
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/45 transition-colors hover:bg-secondary md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "收起菜单" : "展开菜单"}
          >
            {mobileOpen ? (
              <X className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <Menu className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="absolute inset-x-0 top-full z-50 border-t border-border/20 bg-background/90 px-4 py-3 shadow-[0_18px_45px_-24px_oklch(0.28_0.02_60_/_0.45)] backdrop-blur-xl md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                activeOptions={{ exact: l.to === "/" }}
                className="relative inline-flex h-11 items-center rounded-xl px-4 text-sm leading-none text-muted-foreground transition-colors before:absolute before:inset-0 before:rounded-xl before:bg-secondary before:opacity-0 before:transition-opacity hover:text-foreground hover:before:opacity-100 data-[status=active]:text-foreground data-[status=active]:before:opacity-100"
                onClick={() => setMobileOpen(false)}
              >
                <span className="relative z-10">{l.label}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
