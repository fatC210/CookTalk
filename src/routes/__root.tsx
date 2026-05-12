import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { RouteReloadErrorScreen, RouteStatusScreen } from "@/components/route-status-screen";
import { ThemeProvider } from "@/components/theme-provider";
import { GlobalVoiceController } from "@/components/global-voice-controller";
import { TooltipProvider } from "@/components/ui/tooltip";
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
    <RouteStatusScreen
      title={t("root.notFound.title")}
      body={t("root.notFound.body")}
      primaryLabel={t("common.retry")}
      secondaryLabel={t("root.goHome")}
      primaryAction={() => window.location.reload()}
    />
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const { t } = useTranslation();

  return (
    <RouteReloadErrorScreen
      title={t("root.error.title")}
      body={t("root.error.body")}
      primaryLabel={t("common.retry")}
      secondaryLabel={t("root.goHome")}
      reset={reset}
    />
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
  const setHasLlmKey = useAppStore((s) => s.setHasLlmKey);
  const setHasImageGenKey = useAppStore((s) => s.setHasImageGenKey);

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

      await Promise.all([getApiKey("elevenlabs"), getApiKey("llm"), getApiKey("imagegen-key")])
        .then(([elevenLabsKey, llmKey, imageGenKey]) => {
          setHasElevenLabsKey(!!elevenLabsKey);
          setHasLlmKey(!!llmKey);
          setHasImageGenKey(!!imageGenKey);
        })
        .catch(console.error);
    })();

    return () => {
      cancelled = true;
    };
  }, [setHasElevenLabsKey, setHasImageGenKey, setHasLlmKey]);

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
        <TooltipProvider delayDuration={120}>
          <GlobalVoiceController />
          <Outlet />
          <Toaster position="top-center" richColors duration={2000} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
