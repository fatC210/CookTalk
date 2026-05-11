import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import { Mic, Volume2, ChefHat, Sparkles, ArrowRight, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { storeApiKey } from "@/lib/crypto";
import { ElevenLabsService } from "@/lib/elevenlabs";
import i18n from "@/lib/i18n";
import { getSupportedElevenLabsVoices } from "@/hooks/use-elevenlabs-voices";
import { useAppStore } from "@/stores/app-store";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: i18n.t("onboarding.metaTitle") },
      { name: "description", content: i18n.t("onboarding.metaDescription") },
    ],
  }),
  component: OnboardingPage,
});

// Preset voices for step 2
const DEFAULT_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "Calm & clear · American English" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", desc: "Warm & professional · American English" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", desc: "Friendly & energetic · American English" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", desc: "Soft & expressive · American English" },
];

function OnboardingPage() {
  const { t, i18n: activeI18n } = useTranslation();
  const navigate = useNavigate();

  const { setOnboardingCompleted, setHasElevenLabsKey, setConversationVoiceId, setCookingVoiceId } =
    useAppStore();

  useEffect(() => {
    document.title = t("onboarding.metaTitle");
  }, [t, activeI18n.language]);

  // Which steps are completed
  const [stepDone, setStepDoneState] = useState<boolean[]>([false, false, false, false]);
  const setStepDone = (idx: number, done: boolean) => {
    setStepDoneState((prev) => {
      const next = [...prev];
      next[idx] = done;
      return next;
    });
  };

  // Step 0 – Microphone
  const [micLoading, setMicLoading] = useState(false);
  const requestMic = async () => {
    setMicLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setStepDone(0, true);
    } catch {
      toast.error(t("onboarding.micError"));
    } finally {
      setMicLoading(false);
    }
  };

  // Step 1 – ElevenLabs key
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const saveApiKey = async () => {
    if (!apiKey.trim()) {
      toast.error(t("onboarding.keyError"));
      return;
    }
    setSavingKey(true);
    try {
      const trimmedApiKey = apiKey.trim();
      const defaultVoice = getSupportedElevenLabsVoices(
        await new ElevenLabsService(trimmedApiKey).listVoices({ showLegacy: true }),
      )[0];

      await storeApiKey("elevenlabs", trimmedApiKey);
      setHasElevenLabsKey(true);
      setConversationVoiceId(defaultVoice?.voice_id ?? null);
      setCookingVoiceId(defaultVoice?.voice_id ?? null);
      setStepDone(1, true);
      toast.success(t("onboarding.keySaved"));
    } catch {
      toast.error(t("onboarding.keyError"));
    } finally {
      setSavingKey(false);
    }
  };

  // Step 2 – Voice selection
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const confirmVoice = () => {
    if (!selectedVoice) return;
    setConversationVoiceId(selectedVoice);
    setCookingVoiceId(selectedVoice);
    setStepDone(2, true);
  };

  // Step 3 – Sample recipe (just mark done on click)
  const openSampleRecipe = () => {
    setStepDone(3, true);
    navigate({ to: "/recipes" });
  };

  // Finish onboarding
  const handleReady = () => {
    setOnboardingCompleted(true);
    navigate({ to: "/recipes" });
  };

  const allDone = stepDone.every(Boolean);

  const stepIcons = [Mic, Sparkles, Volume2, ChefHat];
  const stepTitleKeys = ["mic", "apiKey", "voice", "recipe"] as const;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden">
        <div
          className="absolute -top-40 -right-20 h-[500px] w-[500px] rounded-full bg-accent/30 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-clay animate-pulse" />
              {t("onboarding.badge")}
            </span>
            <h1 className="mt-6 font-display text-[clamp(2.5rem,11vw,4.75rem)] font-semibold tracking-tight md:text-6xl">
              {t("onboarding.title")}
            </h1>
            <p className="mt-4 mx-auto max-w-xl text-muted-foreground">
              {t("onboarding.subtitle")}
            </p>
          </div>

          <ol className="mt-10 space-y-3 sm:mt-14">
            {stepTitleKeys.map((key, i) => {
              const Icon = stepIcons[i];
              const done = stepDone[i];
              const isActive = !done && (i === 0 || stepDone[i - 1]);

              return (
                <li
                  key={key}
                  className={`relative flex flex-col gap-4 rounded-3xl border p-5 transition-colors sm:flex-row sm:items-start sm:gap-5 sm:p-6 ${
                    isActive
                      ? "border-border bg-card"
                      : done
                        ? "border-border/60 bg-card/60"
                        : "border-border/30 bg-card/20"
                  }`}
                >
                  <VoiceBadge n={i + 1} className="absolute left-5 top-5 sm:-left-3 sm:top-6" />

                  {/* Step icon */}
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:h-14 sm:w-14 ${
                      done
                        ? "bg-foreground text-background"
                        : isActive
                          ? "bg-secondary"
                          : "bg-secondary/40"
                    }`}
                  >
                    {done ? (
                      <Check className="h-6 w-6" strokeWidth={1.75} />
                    ) : (
                      <Icon className="h-6 w-6" strokeWidth={1.5} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <h3 className="font-display text-2xl">
                        {t(`onboarding.steps.${key}.title`)}
                      </h3>
                      {done && <span className="text-xs text-clay">{t("onboarding.done")}</span>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(`onboarding.steps.${key}.body`)}
                    </p>

                    {/* Step-specific content when active */}
                    {isActive && (
                      <div className="mt-4">
                        {/* Step 0: Mic */}
                        {i === 0 && (
                          <button
                            type="button"
                            onClick={requestMic}
                            disabled={micLoading}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay disabled:opacity-60 sm:w-auto"
                          >
                            {micLoading ? (
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                            ) : (
                              <Mic className="h-4 w-4" strokeWidth={1.75} />
                            )}
                            {t("onboarding.steps.mic.action")}
                          </button>
                        )}

                        {/* Step 1: API key */}
                        {i === 1 && (
                          <div className="flex max-w-md flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                            <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5">
                              <input
                                type={showKey ? "text" : "password"}
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
                                placeholder={t("onboarding.steps.apiKey.placeholder")}
                                className="flex-1 bg-transparent text-sm tracking-wider outline-none placeholder:text-muted-foreground"
                              />
                              <button
                                type="button"
                                onClick={() => setShowKey((s) => !s)}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={
                                  showKey
                                    ? t("onboarding.aria.hideKey")
                                    : t("onboarding.aria.showKey")
                                }
                              >
                                {showKey ? (
                                  <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                                ) : (
                                  <Eye className="h-4 w-4" strokeWidth={1.75} />
                                )}
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={saveApiKey}
                              disabled={savingKey}
                              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay disabled:opacity-60 sm:w-auto"
                            >
                              {savingKey ? (
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                              ) : null}
                              {savingKey
                                ? t("onboarding.steps.apiKey.saving")
                                : t("onboarding.steps.apiKey.action")}
                            </button>
                          </div>
                        )}

                        {/* Step 2: Voice selection */}
                        {i === 2 && (
                          <div className="space-y-3">
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                              {DEFAULT_VOICES.map((v) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => setSelectedVoice(v.id)}
                                  className={`rounded-xl border p-3 text-left text-xs transition-colors ${
                                    selectedVoice === v.id
                                      ? "border-foreground bg-foreground text-background"
                                      : "border-border hover:border-foreground/50"
                                  }`}
                                >
                                  <div className="font-medium text-sm">{v.name}</div>
                                  <div
                                    className={`mt-0.5 ${selectedVoice === v.id ? "text-background/70" : "text-muted-foreground"}`}
                                  >
                                    {v.desc}
                                  </div>
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={confirmVoice}
                              disabled={!selectedVoice}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay disabled:opacity-40 sm:w-auto"
                            >
                              {t("onboarding.steps.voice.action")}{" "}
                              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          </div>
                        )}

                        {/* Step 3: Sample recipe */}
                        {i === 3 && (
                          <button
                            type="button"
                            onClick={openSampleRecipe}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay sm:w-auto"
                          >
                            {t("onboarding.steps.recipe.action")}{" "}
                            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Desktop action button for re-grant on done steps */}
                  {done && i === 0 && (
                    <button
                      type="button"
                      onClick={requestMic}
                      className="hidden items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm hover:border-foreground md:inline-flex"
                    >
                      {t("onboarding.steps.mic.regrant")}{" "}
                      <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="mt-12 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={handleReady}
              className={`inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-full px-7 py-4 text-base transition-colors ${
                allDone
                  ? "bg-clay text-background hover:bg-clay/90"
                  : "bg-foreground text-background hover:bg-clay"
              }`}
            >
              {t("onboarding.ready")} <ArrowRight className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <VoiceHint>{t("onboarding.readyHint")}</VoiceHint>
          </div>
        </div>
      </section>
    </div>
  );
}
