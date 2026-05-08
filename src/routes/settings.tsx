import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  Key,
  Mic2,
  Image as ImageIcon,
  Globe,
  Moon,
  Lock,
  Download,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  X,
  Plus,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { storeApiKey, getApiKey, removeApiKey } from "@/lib/crypto";
import { useAppStore } from "@/stores/app-store";
import { db } from "@/lib/db";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  isValidOpenAIBaseUrl,
  normalizeOpenAIBaseUrl,
  validateOpenAIChatConfig,
  validateOpenAIModelConfig,
} from "@/lib/llm";
import { ElevenLabsService } from "@/lib/elevenlabs";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — CookTalk" },
      {
        name: "description",
        content: "Configure API keys, voice wake-words, language, theme, and data — all by voice.",
      },
    ],
  }),
  component: SettingsPage,
});

type VoiceOption = {
  label: string;
  value: string;
  description: string;
};

type ApiSettingsGroup = "elevenlabs" | "llm" | "image";

type ApiSettingsValues = {
  elevenLabsKey: string;
  llmKey: string;
  llmEndpoint: string;
  llmModel: string;
  imageEndpoint: string;
  imageKey: string;
  imageModel: string;
};

const PRESET_VOICE_OPTIONS: VoiceOption[] = [
  { label: "默认男声", value: "pNInz6obpgDQGcFmaJgB", description: "ElevenLabs Adam" },
  { label: "晓晓", value: "pFZP5JQG7iQjIQuC4Bku", description: "中文 · 温暖" },
  { label: "云希", value: "t0jbNlBVZ17f02VDIeMI", description: "中文 · 明亮" },
  { label: "Aria", value: "9BWtsMINqrJLrRacOk9x", description: "English · neutral" },
];
// ── Sub-components ────────────────────────────────────────────────────────────

function KeyField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "password",
  showLabel,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: "password" | "text";
  showLabel: string;
  hideLabel: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="inline-flex items-center gap-2 text-sm font-medium">{label}</label>
        </div>
        {type === "password" && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            aria-label={show ? hideLabel : showLabel}
          >
            {show ? (
              <EyeOff className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <Eye className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5">
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <input
          type={show ? "text" : type === "text" ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="flex-1 bg-transparent text-sm tracking-wider outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

function ApiSettingsCard({
  n,
  title,
  required = false,
  onBlur,
  children,
}: {
  n: number;
  title: string;
  required?: boolean;
  onBlur?: () => void;
  children: ReactNode;
}) {
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }

    onBlur?.();
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5" onBlur={handleBlur}>
      <div className="flex items-start gap-3">
        <VoiceBadge n={n} />
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            {title}
            {required && (
              <span aria-hidden="true" className="text-lg leading-none text-destructive">
                *
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}

function VoiceRoleSelect({
  n,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  n: number;
  label: string;
  hint: string;
  value: string | null;
  options: VoiceOption[];
  onChange: (value: string | null) => void;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <VoiceBadge n={n} />
        <div className="flex-1">
          <div className="text-sm font-medium">{label}</div>
          <div className="voice-hint mt-0.5">{hint}</div>
        </div>
      </div>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground"
      >
        <option value="">跟随默认音色</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} · {option.description}
          </option>
        ))}
      </select>
      <div className="mt-2 text-xs text-muted-foreground">
        当前：{selected ? `${selected.label} · ${selected.description}` : "默认音色"}
      </div>
    </div>
  );
}
function SwitchRow({
  n,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  n: number;
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-3">
        <VoiceBadge n={n} />
        <div>
          <div className="text-sm font-medium">{label}</div>
          {hint && <div className="voice-hint mt-0.5">{hint}</div>}
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SettingsPage() {
  const { t } = useTranslation();

  // ── App store ────────────────────────────────────────────────────────────
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    voiceBadgesVisible,
    toggleVoiceBadges,
    wakeWords,
    addWakeWord,
    removeWakeWord,
    sensitivity,
    setSensitivity,
    screenWakeLock,
    setScreenWakeLock,
    listenMode,
    setListenMode,
    soundEffects,
    setSoundEffects,
    setHasElevenLabsKey,
    setHasLlmKey,
    setHasImageGenKey,
    conversationVoiceId,
    cookingVoiceId,
    setConversationVoiceId,
    setCookingVoiceId,
  } = useAppStore();

  const clonedVoices = useLiveQuery(() => db.voices.orderBy("createdAt").toArray(), []) ?? [];
  const voiceOptions = [
    ...PRESET_VOICE_OPTIONS,
    ...clonedVoices
      .filter((voice) => voice.elevenLabsVoiceId)
      .map((voice) => ({
        label: voice.name,
        value: voice.elevenLabsVoiceId!,
        description: `${voice.language} · ${voice.description}`,
      })),
  ];

  // ── API key state ────────────────────────────────────────────────────────
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [llmEndpoint, setLlmEndpoint] = useState(DEFAULT_LLM_BASE_URL);
  const [llmModel, setLlmModel] = useState(DEFAULT_LLM_MODEL);
  const [imageEndpoint, setImageEndpoint] = useState("");
  const [imageKey, setImageKey] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const lastSavedApiValuesRef = useRef<ApiSettingsValues | null>(null);

  // Load existing keys on mount
  useEffect(() => {
    (async () => {
      const [el, lk, le, lm, ie, ik, im] = await Promise.all([
        getApiKey("elevenlabs"),
        getApiKey("llm"),
        getApiKey("llm-endpoint"),
        getApiKey("llm-model"),
        getApiKey("imagegen-endpoint"),
        getApiKey("imagegen-key"),
        getApiKey("imagegen-model"),
      ]);
      if (el) setElevenLabsKey(el);
      if (lk) setLlmKey(lk);
      if (le) setLlmEndpoint(le);
      if (lm) setLlmModel(lm);
      if (ie) setImageEndpoint(ie);
      if (ik) setImageKey(ik);
      if (im) setImageModel(im);
      lastSavedApiValuesRef.current = {
        elevenLabsKey: el ?? "",
        llmKey: lk ?? "",
        llmEndpoint: le ?? DEFAULT_LLM_BASE_URL,
        llmModel: lm ?? DEFAULT_LLM_MODEL,
        imageEndpoint: ie ?? "",
        imageKey: ik ?? "",
        imageModel: im ?? "",
      };
      setHasElevenLabsKey(!!el);
      setHasLlmKey(!!lk);
      setHasImageGenKey(!!ik);
    })();
  }, [setHasElevenLabsKey, setHasImageGenKey, setHasLlmKey]);

  const handleSaveApiGroup = useCallback(
    async (group: ApiSettingsGroup) => {
      const currentValues: ApiSettingsValues = {
        elevenLabsKey,
        llmKey,
        llmEndpoint,
        llmModel,
        imageEndpoint,
        imageKey,
        imageModel,
      };
      const savedValues = lastSavedApiValuesRef.current;
      const hasGroupChanged =
        !savedValues ||
        (group === "elevenlabs"
          ? currentValues.elevenLabsKey !== savedValues.elevenLabsKey
          : group === "llm"
            ? currentValues.llmKey !== savedValues.llmKey ||
              currentValues.llmEndpoint !== savedValues.llmEndpoint ||
              currentValues.llmModel !== savedValues.llmModel
            : currentValues.imageEndpoint !== savedValues.imageEndpoint ||
              currentValues.imageKey !== savedValues.imageKey ||
              currentValues.imageModel !== savedValues.imageModel);

      if (!hasGroupChanged) return;

      const trimmedElevenLabsKey = elevenLabsKey.trim();
      const trimmedLlmKey = llmKey.trim();
      const trimmedLlmEndpoint = llmEndpoint.trim();
      const trimmedLlmModel = llmModel.trim();
      const trimmedImageEndpoint = imageEndpoint.trim();
      const trimmedImageKey = imageKey.trim();
      const trimmedImageModel = imageModel.trim();

      if (group === "llm") {
        if (!trimmedLlmKey) {
          toast.error(t("settings.apiKeys.llmRequired"));
          return;
        }

        if (!trimmedLlmEndpoint) {
          toast.error(t("settings.apiKeys.llmEndpointRequired"));
          return;
        }

        if (!trimmedLlmModel) {
          toast.error(t("settings.apiKeys.llmModelRequired"));
          return;
        }

        if (!isValidOpenAIBaseUrl(trimmedLlmEndpoint)) {
          toast.error(t("settings.apiKeys.llmEndpointInvalid"));
          return;
        }
      }

      if (group === "image") {
        const hasAnyImageConfig = !!(trimmedImageEndpoint || trimmedImageKey || trimmedImageModel);

        if (hasAnyImageConfig) {
          if (!trimmedImageEndpoint) {
            toast.error(t("settings.apiKeys.imageEndpointRequired"));
            return;
          }

          if (!trimmedImageKey) {
            toast.error(t("settings.apiKeys.imageKeyRequired"));
            return;
          }

          if (!trimmedImageModel) {
            toast.error(t("settings.apiKeys.imageModelRequired"));
            return;
          }
        }

        if (trimmedImageEndpoint && !isValidOpenAIBaseUrl(trimmedImageEndpoint)) {
          toast.error(t("settings.apiKeys.imageEndpointInvalid"));
          return;
        }
      }

      setSavingKeys(true);
      try {
        const nextSavedValues = savedValues ?? {
          elevenLabsKey: "",
          llmKey: "",
          llmEndpoint: DEFAULT_LLM_BASE_URL,
          llmModel: DEFAULT_LLM_MODEL,
          imageEndpoint: "",
          imageKey: "",
          imageModel: "",
        };

        if (group === "elevenlabs") {
          if (trimmedElevenLabsKey) {
            const isValid = await new ElevenLabsService(trimmedElevenLabsKey).validateKey();
            if (!isValid) {
              toast.error(t("settings.apiKeys.elevenlabsValidationFailed"));
              return;
            }

            await storeApiKey("elevenlabs", trimmedElevenLabsKey);
          } else {
            await removeApiKey("elevenlabs");
          }
          nextSavedValues.elevenLabsKey = trimmedElevenLabsKey;
          setElevenLabsKey(trimmedElevenLabsKey);
          setHasElevenLabsKey(!!trimmedElevenLabsKey);
        }

        if (group === "llm") {
          const normalizedLlmEndpoint = normalizeOpenAIBaseUrl(trimmedLlmEndpoint);
          const isValid = await validateOpenAIChatConfig({
            apiKey: trimmedLlmKey,
            baseUrl: normalizedLlmEndpoint,
            model: trimmedLlmModel,
          });

          if (!isValid) {
            toast.error(t("settings.apiKeys.llmValidationFailed"));
            return;
          }

          await Promise.all([
            storeApiKey("llm", trimmedLlmKey),
            storeApiKey("llm-endpoint", normalizedLlmEndpoint),
            storeApiKey("llm-model", trimmedLlmModel),
          ]);
          nextSavedValues.llmKey = trimmedLlmKey;
          nextSavedValues.llmEndpoint = normalizedLlmEndpoint;
          nextSavedValues.llmModel = trimmedLlmModel;
          setLlmKey(trimmedLlmKey);
          setLlmEndpoint(normalizedLlmEndpoint);
          setLlmModel(trimmedLlmModel);
          setHasLlmKey(true);
        }

        if (group === "image") {
          const normalizedImageEndpoint = trimmedImageEndpoint
            ? normalizeOpenAIBaseUrl(trimmedImageEndpoint)
            : "";
          if (normalizedImageEndpoint && trimmedImageKey && trimmedImageModel) {
            const isValid = await validateOpenAIModelConfig({
              apiKey: trimmedImageKey,
              baseUrl: normalizedImageEndpoint,
              model: trimmedImageModel,
            });

            if (!isValid) {
              toast.error(t("settings.apiKeys.imageValidationFailed"));
              return;
            }
          }

          await Promise.all([
            normalizedImageEndpoint
              ? storeApiKey("imagegen-endpoint", normalizedImageEndpoint)
              : removeApiKey("imagegen-endpoint"),
            trimmedImageKey
              ? storeApiKey("imagegen-key", trimmedImageKey)
              : removeApiKey("imagegen-key"),
            trimmedImageModel
              ? storeApiKey("imagegen-model", trimmedImageModel)
              : removeApiKey("imagegen-model"),
          ]);
          nextSavedValues.imageEndpoint = normalizedImageEndpoint;
          nextSavedValues.imageKey = trimmedImageKey;
          nextSavedValues.imageModel = trimmedImageModel;
          setImageEndpoint(normalizedImageEndpoint);
          setImageKey(trimmedImageKey);
          setImageModel(trimmedImageModel);
          setHasImageGenKey(!!trimmedImageKey);
        }

        lastSavedApiValuesRef.current = { ...nextSavedValues };
        toast.success(t("settings.apiKeys.saved"));
      } catch {
        toast.error(t("settings.apiKeys.saveError"));
      } finally {
        setSavingKeys(false);
      }
    },
    [
      elevenLabsKey,
      imageEndpoint,
      imageKey,
      imageModel,
      llmEndpoint,
      llmKey,
      llmModel,
      setHasElevenLabsKey,
      setHasImageGenKey,
      setHasLlmKey,
      t,
    ],
  );

  // ── Wake word input ──────────────────────────────────────────────────────
  const [newWakeWord, setNewWakeWord] = useState("");

  const handleAddWakeWord = () => {
    const word = newWakeWord.trim();
    if (!word) return;
    addWakeWord(word);
    setNewWakeWord("");
  };

  // ── Language ─────────────────────────────────────────────────────────────
  const handleLanguage = (lang: "en" | "zh") => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  // ── Export / Import / Clear ──────────────────────────────────────────────
  const importRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    const recipes = await db.recipes.toArray();
    const json = JSON.stringify(recipes, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cooktalk-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("settings.data.exportSuccess"));
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const recipes = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(recipes)) throw new Error("not array");
        await db.recipes.bulkAdd(recipes);
        toast.success(t("settings.data.importSuccess", { count: recipes.length }));
      } catch {
        toast.error(t("settings.data.importError"));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleClear = async () => {
    await db.recipes.clear();
    await db.voices.clear();
    toast.success(t("settings.data.clearSuccess"));
  };

  // ── Sidebar sections ─────────────────────────────────────────────────────
  const sections = [
    { icon: Key, label: t("settings.sections.apiKeys"), href: "#s0" },
    { icon: Mic2, label: t("settings.sections.voice"), href: "#s1" },
    { icon: ImageIcon, label: t("settings.sections.coverImages"), href: "#s2" },
    { icon: Globe, label: t("settings.sections.language"), href: "#s3" },
    { icon: Moon, label: t("settings.sections.appearance"), href: "#s3" },
    { icon: Download, label: t("settings.sections.data"), href: "#s5" },
  ];

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container">
          <span className="page-kicker">{t("settings.subtitle")}</span>
          <h1 className="page-title">{t("settings.title")}</h1>
          <VoiceHint className="mt-2">{t("settings.hint")}</VoiceHint>
        </div>
      </section>

      <section className="flex-1">
        <div className="page-content-container">
          <div className="grid gap-10 lg:grid-cols-12">
            {/* Sidebar */}
            <aside className="lg:col-span-3">
              <nav className="sticky top-24 space-y-1">
                {sections.map((s, i) => (
                  <a
                    key={s.label}
                    href={s.href}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                      i === 0
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    }`}
                  >
                    <s.icon className="h-4 w-4" strokeWidth={1.75} /> {s.label}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="lg:col-span-9 space-y-12">
              {/* ── API keys ─────────────────────────────────────────────── */}
              <section id="s0">
                <h2 className="font-display text-2xl">{t("settings.apiKeys.title")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("settings.apiKeys.desc")}</p>
                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <ApiSettingsCard
                    n={1}
                    title={t("settings.apiKeys.elevenlabsGroup")}
                    required
                    onBlur={() => void handleSaveApiGroup("elevenlabs")}
                  >
                    <KeyField
                      label={t("settings.apiKeys.elevenlabs")}
                      value={elevenLabsKey}
                      onChange={setElevenLabsKey}
                      placeholder="sk_..."
                      showLabel={t("settings.aria.showSecret")}
                      hideLabel={t("settings.aria.hideSecret")}
                    />
                  </ApiSettingsCard>

                  <ApiSettingsCard
                    n={2}
                    title={t("settings.apiKeys.llmGroup")}
                    required
                    onBlur={() => void handleSaveApiGroup("llm")}
                  >
                    <KeyField
                      label={t("settings.apiKeys.llmEndpoint")}
                      value={llmEndpoint}
                      onChange={setLlmEndpoint}
                      placeholder="https://api.openai.com/v1"
                      type="text"
                      showLabel={t("settings.aria.showSecret")}
                      hideLabel={t("settings.aria.hideSecret")}
                    />
                    <KeyField
                      label={t("settings.apiKeys.llm")}
                      value={llmKey}
                      onChange={setLlmKey}
                      placeholder="sk-..."
                      showLabel={t("settings.aria.showSecret")}
                      hideLabel={t("settings.aria.hideSecret")}
                    />
                    <KeyField
                      label={t("settings.apiKeys.llmModel")}
                      value={llmModel}
                      onChange={setLlmModel}
                      placeholder="gpt-4o-mini"
                      type="text"
                      showLabel={t("settings.aria.showSecret")}
                      hideLabel={t("settings.aria.hideSecret")}
                    />
                  </ApiSettingsCard>

                  <ApiSettingsCard
                    n={3}
                    title={t("settings.apiKeys.imageGroup")}
                    onBlur={() => void handleSaveApiGroup("image")}
                  >
                    <KeyField
                      label={t("settings.apiKeys.imageEndpoint")}
                      value={imageEndpoint}
                      onChange={setImageEndpoint}
                      placeholder="https://api.openai.com/v1"
                      type="text"
                      showLabel={t("settings.aria.showSecret")}
                      hideLabel={t("settings.aria.hideSecret")}
                    />
                    <KeyField
                      label={t("settings.apiKeys.imageKey")}
                      value={imageKey}
                      onChange={setImageKey}
                      placeholder="sk-..."
                      showLabel={t("settings.aria.showSecret")}
                      hideLabel={t("settings.aria.hideSecret")}
                    />
                    <KeyField
                      label={t("settings.apiKeys.imageModel")}
                      value={imageModel}
                      onChange={setImageModel}
                      placeholder="dall-e-3"
                      type="text"
                      showLabel={t("settings.aria.showSecret")}
                      hideLabel={t("settings.aria.hideSecret")}
                    />
                  </ApiSettingsCard>
                </div>
                {savingKeys && (
                  <p className="mt-3 text-right text-sm text-muted-foreground">
                    {t("settings.apiKeys.validating")}
                  </p>
                )}
              </section>

              {/* ── Voice & wake-word ──────────────────────────────────── */}
              <section id="s1">
                <h2 className="font-display text-2xl">{t("settings.voice.title")}</h2>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {/* Wake words */}
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center gap-3">
                      <VoiceBadge n={6} />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{t("settings.voice.wakeWords")}</div>
                        <div className="voice-hint mt-0.5">{t("settings.voice.wakeWordsHint")}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {wakeWords.map((w) => (
                        <span
                          key={w}
                          className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-xs text-background"
                        >
                          {w}
                          <button
                            type="button"
                            onClick={() => removeWakeWord(w)}
                            className="ml-0.5 hover:opacity-70"
                            aria-label={t("settings.aria.removeWakeWord", { word: w })}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        value={newWakeWord}
                        onChange={(e) => setNewWakeWord(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddWakeWord()}
                        placeholder={t("settings.voice.addPlaceholder")}
                        className="flex-1 rounded-xl border border-dashed border-border bg-background px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
                      />
                      <button
                        type="button"
                        onClick={handleAddWakeWord}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Sensitivity */}
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center gap-3">
                      <VoiceBadge n={7} />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{t("settings.voice.sensitivity")}</div>
                        <div className="voice-hint mt-0.5">
                          {t("settings.voice.sensitivityHint")}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {t(`settings.voice.${sensitivity}`)}
                      </span>
                    </div>
                    <div className="mt-4 flex gap-1">
                      {(["low", "medium", "high"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSensitivity(s)}
                          className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                            sensitivity === s
                              ? "border-foreground bg-foreground text-background"
                              : "border-border hover:border-foreground/50"
                          }`}
                        >
                          {t(`settings.voice.${s}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <VoiceRoleSelect
                    n={8}
                    label="对话音色"
                    hint="首页对话里 CookTalk 回复时使用的声音。"
                    value={conversationVoiceId}
                    options={voiceOptions}
                    onChange={setConversationVoiceId}
                  />
                  <VoiceRoleSelect
                    n={9}
                    label="烹饪音色"
                    hint="烹饪模式朗读步骤和回答问题时使用的声音。"
                    value={cookingVoiceId}
                    options={voiceOptions}
                    onChange={setCookingVoiceId}
                  />

                  <SwitchRow
                    n={10}
                    label={t("settings.voice.badges")}
                    hint={t("settings.voice.badgesHint")}
                    checked={voiceBadgesVisible}
                    onCheckedChange={toggleVoiceBadges}
                  />
                  <SwitchRow
                    n={11}
                    label={t("settings.voice.alwaysListen")}
                    hint={t("settings.voice.alwaysListenHint")}
                    checked={listenMode === "always"}
                    onCheckedChange={(v) => setListenMode(v ? "always" : "wake-word")}
                  />
                  <SwitchRow
                    n={12}
                    label={t("settings.voice.wakeLock")}
                    hint={t("settings.voice.wakeLockHint")}
                    checked={screenWakeLock}
                    onCheckedChange={setScreenWakeLock}
                  />
                  <SwitchRow
                    n={13}
                    label={t("settings.voice.soundEffects")}
                    hint={t("settings.voice.soundEffectsHint")}
                    checked={soundEffects}
                    onCheckedChange={setSoundEffects}
                  />
                </div>
              </section>

              {/* ── Language & Appearance ─────────────────────────────── */}
              <section id="s3" className="grid gap-3 md:grid-cols-2">
                {/* Language */}
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <VoiceBadge n={12} />
                    <span className="text-sm font-medium">{t("settings.language.title")}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {(["en", "zh"] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => handleLanguage(lang)}
                        className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          language === lang
                            ? "border-foreground bg-foreground text-background"
                            : "border-border hover:border-foreground/50"
                        }`}
                      >
                        {lang === "en" ? "English" : "中文"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Appearance */}
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <VoiceBadge n={13} />
                    <span className="text-sm font-medium">{t("settings.appearance.title")}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {(["light", "dark", "auto"] as const).map((th) => (
                      <button
                        key={th}
                        type="button"
                        onClick={() => setTheme(th)}
                        className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          theme === th
                            ? "border-foreground bg-foreground text-background"
                            : "border-border hover:border-foreground/50"
                        }`}
                      >
                        {t(`settings.appearance.${th}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* ── Data management ───────────────────────────────────── */}
              <section id="s5">
                <h2 className="font-display text-2xl">{t("settings.data.title")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("settings.data.desc")}</p>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {/* Export */}
                  <button
                    type="button"
                    onClick={handleExport}
                    className="group flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-5 text-left hover:border-foreground"
                  >
                    <Download className="h-5 w-5" strokeWidth={1.5} />
                    <div className="font-display text-base">{t("settings.data.export")}</div>
                    <VoiceHint>{t("settings.data.exportHint")}</VoiceHint>
                  </button>

                  {/* Import */}
                  <button
                    type="button"
                    onClick={() => importRef.current?.click()}
                    className="group flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-5 text-left hover:border-foreground"
                  >
                    <Upload className="h-5 w-5" strokeWidth={1.5} />
                    <div className="font-display text-base">{t("settings.data.import")}</div>
                    <VoiceHint>{t("settings.data.importHint")}</VoiceHint>
                  </button>
                  <input
                    ref={importRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleImport}
                  />

                  {/* Clear */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="group flex flex-col items-start gap-2 rounded-2xl border border-destructive/30 bg-card p-5 text-left text-destructive hover:border-destructive"
                      >
                        <Trash2 className="h-5 w-5" strokeWidth={1.5} />
                        <div className="font-display text-base">{t("settings.data.clear")}</div>
                        <VoiceHint>{t("settings.data.clearHint")}</VoiceHint>
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("settings.data.clearTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("settings.data.clearDesc")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("settings.data.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleClear}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t("settings.data.confirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
