import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import i18n from "./lib/i18n";

function getInitialLanguage(): "en" | "zh" {
  if (typeof document === "undefined") return "en";

  const cookieMatch = document.cookie.match(/(?:^|;\s*)cooktalk-lang=(en|zh)(?:;|$)/);
  if (cookieMatch?.[1] === "zh" || cookieMatch?.[1] === "en") {
    return cookieMatch[1];
  }

  return "en";
}

function hydrateApp() {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    );
  });
}

void i18n.changeLanguage(getInitialLanguage()).then(hydrateApp, hydrateApp);
