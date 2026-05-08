import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ChefHat,
  Clock,
  Mic,
  MicOff,
  Send,
  Settings,
  Trash2,
  Volume2,
  VolumeX,
  Waves,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/site-header";
import { db, type Recipe } from "@/lib/db";
import { getConfiguredLLMService } from "@/lib/llm";
import { synthesizeWithElevenLabs } from "@/lib/voice-pipeline";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { VoiceStatus } from "@/lib/voice-pipeline";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CookTalk — 对话工作台" },
      {
        name: "description",
        content: "和 CookTalk 语音或文字对话，搜索菜谱、获取推荐，并跳转到详情、导入或烹饪模式。",
      },
      { property: "og:title", content: "CookTalk — 对话工作台" },
      {
        property: "og:description",
        content: "首页只承载对话：语音、文字、菜谱卡片和明确的功能跳转。",
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

type ChatRecipe = {
  id: string;
  title: string;
  source: "local" | "web";
  flavor?: string;
  totalTimeMin?: number;
  cuisine?: string;
  sourceUrl?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "recipes" | "confirm" | "guide" | "system";
  text: string;
  createdAt: Date;
  recipes?: ChatRecipe[];
  isReading?: boolean;
};

type AppLanguage = "en" | "zh";

const WEB_RECIPE_SEEDS = ["家常做法", "下饭菜", "快手菜"];
const NUMBER_SYMBOLS = ["①", "②", "③", "④", "⑤", "⑥"];
const EMPTY_RECIPES: Recipe[] = [];
const KITCHEN_ASSISTANT_SYSTEM_PROMPTS: Record<AppLanguage, string> = {
  zh: "你是 CookTalk，一个聪明、自然、可靠的中文厨房做菜 AI 助手。你的主场是厨房：菜谱推荐、食材搭配、火候判断、调味比例、替代食材、备菜流程、烹饪故障补救、厨房安全和省时技巧。用户寒暄时要自然回应并主动给出可问方向；用户问题不完整时，先给可执行建议，再问一个最关键的澄清问题。回答要像真人厨房搭子，避免死板模板；通常控制在 2 到 5 句话。必须使用简体中文回答。不要输出 Markdown 表格。涉及食品安全时要明确提醒风险。",
  en: "You are CookTalk, a smart, natural, reliable AI cooking assistant. Your home turf is the kitchen: recipe ideas, ingredient pairing, heat control, seasoning ratios, substitutions, prep flow, cooking rescue, kitchen safety, and time-saving tips. Reply naturally to greetings and proactively suggest what the user can ask. If the user's request is incomplete, give practical advice first, then ask one key clarifying question. Sound like a helpful kitchen partner, not a rigid script. Usually answer in 2 to 5 sentences. You must answer in English. Do not output Markdown tables. Be explicit about food-safety risks.",
};
const ASSISTANT_COPY: Record<AppLanguage, {
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
  recommendations: string;
  stayHere: string;
  emptyReply: string;
  clearSuccess: string;
  inputPlaceholder: string;
  sendLabel: string;
  manualWakeLabel: string;
}> = {
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
    webCookGuide: (title) => `「${title}」来自网页搜索，当前只能查看；开始烹饪请先从已有菜谱中选择。`,
    importWithCards: "对话里我不直接导入菜谱。可以先从已有菜谱或网页搜索结果里选一个：",
    importWithoutCards: "对话里我不直接导入菜谱。你可以说菜名或口味，我会给出已有菜谱或网页搜索结果供你选择。",
    rateChanged: (rate) => `✓ 语速已调整为 ${rate} 倍。`,
    badgesHidden: "✓ 已隐藏语音徽标和建议提示。",
    settingsGuide: "设置项我可以帮你调整。你可以直接说“进入设置”“语速调到 1.2 倍”，或说“不用”继续留在这里。",
    openingSettings: "好的，打开设置。",
    openingRecipes: "好的，打开你的菜谱库。",
    noLocalRecipes: "当前没有匹配的本地菜谱。你可以换个菜名或口味，我会继续给你网页搜索结果。",
    recommendations: "根据你的菜谱库和当前口味，我推荐这几道：",
    stayHere: "好的，我会留在这里。需要时直接说菜名、口味，或让我从网页搜索菜谱。",
    emptyReply: "我刚才没组织好回答，你可以换个说法再问一次，我会按做菜场景继续帮你。",
    clearSuccess: "已清空当前对话",
    inputPlaceholder: "输入文字（或直接说话）...",
    sendLabel: "发送",
    manualWakeLabel: "手动唤醒麦克风",
  },
  en: {
    llmKeyRequired: "Please configure an LLM API key in Settings to use the smart kitchen assistant.",
    elevenLabsKeyRequired: "Please configure an ElevenLabs API key in Settings to use voice conversation.",
    settingsAction: "Settings",
    voiceGenFailed: "Voice generation failed, so I switched to text reply",
    voicePlayFailed: "Voice playback failed",
    assistantUnavailable: "The smart kitchen assistant is temporarily unavailable. Please try again later.",
    openedWebResult: (title) => `Opened web search results for “${title}”.`,
    webResultOnly: (title) => `“${title}” is from web search. Please view it in the browser first.`,
    startLocalRecipe: (title) => `Great, starting “${title}”.`,
    openedWebCookGuide: (title) => `Opened the web result for “${title}”. To start cooking, choose a recipe from your saved library.`,
    webCookGuide: (title) => `“${title}” is from web search and can only be viewed for now. To start cooking, choose a saved recipe first.`,
    importWithCards: "I don't import recipes directly from chat. Pick one from your saved recipes or web results first:",
    importWithoutCards: "I don't import recipes directly from chat. Tell me a dish or flavor, and I'll suggest saved recipes or web results to choose from.",
    rateChanged: (rate) => `✓ Speech rate set to ${rate}x.`,
    badgesHidden: "✓ Voice badges and suggestion hints are now hidden.",
    settingsGuide: "I can help with settings. Say “open settings”, “set speech rate to 1.2x”, or “not now” to stay here.",
    openingSettings: "Sure, opening Settings.",
    openingRecipes: "Sure, opening your recipe library.",
    noLocalRecipes: "No matching saved recipes right now. Try another dish or flavor, and I can continue with web results.",
    recommendations: "Based on your recipe library and current taste, I recommend these:",
    stayHere: "Sure, I'll stay here. When ready, tell me a dish, flavor, or ask me to search recipes from the web.",
    emptyReply: "I didn't phrase that well. Ask again another way, and I'll help in a cooking-focused way.",
    clearSuccess: "Current conversation cleared",
    inputPlaceholder: "Type a message (or just speak)...",
    sendLabel: "Send",
    manualWakeLabel: "Wake microphone manually",
  },
};

type KitchenAssistantOptions = {
  text: string;
  messages: ChatMessage[];
  recipes: Recipe[];
  language: AppLanguage;
};

function buildRecipeLibraryContext(recipes: Recipe[], language: AppLanguage): string {
  if (recipes.length === 0) {
    return language === "zh" ? "当前用户本地菜谱库为空。" : "The user's saved recipe library is empty.";
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

function HomePage() {
  const navigate = useNavigate();
  const liveRecipes = useLiveQuery(() => db.recipes.orderBy("createdAt").reverse().toArray(), []);
  const recipes = liveRecipes ?? EMPTY_RECIPES;
  const wakeWords = useAppStore((s) => s.wakeWords);
  const listenMode = useAppStore((s) => s.listenMode);
  const triggerManualWake = useAppStore((s) => s.triggerManualWake);
  const setSpeechRate = useAppStore((s) => s.setSpeechRate);
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
  const [mutedMessageId, setMutedMessageId] = useState<string | null>(null);
  const [isAssistantLoading, setAssistantLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const assistantRunRef = useRef<string | null>(null);
  const commandTurnRef = useRef(0);

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
  const isMuted = voiceDetail?.isMuted ?? false;
  const wakeWord = wakeWords[0] || "Hey CookTalk";

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [isAssistantLoading, messages]);

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

  const stopAssistantPlayback = useCallback(
    (finishActiveMessage = false) => {
      assistantRunRef.current = null;

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
        updateMessage(activeAssistantMessageIdRef.current, { isReading: false });
      }

      activeAssistantMessageIdRef.current = null;
      setMutedMessageId(null);
      setAssistantLoading(false);
      setAssistantStatus("idle");
    },
    [updateMessage],
  );

  useEffect(() => {
    return () => {
      stopAssistantPlayback(false);
    };
  }, [stopAssistantPlayback]);

  const pushAssistant = useCallback(
    (message: Omit<ChatMessage, "id" | "createdAt" | "role">) => {
      stopAssistantPlayback(true);

      const runId = crypto.randomUUID();
      const fullText = message.text;
      assistantRunRef.current = runId;
      setAssistantLoading(true);
      setAssistantStatus("thinking");

      void (async () => {
        let audio: HTMLAudioElement | null = null;
        let audioUrl: string | null = null;

        try {
          if (fullText && hasElevenLabsKey) {
            const audioBlob = await synthesizeWithElevenLabs(fullText, conversationVoiceId);
            if (assistantRunRef.current !== runId) return;
            audioUrl = URL.createObjectURL(audioBlob);
            audio = new Audio(audioUrl);
            audioRef.current = audio;
            audioUrlRef.current = audioUrl;
          }
        } catch (error: unknown) {
          if (assistantRunRef.current !== runId) return;
          toast.error(error instanceof Error ? error.message : assistantCopy.voiceGenFailed);
        }

        if (assistantRunRef.current !== runId) {
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          return;
        }

        const nextMessage = addMessage({
          ...message,
          role: "assistant",
          text: fullText,
          isReading: !!audio,
        });
        activeAssistantMessageIdRef.current = nextMessage.id;
        setAssistantLoading(false);

        const audioDone = audio
          ? new Promise<void>((resolve) => {
              setAssistantStatus("speaking");
              audio.onended = () => resolve();
              audio.onerror = () => resolve();
              audio.play().catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : assistantCopy.voicePlayFailed);
                resolve();
              });
            })
          : Promise.resolve();

        await audioDone;

        if (assistantRunRef.current !== runId || activeAssistantMessageIdRef.current !== nextMessage.id) return;
        updateMessage(nextMessage.id, { isReading: false, text: fullText });

        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
        audioRef.current = null;
        activeAssistantMessageIdRef.current = null;
        assistantRunRef.current = null;
        setMutedMessageId(null);
        setAssistantStatus("idle");
      })();

      return null;
    },
    [
      addMessage,
      conversationVoiceId,
      hasElevenLabsKey,
      stopAssistantPlayback,
      updateMessage,
      assistantCopy,
    ],
  );

  const toggleAssistantAudio = useCallback((messageId: string) => {
    const audio = audioRef.current;
    if (!audio || activeAssistantMessageIdRef.current !== messageId) return;

    audio.muted = !audio.muted;
    setMutedMessageId(audio.muted ? messageId : null);
  }, []);

  const handleOpenRecipe = useCallback(
    (chatRecipe: ChatRecipe) => {
      if (chatRecipe.source === "local" && recipeLookup.has(chatRecipe.id)) {
        void navigate({ to: "/recipe-detail", search: { id: chatRecipe.id } });
        return;
      }

      if (chatRecipe.sourceUrl) {
        window.open(chatRecipe.sourceUrl, "_blank", "noopener,noreferrer");
        pushAssistant({
          kind: "confirm",
          text: assistantCopy.openedWebResult(chatRecipe.title),
        });
        return;
      }

      pushAssistant({
        kind: "guide",
        text: assistantCopy.webResultOnly(chatRecipe.title),
      });
    },
    [assistantCopy, navigate, pushAssistant, recipeLookup],
  );

  const handleStartCooking = useCallback(
    (chatRecipe: ChatRecipe) => {
      if (chatRecipe.source === "local" && recipeLookup.has(chatRecipe.id)) {
        pushAssistant({ kind: "confirm", text: assistantCopy.startLocalRecipe(chatRecipe.title) });
        window.setTimeout(() => {
          void navigate({ to: "/cook", search: { id: chatRecipe.id } });
        }, 450);
        return;
      }

      if (chatRecipe.sourceUrl) {
        window.open(chatRecipe.sourceUrl, "_blank", "noopener,noreferrer");
        pushAssistant({
          kind: "guide",
          text: assistantCopy.openedWebCookGuide(chatRecipe.title),
        });
        return;
      }

      pushAssistant({
        kind: "guide",
        text: assistantCopy.webCookGuide(chatRecipe.title),
      });
    },
    [assistantCopy, navigate, pushAssistant, recipeLookup],
  );

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
    (query: string): ChatRecipe[] => {
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

      return buildWebRecipeCards(query);
    },
    [recipes],
  );

  const handleCommand = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      if (!hasLlmKey) {
        promptConfigureLlmKey();
        return;
      }

      const turnId = commandTurnRef.current + 1;
      commandTurnRef.current = turnId;
      const userMessage = addMessage({ role: "user", kind: "text", text });
      const conversationMessages = [...messages, userMessage];
      setAssistantLoading(true);
      setAssistantStatus("thinking");

      window.setTimeout(() => {
        void (async () => {
        if (/(导入|视频|新菜谱|import)/i.test(text)) {
          const cards = buildRecipeCards(text);
          setLatestRecipes(cards);
          pushAssistant({
            kind: cards.length > 0 ? "recipes" : "guide",
            text: cards.length > 0 ? assistantCopy.importWithCards : assistantCopy.importWithoutCards,
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
          window.setTimeout(() => void navigate({ to: "/settings" }), 450);
          return;
        }

        if (/(菜谱库|我的菜谱|全部菜谱|recipes)/i.test(text)) {
          pushAssistant({ kind: "confirm", text: assistantCopy.openingRecipes });
          window.setTimeout(() => void navigate({ to: "/recipes" }), 450);
          return;
        }

        const selectedIndex = findRecipeNumber(text);
        const selectedRecipe = selectedIndex == null ? null : latestRecipes[selectedIndex];
        if (selectedRecipe && /(开始|做|烹饪|煮)/i.test(text)) {
          handleStartCooking(selectedRecipe);
          return;
        }

        if (selectedRecipe && /(看|详情|打开|介绍)/i.test(text)) {
          handleOpenRecipe(selectedRecipe);
          return;
        }

        if (/(换一批|推荐|吃什么|今晚|午饭|晚饭|早餐|辣|川菜|番茄炒蛋|红烧肉|水煮)/i.test(text)) {
          const cards = buildRecipeCards(text);
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

          const reply = await answerKitchenAssistant({
            text,
            messages: conversationMessages,
            recipes,
            language,
          }).catch((error: unknown) => {
            if (error instanceof Error) toast.error(error.message);
            else toast.error(assistantCopy.assistantUnavailable);
            return null;
          });
          if (commandTurnRef.current !== turnId) return;
          if (!reply) {
            setAssistantLoading(false);
            setAssistantStatus("idle");
            return;
          }
          pushAssistant({ kind: "text", text: reply });
        })();
      }, 420);
    },
    [
      addMessage,
      buildRecipeCards,
      findRecipeNumber,
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
      toggleVoiceBadges,
    ],
  );

  useEffect(() => {
    const handleHomeTranscript = (event: Event) => {
      handleCommand((event as CustomEvent<{ transcript: string }>).detail.transcript);
    };

    window.addEventListener("cooktalk:home-transcript", handleHomeTranscript);
    return () => window.removeEventListener("cooktalk:home-transcript", handleHomeTranscript);
  }, [handleCommand]);

  const submitText = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    if (!hasLlmKey) {
      promptConfigureLlmKey();
      return;
    }
    setInput("");
    handleCommand(text);
  };

  const clearConversation = () => {
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
                status={currentStatus}
                wakeWord={wakeWord}
                listenMode={listenMode}
                isMuted={isMuted}
                onManualWake={() => {
                  if (hasElevenLabsKey) triggerManualWake();
                  else promptConfigureElevenLabsKey();
                }}
                onClear={clearConversation}
              />
            </div>
          )}

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-3 sm:py-4">
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
            <form
              onSubmit={submitText}
              className="mx-auto flex w-full max-w-[760px] items-center gap-1.5 rounded-[1.5rem] border border-border/80 bg-card/80 p-1.5 shadow-[0_16px_50px_-24px_oklch(0.28_0.02_60_/_0.32),var(--shadow-soft)] backdrop-blur-xl sm:gap-2 sm:rounded-[1.75rem]"
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
                    ? "scale-105 animate-pulse bg-clay text-primary-foreground"
                    : "bg-foreground text-background hover:bg-clay",
                )}
                aria-label={input.trim() ? assistantCopy.sendLabel : assistantCopy.manualWakeLabel}
              >
                {input.trim() ? (
                  <Send className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
                ) : (
                  <Mic className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
                )}
              </Button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusPanel({
  status,
  wakeWord,
  listenMode,
  isMuted,
  onManualWake,
  onClear,
}: {
  status: AssistantStatus;
  wakeWord: string;
  listenMode: "always" | "wake-word";
  isMuted: boolean;
  onManualWake: () => void;
  onClear: () => void;
}) {
  const state = getStatusCopy(status, listenMode);

  return (
    <div className="z-20 rounded-[1.5rem] border border-border/80 bg-card/75 px-3 py-2.5 shadow-[var(--shadow-soft)] backdrop-blur-xl sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-clay",
                state.animated && "animate-pulse",
              )}
            >
              {status === "speaking" ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-base font-semibold leading-tight sm:text-lg">
                {isMuted ? "麦克风已静音" : state.title}
              </h1>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {state.subtitle || `当前唤醒词：${wakeWord}`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={onManualWake}
            aria-label="手动麦克风"
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={onClear}
            aria-label="清空对话"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            aria-label="设置"
          >
            <Link to="/settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function WelcomePanel() {
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
        <h2 className="mt-6 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          CookTalk
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">说出唤醒词，或从底部输入开始</p>
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
  const isUser = message.role === "user";
  const isSystem = message.role === "system" || message.kind === "system";

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
        <div className="max-w-[78%] text-right sm:max-w-[68%]">
          <p className="whitespace-pre-line break-words px-1 text-sm leading-6 text-foreground sm:text-base md:text-base">
            {message.text}
          </p>
          <time className="mt-1 block text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {formatTime(message.createdAt)}
          </time>
        </div>
      </article>
    );
  }

  return (
    <article className="group flex flex-col items-start">
      <div className="w-full max-w-[92%] rounded-[1.5rem] border border-border bg-card p-4 shadow-sm sm:max-w-[88%]">
        <p className="min-h-7 whitespace-pre-line text-sm leading-7">{message.text}</p>

        {message.recipes && message.recipes.length > 0 && (
          <div className="mt-4 space-y-3">
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
              💡 说“开始做第二个”或“看看第一个详情”
            </p>
          </div>
        )}

        {message.isReading && !isUser && <ReadingIndicator isMuted={isAudioMuted} onToggleAudio={onToggleAudio} />}
      </div>
      <time className="ml-3 mt-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {formatTime(message.createdAt)}
      </time>
    </article>
  );
}

function AssistantLoadingBubble() {
  return (
    <article className="flex flex-col items-start" aria-live="polite" aria-label="AI 正在生成回复">
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
  return (
    <div className="animate-in slide-in-from-bottom-2 fade-in rounded-2xl border border-border bg-background/80 p-3 duration-200">
      <div className="grid grid-cols-[auto_56px_minmax(0,1fr)] gap-3">
        <div className="pt-1 font-display text-lg text-clay">
          {NUMBER_SYMBOLS[index] ?? index + 1}
        </div>
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-accent/60 to-secondary text-clay">
          <ChefHat className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="truncate font-display text-lg font-semibold leading-tight">
              {recipe.title}
            </h3>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              {recipe.source === "local" ? "📚 我的菜谱" : "🌐 网页搜索"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>🌶️ {recipe.flavor || "适中"}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {recipe.totalTimeMin ?? 30} 分钟
            </span>
            {recipe.cuisine && <span>{recipe.cuisine}</span>}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 rounded-full px-3"
              onClick={onOpen}
            >
              查看
            </Button>
            <Button type="button" size="sm" className="h-8 rounded-full px-3" onClick={onStart}>
              {recipe.source === "local" ? "开始做" : "打开网页"}
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
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-secondary py-1 pl-3 pr-1 text-xs text-muted-foreground">
      <Waves className="h-3.5 w-3.5 animate-pulse text-clay" />
      {isMuted ? "已静音播放中" : "朗读中"}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full text-clay hover:text-clay"
        onClick={onToggleAudio}
        aria-label={isMuted ? "取消静音 AI 朗读" : "静音 AI 朗读"}
      >
        {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
function getStatusCopy(status: AssistantStatus, listenMode: "always" | "wake-word") {
  if (status === "recording" || status === "awake") {
    return { title: "我在听...", subtitle: "静音 1.5s 自动结束", animated: true };
  }
  if (status === "thinking" || status === "transcribing") {
    return { title: "思考中...", subtitle: "正在整理你的语音指令", animated: true };
  }
  if (status === "speaking") {
    return { title: "CookTalk 正在回复", subtitle: "可随时打断", animated: true };
  }
  if (status === "unsupported") {
    return { title: "当前浏览器不支持语音", subtitle: "仍可使用底部文字输入", animated: false };
  }
  if (status === "error") {
    return { title: "语音遇到点问题", subtitle: "请检查麦克风权限，或先打字继续", animated: false };
  }
  return {
    title: listenMode === "always" ? "我随时在听" : "说 Hey CookTalk 唤醒我",
    subtitle: listenMode === "always" ? "当前模式：持续监听" : "当前模式：唤醒模式",
    animated: false,
  };
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function buildWebRecipeCards(query: string): ChatRecipe[] {
  const cleaned = query
    .replace(/(搜一下|搜索|推荐|换一批|菜谱|做法|今晚|午饭|晚饭|早餐|吃什么)/g, "")
    .trim();
  const keyword = cleaned || "家常菜";

  return WEB_RECIPE_SEEDS.map((seed, index) => {
    const title = `${keyword}${seed}`;
    return {
      id: `web-${encodeURIComponent(keyword)}-${index}`,
      title,
      source: "web",
      flavor: index === 0 ? "适中" : index === 1 ? "下饭" : "快手",
      totalTimeMin: [30, 40, 20][index],
      cuisine: "网页搜索",
      sourceUrl: `https://www.bing.com/search?q=${encodeURIComponent(`${title} 菜谱`)}`,
    };
  });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
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
