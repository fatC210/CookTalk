import { normalizeSpeechText } from "@/lib/voice-pipeline";

export type VoiceActionResult =
  | { handled: true; label: string }
  | { handled: false; reason?: string };

type InteractiveElement = HTMLElement & {
  disabled?: boolean;
  value?: string;
  checked?: boolean;
};

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const cnDigitMap: Record<string, number> = {
  零: 0,
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

const englishOrdinalMap: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

export function executeVoiceAction(transcript: string): VoiceActionResult {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return { handled: false };
  }

  const text = normalizeSpeechText(transcript);
  if (!text) return { handled: false };

  const historyAction = executeHistoryAction(text);
  if (historyAction.handled) return historyAction;

  const scrollAction = executeScrollAction(text);
  if (scrollAction.handled) return scrollAction;

  const keyboardAction = executeKeyboardAction(text);
  if (keyboardAction.handled) return keyboardAction;

  const inputAction = executeInputAction(transcript);
  if (inputAction.handled) return inputAction;

  const badgeAction = executeBadgeAction(text);
  if (badgeAction.handled) return badgeAction;

  const clickAction = executeClickAction(text);
  if (clickAction.handled) return clickAction;

  const focusAction = executeFocusAction(text);
  if (focusAction.handled) return focusAction;

  return { handled: false };
}

function executeHistoryAction(text: string): VoiceActionResult {
  if (/(返回上一页|后退|go back|back)/i.test(text)) {
    window.history.back();
    return { handled: true, label: "Back" };
  }

  if (/(前进|go forward|forward)/i.test(text)) {
    window.history.forward();
    return { handled: true, label: "Forward" };
  }

  return { handled: false };
}

function executeScrollAction(text: string): VoiceActionResult {
  if (/(回到顶部|到顶部|滚到顶部|scroll to top|top)/i.test(text)) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return { handled: true, label: "Top" };
  }

  if (/(到底部|滚到底部|scroll to bottom|bottom)/i.test(text)) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    return { handled: true, label: "Bottom" };
  }

  if (/(向下|往下|下滑|下翻|下一屏|scroll down|page down)/i.test(text)) {
    window.scrollBy({ top: Math.round(window.innerHeight * 0.75), behavior: "smooth" });
    return { handled: true, label: "Scroll down" };
  }

  if (/(向上|往上|上滑|上翻|上一屏|scroll up|page up)/i.test(text)) {
    window.scrollBy({ top: -Math.round(window.innerHeight * 0.75), behavior: "smooth" });
    return { handled: true, label: "Scroll up" };
  }

  return { handled: false };
}

function executeKeyboardAction(text: string): VoiceActionResult {
  if (/(按)?\s*(回车|确认键|enter)/i.test(text)) {
    const active = document.activeElement as HTMLElement | null;
    const form = active?.closest("form") as HTMLFormElement | null;
    if (form) {
      form.requestSubmit();
    } else {
      dispatchKeyboardEvent("Enter");
    }
    return { handled: true, label: "Enter" };
  }

  if (/(按)?\s*(esc|escape|退出键)/i.test(text)) {
    dispatchKeyboardEvent("Escape");
    return { handled: true, label: "Escape" };
  }

  return { handled: false };
}

function executeInputAction(transcript: string): VoiceActionResult {
  const parsed = parseInputCommand(transcript);
  if (!parsed) return { handled: false };

  const field = parsed.field
    ? findBestInputByLabel(parsed.field)
    : (getActiveEditableElement() ?? findFirstEditableElement());
  if (!field) return { handled: false, reason: "No input target" };

  setEditableValue(field, parsed.value);
  field.focus();
  return { handled: true, label: parsed.field ? `${parsed.field}: ${parsed.value}` : parsed.value };
}

function executeBadgeAction(text: string): VoiceActionResult {
  const number = parseOrdinalTarget(text);
  if (!number) return { handled: false };

  const badges = getVisibleElements(".voice-badge");
  const badge = badges.find((item) => item.textContent?.trim() === String(number));
  const target = findBadgeInteractiveTarget(badge);
  if (!target || !isUsableInteractive(target)) return { handled: false };

  activateElement(target);
  return { handled: true, label: `#${number}` };
}

function executeClickAction(text: string): VoiceActionResult {
  const targetText = parseClickTarget(text);
  if (!targetText) return { handled: false };

  const target = findBestInteractiveElement(targetText);
  if (!target) return { handled: false, reason: "No clickable target" };

  activateElement(target);
  return { handled: true, label: getElementLabel(target) || targetText };
}

function executeFocusAction(text: string): VoiceActionResult {
  const targetText = parseFocusTarget(text);
  if (!targetText) return { handled: false };

  const field = findBestInputByLabel(targetText);
  if (!field) return { handled: false };

  field.focus();
  return { handled: true, label: targetText };
}

function parseInputCommand(transcript: string): { field?: string; value: string } | null {
  const cleaned = transcript.trim();
  const patterns: RegExp[] = [
    /^(?:在|往|给)?\s*(.+?)\s*(?:里|中)?\s*(?:输入|填入|填写|写入|改成|设为)\s*(.+)$/i,
    /^(?:输入|填入|填写|写入)\s*(.+?)\s*(?:到|进|在)\s*(.+?)\s*(?:里|中)?$/i,
    /^(?:type|enter|fill|write)\s+(.+?)\s+(?:in|into|to|for)\s+(.+)$/i,
    /^(?:set|change)\s+(.+?)\s+(?:to|as)\s+(.+)$/i,
    /^(?:type|enter|fill|write|input)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;

    if (pattern === patterns[1] || pattern === patterns[2]) {
      return { value: cleanupDictatedValue(match[1]), field: cleanupTargetText(match[2]) };
    }

    if (pattern === patterns[4]) {
      return { value: cleanupDictatedValue(match[1]) };
    }

    return { field: cleanupTargetText(match[1]), value: cleanupDictatedValue(match[2]) };
  }

  return null;
}

function parseClickTarget(text: string): string | null {
  const trimmed = cleanupTargetText(text);
  const directCommands = [
    "保存",
    "提交",
    "确认",
    "继续",
    "取消",
    "关闭",
    "删除",
    "编辑",
    "添加",
    "新增",
    "克隆",
    "播放",
    "预览",
    "开始",
    "暂停",
    "停止",
    "重试",
    "导出",
    "下载",
    "导入",
    "上传",
    "选择",
    "生成",
    "重新生成",
    "save",
    "submit",
    "confirm",
    "continue",
    "cancel",
    "close",
    "delete",
    "edit",
    "add",
    "new",
    "clone",
    "play",
    "preview",
    "start",
    "pause",
    "stop",
    "retry",
    "export",
    "download",
    "import",
    "upload",
    "select",
    "choose",
    "generate",
    "regenerate",
  ];

  const direct = directCommands.find((command) => normalizedIncludes(trimmed, command));
  if (direct && normalizeForMatch(trimmed) === normalizeForMatch(direct)) return direct;

  const patterns = [
    /^(?:点击|点一下|点|按|按下|选择|选中|打开|查看|播放|预览|删除|关闭|取消|导出|下载|导入|上传|生成|重新生成|添加|新增|克隆|开始|暂停|停止)\s*(.+)$/i,
    /^(?:切换到|切到|切成|换成|设为|开启|勾选|取消勾选)\s*(.+)$/i,
    /^(?:click|tap|press|select|choose|open|show|play|preview|delete|close|cancel|export|download|import|upload|generate|regenerate|add|new|clone|start|pause|stop)\s+(.+)$/i,
    /^(?:switch to|set to|turn on|turn off|check|uncheck)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return cleanupTargetText(match[1]);
  }

  return direct ?? null;
}

function parseFocusTarget(text: string): string | null {
  const patterns = [
    /^(?:聚焦|定位到|光标到|选中输入框)\s*(.+)$/i,
    /^(?:focus|focus on|go to field)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanupTargetText(match[1]);
  }

  return null;
}

function parseOrdinalTarget(text: string): number | null {
  const arabic = text.match(/(?:第\s*)?([0-9]+)\s*(?:个|号|项|条|张|步|#|number)?/i);
  if (arabic && /(第|个|号|项|条|张|编号|number|#|open|play|preview|打开|选择|点击|点|播放|预览|试听)/i.test(text)) {
    return Number(arabic[1]);
  }

  const cn = text.match(/第?\s*([一二两三四五六七八九十]+)\s*(?:个|号|项|条|张|步)?/);
  if (cn && /(第|个|号|项|条|张|打开|选择|点击|点|播放|预览|试听)/i.test(text)) {
    return parseSpokenNumber(cn[1]);
  }

  const english = Object.entries(englishOrdinalMap).find(([word]) =>
    new RegExp(`\\b${word}\\b`, "i").test(text),
  );
  return english?.[1] ?? null;
}

function findBadgeInteractiveTarget(badge: HTMLElement | undefined): InteractiveElement | null {
  if (!badge) return null;

  const ownTarget = badge.closest(INTERACTIVE_SELECTOR) as InteractiveElement | null;
  if (ownTarget) return ownTarget;

  const parent = badge.parentElement;
  const candidates = getInteractiveElements();
  return (
    candidates.find(
      (element) => element !== badge && Boolean(parent) && element.contains(parent),
    ) ??
    candidates.find((element) => element.contains(badge)) ??
    null
  );
}

function findBestInteractiveElement(targetText: string): InteractiveElement | null {
  const candidates = getInteractiveElements();
  return rankByLabel(candidates, targetText)[0]?.element ?? null;
}

function findBestInputByLabel(targetText: string): InteractiveElement | null {
  const candidates = getInteractiveElements().filter(isEditableElement);
  return rankByLabel(candidates, targetText)[0]?.element ?? null;
}

function findFirstEditableElement(): InteractiveElement | null {
  return getInteractiveElements().find(isEditableElement) ?? null;
}

function getActiveEditableElement(): InteractiveElement | null {
  const active = document.activeElement as InteractiveElement | null;
  return active && isEditableElement(active) && isVisible(active) ? active : null;
}

function rankByLabel(elements: InteractiveElement[], targetText: string) {
  const target = normalizeForMatch(targetText);
  if (!target) return [];

  return elements
    .map((element) => {
      const label = normalizeForMatch(getElementLabel(element));
      const looseLabel = label.replace(/\s+/g, "");
      const looseTarget = target.replace(/\s+/g, "");
      let score = 0;

      if (label === target || looseLabel === looseTarget) score = 100;
      else if (label.startsWith(target) || looseLabel.startsWith(looseTarget)) score = 80;
      else if (label.includes(target) || looseLabel.includes(looseTarget)) score = 60;
      else if (target.includes(label) && label.length >= 2) score = 45;

      return { element, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function getInteractiveElements(): InteractiveElement[] {
  return getVisibleElements(INTERACTIVE_SELECTOR).filter(isUsableInteractive);
}

function getVisibleElements(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
}

function isUsableInteractive(element: InteractiveElement): boolean {
  if (!isVisible(element)) return false;
  if (element.disabled) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element.closest("[inert]")) return false;
  return true;
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isEditableElement(element: InteractiveElement): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "textarea" || tagName === "select") return true;
  if (element.isContentEditable) return true;
  if (tagName !== "input") return false;

  const type = (element.getAttribute("type") ?? "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(type);
}

function activateElement(element: InteractiveElement) {
  element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  element.focus({ preventScroll: true });
  window.setTimeout(() => element.click(), 120);
}

function dispatchKeyboardEvent(key: string) {
  const target = document.activeElement ?? document.body;
  for (const type of ["keydown", "keyup"]) {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  }
}

function setEditableValue(element: InteractiveElement, value: string) {
  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
    );
    return;
  }

  if (element instanceof HTMLSelectElement) {
    const option = Array.from(element.options).find((item) =>
      normalizedIncludes(item.textContent ?? item.value, value),
    );
    if (option) element.value = option.value;
  } else {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function getElementLabel(element: HTMLElement): string {
  const parts = [
    element.dataset.voiceLabel,
    element.dataset.voiceAliases,
    element.dataset.voiceAction,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    getAssociatedLabel(element),
    element.getAttribute("placeholder"),
    element.getAttribute("name"),
    element.getAttribute("value"),
    element.textContent,
  ];

  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function getAssociatedLabel(element: HTMLElement): string {
  const id = element.id;
  const labels: string[] = [];

  if (id) {
    labels.push(
      ...Array.from(document.querySelectorAll<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`))
        .map((label) => label.textContent ?? "")
        .filter(Boolean),
    );
  }

  const parentLabel = element.closest("label");
  if (parentLabel?.textContent) labels.push(parentLabel.textContent);

  return labels.join(" ");
}

function cleanupTargetText(text: string): string {
  return normalizeSpeechText(text)
    .replace(/^(这个|那个|一下|the|a|an)\s*/i, "")
    .replace(/\s*(按钮|链接|选项|输入框|button|link|option|field)$/i, "")
    .trim();
}

function cleanupDictatedValue(text: string): string {
  return text
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function normalizeForMatch(text: string): string {
  return normalizeSpeechText(text)
    .replace(/["'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedIncludes(source: string, target: string): boolean {
  const normalizedSource = normalizeForMatch(source);
  const normalizedTarget = normalizeForMatch(target);
  if (!normalizedSource || !normalizedTarget) return false;
  return (
    normalizedSource.includes(normalizedTarget) ||
    normalizedSource.replace(/\s+/g, "").includes(normalizedTarget.replace(/\s+/g, ""))
  );
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
  return cnDigitMap[raw] ?? 0;
}
