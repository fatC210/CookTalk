import { getApiKey } from "@/lib/crypto";
import { type Recipe } from "@/lib/db";
import { ElevenLabsService } from "@/lib/elevenlabs";
import { getFirstElevenLabsVoiceId } from "@/hooks/use-elevenlabs-voices";
import { getConfiguredLLMService } from "@/lib/llm";
import i18n from "@/lib/i18n";
import { claimVoicePlayback } from "@/lib/voice-playback";

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

export class VoicePlaybackInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoicePlaybackInterruptedError";
  }
}

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
  language?: "en" | "zh";
  timers?: Array<{
    label: string;
    remainingSeconds: number;
    totalSeconds: number;
    isRunning: boolean;
  }>;
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
  const normalized = normalizeWakeText(text);
  return wakeWords.some((word) =>
    getWakeWordCandidates(word).some((candidate) => includesWakeCandidate(normalized, candidate)),
  );
}

export function stripWakeWords(text: string, wakeWords: string[]): string {
  let cleaned = text;
  for (const word of wakeWords) {
    if (!word.trim()) continue;
    cleaned = cleaned.replace(new RegExp(escapeRegExp(word), "ig"), "");
  }
  cleaned = cleaned
    .replace(
      /^\s*(?:hey|hi|he|嘿|嗨)\s*(?:cook\s*talk|cooktalk|cook\s*top|cool\s*talk|could\s*talk|库克\s*(?:托克|talk)?|酷\s*talk|厨语)\s*/i,
      "",
    )
    .replace(/^\s*(?:嘿|嗨)?\s*厨语\s*/i, "");
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

type AppLanguage = "en" | "zh";

function voiceText(language: AppLanguage, key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { lng: language, ...options });
}

export async function transcribeWithElevenLabs(
  audioBlob: Blob,
  language: AppLanguage = "zh",
): Promise<string> {
  const apiKey = await getApiKey("elevenlabs");
  if (!apiKey) throw new Error(voiceText(language, "voice.elevenLabsKeyRequiredShort"));
  return new ElevenLabsService(apiKey).speechToText(audioBlob);
}

export async function speakWithElevenLabs(
  text: string,
  voiceId?: string | null,
  language: AppLanguage = "zh",
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const blob = await synthesizeWithElevenLabs(text, voiceId, language, options);
  throwIfAborted(options.signal, language);
  await playAudioBlob(blob, language);
}

export async function synthesizeWithElevenLabs(
  text: string,
  voiceId?: string | null,
  language: AppLanguage = "zh",
  options: { signal?: AbortSignal } = {},
): Promise<Blob> {
  const apiKey = await getApiKey("elevenlabs");
  throwIfAborted(options.signal, language);
  if (!apiKey) throw new Error(voiceText(language, "voice.elevenLabsKeyRequiredShort"));
  const service = new ElevenLabsService(apiKey);
  const resolvedVoiceId = voiceId ?? (await getFirstElevenLabsVoiceId(service));
  throwIfAborted(options.signal, language);
  if (!resolvedVoiceId) throw new Error(voiceText(language, "voice.voiceSelectRequired"));

  try {
    return await service.textToSpeech(text, resolvedVoiceId, { signal: options.signal });
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      throw new VoicePlaybackInterruptedError(voiceText(language, "voice.playbackInterrupted"));
    }
    throw error;
  }
}

function throwIfAborted(signal: AbortSignal | undefined, language: AppLanguage): void {
  if (!signal?.aborted) return;
  throw new VoicePlaybackInterruptedError(voiceText(language, "voice.playbackInterrupted"));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function answerCookingQuestion({
  recipe,
  currentStep,
  question,
  language = "zh",
  timers = [],
}: AnswerCookingQuestionOptions): Promise<string> {
  const service = await getConfiguredLLMService();
  if (!service) {
    return buildLocalCookingAnswer(recipe, currentStep, question, language);
  }

  const activeStep = recipe.steps[currentStep];
  const previousStep = currentStep > 0 ? recipe.steps[currentStep - 1] : undefined;
  const nextStep = recipe.steps[currentStep + 1];
  const context = recipe.steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.description}${
          step.tips ? (language === "zh" ? ` 提示：${step.tips}` : ` Tip: ${step.tips}`) : ""
        }`,
    )
    .join("\n");
  const timerContext =
    timers.length > 0
      ? timers
          .map((timer) =>
            `${timer.label}: ${formatDurationForSpeech(
              timer.remainingSeconds,
              language,
            )} ${timer.isRunning ? (language === "zh" ? "剩余" : "remaining") : ""}`.trim(),
          )
          .join(language === "zh" ? "；" : "; ")
      : language === "zh"
        ? "当前没有运行中的计时器"
        : "No active timers";

  try {
    return await service.chat([
      {
        role: "system",
        content:
          language === "zh"
            ? "你是 CookTalk 烹饪模式里的陪伴型厨房助手，正在用户身边陪他一步一步做菜。回答必须优先围绕当前正在做的步骤，结合前后步骤、食材、火候、时间和正在运行的计时器给出可执行建议。语气自然、简短、像现场提醒，不要输出 Markdown。除非用户明确问整道菜，否则不要跳开当前步骤泛泛解释。"
            : "You are CookTalk's companion-style kitchen assistant in cooking mode, staying beside the user while they cook step by step. Always anchor the answer in the current active step, using nearby steps, ingredients, heat, timing, and active timers to give practical guidance. Keep it brief and natural, like an in-the-moment kitchen prompt. Do not output Markdown. Unless the user asks about the whole recipe, do not drift away from the current step.",
      },
      {
        role: "user",
        content:
          language === "zh"
            ? `菜谱：${recipe.title}
用户当前正在做：第 ${currentStep + 1} 步，共 ${recipe.steps.length} 步
当前步骤：${activeStep?.description ?? ""}
当前步骤提示：${activeStep?.tips ?? "无"}
上一步：${previousStep?.description ?? "无"}
下一步：${nextStep?.description ?? "无"}
计时器：${timerContext}
食材：${recipe.ingredients
                .map((item) => `${item.name}${item.amount ? ` ${item.amount}` : ""}`)
                .join("、")}
全部步骤：
${context}

用户问题：${question}`
            : `Recipe: ${recipe.title}
User is currently doing: step ${currentStep + 1} of ${recipe.steps.length}
Current step: ${activeStep?.description ?? ""}
Current step tip: ${activeStep?.tips ?? "none"}
Previous step: ${previousStep?.description ?? "none"}
Next step: ${nextStep?.description ?? "none"}
Timers: ${timerContext}
Ingredients: ${recipe.ingredients
                .map((item) => `${item.name}${item.amount ? ` ${item.amount}` : ""}`)
                .join(", ")}
All steps:
${context}

User question: ${question}`,
      },
    ]);
  } catch {
    return buildLocalCookingAnswer(recipe, currentStep, question, language);
  }
}

export function buildStepSpeech(
  recipe: Recipe,
  stepIndex: number,
  language: "en" | "zh" = "zh",
): string {
  const step = recipe.steps[stepIndex];
  if (!step) return language === "zh" ? "没有找到当前步骤。" : "Current step not found.";
  const parts = [
    language === "zh"
      ? `第 ${stepIndex + 1} 步，${step.description}`
      : `Step ${stepIndex + 1}: ${step.description}`,
  ];
  if (step.durationSec && step.durationSec >= 30) {
    parts.push(
      language === "zh"
        ? `预计 ${formatDurationForSpeech(step.durationSec, language)}。`
        : `About ${formatDurationForSpeech(step.durationSec, language)}.`,
    );
  }
  if (step.tips) parts.push(language === "zh" ? `小贴士：${step.tips}` : `Tip: ${step.tips}`);
  return parts.join(" ");
}

export function formatDurationForSpeech(seconds: number, language: "en" | "zh" = "zh"): string {
  if (seconds < 60) return language === "zh" ? `${seconds} 秒` : `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (language === "zh") return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
  return rest > 0
    ? `${minutes} minute${minutes === 1 ? "" : "s"} ${rest} seconds`
    : `${minutes} minute${minutes === 1 ? "" : "s"}`;
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
  return cleaned;
}

function buildLocalCookingAnswer(
  recipe: Recipe,
  currentStep: number,
  question: string,
  language: "en" | "zh",
): string {
  const text = normalizeSpeechText(question);
  const step = recipe.steps[currentStep];

  if (/(多久|时间|几分钟|how long)/i.test(text)) {
    if (step?.durationSec) {
      return language === "zh"
        ? `这一步大约需要 ${formatDurationForSpeech(step.durationSec, language)}。`
        : `This step takes about ${formatDurationForSpeech(step.durationSec, language)}.`;
    }
    if (recipe.tags.totalTimeMin) {
      return language === "zh"
        ? `整道菜预计大约 ${recipe.tags.totalTimeMin} 分钟。`
        : `The whole recipe takes about ${recipe.tags.totalTimeMin} minutes.`;
    }
  }

  if (/(材料|食材|ingredient)/i.test(text)) {
    const ingredients = recipe.ingredients
      .map((item) => `${item.name}${item.amount ? item.amount : ""}`)
      .join(language === "zh" ? "，" : ", ");
    return language === "zh" ? `这道菜需要：${ingredients}。` : `This recipe uses: ${ingredients}.`;
  }

  if (/(提示|注意|tip)/i.test(text) && step?.tips) return step.tips;

  return step
    ? buildStepSpeech(recipe, currentStep, language)
    : language === "zh"
      ? "我会根据当前菜谱继续协助你。"
      : "I will keep helping with the current recipe.";
}

function playAudioBlob(blob: Blob, language: AppLanguage): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    let playback: ReturnType<typeof claimVoicePlayback> | null = null;
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    playback = claimVoicePlayback(audio, {
      cleanup: () => URL.revokeObjectURL(url),
      onStop: () =>
        settle(() =>
          reject(new VoicePlaybackInterruptedError(voiceText(language, "voice.playbackInterrupted"))),
        ),
    });

    audio.onended = () => {
      playback?.release();
      settle(resolve);
    };
    audio.onerror = () => {
      playback?.release();
      settle(() => reject(new Error(voiceText(language, "voice.playbackFailed"))));
    };
    audio.play().catch((error: unknown) => {
      playback?.release();
      settle(() =>
        reject(
          error instanceof Error ? error : new Error(voiceText(language, "voice.playbackFailed")),
        ),
      );
    });
  });
}

function normalizeWakeText(text: string): string {
  return normalizeSpeechText(text)
    .replace(/[\s\-_'’]+/g, "")
    .replace(/[嘿嗨]/g, "hey")
    .replace(/库克/g, "cook")
    .replace(/托克|脱口/g, "talk")
    .replace(/酷/g, "cool");
}

function getWakeWordCandidates(word: string): string[] {
  const candidate = normalizeWakeText(word);
  if (!candidate) return [];

  const candidates = new Set([candidate]);
  if (candidate === "heycooktalk" || candidate.includes("cooktalk")) {
    candidates.add("heycooktalk");
    candidates.add("heycooktok");
    candidates.add("heycooktock");
    candidates.add("heycooktop");
    candidates.add("heycooltalk");
    candidates.add("heycouldtalk");
  }

  return [...candidates];
}

function includesWakeCandidate(text: string, candidate: string): boolean {
  if (!candidate) return false;
  if (text.includes(candidate)) return true;
  if (candidate.length < 8) return false;

  const maxDistance = candidate.length >= 10 ? 2 : 1;
  const minLength = Math.max(1, candidate.length - maxDistance);
  const maxLength = candidate.length + maxDistance;

  for (let start = 0; start < text.length; start += 1) {
    for (
      let length = minLength;
      length <= maxLength && start + length <= text.length;
      length += 1
    ) {
      const segment = text.slice(start, start + length);
      if (levenshteinDistance(segment, candidate, maxDistance) <= maxDistance) return true;
    }
  }

  return false;
}

function levenshteinDistance(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = next;
      rowMin = Math.min(rowMin, next);
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }

  return previous[b.length];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
