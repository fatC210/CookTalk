import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { GlobalVoiceController } from "@/components/global-voice-controller";
import { removeSampleRecipes } from "@/lib/db";
import { getApiKey } from "@/lib/crypto";
import { useAppStore } from "@/stores/app-store";
import i18n from "@/lib/i18n";
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE_NAME, isAppLanguage } from "@/lib/language";
import { useTranslation } from "react-i18next";

import appCss from "../styles.css?url";

function waitForRouterHydration() {
  if (typeof window === "undefined") return Promise.resolve();

  const globalState = window as Window & {
    $_TSR?: {
      hydrated?: boolean;
    };
  };

  return new Promise<void>((resolve) => {
    const isHydrated = () => !globalState.$_TSR || globalState.$_TSR.hydrated;

    if (isHydrated()) {
      resolve();
      return;
    }

    const check = () => {
      if (isHydrated()) {
        resolve();
        return;
      }

      window.requestAnimationFrame(check);
    };

    window.requestAnimationFrame(check);
  });
}

function NotFoundComponent() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("root.notFound.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("root.notFound.body")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("root.goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("root.error.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("root.error.body")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.retry")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("root.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => {
    const initialLanguage = await getPreferredLanguage();
    if (i18n.language !== initialLanguage) {
      await i18n.changeLanguage(initialLanguage);
    }

    return { initialLanguage };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: i18n.t("root.metaTitle") },
      {
        name: "description",
        content: i18n.t("root.metaDescription"),
      },
      { name: "author", content: "CookTalk" },
      { property: "og:title", content: i18n.t("root.ogTitle") },
      { property: "og:description", content: i18n.t("root.ogDescription") },
      { property: "og:type", content: "website" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/logo-dark.png",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const getPreferredLanguage = createServerFn({ method: "GET" }).handler(async () => {
  const { getCookie } = await import("@tanstack/react-start/server");
  const cookieLanguage = getCookie(LANGUAGE_COOKIE_NAME);
  return isAppLanguage(cookieLanguage) ? cookieLanguage : DEFAULT_LANGUAGE;
});

function RootShell({ children }: { children: React.ReactNode }) {
  const { initialLanguage } = Route.useLoaderData();

  return (
    <html lang={initialLanguage === "zh" ? "zh-CN" : "en"}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { initialLanguage } = Route.useLoaderData();
  const language = useAppStore((s) => s.language);
  const setHasElevenLabsKey = useAppStore((s) => s.setHasElevenLabsKey);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await waitForRouterHydration();
      if (cancelled) return;

      if (!useAppStore.persist.hasHydrated()) {
        await useAppStore.persist.rehydrate();
      }
      if (cancelled) return;

      await removeSampleRecipes().catch(console.error);
      if (cancelled) return;

      await getApiKey("elevenlabs")
        .then((key) => setHasElevenLabsKey(!!key))
        .catch(console.error);
    })();

    return () => {
      cancelled = true;
    };
  }, [setHasElevenLabsKey]);

  useEffect(() => {
    document.documentElement.lang = initialLanguage === "zh" ? "zh-CN" : "en";
    if (i18n.language !== initialLanguage) void i18n.changeLanguage(initialLanguage);
  }, [initialLanguage]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    if (!useAppStore.persist.hasHydrated()) return;

    const hydratedLanguage = useAppStore.getState().language;
    if (document.cookie.includes(`${LANGUAGE_COOKIE_NAME}=${hydratedLanguage}`)) return;

    document.cookie = `${LANGUAGE_COOKIE_NAME}=${hydratedLanguage}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [language]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <GlobalVoiceController />
        <Outlet />
        <Toaster position="top-center" richColors closeButton />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
