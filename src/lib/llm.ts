import type { Recipe } from "./db";
import { getApiKey } from "./crypto";
import i18n from "./i18n";
import type { AppLanguage } from "./language";

type RecipePayload = Omit<
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

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ChatStreamOptions = {
  onChunk?: (chunk: string) => void;
};

type ChatOptions = {
  maxTokens?: number;
  responseFormat?: "json_object";
  temperature?: number;
  timeoutMs?: number;
};

function resolveRecipeLanguage(language?: AppLanguage): AppLanguage {
  if (language === "en" || language === "zh") return language;
  return i18n.language.startsWith("zh") ? "zh" : "en";
}

interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

interface ChatCompletionStreamResponse {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface ImageGenerationResponse {
  data: Array<{ b64_json?: string; url?: string }>;
  output_format?: "png" | "webp" | "jpeg";
}

interface ResponsesImageGenerationResponse {
  output?: Array<{
    type?: string;
    result?: string;
    content?: Array<{
      type?: string;
      image_url?: string;
      b64_json?: string;
      result?: string;
    }>;
  }>;
}

export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";
export const DEFAULT_IMAGE_MODEL = "gpt-image-1.5";
const OPENAI_API_HOST = "api.openai.com";
const OPENAI_COMPATIBLE_ROOT_HOSTS = new Set([OPENAI_API_HOST, "onetoken.sh", "onetoken.one"]);
const API_VALIDATION_TIMEOUT_MS = 10_000;
const OPENAI_COMPATIBLE_PROXY_PATH = "/api/openai-compatible";
const MAX_RECIPE_SOURCE_CHARS = 8_000;
const META_REASONING_PATTERN =
  /\b(?:prompt|json|schema|field|fields|mapping|map to schema|infer|invent|optional|respond with|return valid|markdown|refine the json|failed response|repair malformed|rule|rules|assistant|model)\b|(?:我应该|我会|让我|等等|先|再|提示词|字段|结构化|返回|输出|省略|编造|推断|修复|让我们|我想|我不能)/i;
const DURATION_HOUR_PATTERN = /(\d+(?:\.\d+)?)\s*(?:小时|hours?\b|hrs?\b|h\b)/i;
const DURATION_MINUTE_PATTERN = /(\d+(?:\.\d+)?)\s*(?:分钟|分|minutes?\b|mins?\b|m\b)/i;
const DURATION_SECOND_PATTERN = /(\d+(?:\.\d+)?)\s*(?:秒|seconds?\b|secs?\b|s\b)/i;
const ISO_DURATION_PATTERN =
  /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;
const RECIPE_SCHEMA_PLACEHOLDERS = new Set([
  "recipe name",
  "ingredient",
  "amount",
  "step text",
  "step description",
  "optional tip",
  "optional notes",
  "cuisine name",
  "savory",
  "菜名",
  "食材名",
  "食材",
  "用量",
  "步骤描述",
  "提示",
  "可选提示",
  "提示（可选）",
  "可选备注",
  "口味",
  "菜系",
  "总时间分钟",
  "recipeingredient",
  "recipeinstructions",
  "reciperesult",
  "recipeyield",
  "recipecuisine",
  "recipecategory",
  "howtostep",
  "howtosection",
  "itemlistelement",
  "@type",
  "@context",
]);
const INGREDIENT_NAME_LABELS = [
  "name",
  "ingredient",
  "item",
  "food",
  "recipeIngredient",
  "recipeIngredients",
  "食材名",
  "食材",
  "原料",
  "名称",
];
const INGREDIENT_AMOUNT_LABELS = [
  "amount",
  "quantity",
  "qty",
  "measure",
  "unit",
  "用量",
  "份量",
  "数量",
];
const STEP_TEXT_LABELS = [
  "step",
  "steps",
  "instruction",
  "instructions",
  "recipeInstruction",
  "recipeInstructions",
  "direction",
  "directions",
  "description",
  "text",
  "itemListElement",
  "做法",
  "步骤",
  "烹饪步骤",
];
const TITLE_LABELS = [
  "title",
  "name",
  "dishName",
  "recipeName",
  "headline",
  "菜名",
  "标题",
  "名称",
];
const CUISINE_LABELS = ["cuisine", "style", "recipeCuisine", "菜系", "菜式"];
const RECIPE_FIELD_LABELS = [
  ...TITLE_LABELS,
  ...CUISINE_LABELS,
  ...INGREDIENT_NAME_LABELS,
  ...INGREDIENT_AMOUNT_LABELS,
  ...STEP_TEXT_LABELS,
  "ingredients",
  "ingredientList",
  "recipeIngredient",
  "recipeIngredients",
  "materials",
  "原料",
  "用料",
  "配料",
  "order",
  "position",
  "durationSec",
  "durationSeconds",
  "durationMin",
  "minutes",
  "duration",
  "tips",
  "tip",
  "text",
  "content",
  "recipeInstructions",
  "recipeInstruction",
  "itemListElement",
  "recipeYield",
  "recipeCuisine",
  "recipeCategory",
  "keywords",
  "@type",
  "@context",
  "tags",
  "flavor",
  "difficulty",
  "totalTimeMin",
  "servings",
  "spiceLevel",
  "notes",
  "标签",
  "口味",
  "难度",
  "总时间",
  "总时间分钟",
  "份量",
  "人数",
  "辣度",
  "备注",
];
const SCHEMA_ONLY_FIELDS = new Set([
  "title",
  "name",
  "dishname",
  "recipename",
  "ingredients",
  "ingredientlist",
  "ingredient",
  "materials",
  "recipeingredient",
  "recipeingredients",
  "steps",
  "instructions",
  "recipeinstruction",
  "recipeinstructions",
  "directions",
  "method",
  "itemlistelement",
  "howtostep",
  "howtosection",
  "tags",
  "flavor",
  "difficulty",
  "cuisine",
  "recipecuisine",
  "recipecategory",
  "keywords",
  "totaltimemin",
  "totalminutes",
  "cooktimemin",
  "preptimemin",
  "servings",
  "recipeyield",
  "spicelevel",
  "notes",
  "amount",
  "quantity",
  "qty",
  "measure",
  "unit",
  "order",
  "description",
  "text",
  "content",
  "durationsec",
  "durationseconds",
  "durationmin",
  "minutes",
  "duration",
  "position",
  "tips",
  "@type",
  "@context",
  "菜名",
  "标题",
  "名称",
  "食材",
  "食材名",
  "原料",
  "用料",
  "配料",
  "步骤",
  "做法",
  "烹饪步骤",
  "标签",
  "口味",
  "难度",
  "菜系",
  "总时间分钟",
  "份量",
  "人数",
  "辣度",
  "备注",
]);

export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const withoutKnownEndpoint = trimmed
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/images\/generations$/i, "")
    .replace(/\/responses$/i, "");

  try {
    const url = new URL(withoutKnownEndpoint);
    if (
      OPENAI_COMPATIBLE_ROOT_HOSTS.has(url.hostname) &&
      (url.pathname === "" || url.pathname === "/")
    ) {
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // Validation happens in isValidOpenAIBaseUrl; keep normalization side-effect free.
  }

  return withoutKnownEndpoint;
}

export function isValidOpenAIBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(normalizeOpenAIBaseUrl(baseUrl));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_VALIDATION_TIMEOUT_MS);

  try {
    return await fetchOpenAICompatible(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();
  if (typeof input === "string") return input;
  return input.url;
}

function shouldProxyOpenAICompatibleRequest(url: string): boolean {
  if (typeof window === "undefined") return false;

  try {
    return new URL(url).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function getOpenAICompatibleProxyUrl(url: string): string {
  const proxyUrl = new URL(OPENAI_COMPATIBLE_PROXY_PATH, window.location.origin);
  proxyUrl.searchParams.set("url", url);
  return proxyUrl.toString();
}

async function fetchOpenAICompatible(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = getRequestUrl(input);

  if (shouldProxyOpenAICompatibleRequest(url)) {
    return await fetch(getOpenAICompatibleProxyUrl(url), init);
  }

  return await fetch(input, init);
}

async function fetchOpenAICompatibleWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  if (!timeoutMs) {
    return await fetchOpenAICompatible(input, init);
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchOpenAICompatible(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function createLLMError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  const detail = body.trim().slice(0, 240);
  return new Error(
    detail ? `LLM failed: ${response.status} - ${detail}` : `LLM failed: ${response.status}`,
  );
}

async function createImageGenerationError(
  response: Response,
  url: string,
  fallbackMessage = "Image gen failed",
): Promise<Error> {
  const body = await response.text().catch(() => "");
  const detail = body.trim().replace(/\s+/g, " ").slice(0, 500);
  const endpoint = new URL(url).pathname;

  if (response.status === 405) {
    return new Error(
      [
        `${fallbackMessage}: 405`,
        `The configured image endpoint does not allow this request method at ${endpoint}.`,
        "Use an OpenAI-compatible base URL such as https://api.openai.com/v1, or a full /images/generations endpoint from a provider that supports image generation.",
        detail ? `Upstream response: ${detail}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  return new Error(
    detail
      ? `${fallbackMessage}: ${response.status} - ${detail}`
      : `${fallbackMessage}: ${response.status}`,
  );
}

function trimRecipeSourceText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_RECIPE_SOURCE_CHARS) return trimmed;

  const head = trimmed.slice(0, Math.floor(MAX_RECIPE_SOURCE_CHARS * 0.7));
  const tail = trimmed.slice(-Math.floor(MAX_RECIPE_SOURCE_CHARS * 0.3));
  return `${head}\n\n[...content trimmed for faster recipe extraction...]\n\n${tail}`;
}

export async function validateOpenAIChatConfig(config: Required<LLMConfig>): Promise<boolean> {
  try {
    const baseUrl = normalizeOpenAIBaseUrl(config.baseUrl);
    const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
    });

    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return false;

    const data = (await response.json()) as { id?: unknown; object?: unknown };
    return data.id === config.model || data.object === "model";
  } catch {
    return false;
  }
}

export async function validateOpenAIModelConfig(config: Required<LLMConfig>): Promise<boolean> {
  try {
    const baseUrl = normalizeOpenAIBaseUrl(config.baseUrl);
    const headers = { Authorization: `Bearer ${config.apiKey}` };
    const modelDetailResponse = await fetchWithTimeout(
      `${baseUrl}/models/${encodeURIComponent(config.model)}`,
      { headers },
    );

    if (modelDetailResponse.ok) return true;
    if (![404, 405].includes(modelDetailResponse.status)) return false;

    const modelListResponse = await fetchWithTimeout(`${baseUrl}/models`, { headers });
    if (!modelListResponse.ok) return false;

    const contentType = modelListResponse.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return false;

    const data = (await modelListResponse.json()) as { data?: unknown };
    if (!Array.isArray(data.data)) return false;

    return data.data.some(
      (entry) => isRecord(entry) && typeof entry.id === "string" && entry.id === config.model,
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFirstString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function normalizePlaceholderText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isRecipeSchemaPlaceholder(value: string): boolean {
  return RECIPE_SCHEMA_PLACEHOLDERS.has(normalizePlaceholderText(value));
}

function omitSchemaPlaceholder(value: string): string {
  const trimmed = value.trim();
  return trimmed && !isRecipeSchemaPlaceholder(trimmed) ? trimmed : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripListMarker(value: string): string {
  return value
    .trim()
    .replace(/^[>\s]+/, "")
    .replace(/^(?:[-*+•]|\d+[.)、])\s*/, "")
    .trim();
}

function cleanRecipeTextValue(value: string): string {
  return value
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^\*\*(.*)\*\*$/s, "$1")
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/\\n/g, " ")
    .replace(/\\["'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*(?:->|=>)\s*[\w\u4e00-\u9fff\s]+$/i, "")
    .replace(/\s*[,，;；.。]\s*$/g, "")
    .trim();
}

function cleanRecipeContentText(value: string): string {
  return cleanRecipeTextValue(value)
    .replace(/\b(?:https?:\/\/|www\.)\S+$/i, "")
    .replace(
      /\s*(?:@type|@context|recipeIngredient|recipeInstructions|itemListElement)\s*[：:].*$/i,
      "",
    )
    .trim();
}

function truncateRecipeFieldTail(value: string): string {
  return truncateAtInlineLabel(value, RECIPE_FIELD_LABELS).replace(
    /\s*[.。]\s*(?:step|steps|ingredient|ingredients|instruction|instructions|tip|tips|in)\b[\s\S]*$/i,
    "",
  );
}

function getLabelPattern(labels: string[]): RegExp {
  const escaped = [...new Set(labels)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(`(^|[\\s,，;；.。])(${escaped})\\s*[：:]`, "i");
}

function findInlineLabel(
  text: string,
  labels: string[],
): { index: number; valueStart: number } | null {
  const match = text.match(getLabelPattern(labels));
  if (!match || match.index === undefined) return null;
  return {
    index: match.index,
    valueStart: match.index + match[0].length,
  };
}

function truncateAtInlineLabel(value: string, labels: string[]): string {
  const match = value.match(getLabelPattern(labels));
  if (!match || match.index === undefined) return value;
  return value.slice(0, match.index);
}

function readInlineLabeledValue(text: string, labels: string[]): string {
  const match = findInlineLabel(text, labels);
  if (!match) return "";
  return cleanRecipeTextValue(truncateRecipeFieldTail(text.slice(match.valueStart)));
}

function isSchemaNoiseLine(value: string): boolean {
  const raw = stripListMarker(value).replace(/^#+\s*/, "");
  if (/(?:->|=>)\s*(?:ingredient|ingredients|amount|title|step|steps|schema)\b/i.test(raw)) {
    return true;
  }

  const stripped = cleanRecipeTextValue(raw);
  if (!stripped) return true;
  if (isRecipeSchemaPlaceholder(stripped)) return true;
  if (/^(?:map\s+to\s+schema|schema|json|```)/i.test(stripped)) return true;
  if (/^[{}[\],:]+$/.test(stripped)) return true;

  const normalized = normalizePlaceholderText(
    stripped
      .replace(/[{}[\],:]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  if (SCHEMA_ONLY_FIELDS.has(normalized)) return true;
  if (META_REASONING_PATTERN.test(stripped)) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => SCHEMA_ONLY_FIELDS.has(word));
}

function containsMetaReasoning(value: string): boolean {
  return META_REASONING_PATTERN.test(cleanRecipeTextValue(value));
}

function readFirstRecord(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) return value;
  }
  return undefined;
}

function readFirstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function normalizeJsonLikeText(text: string): string {
  return stripJsonComments(stripMarkdownFences(text))
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，/g, ",")
    .replace(/：/g, ":")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*|[\u4e00-\u9fff]+)\s*:/g, '$1"$2":');
}

function collectJsonCandidates(text: string): string[] {
  const source = stripMarkdownFences(text);
  const candidates = [source];
  const fencedMatches = source.matchAll(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi);
  for (const match of fencedMatches) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }

  const starts = new Set<number>();
  for (const char of ["{", "["]) {
    const index = source.indexOf(char);
    if (index >= 0) starts.add(index);
  }

  for (const start of starts) {
    const open = source[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
        continue;
      }

      if (char === open) depth += 1;
      if (char === close) depth -= 1;
      if (depth === 0) {
        candidates.push(source.slice(start, index + 1));
        break;
      }
    }
  }

  const firstObject = source.indexOf("{");
  const lastObject = source.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(source.slice(firstObject, lastObject + 1));
  }

  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function parseJsonCandidate(candidate: string): unknown | null {
  const attempts = [
    candidate,
    normalizeJsonLikeText(candidate),
    normalizeJsonLikeText(candidate).replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, value) =>
      JSON.stringify(String(value).replace(/\\"/g, '"')),
    ),
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // Try the next local cleanup.
    }
  }

  return null;
}

function parseDurationToSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1_000 ? Math.round(value) : Math.round(value);
  }

  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;

  const isoMatch = text.match(ISO_DURATION_PATTERN);
  if (isoMatch) {
    const days = isoMatch[1] ? Number(isoMatch[1]) : 0;
    const hours = isoMatch[2] ? Number(isoMatch[2]) : 0;
    const minutes = isoMatch[3] ? Number(isoMatch[3]) : 0;
    const seconds = isoMatch[4] ? Number(isoMatch[4]) : 0;
    const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    if (total > 0) return Math.round(total);
  }

  const hourMatch = text.match(DURATION_HOUR_PATTERN);
  const minuteMatch = text.match(DURATION_MINUTE_PATTERN);
  const secondMatch = text.match(DURATION_SECOND_PATTERN);

  const hours = hourMatch ? Number(hourMatch[1]) : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  const seconds = secondMatch ? Number(secondMatch[1]) : 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  if (total > 0) return Math.round(total);

  const numeric = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.round(numeric);
}

function parseDurationValue(
  value: unknown,
  unit: "seconds" | "minutes" | "auto",
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(unit === "minutes" ? value * 60 : value);
  }

  if (typeof value !== "string") return undefined;
  const parsed = parseDurationToSeconds(value);
  if (parsed) {
    if (
      unit === "minutes" &&
      !DURATION_MINUTE_PATTERN.test(value) &&
      !DURATION_HOUR_PATTERN.test(value)
    ) {
      const numeric = Number(value.replace(/[^\d.]/g, ""));
      return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 60) : parsed;
    }
    return parsed;
  }

  const numeric = Number(value.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.round(unit === "minutes" ? numeric * 60 : numeric);
}

function parseDurationToMinutes(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;

    const seconds = parseDurationToSeconds(text);
    if (!seconds) return undefined;

    if (
      ISO_DURATION_PATTERN.test(text) ||
      DURATION_HOUR_PATTERN.test(text) ||
      DURATION_MINUTE_PATTERN.test(text) ||
      DURATION_SECOND_PATTERN.test(text)
    ) {
      return Math.max(1, Math.round(seconds / 60));
    }

    const numeric = Number(text.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return Math.round(numeric);
  }

  const seconds = parseDurationToSeconds(value);
  if (!seconds) return undefined;
  return Math.max(1, Math.round(seconds / 60));
}

function parseServings(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseServings(item);
      if (parsed) return parsed;
    }
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== "string") return undefined;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function normalizeDifficulty(value: unknown): RecipePayload["tags"]["difficulty"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^(easy|simple|beginner|low|简单|容易|初级|新手|低)$/.test(normalized)) return "easy";
  if (/^(medium|normal|moderate|中等|普通|一般|中)$/.test(normalized)) return "medium";
  if (/^(hard|difficult|advanced|high|困难|复杂|高级|高)$/.test(normalized)) return "hard";
  return undefined;
}

function splitListText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const stripped = stripListMarker(line);
      if (findInlineLabel(stripped, RECIPE_FIELD_LABELS)) return [stripped];
      return stripped.split(/[;；]/);
    })
    .map((item) =>
      stripListMarker(item)
        .replace(/^[\s\d.、)\]-]+/, "")
        .trim(),
    )
    .filter((item) => item && !isSchemaNoiseLine(item));
}

function splitIngredientListText(text: string): string[] {
  return splitListText(text).flatMap((item) => {
    if (findInlineLabel(item, RECIPE_FIELD_LABELS)) return [item];
    return item
      .split(/[,，、]/)
      .map((part) => cleanRecipeContentText(part))
      .filter((part) => part && !isSchemaNoiseLine(part));
  });
}

function joinAmountUnit(amount: string, unit: string): string {
  if (!amount) return unit;
  if (!unit || amount.toLowerCase().includes(unit.toLowerCase())) return amount;
  return /[\u4e00-\u9fff]/.test(unit) ? `${amount}${unit}` : `${amount} ${unit}`;
}

function stringifyAmountValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return cleanRecipeContentText(value);
  if (!isRecord(value)) return "";

  const amount = readFirstString(value, ["value", "minValue", "maxValue", "amount", "quantity"]);
  const unit = readFirstString(value, ["unitText", "unitCode", "unit", "单位"]);
  return cleanRecipeContentText(joinAmountUnit(amount, unit));
}

function readIngredientAmount(source: Record<string, unknown>): string {
  const amount = stringifyAmountValue(
    readFirstValue(source, ["amount", "quantity", "qty", "measure", "用量", "份量", "数量"]),
  );
  const unit = readFirstString(source, ["unit", "unitText", "unitCode", "单位"]);
  return cleanRecipeContentText(joinAmountUnit(amount, unit));
}

function splitFlavor(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item && !isRecipeSchemaPlaceholder(item))
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value !== "string") return undefined;
  const items = value
    .split(/[,，、/|;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item && !isRecipeSchemaPlaceholder(item))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

const HEURISTIC_STEP_PATTERN =
  /(?:先|首先|然后|再|接着|随后|最后|把|将|用|加入|放入|倒入|下入|撒入|切|切成|切好|剁|拍|腌|拌|搅拌|翻炒|炒|煎|炸|烤|蒸|煮|炖|焖|焯|爆香|收汁|勾芡|出锅|盛出|装盘|备用|浸泡|清洗|冲洗|去皮|揉|醒发|发酵|mix|stir|add|cook|boil|simmer|fry|saute|bake|roast|steam|grill|marinate|season|serve)/i;
const HEURISTIC_FILLER_PATTERN =
  /(?:大家好|hello|hi everyone|点赞|关注|收藏|转发|订阅|感谢观看|下期见|记得关注|我是|欢迎来到|sponsor|sponsored|subscribe)/i;
const HEAT_OR_TIP_PATTERN =
  /(?:小火|中火|大火|微火|全程|注意|不要|别|记得|避免|low heat|medium heat|high heat|be careful|make sure)/i;

function normalizeIngredient(value: unknown): RecipePayload["ingredients"][number] | null {
  if (typeof value === "string") {
    const text = cleanRecipeContentText(stripListMarker(value));
    if (!text) return null;
    if (isSchemaNoiseLine(text)) return null;

    const parsedInlineJson = parseJsonCandidate(text);
    if (parsedInlineJson !== null && parsedInlineJson !== text) {
      if (Array.isArray(parsedInlineJson)) {
        const first = parsedInlineJson.map(normalizeIngredient).find(Boolean);
        return first ?? null;
      }
      if (isRecord(parsedInlineJson)) return normalizeIngredient(parsedInlineJson);
    }

    const amountLabel = findInlineLabel(text, INGREDIENT_AMOUNT_LABELS);
    const nameLabel = findInlineLabel(text, INGREDIENT_NAME_LABELS);
    const namePrefix =
      amountLabel && amountLabel.index > 0
        ? cleanRecipeContentText(text.slice(0, amountLabel.index))
        : "";
    const nameFromLabel =
      namePrefix && (!nameLabel || amountLabel!.index < nameLabel.index)
        ? namePrefix
        : readInlineLabeledValue(text, INGREDIENT_NAME_LABELS);
    const amountFromLabel = readInlineLabeledValue(text, INGREDIENT_AMOUNT_LABELS);
    if (nameFromLabel || amountFromLabel) {
      const name = omitSchemaPlaceholder(nameFromLabel);
      const amount = omitSchemaPlaceholder(amountFromLabel);
      return name || amount ? { name, amount } : null;
    }

    if (findInlineLabel(text, STEP_TEXT_LABELS)) return null;

    const parts = text.split(/\s*[：:]\s*/);
    if (parts.length >= 2) {
      const name = omitSchemaPlaceholder(cleanRecipeContentText(parts[0]));
      const amount = omitSchemaPlaceholder(
        cleanRecipeContentText(truncateRecipeFieldTail(parts.slice(1).join(":"))),
      );
      if (!name && !amount) return null;
      return {
        name,
        amount,
      };
    }

    const quantityText = String.raw`(?:约|大约|大概|少许|适量|若干|半|\d+(?:\.\d+)?(?:/\d+)?|[一二两三四五六七八九十百]+)`;
    const unitText = String.raw`(?:克|千克|公斤|斤|两|毫升|升|个|颗|枚|只|根|把|片|块|条|瓣|粒|朵|包|袋|罐|盒|碗|勺|大勺|小勺|汤匙|茶匙|杯|g|kg|ml|l|oz|lb|lbs|cups?|tbsp|tbsps|tablespoons?|tsp|tsps|teaspoons?)`;
    const trailingAmount = text.match(
      new RegExp(
        `^(.+?)(\\s*(?:${quantityText})(?:\\s*${unitText})?(?:\\s*(?:左右|以上|以下|多|许))?)$`,
        "i",
      ),
    );
    if (trailingAmount) {
      const name = omitSchemaPlaceholder(cleanRecipeContentText(trailingAmount[1]));
      const amount = omitSchemaPlaceholder(cleanRecipeContentText(trailingAmount[2]));
      if (name || amount) return { name, amount };
    }

    const delimitedAmount = text.match(
      /^(.+?)(?:\s+|，|,)([\d一二两三四五六七八九十半少许适量大约约].*)$/,
    );
    if (delimitedAmount) {
      return {
        name: omitSchemaPlaceholder(cleanRecipeContentText(delimitedAmount[1])),
        amount: omitSchemaPlaceholder(
          cleanRecipeContentText(truncateRecipeFieldTail(delimitedAmount[2])),
        ),
      };
    }

    const leadingAmount = text.match(
      new RegExp(`^((?:${quantityText})(?:\\s*${unitText})?)(?:\\s*(?:of\\s+)?)?(.+)$`, "i"),
    );
    if (leadingAmount) {
      const amount = omitSchemaPlaceholder(cleanRecipeContentText(leadingAmount[1]));
      const name = omitSchemaPlaceholder(cleanRecipeContentText(leadingAmount[2]));
      if (name || amount) return { name, amount };
    }

    return { name: text, amount: "" };
  }

  if (!isRecord(value)) return null;
  const name = omitSchemaPlaceholder(
    cleanRecipeContentText(
      readFirstString(value, [
        "name",
        "ingredient",
        "item",
        "food",
        "text",
        "recipeIngredient",
        "食材名",
        "食材",
        "原料",
        "名称",
      ]),
    ),
  );
  const amount = omitSchemaPlaceholder(readIngredientAmount(value));
  if (!name && amount) {
    const parsedAmount = normalizeIngredient(amount);
    if (parsedAmount?.name) return parsedAmount;
  }
  if (name && !amount) {
    const parsedName = normalizeIngredient(name);
    if (parsedName?.amount) return parsedName;
  }
  if (!name && !amount) return null;
  return { name, amount };
}

function normalizeIngredients(value: unknown): RecipePayload["ingredients"] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? splitIngredientListText(value)
      : isRecord(value)
        ? [value]
        : [];
  const seen = new Set<string>();

  return values
    .map(normalizeIngredient)
    .filter((item): item is RecipePayload["ingredients"][number] =>
      Boolean(item && (item.name || item.amount)),
    )
    .filter((item) => {
      const key = `${normalizePlaceholderText(item.name)}\u0000${normalizePlaceholderText(
        item.amount,
      )}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeStep(value: unknown, index: number): RecipePayload["steps"][number] | null {
  if (typeof value === "string") {
    const text = cleanRecipeContentText(stripListMarker(value).replace(/^[\s\d.、)\]-]+/, ""));
    if (!text || isSchemaNoiseLine(text)) return null;
    if (parseJsonCandidate(text) !== null) return null;
    if (
      !findInlineLabel(text, STEP_TEXT_LABELS) &&
      (findInlineLabel(text, INGREDIENT_NAME_LABELS) ||
        findInlineLabel(text, INGREDIENT_AMOUNT_LABELS))
    ) {
      return null;
    }

    const description = readInlineLabeledValue(text, STEP_TEXT_LABELS) || text;
    if (isRecipeSchemaPlaceholder(description) || isSchemaNoiseLine(description)) return null;
    if (containsMetaReasoning(description)) return null;
    return description ? { order: index + 1, description } : null;
  }

  if (!isRecord(value)) return null;
  const description = omitSchemaPlaceholder(
    cleanRecipeContentText(
      readFirstString(value, [
        "description",
        "text",
        "instruction",
        "direction",
        "step",
        "content",
        "name",
        "做法",
        "步骤",
        "内容",
        "描述",
      ]),
    ),
  );
  if (!description) return null;
  if (containsMetaReasoning(description)) return null;

  const orderValue = readFirstValue(value, ["order", "stepNumber", "index", "position", "序号"]);
  const order =
    typeof orderValue === "number" && Number.isFinite(orderValue) && orderValue > 0
      ? Math.round(orderValue)
      : index + 1;
  const durationSec =
    parseDurationValue(
      readFirstValue(value, ["durationSec", "durationSeconds", "seconds", "秒数"]),
      "seconds",
    ) ??
    parseDurationValue(
      readFirstValue(value, ["durationMin", "durationMinutes", "minutes", "分钟数"]),
      "minutes",
    ) ??
    parseDurationValue(readFirstValue(value, ["duration", "time", "时间", "时长"]), "auto");
  const tips = omitSchemaPlaceholder(
    cleanRecipeContentText(
      readFirstString(value, ["tips", "tip", "note", "notes", "提示", "小贴士", "备注"]),
    ),
  );

  return {
    order,
    description,
    ...(durationSec ? { durationSec } : {}),
    ...(tips ? { tips } : {}),
  };
}

function collectStepValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(collectStepValues);
  if (!isRecord(value)) return [value];

  const nested = readFirstValue(value, [
    "itemListElement",
    "items",
    "steps",
    "instructions",
    "recipeInstructions",
    "做法",
    "步骤",
  ]);

  const directText = readFirstString(value, [
    "description",
    "text",
    "instruction",
    "direction",
    "step",
    "content",
    "做法",
    "步骤",
    "内容",
    "描述",
  ]);

  if (nested !== undefined && !directText) return collectStepValues(nested);
  return [value];
}

function normalizeSteps(value: unknown): RecipePayload["steps"] {
  const values =
    typeof value === "string"
      ? splitListText(value)
      : value === undefined
        ? []
        : collectStepValues(value);

  return values
    .map(normalizeStep)
    .filter((step): step is RecipePayload["steps"][number] => Boolean(step))
    .map((step, index) => ({ ...step, order: index + 1 }));
}

function getTypeNames(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function isRecipeLikeRecord(value: Record<string, unknown>): boolean {
  const typeNames = getTypeNames(readFirstValue(value, ["@type", "type"]));
  if (typeNames.some((type) => /(^|[/#:])recipe$/i.test(type))) return true;
  return [
    "recipeIngredient",
    "recipeIngredients",
    "recipeInstructions",
    "recipeInstruction",
    "ingredients",
    "ingredientList",
    "steps",
    "instructions",
    "做法",
    "步骤",
    "食材",
    "原料",
    "用料",
  ].some((key) => value[key] !== undefined);
}

function findRecipeLikeRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipeLikeRecord(item);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;
  if (isRecipeLikeRecord(value)) return value;

  for (const key of [
    "recipe",
    "data",
    "result",
    "output",
    "structuredRecipe",
    "mainEntity",
    "mainEntityOfPage",
    "@graph",
    "graph",
    "菜谱",
  ]) {
    const found = findRecipeLikeRecord(value[key]);
    if (found) return found;
  }

  return null;
}

function unwrapRecipeObject(value: unknown): Record<string, unknown> | null {
  const foundRecipe = findRecipeLikeRecord(value);
  if (foundRecipe) return foundRecipe;

  if (Array.isArray(value)) {
    const firstRecord = value.find(isRecord);
    return firstRecord ?? null;
  }

  if (!isRecord(value)) return null;

  for (const key of ["recipe", "data", "result", "output", "structuredRecipe", "菜谱"]) {
    const nested = value[key];
    if (isRecord(nested)) return nested;
  }

  return value;
}

function normalizeRecipePayload(value: unknown): RecipePayload | null {
  const recipe = unwrapRecipeObject(value);
  if (!recipe) return null;

  const tags = readFirstRecord(recipe, ["tags", "tag", "metadata", "meta", "labels", "标签"]) ?? {};
  const ingredients = normalizeIngredients(
    readFirstValue(recipe, [
      "ingredients",
      "ingredientList",
      "recipeIngredient",
      "recipeIngredients",
      "materials",
      "食材",
      "原料",
      "用料",
      "配料",
    ]),
  );
  const steps = normalizeSteps(
    readFirstValue(recipe, [
      "steps",
      "instructions",
      "recipeInstructions",
      "recipeInstruction",
      "itemListElement",
      "directions",
      "method",
      "做法",
      "步骤",
      "烹饪步骤",
    ]),
  );

  if (ingredients.length === 0 && steps.length === 0) return null;

  const title = omitSchemaPlaceholder(
    cleanRecipeContentText(
      readFirstString(recipe, [
        "title",
        "name",
        "dishName",
        "recipeName",
        "headline",
        "菜名",
        "名称",
        "标题",
      ]),
    ),
  );
  const flavor =
    splitFlavor(readFirstValue(tags, ["flavor", "flavors", "taste", "口味", "风味"])) ??
    splitFlavor(readFirstValue(recipe, ["recipeCategory", "keywords", "category", "标签", "口味"]));
  const cuisine = omitSchemaPlaceholder(
    cleanRecipeContentText(
      readFirstString(tags, ["cuisine", "style", "recipeCuisine", "菜系", "菜式"]) ||
        readFirstString(recipe, ["recipeCuisine", "cuisine", "style", "菜系", "菜式"]),
    ),
  );
  const difficulty = normalizeDifficulty(
    readFirstValue(tags, ["difficulty", "level", "难度"]) ??
      readFirstValue(recipe, ["difficulty", "level", "难度"]),
  );
  const totalTimeMin =
    parseDurationToMinutes(
      readFirstValue(tags, ["totalTimeMin", "totalMinutes", "cookTimeMin", "总时间分钟"]),
    ) ??
    parseDurationToMinutes(
      readFirstValue(recipe, [
        "totalTimeMin",
        "totalMinutes",
        "cookTimeMin",
        "prepTimeMin",
        "总时间分钟",
      ]),
    ) ??
    parseDurationToMinutes(
      readFirstValue(tags, ["totalTime", "cookTime", "time", "总时间", "烹饪时间", "耗时"]),
    ) ??
    parseDurationToMinutes(
      readFirstValue(recipe, [
        "totalTime",
        "cookTime",
        "prepTime",
        "time",
        "总时间",
        "烹饪时间",
        "耗时",
      ]),
    );
  const servings = parseServings(
    readFirstValue(tags, ["servings", "serves", "portion", "份量", "人数"]) ??
      readFirstValue(recipe, [
        "recipeYield",
        "yield",
        "servings",
        "serves",
        "portion",
        "份量",
        "人数",
      ]),
  );
  const spiceLevel = omitSchemaPlaceholder(
    cleanRecipeContentText(readFirstString(tags, ["spiceLevel", "spicy", "辣度"])),
  );
  const notes = omitSchemaPlaceholder(
    cleanRecipeContentText(readFirstString(tags, ["notes", "note", "备注"])),
  );

  return {
    title,
    ingredients,
    steps,
    tags: {
      ...(flavor ? { flavor } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(cuisine ? { cuisine } : {}),
      ...(totalTimeMin ? { totalTimeMin } : {}),
      ...(servings ? { servings } : {}),
      ...(spiceLevel ? { spiceLevel } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

function parseLabeledRecipeText(text: string): RecipePayload | null {
  const rawTitle = text.match(/(?:菜名|标题|名称|title|name)\s*[：:]\s*([^\n]+)/i)?.[1] ?? "";
  const title = omitSchemaPlaceholder(
    cleanRecipeTextValue(truncateAtInlineLabel(rawTitle, RECIPE_FIELD_LABELS)),
  );
  const cuisine = omitSchemaPlaceholder(readInlineLabeledValue(text, CUISINE_LABELS));
  const ingredientBlock =
    text.match(
      /(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?(?:食材|原料|用料|ingredients?)(?:\*\*)?\s*[：:]\s*([\s\S]*?)(?=\n\s*(?:#+\s*)?(?:\*\*)?(?:步骤|做法|instructions?|steps?|map\s+to\s+schema|schema|tags?|metadata|标签)(?:\*\*)?\s*[：:]?|$)/i,
    )?.[1] ?? "";
  const stepBlock =
    text.match(
      /(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?(?:步骤|做法|instructions?|steps?)(?:\*\*)?\s*[：:]\s*([\s\S]*?)(?=\n\s*(?:#+\s*)?(?:\*\*)?(?:map\s+to\s+schema|schema|tags?|metadata|标签)(?:\*\*)?\s*[：:]?|$)/i,
    )?.[1] ?? "";

  const ingredients = normalizeIngredients(ingredientBlock);
  const steps = normalizeSteps(stepBlock);
  if (ingredients.length === 0 && steps.length === 0) return null;

  return { title, ingredients, steps, tags: cuisine ? { cuisine } : {} };
}

function normalizeHeuristicSentence(value: string): string {
  return cleanRecipeTextValue(
    value
      .replace(/^[,，。；;:：\s]+/, "")
      .replace(
        /^(?:先|首先|然后|再|接着|随后|最后一步|最后|这时候|此时|下一步|step\s*\d+|第[\d一二三四五六七八九十]+步)\s*/i,
        "",
      ),
  );
}

function splitHeuristicSegments(text: string): string[] {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[。！？!?；;]/g, "\n")
    .replace(/([，,])\s*(然后|再|接着|随后|最后|最后再|下一步)/g, "\n$2")
    .replace(/(?:\n|^)\s*(?:\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/g, "\n");

  return normalized
    .split(/\n+/)
    .flatMap((segment) => segment.split(/(?<=\S)\s{2,}/))
    .map((segment) => normalizeHeuristicSentence(segment))
    .filter(Boolean);
}

function isLikelyRecipeStep(text: string): boolean {
  if (!text || text.length < 4) return false;
  if (HEURISTIC_FILLER_PATTERN.test(text) && !HEURISTIC_STEP_PATTERN.test(text)) return false;
  if (containsMetaReasoning(text)) return false;
  return (
    HEURISTIC_STEP_PATTERN.test(text) ||
    HEAT_OR_TIP_PATTERN.test(text) ||
    Boolean(parseDurationToSeconds(text))
  );
}

function inferRecipeTitleFromText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:今天(?:给大家)?(?:分享|做|教大家做|来做)|这次做|我们做|来做一道|教你做|做一道|做一个)\s*["“]?([^"，。！？,.!?\n]{2,24})["”]?/i,
    /([^"，。！？,.!?\n]{2,24})(?:的做法|教程|怎么做)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern)?.[1];
    const title = omitSchemaPlaceholder(cleanRecipeTextValue(match ?? ""));
    if (title && !HEURISTIC_FILLER_PATTERN.test(title)) return title;
  }

  return "";
}

function inferIngredientsFromText(text: string): RecipePayload["ingredients"] {
  const matches = [
    ...text.matchAll(
      /(?:食材|配料|用料|准备|材料)[:：]?\s*([^\n]+(?:\n(?!.*(?:步骤|做法|开始|先|然后|接着|最后)).+)*)/gi,
    ),
  ];
  const candidates = matches
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .flatMap((block) => block.split(/[\n,，、]/))
    .map((item) => cleanRecipeTextValue(item))
    .filter(Boolean);

  return normalizeIngredients(candidates);
}

function inferStepsFromText(text: string): RecipePayload["steps"] {
  const seen = new Set<string>();
  const steps: RecipePayload["steps"] = [];

  for (const segment of splitHeuristicSegments(text)) {
    if (!isLikelyRecipeStep(segment)) continue;

    const description = normalizeHeuristicSentence(segment);
    if (!description || description.length < 4) continue;

    const dedupeKey = normalizePlaceholderText(description);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const durationSec = parseDurationToSeconds(description);
    const tips =
      HEAT_OR_TIP_PATTERN.test(description) && description.length <= 60 ? description : undefined;

    steps.push({
      order: steps.length + 1,
      description,
      ...(durationSec ? { durationSec } : {}),
      ...(tips && tips !== description ? { tips } : {}),
    });
  }

  return steps.slice(0, 20).map((step, index) => ({ ...step, order: index + 1 }));
}

function buildHeuristicRecipePayload(text: string): RecipePayload | null {
  const source = trimRecipeSourceText(text);
  if (!source) return null;

  const ingredients = inferIngredientsFromText(source);
  const steps = inferStepsFromText(source);
  if (ingredients.length === 0 && steps.length === 0) return null;

  return {
    title: inferRecipeTitleFromText(source),
    ingredients,
    steps,
    tags: {},
  };
}

function mergeRecipeTags(
  primary: RecipePayload["tags"],
  fallback: RecipePayload["tags"],
): RecipePayload["tags"] {
  return {
    ...fallback,
    ...primary,
    flavor: primary.flavor?.length ? primary.flavor : fallback.flavor,
  };
}

function enrichRecipePayload(
  recipe: RecipePayload,
  ...fallbackTexts: Array<string | undefined>
): RecipePayload {
  let enriched: RecipePayload = {
    title: recipe.title,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    tags: { ...recipe.tags, flavor: recipe.tags.flavor ? [...recipe.tags.flavor] : undefined },
  };

  for (const text of fallbackTexts) {
    if (!text?.trim()) continue;
    const heuristic = buildHeuristicRecipePayload(text);
    if (!heuristic) continue;

    enriched = {
      title: enriched.title || heuristic.title,
      ingredients: enriched.ingredients.length > 0 ? enriched.ingredients : heuristic.ingredients,
      steps: enriched.steps.length > 0 ? enriched.steps : heuristic.steps,
      tags: mergeRecipeTags(enriched.tags, heuristic.tags),
    };
  }

  return enriched;
}

const ZH_TAG_TRANSLATIONS: Record<string, string> = {
  savory: "咸鲜",
  salty: "咸香",
  sweet: "甜",
  spicy: "辣",
  mild: "清淡",
  sour: "酸",
  umami: "鲜味",
  crispy: "酥脆",
  tender: "鲜嫩",
  homey: "家常",
  homestyle: "家常",
  chinese: "中式",
  asian: "亚洲风味",
};

function localizeShortRecipeText(value: string, language: AppLanguage): string {
  const content = cleanRecipeContentText(value);
  if (!content) return "";
  if (language === "zh") {
    const translated = ZH_TAG_TRANSLATIONS[content.toLowerCase()];
    if (translated) return translated;
  }
  return omitSchemaPlaceholder(content);
}

function localizeRecipePayload(recipe: RecipePayload, language: AppLanguage): RecipePayload {
  const ingredients = recipe.ingredients
    .map((item) => ({
      name: localizeShortRecipeText(item.name, language),
      amount: localizeShortRecipeText(item.amount, language),
    }))
    .filter((item) => item.name || item.amount);

  const steps = recipe.steps
    .map((step, index) => {
      const description = localizeShortRecipeText(step.description, language);
      const tips = step.tips ? localizeShortRecipeText(step.tips, language) : "";
      return {
        order: index + 1,
        description,
        ...(step.durationSec ? { durationSec: step.durationSec } : {}),
        ...(tips ? { tips } : {}),
      };
    })
    .filter((step) => step.description);

  const flavor = recipe.tags.flavor
    ?.map((item) => localizeShortRecipeText(item, language))
    .filter(Boolean);
  const cuisine = recipe.tags.cuisine ? localizeShortRecipeText(recipe.tags.cuisine, language) : "";
  const spiceLevel = recipe.tags.spiceLevel
    ? localizeShortRecipeText(recipe.tags.spiceLevel, language)
    : "";
  const notes = recipe.tags.notes ? localizeShortRecipeText(recipe.tags.notes, language) : "";

  return {
    title: localizeShortRecipeText(recipe.title, language),
    ingredients,
    steps,
    tags: {
      ...(flavor?.length ? { flavor } : {}),
      ...(recipe.tags.difficulty ? { difficulty: recipe.tags.difficulty } : {}),
      ...(cuisine ? { cuisine } : {}),
      ...(recipe.tags.totalTimeMin ? { totalTimeMin: recipe.tags.totalTimeMin } : {}),
      ...(recipe.tags.servings ? { servings: recipe.tags.servings } : {}),
      ...(spiceLevel ? { spiceLevel } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

export class LLMService {
  private config: Required<LLMConfig>;

  constructor(config: LLMConfig) {
    this.config = {
      baseUrl: DEFAULT_LLM_BASE_URL,
      model: DEFAULT_LLM_MODEL,
      ...config,
    };
    this.config.baseUrl = normalizeOpenAIBaseUrl(this.config.baseUrl);
  }

  private buildChatRequestBody(messages: ChatMessage[], options: ChatOptions = {}) {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: options.temperature ?? 0.7,
    };

    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.responseFormat) body.response_format = { type: options.responseFormat };

    return body;
  }

  private async postChatCompletion(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<Response> {
    try {
      return await fetchOpenAICompatibleWithTimeout(
        `${this.config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(this.buildChatRequestBody(messages, options)),
        },
        options.timeoutMs,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (options.timeoutMs) {
          throw new Error(`LLM request timed out after ${Math.round(options.timeoutMs / 1000)}s`);
        }
        throw new Error("LLM request was aborted");
      }
      throw error;
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    let response = await this.postChatCompletion(messages, options);

    if (!response.ok && options.responseFormat && [400, 422].includes(response.status)) {
      response = await this.postChatCompletion(messages, {
        ...options,
        responseFormat: undefined,
      });
    }

    if (!response.ok) throw await createLLMError(response);
    const data = (await response.json()) as ChatCompletionResponse;
    return data.choices[0].message.content;
  }

  async chatStream(messages: ChatMessage[], options: ChatStreamOptions = {}): Promise<string> {
    const response = await fetchOpenAICompatible(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.7,
        stream: true,
      }),
    });

    if (!response.ok) throw await createLLMError(response);

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.body || !contentType.includes("text/event-stream")) {
      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices[0]?.message.content ?? "";
      if (content) options.onChunk?.(content);
      return content;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    const processEvent = (rawEvent: string) => {
      const dataLines = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      for (const line of dataLines) {
        if (line === "[DONE]") continue;

        const payload = JSON.parse(line) as ChatCompletionStreamResponse;
        const delta = payload.choices?.[0]?.delta?.content;
        const chunk = Array.isArray(delta)
          ? delta.map((item) => (typeof item.text === "string" ? item.text : "")).join("")
          : typeof delta === "string"
            ? delta
            : "";

        if (!chunk) continue;
        fullText += chunk;
        options.onChunk?.(chunk);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      let boundaryIndex = buffer.indexOf("\n\n");
      while (boundaryIndex >= 0) {
        const rawEvent = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + 2);
        if (rawEvent) processEvent(rawEvent);
        boundaryIndex = buffer.indexOf("\n\n");
      }

      if (done) break;
    }

    const trailing = buffer.trim();
    if (trailing) processEvent(trailing);

    return fullText;
  }

  private parseRecipePayload(result: string, errorMessage: string): RecipePayload | null {
    for (const candidate of collectJsonCandidates(result)) {
      const parsed = parseJsonCandidate(candidate);
      if (parsed === null) continue;

      const normalized = normalizeRecipePayload(parsed);
      if (normalized) {
        return normalized;
      }
    }

    return parseLabeledRecipeText(result);
  }

  private async parseOrRepairRecipePayload(
    result: string,
    errorMessage: string,
    fallbackSourceText?: string,
  ): Promise<RecipePayload> {
    const parsed = this.parseRecipePayload(result, errorMessage);
    if (parsed) {
      return enrichRecipePayload(parsed, result, fallbackSourceText);
    }

    const repairPrompt = [
      "Convert the following failed recipe extraction response into valid JSON only.",
      "Do not add markdown or explanation.",
      "Use this schema exactly:",
      "{",
      '  "title": "Recipe name",',
      '  "ingredients": [{"name": "ingredient", "amount": "amount"}],',
      '  "steps": [{"order": 1, "description": "step text", "durationSec": 300, "tips": "optional tip"}],',
      '  "tags": {"flavor": ["savory"], "difficulty": "easy|medium|hard", "cuisine": "cuisine name", "totalTimeMin": 20}',
      "}",
      "",
      `Failed response:\n${trimRecipeSourceText(result)}`,
    ].join("\n");

    const repaired = await this.chat(
      [
        {
          role: "system",
          content:
            "You repair malformed recipe data. Always respond with valid JSON only, no markdown.",
        },
        { role: "user", content: repairPrompt },
      ],
      { maxTokens: 1400, responseFormat: "json_object", temperature: 0 },
    );

    const repairedParsed = this.parseRecipePayload(repaired, errorMessage);
    if (repairedParsed) {
      return enrichRecipePayload(repairedParsed, repaired, fallbackSourceText, result);
    }

    const heuristic =
      buildHeuristicRecipePayload(result) ??
      (fallbackSourceText ? buildHeuristicRecipePayload(fallbackSourceText) : null);
    if (heuristic) return heuristic;

    throw new Error(errorMessage);
  }

  structureRecipe = async (transcript: string, language?: AppLanguage): Promise<RecipePayload> => {
    return this.structureRecipeInLanguage(transcript, resolveRecipeLanguage(language));
  };

  structureRecipeFromText = async (
    recipeText: string,
    language?: AppLanguage,
  ): Promise<RecipePayload> => {
    return this.structureRecipeFromTextInLanguage(recipeText, resolveRecipeLanguage(language));
  };

  private async structureRecipeInLanguage(
    transcript: string,
    language: AppLanguage,
  ): Promise<RecipePayload> {
    if (!transcript.trim()) {
      throw new Error("Cannot structure recipe from empty transcript");
    }

    const prompt =
      language === "zh"
        ? `下面是一段做菜视频的转写内容，请将它整理成结构化 JSON：
{
  "title": "菜名",
  "ingredients": [{"name": "食材名", "amount": "用量"}],
  "steps": [{"order": 1, "description": "步骤描述", "durationSec": 300, "tips": "可选提示"}],
  "tags": {"flavor": ["口味"], "difficulty": "easy|medium|hard", "cuisine": "菜系", "totalTimeMin": 20}
}
要求：
- 忽略寒暄、广告、口头禅和与做菜无关的内容。
- 保留真正有用的菜名、食材、步骤、火候、时长和关键技巧。
- 像“煮 3 分钟”“小火焖 10 分钟”这类时长，请尽量提取到 "durationSec"。
- 重要的火候、注意事项、技巧补充写到 "tips"。
- 不要输出 Markdown、解释、字段说明或思考过程，只返回合法 JSON。

转写内容：
${trimRecipeSourceText(transcript)}`
        : `Below is a cooking-video transcript. Convert it into structured JSON:
{
  "title": "Recipe name",
  "ingredients": [{"name": "ingredient", "amount": "amount"}],
  "steps": [{"order": 1, "description": "step description", "durationSec": 300, "tips": "optional tip"}],
  "tags": {"flavor": ["savory"], "difficulty": "easy|medium|hard", "cuisine": "cuisine name", "totalTimeMin": 20}
}
Rules:
- Ignore filler chatter, greetings, ads, and non-recipe content.
- Title, ingredients, and steps should be in English unless the source clearly requires another language.
- Extract durations from wording like "boil for 3 minutes" or "simmer on low for 10 minutes".
- Put important heat control, technique, and caution notes into tips.
- Do not include markdown, explanations, field-mapping notes, or chain-of-thought. Return JSON only.

Transcript:
${trimRecipeSourceText(transcript)}`;

    const result = await this.chat(
      [
        {
          role: "system",
          content:
            language === "zh"
              ? "你是一名专业厨艺助手。始终只返回合法 JSON，不要输出 Markdown、解释或思考过程。"
              : "You are a professional chef assistant. Always respond with valid JSON only, no markdown, no explanations, and no chain-of-thought.",
        },
        { role: "user", content: prompt },
      ],
      { maxTokens: 1400, responseFormat: "json_object", temperature: 0 },
    );

    const recipe = await this.parseOrRepairRecipePayload(
      result,
      "No usable recipe content was extracted from the transcript",
      transcript,
    );
    return localizeRecipePayload(recipe, language);
  }

  private async structureRecipeFromTextInLanguage(
    recipeText: string,
    language: AppLanguage,
  ): Promise<RecipePayload> {
    if (!recipeText.trim()) {
      throw new Error("Cannot structure recipe from empty recipe text");
    }

    const prompt = [
      language === "zh"
        ? "你需要把原始菜谱文字整理成 CookTalk 可用的结构化 JSON。"
        : "You are converting rough recipe text into structured CookTalk recipe JSON.",
      language === "zh"
        ? "输入可能是网页摘录、聊天记录、做菜笔记，或者没有排版的整段菜谱文字。"
        : "The input may be a web page excerpt, pasted recipe, plain notes, or unformatted cooking text.",
      language === "zh"
        ? "只返回合法 JSON，不要输出 Markdown，结构请严格遵循下面的 schema："
        : "Return valid JSON only, no markdown, using this schema:",
      "{",
      language === "zh" ? '  "title": "菜名",' : '  "title": "Recipe name",',
      language === "zh"
        ? '  "ingredients": [{"name": "食材名", "amount": "用量"}],'
        : '  "ingredients": [{"name": "ingredient", "amount": "amount"}],',
      language === "zh"
        ? '  "steps": [{"order": 1, "description": "步骤描述", "durationSec": 300, "tips": "可选提示"}],'
        : '  "steps": [{"order": 1, "description": "step text", "durationSec": 300, "tips": "optional tip"}],',
      '  "tags": {',
      language === "zh" ? '    "flavor": ["口味"],' : '    "flavor": ["savory"],',
      '    "difficulty": "easy|medium|hard",',
      language === "zh" ? '    "cuisine": "菜系",' : '    "cuisine": "cuisine name",',
      '    "totalTimeMin": 20,',
      '    "servings": 2,',
      language === "zh" ? '    "spiceLevel": "辣度",' : '    "spiceLevel": "mild",',
      language === "zh" ? '    "notes": "可选备注"' : '    "notes": "optional notes"',
      "  }",
      "}",
      language === "zh" ? "要求：" : "Rules:",
      language === "zh"
        ? "- 尽量保留用户原本想表达的菜名和做法。"
        : "- Preserve the user's intended dish and wording where practical.",
      language === "zh"
        ? "- 把内容拆成清晰的食材列表和有顺序的步骤。"
        : "- Break the recipe into clear ingredients and ordered steps.",
      language === "zh"
        ? "- 如果输入来自网页 JSON 或 JSON-LD，只提取实际菜谱值；不要把 @type、@context、recipeIngredient、recipeInstructions、schema 字段名写进标题、食材或步骤。"
        : "- If the input is web JSON or JSON-LD, extract only actual recipe values; never put @type, @context, recipeIngredient, recipeInstructions, or schema field names into title, ingredients, or steps.",
      language === "zh"
        ? "- 食材的 name 只放食材名称，amount 只放数量和单位；不要把整段步骤或 JSON 片段塞进食材字段。"
        : "- Put only the ingredient name in name and only quantity/unit in amount; do not place full steps or JSON fragments in ingredient fields.",
      language === "zh"
        ? "- 步骤文字要简洁，适合做菜时朗读。"
        : "- Keep step text concise and readable for cooking playback.",
      language === "zh"
        ? "- 标题、食材、步骤、菜系、口味、辣度、备注都用中文输出；difficulty 只能用 easy、medium、hard。"
        : "- Match the current interface language for title, ingredients, steps, cuisine, flavor, spice level, and notes; difficulty must be easy, medium, or hard.",
      language === "zh"
        ? "- 只有在文本里有依据时，才补充可推断的可选信息。"
        : "- Infer optional metadata only when reasonably supported by the text.",
      language === "zh"
        ? "- 不确定的可选字段宁可省略，也不要编造。"
        : "- Omit unknown optional fields instead of inventing details.",
      language === "zh"
        ? "- 不要输出 Markdown、schema 解释、字段映射说明、思考过程或自言自语。"
        : "- Do not include markdown, schema explanations, field mapping notes, chain-of-thought, or self-talk.",
      "",
      `${language === "zh" ? "菜谱文字" : "Recipe text"}:
${trimRecipeSourceText(recipeText)}`,
    ].join("\n");

    const result = await this.chat(
      [
        {
          role: "system",
          content:
            language === "zh"
              ? "你是一名专业厨艺助手。始终只返回合法 JSON，不要输出 Markdown、解释或思考过程。"
              : "You are a professional chef assistant. Always respond with valid JSON only, no markdown, no explanations, and no chain-of-thought.",
        },
        { role: "user", content: prompt },
      ],
      { maxTokens: 1400, responseFormat: "json_object", temperature: 0 },
    );

    const recipe = await this.parseOrRepairRecipePayload(
      result,
      "Failed to parse structured recipe JSON from text input",
      recipeText,
    );
    return localizeRecipePayload(recipe, language);
  }

  async refineRecipeWithAnswers(
    recipe: RecipePayload,
    answers: {
      servings?: string;
      spiceLevel?: string;
      notes?: string;
    },
  ): Promise<RecipePayload> {
    const prompt = [
      "You are improving a structured recipe for CookTalk.",
      "Return valid JSON only, with the exact same schema as the input recipe.",
      "Update the recipe using the user's follow-up answers.",
      "Keep ingredients and steps intact unless the answers imply a small wording adjustment.",
      "Put numeric servings into tags.servings when possible.",
      "Put spice preference into tags.spiceLevel.",
      "Put the user's free-form note into tags.notes.",
      "",
      `Current recipe JSON:\n${JSON.stringify(recipe, null, 2)}`,
      "",
      `User answers:\n${JSON.stringify(answers, null, 2)}`,
    ].join("\n");

    const result = await this.chat(
      [
        {
          role: "system",
          content:
            "You are a professional chef assistant. Always respond with valid JSON only, no markdown.",
        },
        { role: "user", content: prompt },
      ],
      { maxTokens: 1600, responseFormat: "json_object", temperature: 0 },
    );

    return this.parseOrRepairRecipePayload(
      result,
      "Failed to parse refined recipe JSON from LLM response",
    );
  }

  async generateCoverPrompt(dishName: string, customStyle?: string): Promise<string> {
    const base = [
      `Create a mouthwatering, realistic cover photo of the finished dish: ${dishName}.`,
      "The dish should look freshly cooked, hot, juicy, glossy, and ready to eat, with visible texture, sauce, herbs, garnish, steam, and rich natural color.",
      "Use professional restaurant food photography with warm side lighting, shallow depth of field, crisp focus on the food, a clean ceramic plate or bowl, and a simple elegant tabletop.",
      "Frame it as an app cover image: square 1:1 composition, the plated dish is the clear hero and fills most of the frame, no people, no hands, no utensils blocking the dish.",
      "Do not show raw ingredients as the main subject. No text, no logo, no watermark, no menu card, no packaging, no distorted food, no unappetizing colors.",
    ].join(" ");
    if (customStyle) {
      return `${base} Style: ${customStyle}`;
    }
    return base;
  }
}

export async function getConfiguredLLMService(): Promise<LLMService | null> {
  const [apiKey, baseUrl, model] = await Promise.all([
    getApiKey("llm"),
    getApiKey("llm-endpoint"),
    getApiKey("llm-model"),
  ]);

  if (!apiKey) return null;

  return new LLMService({
    apiKey,
    baseUrl: baseUrl ? normalizeOpenAIBaseUrl(baseUrl) : DEFAULT_LLM_BASE_URL,
    model: model?.trim() || DEFAULT_LLM_MODEL,
  });
}

export class ImageGenService {
  private baseUrl: string;
  private generationUrl: string;
  private fallbackGenerationUrl?: string;
  private apiKey: string;
  private model: string;

  constructor(endpoint: string, apiKey: string, model: string = DEFAULT_IMAGE_MODEL) {
    const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");
    this.baseUrl = normalizeOpenAIBaseUrl(trimmedEndpoint);
    this.generationUrl = /\/images\/generations$/i.test(trimmedEndpoint)
      ? trimmedEndpoint
      : `${this.baseUrl}/images/generations`;
    this.fallbackGenerationUrl = this.buildFallbackGenerationUrl();
    this.apiKey = apiKey;
    this.model = model.trim() || DEFAULT_IMAGE_MODEL;
  }

  private buildFallbackGenerationUrl(): string | undefined {
    try {
      const url = new URL(this.generationUrl);
      if (url.pathname.replace(/\/+$/, "") !== "/images/generations") return undefined;
      url.pathname = "/v1/images/generations";
      const fallbackUrl = url.toString();
      return fallbackUrl === this.generationUrl ? undefined : fallbackUrl;
    } catch {
      return undefined;
    }
  }

  private buildImageRequestBody(prompt: string): Record<string, unknown> {
    const normalizedModel = this.model.toLowerCase();
    const isGptImageModel = normalizedModel.startsWith("gpt-image-");
    const requestBody: Record<string, unknown> = {
      model: this.model,
      prompt,
      n: 1,
      size: "1024x1024",
    };

    if (isGptImageModel) {
      requestBody.output_format = "png";
      requestBody.quality = "medium";
    } else {
      requestBody.response_format = "b64_json";
    }

    return requestBody;
  }

  private async blobFromImageGenerationResponse(response: Response): Promise<Blob> {
    const data = (await response.json()) as ImageGenerationResponse;
    const image = data.data?.[0];
    if (!image) throw new Error("Image gen failed: empty response");

    if (image.url) {
      const imageResponse = await fetchOpenAICompatible(image.url);
      if (!imageResponse.ok)
        throw await createImageGenerationError(imageResponse, image.url, "Image download failed");
      return await imageResponse.blob();
    }

    return createImageBlobFromBase64(image.b64_json, data.output_format);
  }

  private async postImageGeneration(prompt: string, url: string): Promise<Response> {
    return await fetchOpenAICompatible(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildImageRequestBody(prompt)),
    });
  }

  private async generateImageWithImageApi(prompt: string): Promise<Blob> {
    let response = await this.postImageGeneration(prompt, this.generationUrl);
    let responseUrl = this.generationUrl;

    if (!response.ok && this.fallbackGenerationUrl && [404, 405].includes(response.status)) {
      response = await this.postImageGeneration(prompt, this.fallbackGenerationUrl);
      responseUrl = this.fallbackGenerationUrl;
    }

    if (!response.ok) {
      throw await createImageGenerationError(response, responseUrl);
    }

    return await this.blobFromImageGenerationResponse(response);
  }

  private supportsResponsesImageTool(): boolean {
    const normalizedModel = this.model.toLowerCase();
    return !normalizedModel.startsWith("gpt-image-") && !normalizedModel.startsWith("dall-e");
  }

  private async generateImageWithResponsesApi(prompt: string): Promise<Blob> {
    const responsesUrl = `${this.baseUrl}/responses`;
    const response = await fetchOpenAICompatible(responsesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: prompt,
        tools: [{ type: "image_generation" }],
      }),
    });

    if (!response.ok) {
      throw await createImageGenerationError(response, responsesUrl, "Responses image gen failed");
    }

    const data = (await response.json()) as ResponsesImageGenerationResponse;
    for (const output of data.output ?? []) {
      if (output.type === "image_generation_call" && output.result) {
        return createImageBlobFromBase64(output.result, "png");
      }

      for (const item of output.content ?? []) {
        const b64 = item.b64_json ?? item.result;
        if (b64) return createImageBlobFromBase64(b64, "png");
        if (item.image_url) {
          const imageResponse = await fetchOpenAICompatible(item.image_url);
          if (!imageResponse.ok) {
            throw await createImageGenerationError(
              imageResponse,
              item.image_url,
              "Image download failed",
            );
          }
          return await imageResponse.blob();
        }
      }
    }

    throw new Error("Image gen failed: missing image data");
  }

  async generateImage(prompt: string): Promise<Blob> {
    try {
      return await this.generateImageWithImageApi(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (this.supportsResponsesImageTool() && /Image gen failed: (404|405)\b/i.test(message)) {
        return await this.generateImageWithResponsesApi(prompt);
      }
      throw error;
    }
  }
}

function createImageBlobFromBase64(
  b64: string | undefined,
  outputFormat: ImageGenerationResponse["output_format"] = "png",
): Blob {
  if (!b64) throw new Error("Image gen failed: missing image data");

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: `image/${outputFormat ?? "png"}` });
}
