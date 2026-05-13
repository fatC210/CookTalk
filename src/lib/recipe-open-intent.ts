import type { Recipe } from "@/lib/db";
import { normalizeSpeechText } from "@/lib/voice-pipeline";

const GENERIC_RECIPE_TARGETS = new Set([
  "菜谱",
  "食谱",
  "做法",
  "菜单",
  "菜單",
  "我的菜谱",
  "我的食谱",
  "本地菜谱",
  "已有菜谱",
  "全部菜谱",
  "所有菜谱",
  "菜谱库",
  "食谱库",
  "菜",
  "菜品",
  "这道菜",
  "那道菜",
  "做菜",
  "烹饪",
  "烹饪模式",
  "跟做模式",
  "recipe",
  "recipes",
  "recipe library",
  "saved recipes",
  "my recipes",
  "local recipes",
  "dish",
  "this dish",
  "that dish",
  "cooking",
  "cooking mode",
]);

export function findRecipeToOpenFromTranscript(
  transcript: string,
  recipes: Recipe[],
  options: { allowOrdinal?: boolean; allowBareOrdinal?: boolean } = {},
): Recipe | null {
  const ordinal = extractRecipeOrdinalTarget(transcript, {
    allowBareOrdinal: options.allowBareOrdinal,
  });
  if (ordinal && options.allowOrdinal !== false) {
    return recipes[ordinal - 1] ?? null;
  }

  const query = extractOpenRecipeQuery(transcript);
  if (!query) return null;

  const queryKey = normalizeRecipeMatchText(query);
  const compactQueryKey = compactRecipeMatchText(queryKey);
  if (!queryKey || !compactQueryKey || isGenericRecipeTarget(queryKey)) return null;

  let bestMatch: { recipe: Recipe; score: number } | null = null;

  for (const recipe of recipes) {
    const titleKey = normalizeRecipeMatchText(recipe.title);
    const compactTitleKey = compactRecipeMatchText(titleKey);
    if (!titleKey || !compactTitleKey) continue;

    let score = 0;
    if (titleKey === queryKey || compactTitleKey === compactQueryKey) {
      score = 100;
    } else if (titleKey.includes(queryKey) || compactTitleKey.includes(compactQueryKey)) {
      score = 80 - Math.abs(compactTitleKey.length - compactQueryKey.length);
    } else if (queryKey.includes(titleKey) || compactQueryKey.includes(compactTitleKey)) {
      score = 70 - Math.abs(compactTitleKey.length - compactQueryKey.length);
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { recipe, score };
    }
  }

  return bestMatch?.recipe ?? null;
}

export function findRecipeToStartCookingFromTranscript(
  transcript: string,
  recipes: Recipe[],
  options: { allowOrdinal?: boolean; allowBareOrdinal?: boolean } = {},
): Recipe | null {
  if (!hasStartCookingIntent(transcript)) return null;

  const query = extractStartCookingRecipeQuery(transcript);
  const recipeByName = query ? findBestRecipeMatch(query, recipes) : null;
  if (recipeByName) return recipeByName;

  const ordinal = extractRecipeOrdinalTarget(transcript, {
    allowBareOrdinal: options.allowBareOrdinal,
  });
  if (ordinal && options.allowOrdinal !== false) {
    return recipes[ordinal - 1] ?? null;
  }

  return null;
}

export function extractRecipeOrdinalTarget(
  transcript: string,
  options: { allowBareOrdinal?: boolean } = {},
): number | null {
  const text = normalizeSpeechText(transcript);
  const hasOpenIntent =
    /打开|查看|看一下|看下|看看|进入|开始|做|烹饪|open|show|view|start|cook/i.test(text);
  const hasRecipeTarget = /菜谱|食谱|做法|recipe|dish/i.test(text);
  if (!hasOpenIntent || (!hasRecipeTarget && !options.allowBareOrdinal)) return null;

  return parseSpokenOrdinal(text);
}

function hasStartCookingIntent(transcript: string): boolean {
  const text = normalizeSpeechText(transcript);
  return /开始.*(做|烹饪|烹调|煮)|做这|做那个|做这道|做那道|start.*cook|start.*recipe|cook\s+.+|cook this|cook recipe/i.test(
    text,
  );
}

function findBestRecipeMatch(query: string, recipes: Recipe[]): Recipe | null {
  const queryKey = normalizeRecipeMatchText(query);
  const compactQueryKey = compactRecipeMatchText(queryKey);
  if (!queryKey || !compactQueryKey || isGenericRecipeTarget(queryKey)) return null;

  let bestMatch: { recipe: Recipe; score: number } | null = null;

  for (const recipe of recipes) {
    const titleKey = normalizeRecipeMatchText(recipe.title);
    const compactTitleKey = compactRecipeMatchText(titleKey);
    if (!titleKey || !compactTitleKey) continue;

    let score = 0;
    if (titleKey === queryKey || compactTitleKey === compactQueryKey) {
      score = 100;
    } else if (titleKey.includes(queryKey) || compactTitleKey.includes(compactQueryKey)) {
      score = 80 - Math.abs(compactTitleKey.length - compactQueryKey.length);
    } else if (queryKey.includes(titleKey) || compactQueryKey.includes(compactTitleKey)) {
      score = 70 - Math.abs(compactTitleKey.length - compactQueryKey.length);
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { recipe, score };
    }
  }

  return bestMatch?.recipe ?? null;
}

function extractOpenRecipeQuery(transcript: string): string {
  const text = normalizeSpeechText(transcript);
  const patterns = [
    /^(?:帮我|请|麻烦你|麻烦|给我)?\s*(?:打开|查看|看一下|看下|看看|进入)\s*(?:一下)?\s*(.+?)(?:的)?(?:菜谱|食谱|做法)(?:详情|页面)?$/,
    /^(?:帮我|请|麻烦你|麻烦|给我)?\s*(?:打开|查看|看一下|看下|看看|进入)\s*(?:一下)?\s*(.+?)(?:详情|页面)$/,
    /^(?:帮我|请|麻烦你|麻烦|给我)?\s*(?:打开|查看|看一下|看下|看看|进入)\s*(?:一下)?\s*(.+)$/,
    /^(?:please\s+)?(?:open|show|view|go\s+to|pull\s+up)\s+(?:my|the|saved|local)?\s*(.+?)\s+(?:recipe|recipe\s+details?|details?)(?:\s+page)?$/,
    /^(?:please\s+)?(?:open|show|view)\s+(?:the\s+)?(?:recipe|details?)\s+(?:for|of)\s+(.+)$/,
    /^(?:please\s+)?(?:open|show|view|go\s+to|pull\s+up)\s+(?:my|the|saved|local)?\s*(.+)$/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = cleanOpenRecipeQuery(match?.[1] ?? "");
    if (candidate) return candidate;
  }

  return "";
}

function extractStartCookingRecipeQuery(transcript: string): string {
  const text = normalizeSpeechText(transcript);
  const patterns = [
    /^(?:帮我|请|麻烦你|麻烦|给我)?\s*(?:开始)?\s*(?:做|烹饪|烹调|煮)\s*(?:一下)?\s*(.+?)(?:的)?(?:菜谱|食谱|做法)?$/,
    /^(?:帮我|请|麻烦你|麻烦|给我)?\s*(?:开始|进入)\s*(?:做|烹饪|烹调|煮|做菜|烹饪模式)\s*(?:一下)?\s*(.+?)(?:的)?(?:菜谱|食谱|做法)?$/,
    /^(?:帮我|请|麻烦你|麻烦|给我)?\s*(?:开始|进入)\s*(.+?)(?:的)?(?:烹饪模式|跟做模式|做菜模式)$/,
    /^(?:please\s+)?(?:start\s+cooking|start\s+recipe|cook|start)\s+(?:the\s+)?(?:recipe\s+for\s+)?(.+)$/i,
    /^(?:please\s+)?(?:start|enter)\s+(?:cooking|cooking\s+mode)\s+(?:for|with)?\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = cleanStartCookingRecipeQuery(match?.[1] ?? "");
    if (candidate) return candidate;
  }

  return "";
}

function cleanOpenRecipeQuery(query: string): string {
  return query
    .replace(
      /^(?:一下|一下子|我的|已有|本地|这个|那个|这道|那道|my|the|a|an|saved|local)\s+/i,
      "",
    )
    .replace(/\s+(?:in|from)\s+(?:my|the)?\s*(?:saved|local)?\s*(?:recipe|recipes|recipe library)$/i, "")
    .replace(/\s*(?:的|菜谱|食谱|做法|详情|页面|recipe|recipes|details?|page)$/i, "")
    .trim();
}

function cleanStartCookingRecipeQuery(query: string): string {
  return cleanOpenRecipeQuery(query)
    .replace(/^(?:这个|那个|这道|那道|this|that)\s+/i, "")
    .replace(/\s*(?:的)?(?:烹饪模式|跟做模式|做菜模式|cooking mode)$/i, "")
    .trim();
}

function normalizeRecipeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:："'“”‘’`()[\]{}<>《》]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactRecipeMatchText(value: string): string {
  return value.replace(/\s+/g, "");
}

function isGenericRecipeTarget(queryKey: string): boolean {
  return GENERIC_RECIPE_TARGETS.has(queryKey) || GENERIC_RECIPE_TARGETS.has(compactRecipeMatchText(queryKey));
}

function parseSpokenOrdinal(text: string): number | null {
  const arabic = text.match(/(?:第\s*)?([0-9]+)\s*(?:个|号|项|条|道|张|recipe|dish)?/i);
  if (arabic?.[1]) return Number(arabic[1]);

  const cn = text.match(/第?\s*([一二两三四五六七八九十]+)\s*(?:个|号|项|条|道|张)?/);
  if (cn?.[1]) return parseChineseNumber(cn[1]);

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
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  for (const [word, value] of Object.entries(englishOrdinalMap)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) return value;
  }

  return null;
}

function parseChineseNumber(raw: string): number {
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
  if (raw === "十") return 10;
  if (raw.includes("十")) {
    const [tensRaw, onesRaw] = raw.split("十");
    const tens = tensRaw ? (cnDigitMap[tensRaw] ?? 1) : 1;
    const ones = onesRaw ? (cnDigitMap[onesRaw] ?? 0) : 0;
    return tens * 10 + ones;
  }
  return cnDigitMap[raw] ?? 0;
}
