import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import i18n from "./lib/i18n";

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

// SSR renders the default language because persisted preferences are browser-only.
// Keep the first client render aligned, then RootComponent applies the saved language after mount.
void i18n.changeLanguage("en").then(hydrateApp, hydrateApp);
