import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, ChefHat, Clock, Loader2, Mic, Send, Trash2, Volume2, VolumeX, Waves } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/site-header";
import { db, type Recipe } from "@/lib/db";
import i18n from "@/lib/i18n";
import { getConfiguredLLMService } from "@/lib/llm";
import { synthesizeWithElevenLabs } from "@/lib/voice-pipeline";
import { cn } from "@/lib/utils";
import {
  claimVoicePlayback,
  stopActiveVoicePlayback,
  type VoicePlaybackHandle,
} from "@/lib/voice-playback";
import { useAppStore } from "@/stores/app-store";
import type { VoiceStatus } from "@/lib/voice-pipeline";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: i18n.t("home.chat.metaTitle") },
      {
        name: "description",
        content: i18n.t("home.chat.metaDescription"),
      },
      { property: "og:title", content: i18n.t("home.chat.metaTitle") },
      {
        property: "og:description",
        content: i18n.t("home.chat.metaOgDescription"),
      },
    ],
  }),
  component: HomePage,
});

type AssistantStatus = VoiceStatus | "speaking";

type VoiceStatusDetail = {
  status: VoiceStatus;
  isSupported: boolean;
  isMuted: boolean;
  error: string | null;
  lastTranscript: string;
};

type HomeAwakeDetail = {
  phrase: string;
  source: "manual" | "wake-word";
  transcript: string;
};

type ChatRecipe = {
  id: string;
  title: string;
  source: "local" | "web";
  flavor?: string;
  totalTimeMin?: number;
  cuisine?: string;
  sourceUrl?: string;
};

type WebRecipeSearchResponse = {
  results?: Array<{
    title?: unknown;
    url?: unknown;
    source?: unknown;
  }>;
};

type WebRecipeContentResponse = {
  title?: unknown;
  url?: unknown;
  text?: unknown;
  error?: unknown;
};

type RecipeImportProgressStep = {
  id: "fetching" | "structuring" | "saving" | "opening";
  label: string;
  status: "pending" | "active" | "done";
};

type RecipeImportProgress = {
  title: string;
  detail: string;
  steps: RecipeImportProgressStep[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "recipes" | "confirm" | "guide" | "system";
  text: string;
  displayText?: string;
  createdAt: Date;
  recipes?: ChatRecipe[];
  progress?: RecipeImportProgress;
  isReading?: boolean;
};

type AppLanguage = "en" | "zh";

type StructuredRecipeDraft = Omit<
  Recipe,
  | "id"
  | "coverImage"
  | "coverSource"
  | "sourceUrl"
  | "rawVideo"
  | "rawAudio"
  | "rawTranscript"
  | "voiceId"
  | "createdAt"
  | "lastCookedAt"
>;

const NUMBER_SYMBOLS = ["①", "②", "③", "④", "⑤", "⑥"];
const EMPTY_RECIPES: Recipe[] = [];
const KITCHEN_ASSISTANT_SYSTEM_PROMPTS: Record<AppLanguage, string> = {
  zh: "你是 CookTalk，一个聪明、自然、可靠的中文厨房做菜 AI 助手。你的主场是厨房：菜谱推荐、食材搭配、火候判断、调味比例、替代食材、备菜流程、烹饪故障补救、厨房安全和省时技巧。用户寒暄时要自然回应并主动给出可问方向；用户问题不完整时，先给可执行建议，再问一个最关键的澄清问题。回答要像真人厨房搭子，避免死板模板；通常控制在 2 到 5 句话。必须使用简体中文回答。不要输出 Markdown 表格。涉及食品安全时要明确提醒风险。",
  en: "You are CookTalk, a smart, natural, reliable AI cooking assistant. Your home turf is the kitchen: recipe ideas, ingredient pairing, heat control, seasoning ratios, substitutions, prep flow, cooking rescue, kitchen safety, and time-saving tips. Reply naturally to greetings and proactively suggest what the user can ask. If the user's request is incomplete, give practical advice first, then ask one key clarifying question. Sound like a helpful kitchen partner, not a rigid script. Usually answer in 2 to 5 sentences. You must answer in English. Do not output Markdown tables. Be explicit about food-safety risks.",
};
const ASSISTANT_COPY: Record<
  AppLanguage,
  {
    llmKeyRequired: string;
    elevenLabsKeyRequired: string;
    settingsAction: string;
    voiceGenFailed: string;
    voicePlayFailed: string;
    assistantUnavailable: string;
    openedWebResult: (title: string) => string;
    webResultOnly: (title: string) => string;
    startLocalRecipe: (title: string) => string;
    openedWebCookGuide: (title: string) => string;
    webCookGuide: (title: string) => string;
    importWithCards: string;
    importWithoutCards: string;
    rateChanged: (rate: string) => string;
    badgesHidden: string;
    settingsGuide: string;
    openingSettings: string;
    openingRecipes: string;
    noLocalRecipes: string;
    webSearchEmpty: string;
    recommendations: string;
    recipeSaved: (title: string) => string;
    recipeSaveFailed: string;
    webRecipeImportTitle: (title: string) => string;
    webRecipeImportStarted: string;
    webRecipeImportFetching: string;
    webRecipeImportStructuring: string;
    webRecipeImportSaving: string;
    webRecipeImportOpeningDetail: string;
    webRecipeImportOpeningCook: string;
    webRecipeImportDone: (title: string) => string;
    webRecipeDetailDone: (title: string) => string;
    webRecipeImportFailed: string;
    noRecipeDraft: string;
    stayHere: string;
    emptyReply: string;
    clearSuccess: string;
    inputPlaceholder: string;
    sendLabel: string;
    manualWakeLabel: string;
    awakeReady: string;
  }
> = {
  zh: {
    llmKeyRequired: "请先在设置里配置 LLM API Key，才能使用智能厨房助手。",
    elevenLabsKeyRequired: "请先在设置里配置 ElevenLabs API Key，才能使用语音对话。",
    settingsAction: "去设置",
    voiceGenFailed: "语音生成失败，已改为文字回复",
    voicePlayFailed: "语音播放失败",
    assistantUnavailable: "智能厨房助手暂时不可用，请稍后再试。",
    openedWebResult: (title) => `已为你打开「${title}」的网页搜索结果。`,
    webResultOnly: (title) => `「${title}」来自网页搜索，请先在网页中查看。`,
    startLocalRecipe: (title) => `好的，开始做「${title}」。`,
    openedWebCookGuide: (title) => `已打开「${title}」的网页结果。开始烹饪请从已有菜谱中选择。`,
    webCookGuide: (title) =>
      `「${title}」来自网页搜索，当前只能查看；开始烹饪请先从已有菜谱中选择。`,
    importWithCards: "对话里我不直接导入菜谱。可以先从已有菜谱或网页搜索结果里选一个：",
    importWithoutCards:
      "对话里我不直接导入菜谱。你可以说菜名或口味，我会给出已有菜谱或网页搜索结果供你选择。",
    rateChanged: (rate) => `✓ 语速已调整为 ${rate} 倍。`,
    badgesHidden: "✓ 已隐藏语音徽标和建议提示。",
    settingsGuide:
      "设置项我可以帮你调整。你可以直接说“进入设置”“语速调到 1.2 倍”，或说“不用”继续留在这里。",
    openingSettings: "好的，打开设置。",
    openingRecipes: "好的，打开你的菜谱库。",
    noLocalRecipes: "当前没有匹配的本地菜谱。你可以换个菜名或口味，我会继续给你网页搜索结果。",
    webSearchEmpty: "我没搜到可以直接打开的网页结果。你可以换个更具体的菜名或食材再试。",
    recommendations: "根据你的菜谱库和当前口味，我推荐这几道：",
    recipeSaved: (title) => `已整理并上传到菜谱「${title}」。`,
    recipeSaveFailed: "整理并上传菜谱失败，请稍后再试。",
    webRecipeImportTitle: (title) => `正在整理「${title}」`,
    webRecipeImportStarted: "我会先读取网页菜谱，整理步骤，保存到你的菜谱库，然后进入烹饪模式。",
    webRecipeImportFetching: "读取网页内容",
    webRecipeImportStructuring: "整理食材和步骤",
    webRecipeImportSaving: "保存到我的菜谱",
    webRecipeImportOpeningDetail: "打开菜谱详情",
    webRecipeImportOpeningCook: "进入烹饪模式",
    webRecipeImportDone: (title) => `已保存「${title}」，正在进入烹饪模式。`,
    webRecipeDetailDone: (title) => `已保存「${title}」，正在打开菜谱详情。`,
    webRecipeImportFailed: "网页菜谱整理失败。你可以先打开网页查看，或换一个搜索结果再试。",
    noRecipeDraft: "我还没有可上传或开始烹饪的做菜方案。请先让我生成一道菜的做法。",
    stayHere: "好的，我会留在这里。需要时直接说菜名、口味，或让我从网页搜索菜谱。",
    emptyReply: "我刚才没组织好回答，你可以换个说法再问一次，我会按做菜场景继续帮你。",
    clearSuccess: "已清空当前对话",
    inputPlaceholder: "输入文字（或直接说话）...",
    sendLabel: "发送",
    manualWakeLabel: "手动唤醒麦克风",
    awakeReady: "我在，已经唤醒了。直接说你想找的菜、食材，或问我做菜问题。",
  },
  en: {
    llmKeyRequired:
      "Please configure an LLM API key in Settings to use the smart kitchen assistant.",
    elevenLabsKeyRequired:
      "Please configure an ElevenLabs API key in Settings to use voice conversation.",
    settingsAction: "Settings",
    voiceGenFailed: "Voice generation failed, so I switched to text reply",
    voicePlayFailed: "Voice playback failed",
    assistantUnavailable:
      "The smart kitchen assistant is temporarily unavailable. Please try again later.",
    openedWebResult: (title) => `Opened web search results for “${title}”.`,
    webResultOnly: (title) => `“${title}” is from web search. Please view it in the browser first.`,
    startLocalRecipe: (title) => `Great, starting “${title}”.`,
    openedWebCookGuide: (title) =>
      `Opened the web result for “${title}”. To start cooking, choose a recipe from your saved library.`,
    webCookGuide: (title) =>
      `“${title}” is from web search and can only be viewed for now. To start cooking, choose a saved recipe first.`,
    importWithCards:
      "I don't import recipes directly from chat. Pick one from your saved recipes or web results first:",
    importWithoutCards:
      "I don't import recipes directly from chat. Tell me a dish or flavor, and I'll suggest saved recipes or web results to choose from.",
    rateChanged: (rate) => `✓ Speech rate set to ${rate}x.`,
    badgesHidden: "✓ Voice badges and suggestion hints are now hidden.",
    settingsGuide:
      "I can help with settings. Say “open settings”, “set speech rate to 1.2x”, or “not now” to stay here.",
    openingSettings: "Sure, opening Settings.",
    openingRecipes: "Sure, opening your recipe library.",
    noLocalRecipes:
      "No matching saved recipes right now. Try another dish or flavor, and I can continue with web results.",
    webSearchEmpty:
      "I couldn't find web results that can be opened directly. Try a more specific dish or ingredient.",
    recommendations: "Based on your recipe library and current taste, I recommend these:",
    recipeSaved: (title) => `Structured and saved “${title}” to your recipes.`,
    recipeSaveFailed: "Failed to structure and save the recipe. Please try again.",
    webRecipeImportTitle: (title) => `Preparing “${title}”`,
    webRecipeImportStarted:
      "I'll read the web recipe, structure the steps, save it to your recipes, then open cooking mode.",
    webRecipeImportFetching: "Reading the web page",
    webRecipeImportStructuring: "Structuring ingredients and steps",
    webRecipeImportSaving: "Saving to your recipes",
    webRecipeImportOpeningDetail: "Opening recipe details",
    webRecipeImportOpeningCook: "Opening cooking mode",
    webRecipeImportDone: (title) => `Saved “${title}” and opening cooking mode.`,
    webRecipeDetailDone: (title) => `Saved “${title}” and opening recipe details.`,
    webRecipeImportFailed:
      "Failed to structure this web recipe. Open the page directly or try another result.",
    noRecipeDraft:
      "I don't have a recipe plan to save or start yet. Ask me to create a dish plan first.",
    stayHere:
      "Sure, I'll stay here. When ready, tell me a dish, flavor, or ask me to search recipes from the web.",
    emptyReply:
      "I didn't phrase that well. Ask again another way, and I'll help in a cooking-focused way.",
    clearSuccess: "Current conversation cleared",
    inputPlaceholder: "Type a message (or just speak)...",
    sendLabel: "Send",
    manualWakeLabel: "Wake microphone manually",
    awakeReady:
      "I'm awake and listening. Just say the dish, ingredient, or cooking question you want help with.",
  },
};

type KitchenAssistantOptions = {
  text: string;
  messages: ChatMessage[];
  recipes: Recipe[];
  language: AppLanguage;
};

type StreamKitchenAssistantOptions = KitchenAssistantOptions & {
  onChunk: (chunk: string) => void;
};

type SpeechSegment = {
  speechText: string;
  displayText: string;
};

type AssistantSpeechScheduler = {
  append: (chunk: string, force?: boolean) => void;
  finish: () => Promise<void>;
};

type AssistantAudioReveal = {
  baseText: string;
  segmentText: string;
};

const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 96;

function buildRecipeLibraryContext(recipes: Recipe[], language: AppLanguage): string {
  if (recipes.length === 0) {
    return language === "zh"
      ? "当前用户本地菜谱库为空。"
      : "The user's saved recipe library is empty.";
  }

  return recipes
    .slice(0, 8)
    .map((recipe, index) => {
      const ingredients = recipe.ingredients
        .slice(0, 6)
        .map((ingredient) => ingredient.name)
        .join("、");
      const tags = [
        recipe.tags.cuisine,
        recipe.tags.difficulty,
        recipe.tags.totalTimeMin ? `${recipe.tags.totalTimeMin} 分钟` : null,
        recipe.tags.flavor?.join("、"),
      ]
        .filter(Boolean)
        .join(" / ");

      const ingredientLabel = language === "zh" ? "食材" : "ingredients";
      return `${index + 1}. ${recipe.title}${tags ? `（${tags}）` : ""}${ingredients ? `；${ingredientLabel}: ${ingredients}` : ""}`;
    })
    .join("\n");
}

async function answerKitchenAssistant({
  text,
  messages,
  recipes,
  language,
}: KitchenAssistantOptions): Promise<string> {
  const service = await getConfiguredLLMService();
  if (!service) throw new Error(ASSISTANT_COPY[language].llmKeyRequired);

  const history = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.text }));

  const reply = await service.chat([
    { role: "system", content: KITCHEN_ASSISTANT_SYSTEM_PROMPTS[language] },
    {
      role: "system",
      content:
        language === "zh"
          ? `用户本地菜谱库摘要：\n${buildRecipeLibraryContext(recipes, language)}`
          : `User's saved recipe library summary:\n${buildRecipeLibraryContext(recipes, language)}`,
    },
    ...history,
    { role: "user", content: text },
  ]);

  return reply.trim() || ASSISTANT_COPY[language].emptyReply;
}

async function streamKitchenAssistantReply({
  text,
  messages,
  recipes,
  language,
  onChunk,
}: StreamKitchenAssistantOptions): Promise<string> {
  const service = await getConfiguredLLMService();
  if (!service) throw new Error(ASSISTANT_COPY[language].llmKeyRequired);

  const history = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.text }));

  const reply = await service.chatStream(
    [
      { role: "system", content: KITCHEN_ASSISTANT_SYSTEM_PROMPTS[language] },
      {
        role: "system",
          content:
            language === "zh"
              ? `用户本地菜谱库摘要：\n${buildRecipeLibraryContext(recipes, language)}`
              : `User's saved recipe library summary:\n${buildRecipeLibraryContext(recipes, language)}`,
      },
      ...history,
      { role: "user", content: text },
    ],
    { onChunk },
  );

  return reply.trim() || ASSISTANT_COPY[language].emptyReply;
}

function splitSpeechSegments(
  text: string,
  force = false,
): { segments: SpeechSegment[]; remaining: string } {
  const segments: SpeechSegment[] = [];
  let cursor = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!/[.!?。！？\n]/.test(char)) continue;

    const displayText = text.slice(cursor, index + 1);
    const speechText = displayText.trim();
    if (speechText) segments.push({ speechText, displayText });
    cursor = index + 1;
  }

  let remaining = text.slice(cursor);
  if (!force) {
    const softBoundaryIndex = Math.max(
      remaining.lastIndexOf("，"),
      remaining.lastIndexOf(","),
      remaining.lastIndexOf("；"),
      remaining.lastIndexOf(";"),
      remaining.lastIndexOf("："),
      remaining.lastIndexOf(":"),
    );

    if (softBoundaryIndex >= 0 && remaining.slice(0, softBoundaryIndex + 1).trim().length >= 24) {
      const displayText = remaining.slice(0, softBoundaryIndex + 1);
      const speechText = displayText.trim();
      if (speechText) segments.push({ speechText, displayText });
      remaining = remaining.slice(softBoundaryIndex + 1);
    } else if (remaining.trim().length >= 90) {
      const fallbackIndex = remaining.lastIndexOf(" ", 90);
      const splitIndex = fallbackIndex >= 24 ? fallbackIndex : 90;
      const displayText = remaining.slice(0, splitIndex);
      const speechText = displayText.trim();
      if (speechText) segments.push({ speechText, displayText });
      remaining = remaining.slice(splitIndex);
    }
  } else {
    const displayText = remaining;
    const speechText = displayText.trim();
    if (speechText) segments.push({ speechText, displayText });
    remaining = "";
  }

  return { segments, remaining };
}

function getInitialAssistantDisplayText(_text?: string): string {
  return "";
}

function estimateSpeechRevealDurationMs(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;

  const cjkCount = (normalized.match(/[\u3400-\u9fff]/g) ?? []).length;
  const punctuationCount = (normalized.match(/[,.!?;:，。！？；：]/g) ?? []).length;
  const otherCount = Math.max(0, normalized.length - cjkCount - punctuationCount);
  const estimatedMs = cjkCount * 190 + otherCount * 45 + punctuationCount * 130 + 400;

  return Math.max(800, Math.min(estimatedMs, 16_000));
}

function getInitialSegmentRevealLength(text: string): number {
  const firstVisibleIndex = text.search(/\S/);
  return firstVisibleIndex >= 0 ? firstVisibleIndex + 1 : 0;
}

function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const liveRecipes = useLiveQuery(() => db.recipes.orderBy("createdAt").reverse().toArray(), []);
  const recipes = liveRecipes ?? EMPTY_RECIPES;
  const triggerManualWake = useAppStore((s) => s.triggerManualWake);
  const setSpeechRate = useAppStore((s) => s.setSpeechRate);
  const setHomeConversationActive = useAppStore((s) => s.setHomeConversationActive);
  const pendingHomeAwake = useAppStore((s) => s.pendingHomeAwake);
  const clearHomeAwake = useAppStore((s) => s.clearHomeAwake);
  const toggleVoiceBadges = useAppStore((s) => s.toggleVoiceBadges);
  const hasElevenLabsKey = useAppStore((s) => s.hasElevenLabsKey);
  const hasLlmKey = useAppStore((s) => s.hasLlmKey);
  const language = useAppStore((s) => s.language);
  const assistantCopy = ASSISTANT_COPY[language];
  const conversationVoiceId = useAppStore((s) => s.conversationVoiceId);

  const [voiceDetail, setVoiceDetail] = useState<VoiceStatusDetail | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus>("idle");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [latestRecipes, setLatestRecipes] = useState<ChatRecipe[]>([]);
  const [latestRecipeDraftText, setLatestRecipeDraftText] = useState("");
  const [mutedMessageId, setMutedMessageId] = useState<string | null>(null);
  const [isAssistantLoading, setAssistantLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const playbackHandleRef = useRef<VoicePlaybackHandle | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const assistantRunRef = useRef<string | null>(null);
  const commandTurnRef = useRef(0);
  const mutedMessageIdRef = useRef<string | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const currentStatus = isAssistantLoading
    ? "thinking"
    : assistantStatus === "speaking"
      ? "speaking"
      : (voiceDetail?.status ?? assistantStatus);
  const isConversationActive = messages.length > 0;
  const isWakeActive = ["awake", "recording", "transcribing", "thinking", "speaking"].includes(
    currentStatus,
  );
  const shouldShowWakeTip = !isConversationActive && !isWakeActive;

  useEffect(() => {
    document.title = t("home.chat.metaTitle");
  }, [t, language]);

  const promptConfigureElevenLabsKey = useCallback(() => {
    toast.error(assistantCopy.elevenLabsKeyRequired, {
      action: {
        label: assistantCopy.settingsAction,
        onClick: () => void navigate({ to: "/settings" }),
      },
    });
  }, [assistantCopy, navigate]);

  const promptConfigureLlmKey = useCallback(() => {
    toast.error(assistantCopy.llmKeyRequired, {
      action: {
        label: assistantCopy.settingsAction,
        onClick: () => void navigate({ to: "/settings" }),
      },
    });
  }, [assistantCopy, navigate]);

  useEffect(() => {
    const handleVoiceStatus = (event: Event) => {
      const detail = (event as CustomEvent<VoiceStatusDetail>).detail;
      setVoiceDetail(detail);
      if (assistantStatus !== "speaking") setAssistantStatus(detail.status);
    };

    window.addEventListener("cooktalk:voice-status", handleVoiceStatus);
    return () => window.removeEventListener("cooktalk:voice-status", handleVoiceStatus);
  }, [assistantStatus]);

  const scrollConversationToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    scrollElement.scrollTo({
      top: scrollElement.scrollHeight,
      behavior,
    });
  }, []);

  const handleConversationScroll = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    scrollConversationToBottom();
  }, [isAssistantLoading, messages, scrollConversationToBottom]);

  useEffect(() => {
    mutedMessageIdRef.current = mutedMessageId;
  }, [mutedMessageId]);

  useEffect(() => {
    setHomeConversationActive(isConversationActive);
    return () => setHomeConversationActive(false);
  }, [isConversationActive, setHomeConversationActive]);

  const recipeLookup = useMemo(() => {
    return new Map(recipes.map((recipe) => [recipe.id, recipe]));
  }, [recipes]);

  const addMessage = useCallback((message: Omit<ChatMessage, "id" | "createdAt">) => {
    const nextMessage: ChatMessage = {
      ...message,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    setMessages((current) => [...current, nextMessage]);
    return nextMessage;
  }, []);

  const updateMessage = useCallback((id: string, changes: Partial<ChatMessage>) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...changes } : message)),
    );
  }, []);

  const revealMessageText = useCallback(
    (id: string, text?: string, changes: Partial<ChatMessage> = {}) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? {
                ...message,
                ...(text !== undefined ? { text } : {}),
                ...changes,
                displayText: text ?? message.text,
              }
            : message,
        ),
      );
    },
    [],
  );

  const finalizeAssistantRun = useCallback(
    (runId: string, messageId: string, text?: string) => {
      if (assistantRunRef.current === runId) assistantRunRef.current = null;
      if (activeAssistantMessageIdRef.current === messageId)
        activeAssistantMessageIdRef.current = null;
      playbackHandleRef.current = null;
      audioRef.current = null;
      audioUrlRef.current = null;
      mutedMessageIdRef.current = null;
      setMutedMessageId(null);
      setAssistantLoading(false);
      setAssistantStatus("idle");
      revealMessageText(messageId, text, { isReading: false });
    },
    [revealMessageText],
  );

  const playAssistantAudioBlob = useCallback(
    (
      runId: string,
      messageId: string,
      audioBlob: Blob,
      reveal?: AssistantAudioReveal,
    ) =>
      new Promise<void>((resolve) => {
        if (assistantRunRef.current !== runId) {
          resolve();
          return;
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.muted = mutedMessageIdRef.current === messageId;
        audioRef.current = audio;
        audioUrlRef.current = audioUrl;
        let settled = false;
        let revealFrame: number | null = null;
        let revealStarted = false;

        const revealFullSegment = () => {
          if (!reveal || assistantRunRef.current !== runId) return;
          if (revealFrame !== null) {
            window.cancelAnimationFrame(revealFrame);
            revealFrame = null;
          }
          updateMessage(messageId, {
            displayText: `${reveal.baseText}${reveal.segmentText}`,
          });
        };

        const startTextReveal = () => {
          if (!reveal || revealStarted || assistantRunRef.current !== runId) return;
          revealStarted = true;

          const fallbackDuration = estimateSpeechRevealDurationMs(reveal.segmentText);
          const initialRevealLength = getInitialSegmentRevealLength(reveal.segmentText);
          const initialText = reveal.segmentText.slice(0, initialRevealLength);
          updateMessage(messageId, {
            displayText: `${reveal.baseText}${initialText}`,
            isReading: true,
          });
          setAssistantLoading(false);

          const tick = () => {
            if (assistantRunRef.current !== runId) return;

            const duration =
              Number.isFinite(audio.duration) && audio.duration > 0
                ? audio.duration * 1000
                : fallbackDuration;
            const progress =
              duration > 0 ? Math.min(1, (audio.currentTime * 1000) / duration) : 1;
            const revealLength = Math.min(
              reveal.segmentText.length,
              Math.max(initialRevealLength, Math.floor(reveal.segmentText.length * progress)),
            );

            updateMessage(messageId, {
              displayText: `${reveal.baseText}${reveal.segmentText.slice(0, revealLength)}`,
            });

            if (progress < 1) {
              revealFrame = window.requestAnimationFrame(tick);
            } else {
              revealFrame = null;
            }
          };

          revealFrame = window.requestAnimationFrame(tick);
        };

        const settle = () => {
          if (settled) return;
          settled = true;
          revealFullSegment();
          resolve();
        };

        setAssistantStatus("speaking");
        const playback = claimVoicePlayback(audio, {
          cleanup: () => {
            URL.revokeObjectURL(audioUrl);
            if (audioUrlRef.current === audioUrl) audioUrlRef.current = null;
            if (audioRef.current === audio) audioRef.current = null;
            if (playbackHandleRef.current?.isActive() === false) playbackHandleRef.current = null;
          },
          onStop: settle,
        });
        playbackHandleRef.current = playback;

        audio.onended = () => {
          playback.release();
          settle();
        };
        audio.onerror = () => {
          playback.release();
          settle();
        };
        audio
          .play()
          .then(startTextReveal)
          .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : assistantCopy.voicePlayFailed);
            playback.release();
            settle();
          });
      }),
    [assistantCopy.voicePlayFailed, updateMessage],
  );

  const createAssistantSpeechScheduler = useCallback(
    (runId: string, messageId: string): AssistantSpeechScheduler => {
      let pendingText = "";
      let revealedText = "";
      let playbackChain = Promise.resolve();

      const queueSegment = ({ speechText, displayText }: SpeechSegment) => {
        if (!hasElevenLabsKey || !speechText.trim()) return;

        const blobPromise = synthesizeWithElevenLabs(speechText, conversationVoiceId, language).catch(
          (error: unknown) => {
            if (assistantRunRef.current === runId) {
              toast.error(error instanceof Error ? error.message : assistantCopy.voiceGenFailed);
            }
            return null;
          },
        );

        playbackChain = playbackChain.then(async () => {
          if (assistantRunRef.current !== runId) return;
          const baseText = revealedText;
          const audioBlob = await blobPromise;
          if (!audioBlob || assistantRunRef.current !== runId) {
            revealedText = `${baseText}${displayText}`;
            updateMessage(messageId, { displayText: revealedText });
            setAssistantLoading(false);
            return;
          }
          await playAssistantAudioBlob(runId, messageId, audioBlob, {
            baseText,
            segmentText: displayText,
          });
          revealedText = `${baseText}${displayText}`;
        });
      };

      return {
        append(chunk: string, force = false) {
          pendingText += chunk;
          const { segments, remaining } = splitSpeechSegments(pendingText, force);
          pendingText = remaining;
          segments.forEach(queueSegment);
        },
        async finish() {
          if (pendingText.trim()) {
            const finalSegment: SpeechSegment = {
              speechText: pendingText.trim(),
              displayText: pendingText,
            };
            pendingText = "";
            queueSegment(finalSegment);
          }
          await playbackChain;
        },
      };
    },
    [
      assistantCopy.voiceGenFailed,
      conversationVoiceId,
      hasElevenLabsKey,
      language,
      playAssistantAudioBlob,
      updateMessage,
    ],
  );

  const stopAssistantPlayback = useCallback(
    (finishActiveMessage = false) => {
      assistantRunRef.current = null;

      playbackHandleRef.current?.stop();
      playbackHandleRef.current = null;
      stopActiveVoicePlayback();

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }

      if (finishActiveMessage && activeAssistantMessageIdRef.current) {
        revealMessageText(activeAssistantMessageIdRef.current, undefined, { isReading: false });
      }

      activeAssistantMessageIdRef.current = null;
      mutedMessageIdRef.current = null;
      setMutedMessageId(null);
      setAssistantLoading(false);
      setAssistantStatus("idle");
    },
    [revealMessageText],
  );

  useEffect(() => {
    return () => {
      stopAssistantPlayback(false);
    };
  }, [stopAssistantPlayback]);

  useEffect(() => {
    if (pathname !== "/") stopAssistantPlayback(true);
  }, [pathname, stopAssistantPlayback]);

  const pushAssistant = useCallback(
    (message: Omit<ChatMessage, "id" | "createdAt" | "role">) => {
      stopAssistantPlayback(true);

      const runId = crypto.randomUUID();
      assistantRunRef.current = runId;
      setAssistantLoading(hasElevenLabsKey && !!message.text);
      setAssistantStatus(hasElevenLabsKey && !!message.text ? "thinking" : "idle");

      const nextMessage = addMessage({
        ...message,
        role: "assistant",
        displayText:
          hasElevenLabsKey && message.text
            ? getInitialAssistantDisplayText(message.text)
            : message.text,
        isReading: false,
      });
      activeAssistantMessageIdRef.current = nextMessage.id;

      if (!message.text || !hasElevenLabsKey) {
        finalizeAssistantRun(runId, nextMessage.id);
        return nextMessage;
      }

      const speechScheduler = createAssistantSpeechScheduler(runId, nextMessage.id);
      speechScheduler.append(message.text, true);

      void (async () => {
        await speechScheduler.finish();
        if (
          assistantRunRef.current !== runId ||
          activeAssistantMessageIdRef.current !== nextMessage.id
        ) {
          return;
        }
        finalizeAssistantRun(runId, nextMessage.id, message.text);
      })();

      return nextMessage;
    },
    [
      addMessage,
      createAssistantSpeechScheduler,
      finalizeAssistantRun,
      hasElevenLabsKey,
      stopAssistantPlayback,
    ],
  );

  const toggleAssistantAudio = useCallback((messageId: string) => {
    const audio = audioRef.current;
    if (!audio || activeAssistantMessageIdRef.current !== messageId) return;

    audio.muted = !audio.muted;
    mutedMessageIdRef.current = audio.muted ? messageId : null;
    setMutedMessageId(mutedMessageIdRef.current);
  }, []);

  const streamAssistantTextReply = useCallback(
    async (text: string, conversationMessages: ChatMessage[]) => {
      stopAssistantPlayback(true);

      const runId = crypto.randomUUID();
      assistantRunRef.current = runId;
      setAssistantLoading(true);
      setAssistantStatus("thinking");

      let assistantMessage: ChatMessage | null = null;
      let assistantText = "";
      let speechScheduler: AssistantSpeechScheduler | null = null;
      let receivedChunk = false;

      const ensureAssistantMessage = () => {
        if (assistantMessage) return assistantMessage;
        assistantMessage = addMessage({
          role: "assistant",
          kind: "text",
          text: assistantText,
          displayText: hasElevenLabsKey
            ? getInitialAssistantDisplayText(assistantText)
            : assistantText,
          isReading: false,
        });
        activeAssistantMessageIdRef.current = assistantMessage.id;
        speechScheduler = createAssistantSpeechScheduler(runId, assistantMessage.id);
        if (!hasElevenLabsKey) setAssistantLoading(false);
        return assistantMessage;
      };

      try {
        const fullReply = await streamKitchenAssistantReply({
          text,
          messages: conversationMessages,
          recipes,
          language,
          onChunk: (chunk) => {
            if (assistantRunRef.current !== runId) return;
            receivedChunk = true;
            assistantText += chunk;
            const message = ensureAssistantMessage();
            updateMessage(
              message.id,
              hasElevenLabsKey ? { text: assistantText } : { text: assistantText, displayText: assistantText },
            );
            speechScheduler?.append(chunk);
          },
        });

        if (assistantRunRef.current !== runId) return;

        assistantText = fullReply;
        const message = ensureAssistantMessage();
        updateMessage(
          message.id,
          hasElevenLabsKey ? { text: assistantText } : { text: assistantText, displayText: assistantText },
        );
        setLatestRecipeDraftText(`${text}\n\n${assistantText}`.trim());
        if (!receivedChunk && assistantText) {
          (speechScheduler as AssistantSpeechScheduler | null)?.append(assistantText, true);
        }
        await (speechScheduler as AssistantSpeechScheduler | null)?.finish();

        if (
          assistantRunRef.current !== runId ||
          activeAssistantMessageIdRef.current !== message.id
        ) {
          return;
        }
        finalizeAssistantRun(runId, message.id, assistantText);
      } catch (error: unknown) {
        if (assistantRunRef.current !== runId) return;

        const failedAssistantMessage = assistantMessage as ChatMessage | null;
        if (failedAssistantMessage) {
          finalizeAssistantRun(
            runId,
            failedAssistantMessage.id,
            assistantText || failedAssistantMessage.text,
          );
        } else {
          assistantRunRef.current = null;
          activeAssistantMessageIdRef.current = null;
          setAssistantLoading(false);
          setAssistantStatus("idle");
        }

        if (error instanceof Error) toast.error(error.message);
        else toast.error(assistantCopy.assistantUnavailable);
      }
    },
    [
      addMessage,
      assistantCopy.assistantUnavailable,
      createAssistantSpeechScheduler,
      finalizeAssistantRun,
      hasElevenLabsKey,
      language,
      recipes,
      stopAssistantPlayback,
      updateMessage,
    ],
  );

  const structureAndSaveRecipeDraft = useCallback(
    async (draftText: string, options: { sourceUrl?: string; fallbackTitle?: string } = {}): Promise<Recipe> => {
      const service = await getConfiguredLLMService();
      if (!service) throw new Error(assistantCopy.llmKeyRequired);

      const draft = (await service.structureRecipeFromText(draftText)) as StructuredRecipeDraft;
      const title =
        draft.title?.trim() ||
        options.fallbackTitle?.trim() ||
        i18n.t("import.untitledRecipe", { lng: language });
      const ingredients = (draft.ingredients ?? [])
        .map((ingredient) => ({
          name: ingredient.name?.trim() ?? "",
          amount: ingredient.amount?.trim() ?? "",
        }))
        .filter((ingredient) => ingredient.name);
      const steps = (draft.steps ?? [])
        .map((step, index) => ({
          order: index + 1,
          description: step.description?.trim() ?? "",
          durationSec: step.durationSec,
          tips: step.tips?.trim() || undefined,
        }))
        .filter((step) => step.description);

      if (steps.length === 0) throw new Error(assistantCopy.recipeSaveFailed);

      const recipe: Recipe = {
        title,
        ingredients,
        steps,
        tags: draft.tags ?? {},
        coverSource: "default",
        sourceUrl: options.sourceUrl,
        rawTranscript: draftText,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };

      await db.recipes.add(recipe);
      return recipe;
    },
    [assistantCopy.llmKeyRequired, assistantCopy.recipeSaveFailed, language],
  );

  const createWebRecipeProgress = useCallback(
    (
      title: string,
      activeStep: RecipeImportProgressStep["id"],
      detail = assistantCopy.webRecipeImportStarted,
    ): RecipeImportProgress => {
      const stepIds: RecipeImportProgressStep["id"][] = [
        "fetching",
        "structuring",
        "saving",
        "opening",
      ];
      const labels: Record<RecipeImportProgressStep["id"], string> = {
        fetching: assistantCopy.webRecipeImportFetching,
        structuring: assistantCopy.webRecipeImportStructuring,
        saving: assistantCopy.webRecipeImportSaving,
        opening: assistantCopy.webRecipeImportOpeningCook,
      };
      const activeIndex = stepIds.indexOf(activeStep);

      return {
        title: assistantCopy.webRecipeImportTitle(title),
        detail,
        steps: stepIds.map((id, index) => ({
          id,
          label: labels[id],
          status: index < activeIndex ? "done" : index === activeIndex ? "active" : "pending",
        })),
      };
    },
    [assistantCopy],
  );

  const importWebRecipe = useCallback(
    async (
      chatRecipe: ChatRecipe,
      options: { startCooking?: boolean; openDetail?: boolean } = {},
    ) => {
      if (!chatRecipe.sourceUrl) {
        pushAssistant({ kind: "guide", text: assistantCopy.webResultOnly(chatRecipe.title) });
        return;
      }

      if (!hasLlmKey) {
        promptConfigureLlmKey();
        return;
      }

      stopAssistantPlayback(true);
      setAssistantLoading(false);
      setAssistantStatus("thinking");

      const progressMessage = addMessage({
        role: "assistant",
        kind: "text",
        text: assistantCopy.webRecipeImportStarted,
        displayText: assistantCopy.webRecipeImportStarted,
        progress: createWebRecipeProgress(chatRecipe.title, "fetching"),
      });

      const setProgress = (
        step: RecipeImportProgressStep["id"],
        detail = assistantCopy.webRecipeImportStarted,
      ) => {
        updateMessage(progressMessage.id, {
          text: detail,
          displayText: detail,
          progress: createWebRecipeProgress(chatRecipe.title, step, detail),
        });
      };

      try {
        setProgress("fetching");
        const page = await fetchWebRecipeContent(chatRecipe.sourceUrl);
        const sourceTitle = page.title || chatRecipe.title;
        const sourceUrl = page.url || chatRecipe.sourceUrl;
        const sourceText = [
          `Source title: ${sourceTitle}`,
          `Source URL: ${sourceUrl}`,
          "",
          page.text,
        ].join("\n");

        setProgress("structuring");
        const recipe = await structureAndSaveRecipeDraft(sourceText, {
          sourceUrl,
          fallbackTitle: sourceTitle,
        });

        setProgress("saving");
        setLatestRecipes([recipeToChatRecipe(recipe)]);

        const doneText = options.startCooking
          ? assistantCopy.webRecipeImportDone(recipe.title)
          : assistantCopy.webRecipeDetailDone(recipe.title);
        const openingProgress = createWebRecipeProgress(chatRecipe.title, "opening", doneText);
        openingProgress.steps = openingProgress.steps.map((step) =>
          step.id === "opening"
            ? {
                ...step,
                label: options.startCooking
                  ? assistantCopy.webRecipeImportOpeningCook
                  : assistantCopy.webRecipeImportOpeningDetail,
              }
            : step,
        );
        updateMessage(progressMessage.id, {
          text: doneText,
          displayText: doneText,
          kind: "confirm",
          progress: openingProgress,
        });

        window.setTimeout(() => {
          stopAssistantPlayback(true);
          void navigate({
            to: options.startCooking ? "/cook" : "/recipe-detail",
            search: { id: recipe.id },
          });
        }, 500);
      } catch (error) {
        const message = error instanceof Error ? error.message : assistantCopy.webRecipeImportFailed;
        updateMessage(progressMessage.id, {
          text: assistantCopy.webRecipeImportFailed,
          displayText: assistantCopy.webRecipeImportFailed,
          kind: "guide",
          progress: undefined,
        });
        toast.error(message);
        setAssistantStatus("idle");
      }
    },
    [
      addMessage,
      assistantCopy,
      createWebRecipeProgress,
      hasLlmKey,
      navigate,
      promptConfigureLlmKey,
      pushAssistant,
      stopAssistantPlayback,
      structureAndSaveRecipeDraft,
      updateMessage,
    ],
  );

  const handleSaveLatestRecipeDraft = useCallback(
    async (options: { startCooking?: boolean } = {}) => {
      const draftText = latestRecipeDraftText.trim();
      if (!draftText) {
        pushAssistant({ kind: "guide", text: assistantCopy.noRecipeDraft });
        return;
      }

      stopAssistantPlayback(true);
      setAssistantLoading(true);
      setAssistantStatus("thinking");

      try {
        const recipe = await structureAndSaveRecipeDraft(draftText);
        setLatestRecipes([recipeToChatRecipe(recipe)]);
        pushAssistant({ kind: "confirm", text: assistantCopy.recipeSaved(recipe.title) });

        window.setTimeout(() => {
          stopAssistantPlayback(true);
          void navigate({
            to: options.startCooking ? "/cook" : "/recipe-detail",
            search: { id: recipe.id },
          });
        }, 450);
      } catch (error) {
        setAssistantLoading(false);
        setAssistantStatus("idle");
        toast.error(error instanceof Error ? error.message : assistantCopy.recipeSaveFailed);
        pushAssistant({ kind: "guide", text: assistantCopy.recipeSaveFailed });
      }
    },
    [
      assistantCopy,
      latestRecipeDraftText,
      navigate,
      pushAssistant,
      stopAssistantPlayback,
      structureAndSaveRecipeDraft,
    ],
  );

  const handleOpenRecipe = useCallback(
    (chatRecipe: ChatRecipe) => {
      if (chatRecipe.source === "local" && recipeLookup.has(chatRecipe.id)) {
        stopAssistantPlayback(true);
        void navigate({ to: "/recipe-detail", search: { id: chatRecipe.id } });
        return;
      }

      if (chatRecipe.sourceUrl) {
        void importWebRecipe(chatRecipe, { openDetail: true });
        return;
      }

      pushAssistant({
        kind: "guide",
        text: assistantCopy.webResultOnly(chatRecipe.title),
      });
    },
    [assistantCopy, importWebRecipe, navigate, pushAssistant, recipeLookup, stopAssistantPlayback],
  );

  const handleStartCooking = useCallback(
    (chatRecipe: ChatRecipe) => {
      if (chatRecipe.source === "local" && recipeLookup.has(chatRecipe.id)) {
        pushAssistant({ kind: "confirm", text: assistantCopy.startLocalRecipe(chatRecipe.title) });
        window.setTimeout(() => {
          stopAssistantPlayback(true);
          void navigate({ to: "/cook", search: { id: chatRecipe.id } });
        }, 450);
        return;
      }

      if (chatRecipe.sourceUrl) {
        void importWebRecipe(chatRecipe, { startCooking: true });
        return;
      }

      pushAssistant({
        kind: "guide",
        text: assistantCopy.webCookGuide(chatRecipe.title),
      });
    },
    [assistantCopy, importWebRecipe, navigate, pushAssistant, recipeLookup, stopAssistantPlayback],
  );

  const handleAwakeReady = useCallback(() => {
    if (assistantRunRef.current || isAssistantLoading) return;
    pushAssistant({ kind: "confirm", text: assistantCopy.awakeReady });
  }, [assistantCopy.awakeReady, isAssistantLoading, pushAssistant]);

  const findRecipeNumber = useCallback((text: string) => {
    const normalized = text.toLowerCase();
    const numberMap = [
      /(第)?(1|一|①)(个|道)?/,
      /(第)?(2|二|两|②)(个|道)?/,
      /(第)?(3|三|③)(个|道)?/,
      /(第)?(4|四|④)(个|道)?/,
      /(第)?(5|五|⑤)(个|道)?/,
      /(第)?(6|六|⑥)(个|道)?/,
    ];
    const index = numberMap.findIndex((pattern) => pattern.test(normalized));
    return index >= 0 ? index : null;
  }, []);

  const buildRecipeCards = useCallback(
    async (query: string): Promise<ChatRecipe[]> => {
      const normalized = query.toLowerCase();
      const localMatches = recipes
        .filter((recipe) => {
          const values = [
            recipe.title,
            recipe.tags.cuisine,
            recipe.tags.flavor?.join(" "),
            recipe.ingredients.map((ingredient) => ingredient.name).join(" "),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return (
            values.includes(normalized) ||
            ["吃什么", "推荐", "辣", "川菜", "家常", "菜谱"].some((keyword) =>
              query.includes(keyword),
            )
          );
        })
        .slice(0, 3)
        .map(recipeToChatRecipe);

      if (localMatches.length > 0) return localMatches;

      return await fetchWebRecipeCards(query, language);
    },
    [language, recipes],
  );

  const handleCommand = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;

      const turnId = commandTurnRef.current + 1;
      commandTurnRef.current = turnId;
      shouldAutoScrollRef.current = true;
      const userMessage = addMessage({ role: "user", kind: "text", text });
      const conversationMessages = [...messages, userMessage];
      setAssistantLoading(true);
      setAssistantStatus("thinking");

      window.setTimeout(() => {
        void (async () => {
          if (commandTurnRef.current !== turnId) return;

          const selectedIndex = findRecipeNumber(text);
          const selectedRecipe = selectedIndex == null ? null : latestRecipes[selectedIndex];

          if (selectedRecipe && /(看|查看|详情|打开|介绍)/i.test(text)) {
            handleOpenRecipe(selectedRecipe);
            return;
          }

          if (selectedRecipe && /(开始|做|烹饪|煮)/i.test(text)) {
            handleStartCooking(selectedRecipe);
            return;
          }

          if (
            /(网页|网上|联网|搜索|搜一下|查一下|web|online|internet)/i.test(text) &&
            /(菜谱|食谱|做法|recipe|recipes|search|搜索|搜一下|查一下)/i.test(text)
          ) {
            const cards = await fetchWebRecipeCards(text, language);
            if (commandTurnRef.current !== turnId) return;
            setLatestRecipes(cards);
            pushAssistant({
              kind: cards.length > 0 ? "recipes" : "guide",
              text: cards.length > 0 ? assistantCopy.recommendations : assistantCopy.webSearchEmpty,
              recipes: cards,
            });
            return;
          }

          if (/(上传|保存|加入|添加).*(菜谱|菜谱库)|save.*recipe/i.test(text)) {
            if (!hasLlmKey) {
              promptConfigureLlmKey();
              return;
            }
            await handleSaveLatestRecipeDraft();
            return;
          }

          if (/(开始|进入).*(烹饪|烹调|做菜|cooking)|start cooking|cooking mode/i.test(text)) {
            const targetRecipe = selectedRecipe ?? latestRecipes[0];
            if (targetRecipe) {
              handleStartCooking(targetRecipe);
              return;
            }
            if (!hasLlmKey) {
              promptConfigureLlmKey();
              return;
            }
            await handleSaveLatestRecipeDraft({ startCooking: true });
            return;
          }

          if (/(导入|视频|新菜谱|import)/i.test(text)) {
            if (/(菜谱|菜谱库|recipe)/i.test(text) && !/(视频|video)/i.test(text)) {
              if (!hasLlmKey) {
                promptConfigureLlmKey();
                return;
              }
              await handleSaveLatestRecipeDraft();
              return;
            }
            const cards = await buildRecipeCards(text);
            if (commandTurnRef.current !== turnId) return;
            setLatestRecipes(cards);
            pushAssistant({
              kind: cards.length > 0 ? "recipes" : "guide",
              text:
                cards.length > 0 ? assistantCopy.importWithCards : assistantCopy.importWithoutCards,
              recipes: cards,
            });
            return;
          }

          if (/(设置|语速|声音|徽标|唤醒|settings)/i.test(text)) {
            const rateMatch = text.match(/(0\.8|1\.0|1|1\.2|1\.5|2)(\s*)倍/);
            if (rateMatch) {
              setSpeechRate(Number(rateMatch[1]));
              pushAssistant({ kind: "confirm", text: assistantCopy.rateChanged(rateMatch[1]) });
              return;
            }
            if (/隐藏.*(建议|徽标)|hide.*badge/i.test(text)) {
              toggleVoiceBadges(false);
              pushAssistant({ kind: "confirm", text: assistantCopy.badgesHidden });
              return;
            }
            pushAssistant({
              kind: "guide",
              text: assistantCopy.settingsGuide,
            });
            return;
          }

          if (/(打开|进入).*(设置|settings)/i.test(text)) {
            pushAssistant({ kind: "confirm", text: assistantCopy.openingSettings });
            window.setTimeout(() => {
              stopAssistantPlayback(true);
              void navigate({ to: "/settings" });
            }, 450);
            return;
          }

          if (/(菜谱库|我的菜谱|全部菜谱|recipes)/i.test(text)) {
            pushAssistant({ kind: "confirm", text: assistantCopy.openingRecipes });
            window.setTimeout(() => {
              stopAssistantPlayback(true);
              void navigate({ to: "/recipes" });
            }, 450);
            return;
          }

          if (/(换一批|推荐|吃什么|今晚|午饭|晚饭|早餐|辣|川菜|番茄炒蛋|红烧肉|水煮)/i.test(text)) {
            const cards = await buildRecipeCards(text);
            if (commandTurnRef.current !== turnId) return;
            setLatestRecipes(cards);
            if (cards.length === 0) {
              pushAssistant({
                kind: "guide",
                text: assistantCopy.noLocalRecipes,
              });
              return;
            }

            pushAssistant({
              kind: "recipes",
              text: assistantCopy.recommendations,
              recipes: cards,
            });
            return;
          }

          if (/^(是|好|可以|yes|ok)$/i.test(text) && latestRecipes[0]) {
            handleStartCooking(latestRecipes[0]);
            return;
          }

          if (/^(否|不用|待会|no)$/i.test(text)) {
            pushAssistant({
              kind: "text",
              text: assistantCopy.stayHere,
            });
            return;
          }

          if (!hasLlmKey) {
            promptConfigureLlmKey();
            return;
          }

          await streamAssistantTextReply(text, conversationMessages);
        })();
      }, 0);
    },
    [
      addMessage,
      buildRecipeCards,
      findRecipeNumber,
      handleSaveLatestRecipeDraft,
      handleOpenRecipe,
      handleStartCooking,
      assistantCopy,
      hasLlmKey,
      language,
      latestRecipes,
      messages,
      navigate,
      promptConfigureLlmKey,
      pushAssistant,
      recipes,
      setSpeechRate,
      stopAssistantPlayback,
      streamAssistantTextReply,
      toggleVoiceBadges,
    ],
  );

  useEffect(() => {
    const handleHomeAwake = (event: Event) => {
      const transcript =
        (event as CustomEvent<HomeAwakeDetail>).detail?.transcript?.trim() ?? "";
      if (transcript) {
        handleCommand(transcript);
        return;
      }
      handleAwakeReady();
    };

    const handleHomeTranscript = (event: Event) => {
      handleCommand((event as CustomEvent<{ transcript: string }>).detail.transcript);
    };

    window.addEventListener("cooktalk:home-awake", handleHomeAwake);
    window.addEventListener("cooktalk:home-transcript", handleHomeTranscript);
    return () => {
      window.removeEventListener("cooktalk:home-awake", handleHomeAwake);
      window.removeEventListener("cooktalk:home-transcript", handleHomeTranscript);
    };
  }, [handleAwakeReady, handleCommand]);

  useEffect(() => {
    if (!pendingHomeAwake) return;
    const transcript = pendingHomeAwake.transcript.trim();
    clearHomeAwake();
    if (transcript) handleCommand(transcript);
    else triggerManualWake();
  }, [clearHomeAwake, handleCommand, pendingHomeAwake, triggerManualWake]);

  const submitText = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    handleCommand(text);
  };

  const clearConversation = () => {
    commandTurnRef.current += 1;
    setMessages([]);
    setLatestRecipes([]);
    stopAssistantPlayback(false);
    toast.success(assistantCopy.clearSuccess);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <SiteHeader />

      <main className="relative flex flex-1 overflow-hidden bg-[radial-gradient(circle_at_18%_0%,oklch(0.985_0.008_80),transparent_18rem),radial-gradient(circle_at_16%_22%,oklch(0.86_0.08_70_/_0.32),transparent_30rem),radial-gradient(circle_at_86%_18%,oklch(0.74_0.07_48_/_0.16),transparent_26rem),linear-gradient(180deg,oklch(0.985_0.008_80)_0%,oklch(0.965_0.018_78)_45%,oklch(0.94_0.025_76)_100%)] dark:bg-[radial-gradient(circle_at_18%_0%,oklch(0.18_0.01_60),transparent_18rem),radial-gradient(circle_at_18%_16%,oklch(0.55_0.05_55_/_0.16),transparent_28rem),radial-gradient(circle_at_82%_12%,oklch(0.78_0.05_75_/_0.1),transparent_24rem),linear-gradient(180deg,oklch(0.18_0.01_60)_0%,oklch(0.17_0.012_60)_45%,oklch(0.14_0.01_60)_100%)]">
        <div className="absolute inset-0 grain opacity-50" aria-hidden />
        <div
          className="absolute left-1/2 top-20 h-72 w-72 -translate-x-1/2 rounded-full bg-accent/25 blur-3xl"
          aria-hidden
        />
        <div
          className="absolute -bottom-36 right-[-7rem] h-96 w-96 rounded-full bg-clay/10 blur-3xl"
          aria-hidden
        />

        <section className="relative flex h-full w-full flex-1 flex-col pt-2 sm:pt-3">
          {shouldShowWakeTip && (
            <div className="mx-auto w-full max-w-[760px] px-3 sm:px-6">
              <StatusPanel
                label={t("home.wakeTip", { wakeWord: t("app.wakeWord") })}
                onManualWake={() => {
                  if (hasElevenLabsKey) triggerManualWake();
                  else promptConfigureElevenLabsKey();
                }}
              />
            </div>
          )}

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain py-3 sm:py-4"
            onScroll={handleConversationScroll}
          >
            {messages.length === 0 ? (
              <WelcomePanel />
            ) : (
              <div className="mx-auto w-full max-w-[980px] space-y-4 px-3 pb-4 sm:px-6">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onOpenRecipe={handleOpenRecipe}
                    onStartCooking={handleStartCooking}
                    onToggleAudio={() => toggleAssistantAudio(message.id)}
                    isAudioMuted={mutedMessageId === message.id}
                  />
                ))}
                {isAssistantLoading && <AssistantLoadingBubble />}
              </div>
            )}
          </div>

          <div className="z-10 shrink-0 px-2 pb-2 pt-1 sm:px-6 sm:pb-3">
            <div
              className={cn(
                "relative mx-auto w-full max-w-[760px]",
                isConversationActive && "pt-12 sm:pt-8",
              )}
            >
              {isConversationActive && (
                <div className="group/clear absolute left-1/2 top-0 z-20 flex h-10 w-full max-w-[220px] -translate-x-1/2 items-center justify-center">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 w-full gap-1.5 rounded-full border border-border/80 bg-card/95 px-3 text-xs opacity-100 shadow-sm backdrop-blur transition-all duration-150 sm:translate-y-1 sm:opacity-0 sm:pointer-events-none sm:group-hover/clear:translate-y-0 sm:group-hover/clear:opacity-100 sm:group-hover/clear:pointer-events-auto sm:focus-visible:translate-y-0 sm:focus-visible:opacity-100 sm:focus-visible:pointer-events-auto"
                    onClick={clearConversation}
                    aria-label={t("home.chat.clearConversation")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("home.chat.clearConversation")}
                  </Button>
                </div>
              )}
              <form
                onSubmit={submitText}
                className="flex w-full items-center gap-1.5 rounded-[1.5rem] border border-border/80 bg-card/80 p-1.5 shadow-[0_16px_50px_-24px_oklch(0.28_0.02_60_/_0.32),var(--shadow-soft)] backdrop-blur-xl sm:gap-2 sm:rounded-[1.75rem]"
              >
                <Input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={assistantCopy.inputPlaceholder}
                  className="h-10 flex-1 rounded-full border-0 bg-background/55 px-4 text-sm shadow-none focus-visible:ring-1 sm:h-11 sm:px-5 sm:text-base md:text-base"
                />
                <Button
                  type={input.trim() ? "submit" : "button"}
                  size="icon"
                  onClick={() => {
                    if (!input.trim()) {
                      if (hasElevenLabsKey) triggerManualWake();
                      else promptConfigureElevenLabsKey();
                    }
                  }}
                  className={cn(
                    "h-10 w-10 shrink-0 rounded-full transition-all sm:h-12 sm:w-12",
                    currentStatus === "recording" || currentStatus === "awake"
                      ? "scale-105 animate-pulse border-clay/40 bg-accent/35 text-clay shadow-[0_10px_24px_-16px_oklch(0.48_0.04_55_/_0.45)]"
                      : "border-border/70 bg-background/80 text-foreground shadow-[0_10px_24px_-16px_oklch(0.28_0.02_60_/_0.35)] hover:border-clay/40 hover:bg-background hover:text-clay",
                  )}
                  aria-label={
                    input.trim() ? assistantCopy.sendLabel : assistantCopy.manualWakeLabel
                  }
                >
                  {input.trim() ? (
                    <Send className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
                  ) : (
                    <Mic className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
                  )}
                </Button>
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusPanel({ label, onManualWake }: { label: string; onManualWake: () => void }) {
  return (
    <button
      type="button"
      className="z-20 mx-auto flex w-full items-center justify-center gap-2 rounded-full border border-border/80 bg-card/75 px-4 py-2 text-sm font-medium shadow-[var(--shadow-soft)] backdrop-blur-xl transition-colors hover:border-clay/60 hover:text-clay sm:w-fit"
      onClick={onManualWake}
      aria-label={label}
    >
      <Mic className="h-4 w-4 text-clay" />
      <span>{label}</span>
    </button>
  );
}

function WelcomePanel() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full items-center justify-center px-4 pb-4 text-center">
      <div className="flex flex-col items-center">
        <div className="relative">
          <div
            className="absolute inset-[-1.75rem] rounded-full bg-accent/25 blur-2xl"
            aria-hidden
          />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-[2rem] border border-border/80 bg-card/70 shadow-[var(--shadow-warm)] backdrop-blur-xl sm:h-28 sm:w-28">
            <img
              src="/logo.png"
              alt="CookTalk logo"
              className="h-16 w-16 rounded-full object-contain dark:hidden"
            />
            <img
              src="/logo-dark.png"
              alt="CookTalk logo"
              className="hidden h-16 w-16 rounded-full object-contain dark:block"
            />
          </div>
        </div>
        <h2 className="mt-6 font-display text-[clamp(2rem,9vw,2.75rem)] font-semibold tracking-tight text-foreground sm:text-4xl">
          CookTalk
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("home.chat.emptyPrompt")}</p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onOpenRecipe,
  onStartCooking,
  onToggleAudio,
  isAudioMuted,
}: {
  message: ChatMessage;
  onOpenRecipe: (recipe: ChatRecipe) => void;
  onStartCooking: (recipe: ChatRecipe) => void;
  onToggleAudio: () => void;
  isAudioMuted: boolean;
}) {
  const { t, i18n: activeI18n } = useTranslation();
  const isUser = message.role === "user";
  const isSystem = message.role === "system" || message.kind === "system";
  const assistantText = message.displayText ?? message.text;
  const hasAssistantText = assistantText.trim().length > 0;

  if (isSystem) {
    return (
      <div className="mx-auto max-w-md rounded-full border border-border bg-secondary px-4 py-2 text-center text-xs text-muted-foreground">
        {message.text}
      </div>
    );
  }

  if (isUser) {
    return (
      <article className="group flex justify-end">
        <div className="max-w-[88%] text-right sm:max-w-[68%]">
          <p className="whitespace-pre-line break-words px-1 text-sm leading-6 text-foreground sm:text-base md:text-base">
            {message.text}
          </p>
          <time className="mt-1 block text-[11px] text-muted-foreground opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            {formatTime(message.createdAt, activeI18n.language)}
          </time>
        </div>
      </article>
    );
  }

  if (!hasAssistantText && !message.recipes?.length && !message.progress) {
    return null;
  }

  return (
    <article className="group flex flex-col items-start">
      <div className="w-full max-w-full rounded-[1.5rem] border border-border bg-card p-4 shadow-sm sm:max-w-[88%]">
        {hasAssistantText && (
          <p className="whitespace-pre-line break-words font-sans text-sm leading-6 text-foreground sm:text-base md:text-base">
            {assistantText}
          </p>
        )}

        {message.progress && (
          <RecipeImportProgressPanel
            progress={message.progress}
            className={cn(hasAssistantText && "mt-4")}
          />
        )}

        {message.recipes && message.recipes.length > 0 && (
          <div className={cn("space-y-3", (hasAssistantText || message.progress) && "mt-4")}>
            {message.recipes.map((recipe, index) => (
              <RecipeResultCard
                key={`${recipe.id}-${index}`}
                recipe={recipe}
                index={index}
                onOpen={() => onOpenRecipe(recipe)}
                onStart={() => onStartCooking(recipe)}
              />
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              {t("home.chat.recipeSuggestion")}
            </p>
          </div>
        )}

      </div>
      {message.isReading && !isUser && hasAssistantText && (
        <div className="ml-3 mt-2">
          <ReadingIndicator isMuted={isAudioMuted} onToggleAudio={onToggleAudio} />
        </div>
      )}
      <time className="ml-3 mt-1 text-[11px] text-muted-foreground opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        {formatTime(message.createdAt, activeI18n.language)}
      </time>
    </article>
  );
}

function RecipeImportProgressPanel({
  progress,
  className,
}: {
  progress: RecipeImportProgress;
  className?: string;
}) {
  const completed = progress.steps.filter((step) => step.status === "done").length;
  const activeIndex = progress.steps.findIndex((step) => step.status === "active");
  const visualProgress =
    ((activeIndex >= 0 ? activeIndex + 0.45 : completed) / progress.steps.length) * 100;

  return (
    <div className={cn("rounded-2xl border border-border bg-background/70 p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{progress.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{progress.detail}</p>
        </div>
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-clay" />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-clay transition-all duration-300"
          style={{ width: `${Math.max(8, Math.min(100, visualProgress))}%` }}
        />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {progress.steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]",
              step.status === "done" &&
                "border-clay/20 bg-accent/35 font-medium text-clay",
              step.status === "active" &&
                "border-clay/35 bg-background font-medium text-foreground shadow-sm",
              step.status === "pending" &&
                "border-border/70 bg-secondary/50 text-muted-foreground",
            )}
          >
            {step.status === "done" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : step.status === "active" ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-current opacity-40" />
            )}
            <span className="truncate">{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssistantLoadingBubble() {
  const { t } = useTranslation();

  return (
    <article className="flex flex-col items-start" aria-live="polite" aria-label={t("home.chat.loadingReply")}>
      <div className="rounded-[1.5rem] border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5 py-1" aria-hidden>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="h-2 w-2 animate-bounce rounded-full bg-clay"
              style={{ animationDelay: `${index * 140}ms` }}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

function RecipeResultCard({
  recipe,
  index,
  onOpen,
  onStart,
}: {
  recipe: ChatRecipe;
  index: number;
  onOpen: () => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="animate-in slide-in-from-bottom-2 fade-in rounded-2xl border border-border bg-background/80 p-3 duration-200">
      <div className="grid grid-cols-[auto_56px] gap-3 sm:grid-cols-[auto_56px_minmax(0,1fr)]">
        <div className="pt-1 font-display text-lg text-clay">
          {NUMBER_SYMBOLS[index] ?? index + 1}
        </div>
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-accent/60 to-secondary text-clay">
          <ChefHat className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="truncate font-sans text-lg font-semibold leading-tight tracking-normal">
              {recipe.title}
            </h3>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              {recipe.source === "local"
                ? `📚 ${t("home.chat.localRecipe")}`
                : `🌐 ${t("home.chat.webRecipe")}`}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>
              🌶️{" "}
              {recipe.source === "web"
                ? t("home.chat.webResultFlavor")
                : recipe.flavor || t("home.chat.neutralFlavor")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t("recipes.minutes", { count: recipe.totalTimeMin ?? 30 })}
            </span>
            {recipe.cuisine && <span>{recipe.cuisine}</span>}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 rounded-full px-3 sm:min-w-[72px]"
              onClick={onOpen}
            >
              {t("home.chat.open")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full px-3 sm:min-w-[72px]"
              onClick={onStart}
            >
              {t("home.chat.startCooking")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Waveform({ active, className }: { active: boolean; className?: string }) {
  return (
    <div className={cn("flex h-5 items-center gap-1 text-clay", className)} aria-hidden>
      {Array.from({ length: 18 }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "block w-1 rounded-full bg-current opacity-60",
            active ? "animate-pulse" : "h-0.5",
          )}
          style={{
            height: active ? `${6 + ((index * 7) % 14)}px` : undefined,
            animationDelay: `${index * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}

function ReadingIndicator({
  isMuted,
  onToggleAudio,
}: {
  isMuted: boolean;
  onToggleAudio: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-clay/12 bg-card/95 py-1 pl-3 pr-1 text-xs text-secondary-foreground shadow-sm backdrop-blur-sm">
      <Waves className="h-3.5 w-3.5 animate-pulse text-clay/85" />
      {isMuted ? t("home.chat.mutedReading") : t("home.chat.reading")}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full bg-transparent text-clay/90 hover:bg-transparent hover:text-clay"
        onClick={onToggleAudio}
        aria-label={isMuted ? t("home.chat.unmuteReading") : t("home.chat.muteReading")}
      >
        {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
async function fetchWebRecipeCards(query: string, language: AppLanguage): Promise<ChatRecipe[]> {
  const cleaned = cleanRecipeSearchKeyword(query);
  const keyword = cleaned || i18n.t("home.chat.fallbackSearchKeyword", { lng: language });

  try {
    const url = new URL("/api/web-recipe-search", window.location.origin);
    url.searchParams.set("q", keyword);
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = (await response.json()) as WebRecipeSearchResponse;
    return (data.results ?? [])
      .filter(
        (result): result is { title: string; url: string; source?: string } =>
          typeof result.title === "string" &&
          result.title.trim().length > 0 &&
          typeof result.url === "string" &&
          /^https?:\/\//i.test(result.url),
      )
      .slice(0, 3)
      .map((result, index) => ({
        id: `web-${encodeURIComponent(result.url)}-${index}`,
        title: result.title.trim(),
        source: "web",
        flavor: i18n.t("home.chat.webResultFlavor", { lng: language }),
        totalTimeMin: undefined,
        cuisine:
          typeof result.source === "string"
            ? result.source
            : i18n.t("home.chat.webSourceDefault", { lng: language }),
        sourceUrl: result.url,
      }));
  } catch {
    return [];
  }
}

async function fetchWebRecipeContent(sourceUrl: string): Promise<{
  title: string;
  url: string;
  text: string;
}> {
  const url = new URL("/api/web-recipe-content", window.location.origin);
  url.searchParams.set("url", sourceUrl);

  const response = await fetch(url);
  const data = (await response.json().catch(() => ({}))) as WebRecipeContentResponse;

  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : "Failed to fetch recipe page";
    throw new Error(message);
  }

  if (typeof data.text !== "string" || !data.text.trim()) {
    throw new Error("Recipe page did not contain readable recipe text");
  }

  return {
    title: typeof data.title === "string" ? data.title.trim() : "",
    url: typeof data.url === "string" ? data.url : sourceUrl,
    text: data.text.trim(),
  };
}

function cleanRecipeSearchKeyword(query: string): string {
  const cleaned = query
    .replace(
      /(帮我|给我|请|找找|找一下|找|查查|查一下|搜一下|搜索|推荐|换一批|菜谱|食谱|做法|今晚|午饭|晚饭|早餐|吃什么|怎么做|如何做|怎么煮|如何煮)/g,
      "",
    )
    .replace(/[，。！？、,.!?;；:："'“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length % 2 === 0) {
    const half = cleaned.length / 2;
    const left = cleaned.slice(0, half);
    if (left && left === cleaned.slice(half)) return left;
  }

  return cleaned;
}

function formatTime(date: Date, language: string) {
  return date.toLocaleTimeString(language.startsWith("zh") ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function recipeToChatRecipe(recipe: Recipe): ChatRecipe {
  return {
    id: recipe.id,
    title: recipe.title,
    source: "local",
    flavor: recipe.tags.flavor?.[0],
    totalTimeMin: recipe.tags.totalTimeMin,
    cuisine: recipe.tags.cuisine,
  };
}
