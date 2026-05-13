import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  Key,
  Mic2,
  Globe,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { storeApiKey, getApiKey, removeApiKey } from "@/lib/crypto";
import { getActiveWakeWords, isBuiltInWakeWord, useAppStore } from "@/stores/app-store";
import { db } from "@/lib/db";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  isValidOpenAIBaseUrl,
  normalizeOpenAIBaseUrl,
  validateOpenAIChatConfig,
  validateOpenAIModelConfig,
} from "@/lib/llm";
import { ElevenLabsService } from "@/lib/elevenlabs";
import {
  getFirstElevenLabsVoiceId,
  toCombinedVoiceOptions,
  useDefaultElevenLabsVoiceSelection,
  useElevenLabsVoices,
} from "@/hooks/use-elevenlabs-voices";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: `${i18n.t("settings.title")} - CookTalk` },
      {
        name: "description",
        content: i18n.t("settings.metaDescription"),
      },
    ],
  }),
  component: SettingsPage,
});

type VoiceOption = {
  label: string;
  value: string;
  description: string;
  displayLabel?: string;
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

type SettingsTab = "apiKeys" | "voice" | "preferences" | "data";

const EMPTY_SELECT_VALUE = "__empty__";
const EMPTY_API_SETTINGS_VALUES: ApiSettingsValues = {
  elevenLabsKey: "",
  llmKey: "",
  llmEndpoint: "",
  llmModel: "",
  imageEndpoint: "",
  imageKey: "",
  imageModel: "",
};

function getTrimmedApiSettingsValues(values: ApiSettingsValues): ApiSettingsValues {
  return {
    elevenLabsKey: values.elevenLabsKey.trim(),
    llmKey: values.llmKey.trim(),
    llmEndpoint: values.llmEndpoint.trim(),
    llmModel: values.llmModel.trim(),
    imageEndpoint: values.imageEndpoint.trim(),
    imageKey: values.imageKey.trim(),
    imageModel: values.imageModel.trim(),
  };
}

function areApiGroupValuesEqual(
  group: ApiSettingsGroup,
  left: ApiSettingsValues,
  right: ApiSettingsValues,
): boolean {
  if (group === "elevenlabs") {
    return left.elevenLabsKey === right.elevenLabsKey;
  }

  if (group === "llm") {
    return (
      left.llmKey === right.llmKey &&
      left.llmEndpoint === right.llmEndpoint &&
      left.llmModel === right.llmModel
    );
  }

  return (
    left.imageEndpoint === right.imageEndpoint &&
    left.imageKey === right.imageKey &&
    left.imageModel === right.imageModel
  );
}

function isApiGroupReadyForValidation(group: ApiSettingsGroup, values: ApiSettingsValues): boolean {
  if (group === "elevenlabs") {
    return !!values.elevenLabsKey;
  }

  if (group === "llm") {
    return !!(values.llmKey && values.llmEndpoint && values.llmModel);
  }

  return !!(values.imageEndpoint && values.imageKey && values.imageModel);
}

// 鈹€鈹€ Sub-components 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
  placeholder?: string;
  type?: "password" | "text";
  showLabel: string;
  hideLabel: string;
}) {
  const [show, setShow] = useState(false);
  const canToggleSecret = type === "password" && value.length > 0;

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }

    onBlur?.(event);
  };

  useEffect(() => {
    if (!canToggleSecret) setShow(false);
  }, [canToggleSecret]);

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="inline-flex items-center gap-2 text-sm font-medium">{label}</label>
        </div>
      </div>
      <div
        className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5"
        onBlur={handleBlur}
      >
        {type === "password" && (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        )}
        <input
          type={canToggleSecret && show ? "text" : type === "text" ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="secret-input min-w-0 flex-1 bg-transparent text-sm tracking-wider outline-none placeholder:text-muted-foreground"
        />
        {canToggleSecret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="-mr-1 inline-flex h-8 w-8 shrink-0 appearance-none items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-muted-foreground shadow-none ring-0 hover:border-border hover:bg-transparent hover:text-foreground focus-visible:border-border focus-visible:ring-0 active:bg-transparent"
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
    </div>
  );
}

function ApiSettingsCard({
  title,
  required = false,
  onBlur,
  children,
}: {
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
    <div
      className="rounded-2xl border border-border bg-card p-5"
      data-api-settings-card
      onBlur={handleBlur}
    >
      <div className="flex items-start gap-3">
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
  disabled = false,
  emptyLabel,
  defaultLabel,
}: {
  n: number;
  label: string;
  hint: string;
  value: string | null;
  options: VoiceOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
  emptyLabel: string;
  defaultLabel: string;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const getOptionDisplayLabel = (option: VoiceOption) =>
    option.displayLabel ?? `${option.label} - ${option.description}`;
  const helperText = selected
    ? getOptionDisplayLabel(selected)
    : disabled
      ? emptyLabel
      : defaultLabel;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <VoiceBadge n={n} />
        <div className="flex-1">
          <div className="text-sm font-medium">{label}</div>
          <div className="voice-hint mt-0.5">{hint}</div>
        </div>
      </div>
      <Select
        value={selected?.value ?? EMPTY_SELECT_VALUE}
        onValueChange={(nextValue) => onChange(nextValue === EMPTY_SELECT_VALUE ? null : nextValue)}
        disabled={disabled}
      >
        <SelectTrigger className="mt-3">
          <SelectValue placeholder={disabled ? emptyLabel : defaultLabel} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {getOptionDisplayLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="mt-2 text-xs text-muted-foreground">{helperText}</div>
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

// 鈹€鈹€ Main page 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("apiKeys");

  // 鈹€鈹€ App store 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
    setHasElevenLabsKey,
    setHasLlmKey,
    setHasImageGenKey,
    conversationVoiceId,
    cookingVoiceId,
    setConversationVoiceId,
    setCookingVoiceId,
  } = useAppStore();

  useEffect(() => {
    document.title = `${t("settings.title")} - CookTalk`;
  }, [t, language]);

  const [elevenLabsVoiceRefreshKey, setElevenLabsVoiceRefreshKey] = useState(0);
  const {
    options: elevenLabsVoiceOptions,
    isLoading: isLoadingElevenLabsVoices,
    error: elevenLabsVoicesError,
    hasElevenLabsKey,
  } = useElevenLabsVoices(elevenLabsVoiceRefreshKey);
  const clonedVoices = useLiveQuery(() => db.voices.orderBy("createdAt").toArray(), []) ?? [];
  const formatClonedVoiceDescription = (voice: (typeof clonedVoices)[number]) => {
    const languageLabel = voice.language
      ? t(`voices.languages.${voice.language}`, { defaultValue: voice.language })
      : t("common.unknown");
    const voiceDescription =
      voice.description === "Cloned voice" ? t("voices.clonedVoice") : voice.description;

    return `${languageLabel} · ${voiceDescription || t("voices.clonedVoice")}`;
  };
  const voiceOptions = toCombinedVoiceOptions(
    clonedVoices,
    elevenLabsVoiceOptions,
    formatClonedVoiceDescription,
  );
  const firstElevenLabsVoiceId = elevenLabsVoiceOptions[0]?.value ?? null;
  const voiceSelectDisabled = !hasElevenLabsKey || voiceOptions.length === 0;
  const stableVoiceSetters = useMemo(
    () => [setConversationVoiceId, setCookingVoiceId],
    [setConversationVoiceId, setCookingVoiceId],
  );
  const stableVoiceValues = useMemo(
    () => [conversationVoiceId, cookingVoiceId],
    [conversationVoiceId, cookingVoiceId],
  );
  const defaultVoiceId = useDefaultElevenLabsVoiceSelection(
    voiceOptions,
    firstElevenLabsVoiceId,
    stableVoiceSetters,
    stableVoiceValues,
  );
  const defaultVoiceLabel =
    voiceOptions.find((option) => option.value === defaultVoiceId)?.displayLabel ??
    t("settings.voice.defaultElevenLabsVoice");

  // 鈹€鈹€ API key state 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [imageEndpoint, setImageEndpoint] = useState("");
  const [imageKey, setImageKey] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const lastSavedApiValuesRef = useRef<ApiSettingsValues | null>(null);
  const lastValidatedApiValuesRef = useRef<ApiSettingsValues | null>(null);
  const apiGroupOperationQueueRef = useRef<Record<ApiSettingsGroup, Promise<void>>>({
    elevenlabs: Promise.resolve(),
    llm: Promise.resolve(),
    image: Promise.resolve(),
  });

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
      const initialApiValues = {
        elevenLabsKey: el ?? "",
        llmKey: lk ?? "",
        llmEndpoint: le ?? "",
        llmModel: lm ?? "",
        imageEndpoint: ie ?? "",
        imageKey: ik ?? "",
        imageModel: im ?? "",
      };
      lastSavedApiValuesRef.current = initialApiValues;
      lastValidatedApiValuesRef.current = null;
      setHasElevenLabsKey(!!el);
      setHasLlmKey(!!lk);
      setHasImageGenKey(!!ik);
    })();
  }, [setHasElevenLabsKey, setHasImageGenKey, setHasLlmKey]);

  const enqueueApiGroupOperation = useCallback(
    (group: ApiSettingsGroup, operation: () => Promise<void>) => {
      const queuedOperation = apiGroupOperationQueueRef.current[group]
        .catch(() => undefined)
        .then(operation);
      apiGroupOperationQueueRef.current[group] = queuedOperation;
      return queuedOperation;
    },
    [],
  );

  const persistApiGroupValues = useCallback(
    async (group: ApiSettingsGroup, values: ApiSettingsValues) => {
      const nextSavedValues = {
        ...(lastSavedApiValuesRef.current ?? EMPTY_API_SETTINGS_VALUES),
      };

      if (group === "elevenlabs") {
        if (values.elevenLabsKey) {
          await storeApiKey("elevenlabs", values.elevenLabsKey);
        } else {
          await removeApiKey("elevenlabs");
        }

        nextSavedValues.elevenLabsKey = values.elevenLabsKey;
        setElevenLabsKey(values.elevenLabsKey);
      }

      if (group === "llm") {
        await Promise.all([
          values.llmKey ? storeApiKey("llm", values.llmKey) : removeApiKey("llm"),
          values.llmEndpoint
            ? storeApiKey("llm-endpoint", values.llmEndpoint)
            : removeApiKey("llm-endpoint"),
          values.llmModel ? storeApiKey("llm-model", values.llmModel) : removeApiKey("llm-model"),
        ]);

        nextSavedValues.llmKey = values.llmKey;
        nextSavedValues.llmEndpoint = values.llmEndpoint;
        nextSavedValues.llmModel = values.llmModel;
        setLlmKey(values.llmKey);
        setLlmEndpoint(values.llmEndpoint);
        setLlmModel(values.llmModel);
      }

      if (group === "image") {
        await Promise.all([
          values.imageEndpoint
            ? storeApiKey("imagegen-endpoint", values.imageEndpoint)
            : removeApiKey("imagegen-endpoint"),
          values.imageKey
            ? storeApiKey("imagegen-key", values.imageKey)
            : removeApiKey("imagegen-key"),
          values.imageModel
            ? storeApiKey("imagegen-model", values.imageModel)
            : removeApiKey("imagegen-model"),
        ]);

        nextSavedValues.imageEndpoint = values.imageEndpoint;
        nextSavedValues.imageKey = values.imageKey;
        nextSavedValues.imageModel = values.imageModel;
        setImageEndpoint(values.imageEndpoint);
        setImageKey(values.imageKey);
        setImageModel(values.imageModel);
      }

      lastSavedApiValuesRef.current = nextSavedValues;
      return nextSavedValues;
    },
    [],
  );

  const markApiGroupNeedsValidation = useCallback(
    (group: ApiSettingsGroup, values: ApiSettingsValues) => {
      const lastValidatedValues = lastValidatedApiValuesRef.current;
      if (lastValidatedValues && areApiGroupValuesEqual(group, values, lastValidatedValues)) {
        return;
      }

      if (group === "elevenlabs") {
        setHasElevenLabsKey(false);
        return;
      }

      if (group === "llm") {
        setHasLlmKey(false);
        return;
      }

      setHasImageGenKey(false);
    },
    [setHasElevenLabsKey, setHasImageGenKey, setHasLlmKey],
  );

  const handleSaveApiGroup = useCallback(
    (group: ApiSettingsGroup) =>
      enqueueApiGroupOperation(group, async () => {
        const currentValues = getTrimmedApiSettingsValues({
          elevenLabsKey,
          llmKey,
          llmEndpoint,
          llmModel,
          imageEndpoint,
          imageKey,
          imageModel,
        });
        const savedValues = lastSavedApiValuesRef.current;
        const hasGroupChanged =
          !savedValues || !areApiGroupValuesEqual(group, currentValues, savedValues);

        if (!hasGroupChanged) return;

        try {
          await persistApiGroupValues(group, currentValues);
          markApiGroupNeedsValidation(group, currentValues);
        } catch {
          toast.error(t("settings.apiKeys.saveError"));
        }
      }),
    [
      elevenLabsKey,
      enqueueApiGroupOperation,
      imageEndpoint,
      imageKey,
      imageModel,
      llmEndpoint,
      llmKey,
      llmModel,
      markApiGroupNeedsValidation,
      persistApiGroupValues,
      t,
    ],
  );

  const handleValidateApiGroup = useCallback(
    (group: ApiSettingsGroup) =>
      enqueueApiGroupOperation(group, async () => {
        const currentValues = getTrimmedApiSettingsValues({
          elevenLabsKey,
          llmKey,
          llmEndpoint,
          llmModel,
          imageEndpoint,
          imageKey,
          imageModel,
        });
        const savedValues = lastSavedApiValuesRef.current;
        const hasGroupChanged =
          !savedValues || !areApiGroupValuesEqual(group, currentValues, savedValues);

        try {
          if (hasGroupChanged) {
            await persistApiGroupValues(group, currentValues);
            markApiGroupNeedsValidation(group, currentValues);
          }
        } catch {
          toast.error(t("settings.apiKeys.saveError"));
          return;
        }

        if (!isApiGroupReadyForValidation(group, currentValues)) {
          return;
        }

        const lastValidatedValues = lastValidatedApiValuesRef.current;
        if (
          lastValidatedValues &&
          areApiGroupValuesEqual(group, currentValues, lastValidatedValues)
        ) {
          return;
        }

        if (group === "llm" && !isValidOpenAIBaseUrl(currentValues.llmEndpoint)) {
          toast.error(t("settings.apiKeys.llmEndpointInvalid"));
          return;
        }

        if (group === "image" && !isValidOpenAIBaseUrl(currentValues.imageEndpoint)) {
          toast.error(t("settings.apiKeys.imageEndpointInvalid"));
          return;
        }

        setSavingKeys(true);
        try {
          const nextValidatedValues = {
            ...(lastValidatedApiValuesRef.current ?? EMPTY_API_SETTINGS_VALUES),
          };

          if (group === "elevenlabs") {
            const elevenLabs = new ElevenLabsService(currentValues.elevenLabsKey);
            const isValid = await elevenLabs.validateKey();
            if (!isValid) {
              toast.error(t("settings.apiKeys.elevenlabsValidationFailed"));
              return;
            }

            const defaultVoiceId = await getFirstElevenLabsVoiceId(elevenLabs);

            await persistApiGroupValues(group, currentValues);
            nextValidatedValues.elevenLabsKey = currentValues.elevenLabsKey;
            setHasElevenLabsKey(true);
            if (defaultVoiceId) {
              setConversationVoiceId(defaultVoiceId);
              setCookingVoiceId(defaultVoiceId);
            }
            setElevenLabsVoiceRefreshKey((key) => key + 1);
          }

          if (group === "llm") {
            const normalizedLlmEndpoint = normalizeOpenAIBaseUrl(currentValues.llmEndpoint);
            const normalizedValues = {
              ...currentValues,
              llmEndpoint: normalizedLlmEndpoint,
            };
            const isValid = await validateOpenAIChatConfig({
              apiKey: normalizedValues.llmKey,
              baseUrl: normalizedValues.llmEndpoint,
              model: normalizedValues.llmModel,
            });

            if (!isValid) {
              toast.error(t("settings.apiKeys.llmValidationFailed"));
              return;
            }

            await persistApiGroupValues(group, normalizedValues);
            nextValidatedValues.llmKey = normalizedValues.llmKey;
            nextValidatedValues.llmEndpoint = normalizedValues.llmEndpoint;
            nextValidatedValues.llmModel = normalizedValues.llmModel;
            setHasLlmKey(true);
          }

          if (group === "image") {
            const normalizedImageEndpoint = normalizeOpenAIBaseUrl(currentValues.imageEndpoint);
            const normalizedValues = {
              ...currentValues,
              imageEndpoint: normalizedImageEndpoint,
            };
            const isValid = await validateOpenAIModelConfig({
              apiKey: normalizedValues.imageKey,
              baseUrl: normalizedValues.imageEndpoint,
              model: normalizedValues.imageModel,
            });

            if (!isValid) {
              toast.error(t("settings.apiKeys.imageValidationFailed"));
              return;
            }

            await persistApiGroupValues(group, normalizedValues);
            nextValidatedValues.imageEndpoint = normalizedValues.imageEndpoint;
            nextValidatedValues.imageKey = normalizedValues.imageKey;
            nextValidatedValues.imageModel = normalizedValues.imageModel;
            setHasImageGenKey(true);
          }

          lastValidatedApiValuesRef.current = nextValidatedValues;
          toast.success(t("settings.apiKeys.saved"));
        } catch {
          toast.error(t("settings.apiKeys.saveError"));
        } finally {
          setSavingKeys(false);
        }
      }),
    [
      elevenLabsKey,
      enqueueApiGroupOperation,
      imageEndpoint,
      imageKey,
      imageModel,
      llmEndpoint,
      llmKey,
      llmModel,
      markApiGroupNeedsValidation,
      persistApiGroupValues,
      setConversationVoiceId,
      setCookingVoiceId,
      setHasElevenLabsKey,
      setHasImageGenKey,
      setHasLlmKey,
      t,
    ],
  );

  const handleApiFieldBlur = useCallback(
    (group: ApiSettingsGroup, event: FocusEvent<HTMLDivElement>) => {
      const nextFocusedElement = event.relatedTarget;
      const card = event.currentTarget.closest("[data-api-settings-card]");
      if (card && nextFocusedElement instanceof Node && !card.contains(nextFocusedElement)) {
        return;
      }

      void handleSaveApiGroup(group);
    },
    [handleSaveApiGroup],
  );

  // 鈹€鈹€ Wake word input 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const [newWakeWord, setNewWakeWord] = useState("");
  const visibleWakeWords = getActiveWakeWords(wakeWords);

  const handleAddWakeWord = () => {
    const word = newWakeWord.trim();
    if (!word) return;
    addWakeWord(word);
    setNewWakeWord("");
  };

  // 鈹€鈹€ Language 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const handleLanguage = (lang: "en" | "zh") => {
    setLanguage(lang);
  };

  // 鈹€鈹€ Export / Import / Clear 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

  useEffect(() => {
    const handleVoicePageAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (!action?.startsWith("settings-")) return;

      setActiveTab("data");
      if (action === "settings-export") {
        void handleExport();
        return;
      }

      if (action === "settings-import") {
        window.setTimeout(() => importRef.current?.click(), 120);
      }
    };

    window.addEventListener("cooktalk:voice-page-action", handleVoicePageAction);
    return () => window.removeEventListener("cooktalk:voice-page-action", handleVoicePageAction);
  }, [handleExport]);

  // 鈹€鈹€ Sidebar sections 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const sections: Array<{
    icon: typeof Key;
    label: string;
    value: SettingsTab;
  }> = [
    { icon: Key, label: t("settings.sections.apiKeys"), value: "apiKeys" },
    { icon: Mic2, label: t("settings.sections.voice"), value: "voice" },
    { icon: Globe, label: t("settings.sections.preferences"), value: "preferences" },
    { icon: Download, label: t("settings.sections.data"), value: "data" },
  ];

  return (
    <div className="app-page-bg settings-page">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container">
          <h1 className="page-title">{t("settings.title")}</h1>
        </div>
      </section>

      <section className="settings-main">
        <div className="page-content-container settings-content-container">
          <div className="settings-layout grid gap-8 lg:grid-cols-12">
            {/* Sidebar */}
            <aside className="settings-sidebar lg:col-span-3">
              <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:block lg:space-y-1">
                {sections.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setActiveTab(s.value)}
                    aria-current={activeTab === s.value ? "page" : undefined}
                    data-voice-label={s.label}
                    data-voice-aliases={`${s.label} 设置页签 ${s.label} tab ${s.value}`}
                    className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors lg:w-full ${
                      activeTab === s.value
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    }`}
                  >
                    <s.icon className="h-4 w-4" strokeWidth={1.75} /> {s.label}
                  </button>
                ))}
              </nav>
            </aside>

            <div className="settings-tab-panel min-w-0 lg:col-span-9">
              <div className="settings-tab-scroll">
                {/* 鈹€鈹€ API keys 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
                {activeTab === "apiKeys" && (
                  <section>
                    <h2 className="font-display text-2xl">{t("settings.apiKeys.title")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("settings.apiKeys.desc")}
                    </p>
                    <div className="mt-5 grid gap-4 lg:grid-cols-3">
                      <ApiSettingsCard
                        title={t("settings.apiKeys.elevenlabsGroup")}
                        required
                        onBlur={() => void handleValidateApiGroup("elevenlabs")}
                      >
                        <KeyField
                          label={t("settings.apiKeys.elevenlabs")}
                          value={elevenLabsKey}
                          onChange={setElevenLabsKey}
                          onBlur={(event) => handleApiFieldBlur("elevenlabs", event)}
                          placeholder="sk_..."
                          showLabel={t("settings.aria.showSecret")}
                          hideLabel={t("settings.aria.hideSecret")}
                        />
                      </ApiSettingsCard>

                      <ApiSettingsCard
                        title={t("settings.apiKeys.llmGroup")}
                        required
                        onBlur={() => void handleValidateApiGroup("llm")}
                      >
                        <KeyField
                          label={t("settings.apiKeys.llmEndpoint")}
                          value={llmEndpoint}
                          onChange={setLlmEndpoint}
                          onBlur={(event) => handleApiFieldBlur("llm", event)}
                          placeholder={DEFAULT_LLM_BASE_URL}
                          type="text"
                          showLabel={t("settings.aria.showSecret")}
                          hideLabel={t("settings.aria.hideSecret")}
                        />
                        <KeyField
                          label={t("settings.apiKeys.llm")}
                          value={llmKey}
                          onChange={setLlmKey}
                          onBlur={(event) => handleApiFieldBlur("llm", event)}
                          placeholder="sk-..."
                          showLabel={t("settings.aria.showSecret")}
                          hideLabel={t("settings.aria.hideSecret")}
                        />
                        <KeyField
                          label={t("settings.apiKeys.llmModel")}
                          value={llmModel}
                          onChange={setLlmModel}
                          onBlur={(event) => handleApiFieldBlur("llm", event)}
                          placeholder={DEFAULT_LLM_MODEL}
                          type="text"
                          showLabel={t("settings.aria.showSecret")}
                          hideLabel={t("settings.aria.hideSecret")}
                        />
                      </ApiSettingsCard>

                      <ApiSettingsCard
                        title={t("settings.apiKeys.imageGroup")}
                        onBlur={() => void handleValidateApiGroup("image")}
                      >
                        <KeyField
                          label={t("settings.apiKeys.imageEndpoint")}
                          value={imageEndpoint}
                          onChange={setImageEndpoint}
                          onBlur={(event) => handleApiFieldBlur("image", event)}
                          placeholder="https://api.openai.com/v1"
                          type="text"
                          showLabel={t("settings.aria.showSecret")}
                          hideLabel={t("settings.aria.hideSecret")}
                        />
                        <KeyField
                          label={t("settings.apiKeys.imageKey")}
                          value={imageKey}
                          onChange={setImageKey}
                          onBlur={(event) => handleApiFieldBlur("image", event)}
                          placeholder="sk-..."
                          showLabel={t("settings.aria.showSecret")}
                          hideLabel={t("settings.aria.hideSecret")}
                        />
                        <KeyField
                          label={t("settings.apiKeys.imageModel")}
                          value={imageModel}
                          onChange={setImageModel}
                          onBlur={(event) => handleApiFieldBlur("image", event)}
                          placeholder={DEFAULT_IMAGE_MODEL}
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
                )}

                {/* 鈹€鈹€ Voice & wake-word 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
                {activeTab === "voice" && (
                  <section>
                    <h2 className="font-display text-2xl">{t("settings.voice.title")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {!hasElevenLabsKey
                        ? t("settings.voice.configureElevenLabsFirst")
                        : isLoadingElevenLabsVoices
                          ? t("settings.voice.loadingElevenLabsVoices")
                          : elevenLabsVoicesError
                            ? t("settings.voice.elevenLabsVoicesFailed")
                            : t("settings.voice.elevenLabsVoicesLoaded", {
                                count: voiceOptions.length,
                              })}
                    </p>
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {/* Wake words */}
                      <div className="rounded-2xl border border-border bg-card p-5">
                        <div className="flex items-center gap-3">
                          <VoiceBadge n={6} />
                          <div className="flex-1">
                            <div className="text-sm font-medium">
                              {t("settings.voice.wakeWords")}
                            </div>
                            <div className="voice-hint mt-0.5">
                              {t("settings.voice.wakeWordsHint")}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {visibleWakeWords.map((w) => (
                            <span
                              key={w}
                              className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-xs text-background"
                            >
                              {w}
                              {!isBuiltInWakeWord(w) && (
                                <button
                                  type="button"
                                  onClick={() => removeWakeWord(w)}
                                  className="ml-0.5 inline-flex h-5 w-5 appearance-none items-center justify-center rounded-full border border-transparent bg-transparent p-0 shadow-none ring-0 hover:border-border hover:bg-transparent hover:opacity-70 focus-visible:border-border focus-visible:ring-0 active:bg-transparent"
                                  aria-label={t("settings.aria.removeWakeWord", { word: w })}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
                            className="inline-flex h-10 w-full appearance-none items-center justify-center rounded-xl border border-border/70 bg-background p-0 text-muted-foreground shadow-none ring-0 hover:border-border hover:bg-transparent hover:text-foreground focus-visible:border-border focus-visible:ring-0 active:bg-transparent sm:h-8 sm:w-8 sm:rounded-full sm:border-transparent"
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
                            <div className="text-sm font-medium">
                              {t("settings.voice.sensitivity")}
                            </div>
                            <div className="voice-hint mt-0.5">
                              {t("settings.voice.sensitivityHint")}
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {t(`settings.voice.${sensitivity}`)}
                          </span>
                        </div>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-1">
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
                        n={9}
                        label={t("settings.voice.conversationVoice")}
                        hint={t("settings.voice.conversationVoiceHint")}
                        value={conversationVoiceId}
                        options={voiceOptions}
                        onChange={setConversationVoiceId}
                        disabled={voiceSelectDisabled}
                        emptyLabel={t("settings.voice.voiceSelectDisabled")}
                        defaultLabel={defaultVoiceLabel}
                      />
                      <VoiceRoleSelect
                        n={10}
                        label={t("settings.voice.cookingVoice")}
                        hint={t("settings.voice.cookingVoiceHint")}
                        value={cookingVoiceId}
                        options={voiceOptions}
                        onChange={setCookingVoiceId}
                        disabled={voiceSelectDisabled}
                        emptyLabel={t("settings.voice.voiceSelectDisabled")}
                        defaultLabel={defaultVoiceLabel}
                      />

                      <SwitchRow
                        n={11}
                        label={t("settings.voice.badges")}
                        hint={t("settings.voice.badgesHint")}
                        checked={voiceBadgesVisible}
                        onCheckedChange={toggleVoiceBadges}
                      />
                    </div>
                  </section>
                )}

                {/* 鈹€鈹€ Preferences 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
                {activeTab === "preferences" && (
                  <section>
                    <h2 className="font-display text-2xl">{t("settings.preferences.title")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("settings.preferences.desc")}
                    </p>
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {/* Language */}
                      <div className="rounded-2xl border border-border bg-card p-5">
                        <div className="flex items-center gap-3">
                          <VoiceBadge n={12} />
                          <span className="text-sm font-medium">
                            {t("settings.language.title")}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
                          <span className="text-sm font-medium">
                            {t("settings.appearance.title")}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
                    </div>
                  </section>
                )}

                {/* 鈹€鈹€ Data management 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
                {activeTab === "data" && (
                  <section>
                    <h2 className="font-display text-2xl">{t("settings.data.title")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t("settings.data.desc")}</p>
                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                      {/* Export */}
                      <button
                        type="button"
                        onClick={handleExport}
                        data-voice-label={t("settings.data.export")}
                        data-voice-aliases="导出所有菜谱 导出全部菜谱 导出菜谱 下载所有菜谱 export all recipes export recipes download recipes backup recipes"
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
                        data-voice-label={t("settings.data.import")}
                        data-voice-aliases="导入菜谱 导入菜谱文件 上传菜谱 上传菜谱文件 恢复菜谱 import recipes import recipe file upload recipes restore recipes"
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
                            data-voice-label={t("settings.data.clear")}
                            data-voice-aliases="清空所有数据 清空菜谱 删除全部数据 clear all data clear recipes delete all data"
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
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
