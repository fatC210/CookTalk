import { getApiKey } from "@/lib/crypto";
import { db, type Recipe } from "@/lib/db";
import { ElevenLabsService } from "@/lib/elevenlabs";
import { getConfiguredLLMService } from "@/lib/llm";

export type VoiceStatus =
  | "unsupported"
  | "idle"
  | "listening"
  | "awake"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export type VoiceIntentType =
  | "next_step"
  | "previous_step"
  | "pause"
  | "resume"
  | "repeat_step"
  | "read_tip"
  | "set_timer"
  | "cancel_timer"
  | "extend_timer"
  | "jump_step"
  | "end_cooking"
  | "show_badges"
  | "hide_badges"
  | "stop_listening"
  | "start_listening"
  | "qa";

export interface VoiceIntent {
  type: VoiceIntentType;
  seconds?: number;
  stepNumber?: number;
  label?: string;
  answer?: string;
}

interface AnswerCookingQuestionOptions {
  recipe: Recipe;
  currentStep: number;
  question: string;
}

type SpeechRecognitionConstructor = new () => SpeechRecognition;

type SpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionAlternative = { transcript: string };

type SpeechRecognitionResult = ArrayLike<SpeechRecognitionAlternative> & { isFinal: boolean };

type SpeechRecognitionResultList = ArrayLike<SpeechRecognitionResult>;

interface SpeechRecognitionEvent {
  resultIndex?: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

const cnDigitMap: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function normalizeSpeechText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasWakeWord(text: string, wakeWords: string[]): boolean {
  const normalized = normalizeSpeechText(text).replace(/\s+/g, "");
  return wakeWords.some((word) => {
    const candidate = normalizeSpeechText(word).replace(/\s+/g, "");
    return candidate.length > 0 && normalized.includes(candidate);
  });
}

export function stripWakeWords(text: string, wakeWords: string[]): string {
  let cleaned = text;
  for (const word of wakeWords) {
    if (!word.trim()) continue;
    cleaned = cleaned.replace(new RegExp(escapeRegExp(word), "ig"), "");
  }
  return cleaned.replace(/^[，。！？、,.!?\s]+/, "").trim();
}

export function parseVoiceIntent(transcript: string): VoiceIntent {
  const text = normalizeSpeechText(transcript);

  if (/(下一步|下一个|继续下一|next)/i.test(text)) return { type: "next_step" };
  if (/(上一步|前一步|previous|back)/i.test(text)) return { type: "previous_step" };
  if (/(暂停|停一下|pause)/i.test(text)) return { type: "pause" };
  if (/(继续|恢复|resume)/i.test(text)) return { type: "resume" };
  if (/(重复|再说一遍|重播|repeat)/i.test(text)) return { type: "repeat_step" };
  if (/(小贴士|提示|tip)/i.test(text)) return { type: "read_tip" };
  if (/(结束烹饪|退出烹饪|关闭烹饪|end cooking|exit)/i.test(text)) return { type: "end_cooking" };
  if (/(隐藏.*语音|hide.*badge)/i.test(text)) return { type: "hide_badges" };
  if (/(显示.*语音|show.*badge)/i.test(text)) return { type: "show_badges" };
  if (/(停止监听|stop listening)/i.test(text)) return { type: "stop_listening" };
  if (/(开始监听|start listening)/i.test(text)) return { type: "start_listening" };

  const jumpStep = text.match(/(?:第|step\s*)([0-9一二两三四五六七八九十]+)\s*(?:步|step)?/i);
  if (jumpStep?.[1] && /(跳到|去到|切到|第|step)/i.test(text)) {
    return { type: "jump_step", stepNumber: parseSpokenNumber(jumpStep[1]) };
  }

  if (/(取消|关闭|停止).*(计时|timer)/i.test(text)) {
    return { type: "cancel_timer" };
  }

  if (/(加|延长|extend).*(分钟|秒|minute|second)/i.test(text)) {
    return { type: "extend_timer", seconds: parseDurationSeconds(text) ?? 60 };
  }

  if (/(计时|定时|timer|remind)/i.test(text)) {
    return {
      type: "set_timer",
      seconds: parseDurationSeconds(text) ?? 60,
      label: parseTimerLabel(transcript),
    };
  }

  return { type: "qa" };
}

export async function transcribeWithElevenLabs(audioBlob: Blob): Promise<string> {
  const apiKey = await getApiKey("elevenlabs");
  if (!apiKey) throw new Error("请先在设置里配置 ElevenLabs API Key");
  return new ElevenLabsService(apiKey).speechToText(audioBlob);
}

export async function speakWithElevenLabs(text: string, voiceId?: string | null): Promise<void> {
  const blob = await synthesizeWithElevenLabs(text, voiceId);
  await playAudioBlob(blob);
}

export async function synthesizeWithElevenLabs(
  text: string,
  voiceId?: string | null,
): Promise<Blob> {
  const apiKey = await getApiKey("elevenlabs");
  if (!apiKey) throw new Error("请先在设置里配置 ElevenLabs API Key");

  const resolvedVoiceId = await resolveVoiceId(voiceId);
  return new ElevenLabsService(apiKey).textToSpeech(text, resolvedVoiceId);
}

export async function answerCookingQuestion({
  recipe,
  currentStep,
  question,
}: AnswerCookingQuestionOptions): Promise<string> {
  const service = await getConfiguredLLMService();
  if (!service) {
    return buildLocalCookingAnswer(recipe, currentStep, question);
  }

  const activeStep = recipe.steps[currentStep];
  const context = recipe.steps
    .map(
      (step, index) => `${index + 1}. ${step.description}${step.tips ? ` 提示：${step.tips}` : ""}`,
    )
    .join("\n");

  try {
    return await service.chat([
      {
        role: "system",
        content:
          "你是 CookTalk 烹饪语音助手。用中文简短回答，优先结合当前菜谱、当前步骤、食材和计时信息。不要输出 Markdown。",
      },
      {
        role: "user",
        content: `菜谱：${recipe.title}\n当前步骤：第 ${currentStep + 1} 步，${activeStep?.description ?? ""}\n食材：${recipe.ingredients
          .map((item) => `${item.name}${item.amount ? ` ${item.amount}` : ""}`)
          .join("、")}\n全部步骤：\n${context}\n\n用户问题：${question}`,
      },
    ]);
  } catch {
    return buildLocalCookingAnswer(recipe, currentStep, question);
  }
}

export function buildStepSpeech(recipe: Recipe, stepIndex: number): string {
  const step = recipe.steps[stepIndex];
  if (!step) return "没有找到当前步骤。";
  const parts = [`第 ${stepIndex + 1} 步，${step.description}`];
  if (step.durationSec && step.durationSec >= 30) {
    parts.push(`预计 ${formatDurationForSpeech(step.durationSec)}。`);
  }
  if (step.tips) parts.push(`小贴士：${step.tips}`);
  return parts.join(" ");
}

export function formatDurationForSpeech(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

function parseDurationSeconds(text: string): number | null {
  const minuteMatch = text.match(
    /([0-9]+|[一二两三四五六七八九十]+)\s*(?:分钟|分|minute|minutes)/i,
  );
  const secondMatch = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*(?:秒|second|seconds)/i);
  const minutes = minuteMatch?.[1] ? parseSpokenNumber(minuteMatch[1]) : 0;
  const seconds = secondMatch?.[1] ? parseSpokenNumber(secondMatch[1]) : 0;
  const total = minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function parseSpokenNumber(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "十") return 10;
  if (raw.includes("十")) {
    const [tensRaw, onesRaw] = raw.split("十");
    const tens = tensRaw ? (cnDigitMap[tensRaw] ?? 1) : 1;
    const ones = onesRaw ? (cnDigitMap[onesRaw] ?? 0) : 0;
    return tens * 10 + ones;
  }
  return cnDigitMap[raw] ?? 1;
}

function parseTimerLabel(text: string): string {
  const cleaned = text
    .replace(/(帮我|给我|请|设置|开始|一个|计时器|计时|定时|timer|remind|after)/gi, "")
    .replace(
      /([0-9]+|[一二两三四五六七八九十]+)\s*(分钟|分|秒|minute|minutes|second|seconds)/gi,
      "",
    )
    .trim();
  return cleaned || "烹饪计时";
}

function buildLocalCookingAnswer(recipe: Recipe, currentStep: number, question: string): string {
  const text = normalizeSpeechText(question);
  const step = recipe.steps[currentStep];

  if (/(多久|时间|几分钟|how long)/i.test(text)) {
    if (step?.durationSec) return `这一步大约需要 ${formatDurationForSpeech(step.durationSec)}。`;
    if (recipe.tags.totalTimeMin) return `整道菜预计大约 ${recipe.tags.totalTimeMin} 分钟。`;
  }

  if (/(材料|食材|ingredient)/i.test(text)) {
    return `这道菜需要：${recipe.ingredients
      .map((item) => `${item.name}${item.amount ? item.amount : ""}`)
      .join("，")}。`;
  }

  if (/(提示|注意|tip)/i.test(text) && step?.tips) return step.tips;

  return step
    ? `当前是第 ${currentStep + 1} 步：${step.description}${step.tips ? `。提示：${step.tips}` : ""}`
    : "我会根据当前菜谱继续协助你。";
}

async function resolveVoiceId(voiceId?: string | null): Promise<string> {
  if (voiceId) return voiceId;
  const defaultVoice = await db.voices.where("isDefault").equals(1).first();
  return defaultVoice?.elevenLabsVoiceId ?? DEFAULT_VOICE_ID;
}

function playAudioBlob(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("语音播放失败"));
    };
    audio.play().catch((error: unknown) => {
      URL.revokeObjectURL(url);
      reject(error instanceof Error ? error : new Error("语音播放失败"));
    });
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
