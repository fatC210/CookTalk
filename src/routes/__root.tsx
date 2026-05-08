import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { GlobalVoiceController } from "@/components/global-voice-controller";
import { removeSampleRecipes } from "@/lib/db";
import { getApiKey } from "@/lib/crypto";
import { useAppStore } from "@/stores/app-store";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("root.notFound.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("root.notFound.body")}
        </p>
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
        <p className="mt-2 text-sm text-muted-foreground">
          {t("root.error.body")}
        </p>
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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CookTalk — Voice-first AI kitchen assistant" },
      { name: "description", content: "A 100% voice-controlled AI kitchen assistant. Hands-free cooking with voice commands." },
      { name: "author", content: "CookTalk" },
      { property: "og:title", content: "CookTalk — Voice-first AI kitchen" },
      { property: "og:description", content: "100% voice-controlled cooking companion." },
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

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
  const language = useAppStore((s) => s.language);
  const setHasElevenLabsKey = useAppStore((s) => s.setHasElevenLabsKey);

  useEffect(() => {
    void (async () => {
      if (!useAppStore.persist.hasHydrated()) await useAppStore.persist.rehydrate();
      await removeSampleRecipes().catch(console.error);
      await getApiKey("elevenlabs")
        .then((key) => setHasElevenLabsKey(!!key))
        .catch(console.error);
    })();
  }, [setHasElevenLabsKey]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    if (i18n.language !== language) void i18n.changeLanguage(language);
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
