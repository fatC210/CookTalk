import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function SiteFooter() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border/60 bg-card/30">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <h3 className="font-display text-2xl font-semibold tracking-tight">{t("app.name")}</h3>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              {t("footer.description")}
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" />
              {t("footer.version")}
            </div>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("footer.product")}</h4>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link to="/recipes" className="hover:text-clay">{t("nav.recipes")}</Link></li>
              <li><Link to="/import" className="hover:text-clay">{t("nav.import")}</Link></li>
              <li><Link to="/voices" className="hover:text-clay">{t("nav.voices")}</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("footer.system")}</h4>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link to="/settings" className="hover:text-clay">{t("nav.settings")}</Link></li>
              <li><Link to="/onboarding" className="hover:text-clay">{t("onboarding.title").split(".")[0]}</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground md:flex-row md:items-center">
          <span>{t("footer.copyright")}</span>
          <span>{t("footer.languageSwitch")}</span>
        </div>
      </div>
    </footer>
  );
}
