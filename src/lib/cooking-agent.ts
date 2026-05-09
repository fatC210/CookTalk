import type { TimerInfo } from "@/hooks/use-timers";
import type { Recipe } from "@/lib/db";

type AppLanguage = "en" | "zh";

interface CookingContextOptions {
  recipe: Recipe;
  stepIndex: number;
  isPaused: boolean;
  timers: TimerInfo[];
  language: AppLanguage;
  reason?: string;
}

interface FirstMessageOptions {
  recipe: Recipe;
  stepIndex: number;
  language: AppLanguage;
}

export function buildCookingAgentPrompt({
  recipe,
  language,
}: {
  recipe: Recipe;
  language: AppLanguage;
}): string {
  const ingredients = recipe.ingredients
    .map((item) => `${item.name}${item.amount ? ` (${item.amount})` : ""}`)
    .join(language === "zh" ? "、" : ", ");
  const steps = recipe.steps
    .map((step, index) => {
      const duration =
        typeof step.durationSec === "number" && step.durationSec > 0
          ? language === "zh"
            ? `，预计 ${formatSpeechDuration(step.durationSec, language)}`
            : `, about ${formatSpeechDuration(step.durationSec, language)}`
          : "";
      const tip =
        step.tips?.trim()
          ? language === "zh"
            ? `。提示：${step.tips.trim()}`
            : `. Tip: ${step.tips.trim()}`
          : "";
      return `${index + 1}. ${step.description}${duration}${tip}`;
    })
    .join("\n");

  if (language === "zh") {
    return [
      "你是 CookTalk 的烹饪模式语音助手。",
      "你正在指导用户完成一道固定菜谱。",
      "规则：",
      "1. 只用简体中文回答。",
      "2. 回答要短、自然、适合边做饭边听。",
      "3. 当前步骤、暂停状态、计时器状态，以系统后续发送的上下文更新为准。",
      "4. 如果用户说下一步、上一步、跳步、暂停、继续、设置计时器、取消计时器、延长计时器、结束烹饪，应用可能已经执行了动作。优先根据最新上下文回答，不要自行编造状态变化。",
      "5. 讲步骤时，先说明当前第几步，再简短说明动作；如果有时长或提示，再顺带补一句。",
      "6. 回答问题时优先基于这道菜、当前步骤、食材和计时器。",
      `菜谱标题：${recipe.title}`,
      `食材：${ingredients || "无"}`,
      "全部步骤：",
      steps,
    ].join("\n");
  }

  return [
    "You are CookTalk's cooking-mode voice agent.",
    "You are guiding the cook through one fixed recipe.",
    "Rules:",
    "1. Reply in natural English only.",
    "2. Keep replies short and easy to follow while cooking.",
    "3. Treat later contextual updates from the app as the source of truth for the current step, pause state, and timers.",
    "4. If the user says next step, previous step, jump to a step, pause, resume, set a timer, cancel a timer, extend a timer, or end cooking, the app may have already performed that action. Prioritize the latest context and do not invent extra state changes.",
    "5. When guiding a step, say the current step number, the action to take, and only brief timing or tip details.",
    "6. Answer questions using this recipe, the current step, the ingredients, and the active timers.",
    `Recipe title: ${recipe.title}`,
    `Ingredients: ${ingredients || "None listed"}`,
    "All steps:",
    steps,
  ].join("\n");
}

export function buildCookingAgentFirstMessage({
  recipe,
  stepIndex,
  language,
}: FirstMessageOptions): string {
  const step = recipe.steps[stepIndex];
  if (!step) {
    return language === "zh"
      ? `开始 ${recipe.title}。我已经准备好指导你了。`
      : `Starting ${recipe.title}. I'm ready to guide you.`;
  }

  const stepSummary = summarizeStep(step, stepIndex, language);
  return language === "zh"
    ? `开始 ${recipe.title}。${stepSummary}`
    : `Starting ${recipe.title}. ${stepSummary}`;
}

export function buildCookingContextUpdate({
  recipe,
  stepIndex,
  isPaused,
  timers,
  language,
  reason,
}: CookingContextOptions): string {
  const step = recipe.steps[stepIndex];
  const timerSummary = summarizeTimers(timers, language);
  const currentStepSummary = step
    ? summarizeStep(step, stepIndex, language)
    : language === "zh"
      ? "当前没有可用步骤。"
      : "There is no current step.";
  const pauseSummary = language === "zh" ? (isPaused ? "已暂停" : "进行中") : isPaused ? "paused" : "active";

  if (language === "zh") {
    return [
      "CURRENT STATE",
      reason ? `原因：${reason}` : undefined,
      `菜谱：${recipe.title}`,
      `状态：${pauseSummary}`,
      `当前步骤：${currentStepSummary}`,
      `计时器：${timerSummary}`,
      "请基于这个最新状态继续回答。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "CURRENT STATE",
    reason ? `Reason: ${reason}` : undefined,
    `Recipe: ${recipe.title}`,
    `Cooking state: ${pauseSummary}`,
    `Current step: ${currentStepSummary}`,
    `Timers: ${timerSummary}`,
    "Please use this latest state for your next reply.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCookingManualReplyPrompt(language: AppLanguage): string {
  return language === "zh"
    ? "应用刚刚通过界面按钮更新了烹饪状态。请用一句简短的话继续指导用户当前这一步。"
    : "The app just updated the cooking state from an on-screen control. Briefly guide the cook through the current step now.";
}

export function buildCookingTimerFinishedPrompt(label: string, language: AppLanguage): string {
  return language === "zh"
    ? `名为“${label}”的计时器刚刚结束。请简短提醒用户，并结合当前步骤给一句下一步建议。`
    : `A timer named "${label}" just finished. Briefly notify the cook and add one short suggestion for the current step.`;
}

function summarizeStep(
  step: Recipe["steps"][number],
  stepIndex: number,
  language: AppLanguage,
): string {
  const duration =
    typeof step.durationSec === "number" && step.durationSec > 0
      ? language === "zh"
        ? `，预计 ${formatSpeechDuration(step.durationSec, language)}`
        : `, about ${formatSpeechDuration(step.durationSec, language)}`
      : "";
  const tip =
    step.tips?.trim()
      ? language === "zh"
        ? `。提示：${step.tips.trim()}`
        : `. Tip: ${step.tips.trim()}`
      : "";

  return language === "zh"
    ? `第 ${stepIndex + 1} 步，${step.description}${duration}${tip}`
    : `Step ${stepIndex + 1}: ${step.description}${duration}${tip}`;
}

function summarizeTimers(timers: TimerInfo[], language: AppLanguage): string {
  if (timers.length === 0) {
    return language === "zh" ? "当前没有运行中的计时器。" : "No active timers.";
  }

  return timers
    .map((timer) => {
      const duration = formatSpeechDuration(timer.remainingSeconds, language);
      return language === "zh"
        ? `${timer.label}，剩余 ${duration}`
        : `${timer.label}, ${duration} remaining`;
    })
    .join(language === "zh" ? "；" : "; ");
}

function formatSpeechDuration(seconds: number, language: AppLanguage): string {
  if (seconds < 60) {
    return language === "zh" ? `${seconds} 秒` : `${seconds} seconds`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  if (language === "zh") {
    return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
  }

  return remainder > 0 ? `${minutes} minute${minutes === 1 ? "" : "s"} ${remainder} seconds` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
