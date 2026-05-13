import type { TFunction } from "i18next";
import { toast } from "sonner";

type ApiKeyPromptKind = "elevenlabs" | "llm" | "imagegen";

type SettingsNavigate = (options: { to: "/settings" }) => void | Promise<void>;

const MESSAGE_KEYS: Record<ApiKeyPromptKind, string> = {
  elevenlabs: "settings.apiKeys.configureRequired.elevenlabs",
  llm: "settings.apiKeys.configureRequired.llm",
  imagegen: "settings.apiKeys.configureRequired.imagegen",
};

export function promptConfigureApiKey(
  kind: ApiKeyPromptKind,
  t: TFunction,
  navigate: SettingsNavigate,
) {
  toast.error(t(MESSAGE_KEYS[kind]), {
    action: {
      label: t("cook.openSettings"),
      onClick: () => navigateToSettings(navigate),
    },
  });
}

export function navigateToSettings(navigate: SettingsNavigate) {
  try {
    void Promise.resolve(navigate({ to: "/settings" })).catch(openSettingsWithLocationFallback);
  } catch {
    openSettingsWithLocationFallback();
  }
}

function openSettingsWithLocationFallback() {
  if (typeof window === "undefined") return;
  window.location.assign("/settings");
}
