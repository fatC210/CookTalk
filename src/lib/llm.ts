import type { Recipe } from "./db";
import { getApiKey } from "./crypto";
import i18n from "./i18n";
import type { AppLanguage } from "./language";

export type RecipePayload = Omit<
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

function resolveRecipeTextLanguage(text: string, fallback: AppLanguage): AppLanguage {
  const chineseChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0;

  if (chineseChars >= 12 && chineseChars >= latinWords) return "zh";
  if (latinWords >= 12 && chineseChars < latinWords * 0.35) return "en";
  return fallback;
}

interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string | null; reasoning_content?: string | null } }>;
}

function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
  if (!isRecord(value) || !Array.isArray(value.choices)) return false;

  return value.choices.some(
    (choice) =>
      isRecord(choice) &&
      isRecord(choice.message) &&
      (typeof choice.message.content === "string" ||
        typeof choice.message.reasoning_content === "string"),
  );
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
  /\b(?:prompt|json|schema|field|fields|mapping|map to schema|infer(?:red|ence)?|invent|optional|respond with|return valid|markdown|refine the json|failed response|repair malformed|rule|rules|assistant|model|chain[-\s]*of[-\s]*thought|reasoning|mentioned\/inferred|primary step description|let'?s|i(?:'ll| will| should| can)|we (?:can|should|will))\b|(?:我应该|我会|让我|等等|先|再|提示词|字段|结构化|返回|输出|省略|编造|推断|修复|让我们|我想|我不能)/i;
const META_FRAGMENT_CUE_PATTERN =
  /\b(?:let'?s|i(?:'ll| will| should| can)|we (?:can|should|will)|or (?:mention|combine|use|write|describe|pan[-\s]*fry)|tags mentioned|mentioned\/inferred|primary step description|common and detailed|prominent|specific times|chain[-\s]*of[-\s]*thought|reasoning|field mapping|schema|json)\b/i;
const PROMPT_INSTRUCTION_PATTERN =
  /\b(?:ordered steps?|ingredient name|quantity\s*\+\s*unit|suitable for reading aloud|all text in|except\s+[`"']?difficulty|no explanations?|valid json only|schema explanations?|field mapping|chain[-\s]*of[-\s]*thought|self-talk|do not include|do not output|return valid|use this schema|rules?:|failed response|repair malformed|convert the following)\b|(?:只返回|不要输出|字段映射|思考过程|自言自语|合法\s*JSON|严格遵循|食材名称|数量和单位)/i;
const COOKING_CONTENT_CUE_PATTERN =
  /[\u4e00-\u9fff]|(?:\b(?:add|mix|stir|cook|boil|simmer|fry|saute|bake|roast|steam|grill|marinate|season|serve|preheat|brush|fill|wrap)\b)/i;
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
        max_tokens: 16,
        temperature: 0,
      }),
    });

    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return false;

    const data = await response.json();
    return isChatCompletionResponse(data);
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
    .replace(/[“”"'`\\]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[{}[\],:：]/g, " ")
    .replace(/\s+/g, " ");
}

function isRecipeSchemaPlaceholder(value: string): boolean {
  return RECIPE_SCHEMA_PLACEHOLDERS.has(normalizePlaceholderText(value));
}

function omitSchemaPlaceholder(value: string): string {
  const trimmed = value.trim();
  return trimmed && !isRecipeSchemaPlaceholder(trimmed) ? trimmed : "";
}

function countCookingContentCues(value: string): number {
  const text = cleanRecipeTextValue(value);
  const zhCues = text.match(
    /(?:加入|放入|倒入|下入|撒入|切|切成|切好|剁|拍|腌|拌|搅拌|翻炒|炒|煎|炸|烤|蒸|煮|炖|焖|焯|爆香|收汁|勾芡|出锅|盛出|装盘|备用|浸泡|清洗|冲洗|去皮|预热|刷|填充|封口|包|上色)/g,
  );
  const enCues = text.match(
    /\b(?:add|mix|stir|cook|boil|simmer|fry|saute|bake|roast|steam|grill|marinate|season|serve|preheat|brush|fill|wrap)\b/gi,
  );
  return (zhCues?.length ?? 0) + (enCues?.length ?? 0);
}

function isSchemaOnlyRecord(value: Record<string, unknown>): boolean {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (entries.length === 0) return true;

  return entries.every(([key, entryValue]) => {
    if (!SCHEMA_ONLY_FIELDS.has(normalizePlaceholderText(key))) return false;
    if (entryValue == null) return true;
    if (typeof entryValue === "string") {
      const text = cleanRecipeTextValue(entryValue);
      return !text || isRecipeSchemaPlaceholder(text) || isSchemaNoiseLine(text);
    }
    if (typeof entryValue === "number") return true;
    if (Array.isArray(entryValue)) {
      return entryValue.length === 0 || entryValue.every((item) => isSchemaOnlyValue(item));
    }
    return isRecord(entryValue) ? isSchemaOnlyRecord(entryValue) : true;
  });
}

function isSchemaOnlyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") {
    const text = cleanRecipeTextValue(value);
    return !text || isRecipeSchemaPlaceholder(text) || isSchemaNoiseLine(text);
  }
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isSchemaOnlyValue);
  return isRecord(value) ? isSchemaOnlyRecord(value) : true;
}

function isGenericSchemaRecipePayload(recipe: RecipePayload): boolean {
  const titleGeneric = !recipe.title || isRecipeSchemaPlaceholder(recipe.title);
  const ingredientsGeneric =
    recipe.ingredients.length === 0 ||
    recipe.ingredients.every(
      (item) =>
        isRecipeSchemaPlaceholder(item.name) ||
        isRecipeSchemaPlaceholder(item.amount) ||
        (!item.name && !item.amount),
    );
  const stepsGeneric =
    recipe.steps.length === 0 ||
    recipe.steps.every(
      (step) =>
        isRecipeSchemaPlaceholder(step.description) ||
        isSchemaNoiseLine(step.description) ||
        countCookingContentCues(step.description) === 0,
    );

  return titleGeneric && ingredientsGeneric && stepsGeneric;
}

function hasUsableRecipePayload(recipe: RecipePayload): boolean {
  if (isGenericSchemaRecipePayload(recipe)) return false;
  return recipe.steps.length > 0 || recipe.ingredients.length > 0;
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

function stripMetaReasoningFragments(value: string): string {
  const text = cleanRecipeContentText(value);
  if (!text) return "";

  const withoutParentheticalMeta = text
    .replace(
      /\s*[（(][^）)]*(?:let'?s|i(?:'ll| will| should| can)|we (?:can|should|will)|or (?:mention|combine|use|write|describe|pan[-\s]*fry)|common and detailed|primary step description|schema|json|reasoning)[^）)]*[）)]/gi,
      "",
    )
    .trim();
  const source = withoutParentheticalMeta || text;
  const sentenceParts = source
    .split(/(?<=[。！？!?])\s+|(?<=\.)\s+(?=[A-Z(I])/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length <= 1) {
    return META_FRAGMENT_CUE_PATTERN.test(source) && countCookingContentCues(source) === 0
      ? ""
      : source;
  }

  const kept = sentenceParts.filter((part) => {
    if (!META_FRAGMENT_CUE_PATTERN.test(part)) return true;
    return COOKING_CONTENT_CUE_PATTERN.test(part) && countCookingContentCues(part) >= 2;
  });

  return kept.join(" ").trim();
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
  if (PROMPT_INSTRUCTION_PATTERN.test(stripped)) return true;
  if (isRecipeSchemaPlaceholder(stripped)) return true;
  if (/^(?:map\s+to\s+schema|schema|json|```)/i.test(stripped)) return true;
  if (/^"?[\w\u4e00-\u9fff]+"?\s*:\s*\[?\{?["“]?[\w\u4e00-\u9fff\s]+["”]?/i.test(stripped)) {
    const left = stripped.split(/[：:]/, 1)[0] ?? "";
    if (SCHEMA_ONLY_FIELDS.has(normalizePlaceholderText(left))) return true;
  }
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
  const text = cleanRecipeTextValue(value);
  if (!META_REASONING_PATTERN.test(text)) return false;
  return countCookingContentCues(text) < 2;
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

function getRecipePayloadQuality(recipe: RecipePayload): number {
  if (!hasUsableRecipePayload(recipe)) return 0;

  const cookingStepCount = recipe.steps.filter(
    (step) =>
      countCookingContentCues(step.description) > 0 ||
      Boolean(parseDurationToSeconds(step.description)),
  ).length;
  const ingredientCount = recipe.ingredients.filter((item) => item.name || item.amount).length;
  const titleScore = recipe.title ? 2 : 0;
  const metadataScore =
    (recipe.tags.totalTimeMin ? 1 : 0) +
    (recipe.tags.servings ? 1 : 0) +
    (recipe.tags.cuisine ? 1 : 0);

  return (
    titleScore +
    ingredientCount * 2 +
    recipe.steps.length * 3 +
    cookingStepCount * 4 +
    metadataScore
  );
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
      .filter((item) => !containsMetaReasoning(item))
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value !== "string") return undefined;
  const items = value
    .split(/[,，、/|;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item && !isRecipeSchemaPlaceholder(item))
    .filter((item) => !containsMetaReasoning(item))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

const HEURISTIC_STEP_PATTERN =
  /(?:先|首先|然后|再|接着|随后|最后|把|将|用|加入|放入|倒入|下入|撒入|切|切成|切好|剁|拍|腌|拌|搅拌|翻炒|炒|煎|炸|烤|蒸|煮|炖|焖|焯|爆香|收汁|勾芡|出锅|盛出|装盘|备用|浸泡|清洗|冲洗|去皮|揉|醒发|发酵|mix|stir|add|cook|boil|simmer|fry|saute|bake|roast|steam|grill|marinate|season|serve)/i;
const HEURISTIC_FILLER_PATTERN =
  /(?:大家好|hello|hi everyone|点赞|点个赞|关注|收藏|转发|评论|留言|订阅|感谢观看|下期见|记得关注|我是|欢迎来到|祝大家|天天开心|背景音乐|sponsor|sponsored|subscribe|like and subscribe)/i;
const HEAT_OR_TIP_PATTERN =
  /(?:小火|中火|大火|微火|全程|注意|不要|别|记得|避免|low heat|medium heat|high heat|be careful|make sure)/i;
const EN_STEP_START_PATTERN =
  /(?:start by|finely\s+chop|heat|saute|add|pour|stir|season|lower|cover|let|cook|drain|toss|finish|serve|meanwhile|preheat|bake|roast|boil|simmer|fry|grill|steam|marinate|mix|blend|whisk|knead|slice|dice|chop|peel|crush)/i;
const EN_STEP_BOUNDARY_PATTERN = new RegExp(
  String.raw`\b(?:meanwhile|then|next|after(?:wards)?|finally|lastly),?\s+|(?<=\.)\s+(?=(?:start by|heat|saute|add|pour|stir|season|lower|cover|let|cook|drain|toss|finish|serve|preheat|bake|roast|boil|simmer|fry|grill|steam|marinate|mix|blend|whisk|knead|slice|dice|chop|peel|crush)\b)`,
  "gi",
);

const NON_RECIPE_CHATTER_PATTERN =
  /(?:大家好|朋友们|家人们|孩子在家|阿建|分享|帮助|点赞|点个赞|关注|收藏|转发|评论|留言|订阅|感谢观看|下期见|祝大家|天天开心|美美地享用|不知道怎么做|非常地下饭|比红烧肉|背景音乐|sponsor|sponsored|subscribe|like and subscribe|thanks for watching)/i;
const COOKING_ACTION_PATTERN =
  /(?:加入|放入|倒入|下入|撒入|加|放|倒|下|切|切成|切好|剁|拍|洗|清洗|冲洗|去皮|削皮|控水|挤出|腌|拌|搅拌|调|调成|翻炒|煸炒|炒|煎|炸|烤|蒸|煮|炖|焖|焯|焯水|爆香|收汁|勾芡|出锅|盛出|装盘|备用|浸泡|预热|刷|填充|封口|包|上色|mix|stir|add|cook|boil|simmer|fry|saute|bake|roast|steam|grill|marinate|season|serve|preheat|wash|slice|chop|dice|soften|tear|blend|pass|sieve|strain|reheat|reduce)/i;
const INGREDIENT_OR_MEASURE_PATTERN =
  /(?:少许|适量|一勺|半勺|两勺|\d+\s*(?:克|g|kg|斤|毫升|ml|升|l|个|颗|粒|片|块|根|把|勺|匙|茶匙|汤匙|杯|碗|分钟|秒|小时|minutes?|mins?|seconds?|secs?|hours?|hrs?)|盐|糖|醋|酱油|生抽|老抽|蚝油|料酒|胡椒|淀粉|清水|油|葱|姜|蒜|肉|蛋|米|面|粉|菜|茄子|土豆|番茄|辣椒)/i;
const NON_INGREDIENT_PHRASE_PATTERN =
  /(?:抑制|细菌|农药|残留|保持|鲜嫩|柔软|下饭|视频|分享|点赞|评论|转发|关注|孩子|家人|做法|简单|实用|帮助|今天|非常|而且|因为|以后|回家|餐桌|开心|background music)/i;
const NON_RECIPE_TITLE_PATTERN =
  /(?:厨师|主厨|美食|厨房|菜谱|教程|视频|分享|频道|博主|达人|阿建|温暖厨师|点赞|关注|评论|转发|收藏|订阅|背景音乐|unknown|untitled)/i;
const DISH_TITLE_CUE_PATTERN =
  /(?:鸡|鸭|鱼|虾|蟹|肉|排骨|牛|羊|猪|蛋|豆腐|茄子|土豆|番茄|西红柿|青椒|辣椒|白菜|萝卜|黄瓜|面|粉|饭|米|粥|汤|饼|包子|馒头|蛋糕|沙拉|红烧|清炒|小炒|凉拌|炖|焖|煮|烤|炸|煎|蒸|卤|拌|stew|salad|soup|rice|noodle|chicken|beef|pork|fish|shrimp|egg|tofu|potato|tomato|eggplant)/i;
const COMMON_INGREDIENT_NAME_PATTERN =
  /^(?:盐|食盐|白糖|糖|生抽|老抽|酱油|蚝油|料酒|胡椒粉|胡椒|白醋|醋|油|食用油|清水|水|葱|姜|蒜|蒜末|葱花|salt|sugar|soy sauce|oil|water|vinegar|pepper|garlic|ginger|scallion)$/i;
const EN_NARRATIVE_AMOUNT_WORD_PATTERN = String.raw`(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|half|\d+(?:\.\d+)?(?:/\d+)?)`;
const EN_NARRATIVE_AMOUNT_MODIFIER_PATTERN = String.raw`(?:about|around|roughly|generous|heaped|level|large|small|medium|good)`;
const EN_NARRATIVE_UNIT_PATTERN = String.raw`(?:cloves?|kilograms?|kilos?|kg|grams?|g|pounds?|lbs?|ounces?|oz|liters?|litres?|l|milliliters?|millilitres?|ml|cups?|tablespoons?|tbsp|tbsps|teaspoons?|tsp|tsps|knobs?|handfuls?|pinches?|swirls?)`;
const EN_NARRATIVE_FOOD_SOURCE = String.raw`(?:self-raising flour|all-purpose flour|plain flour|vanilla extract|maple syrup|fresh banana(?: slices)?|banana slices|toasted walnuts|walnuts|bananas?|eggs?|milk|flour|tomato paste|vegetable stock|crusty bread|basil leaves|olive oil|onions?|garlic|butter|tomatoes?|sugar|stock|basil|salt|pepper|cream|bread|oil|water|vinegar|ginger|scallions?|parsley|cilantro|honey|yogurt|berries?)`;
const EN_NARRATIVE_FOOD_PATTERN = new RegExp(EN_NARRATIVE_FOOD_SOURCE, "i");
const EN_NARRATIVE_NON_INGREDIENT_PATTERN =
  /(?:immersion blender|blender|sieve|bowl|bowls|pot|pan|knife|spoon|heat|evening|texture|side|top|everything)/i;
const EN_INGREDIENT_SECTION_LABEL_PATTERN =
  /^(?:for serving|to serve|for the topping|for toppings|topping|toppings|garnish|to garnish|optional|optional toppings?)$/i;
const EN_INGREDIENT_FRAGMENT_PATTERN =
  /^(?:a|an)\s+(?:scattering|drizzle|splash|pinch|knob|handful|few|little)(?:\s+of)?$/i;
const EN_META_RECIPE_NOTE_PATTERN =
  /(?:should we include|these are(?: just)? toppings|part of the recipe|we['’]ll include|amounts?\s*:)/i;

function hasCookingAction(value: string): boolean {
  return (
    COOKING_ACTION_PATTERN.test(value) ||
    EN_STEP_START_PATTERN.test(value) ||
    countCookingContentCues(value) > 0
  );
}

function isLikelyNonRecipeChatter(value: string): boolean {
  const text = cleanRecipeTextValue(value);
  if (!text) return true;
  const hasChatter = NON_RECIPE_CHATTER_PATTERN.test(text);
  const hasAction = hasCookingAction(text);
  if (hasChatter && !hasAction) return true;
  if (hasChatter && hasAction && text.length > 34 && countCookingContentCues(text) <= 1)
    return true;
  return false;
}

function isEnglishIngredientSectionLabel(value: string): boolean {
  const text = cleanRecipeTextValue(value).replace(/[:.,;]+$/g, "");
  return EN_INGREDIENT_SECTION_LABEL_PATTERN.test(text);
}

function isIngredientFragmentText(value: string): boolean {
  const text = cleanRecipeTextValue(value).replace(/[:.,;]+$/g, "");
  return EN_INGREDIENT_FRAGMENT_PATTERN.test(text);
}

function isLikelyIngredientOnlyStep(value: string): boolean {
  const text = cleanRecipeTextValue(value);
  if (!text) return false;
  if (isEnglishIngredientSectionLabel(text) || isIngredientFragmentText(text)) return true;
  if (EN_META_RECIPE_NOTE_PATTERN.test(text)) return true;
  if (hasCookingAction(text) || HEAT_OR_TIP_PATTERN.test(text)) return false;

  const normalized = normalizeIngredient(text);
  if (!normalized?.name) return false;
  if (normalized.amount && !INGREDIENT_OR_MEASURE_PATTERN.test(normalized.amount)) return false;
  return isLikelyIngredientName(normalized.name);
}

function isLikelyIngredientName(value: string): boolean {
  const text = cleanRecipeTextValue(value);
  if (!text) return false;
  if (text.length > 32) return false;
  if (isLikelyNonRecipeChatter(text)) return false;
  if (isEnglishIngredientSectionLabel(text) || isIngredientFragmentText(text)) return false;
  if (EN_META_RECIPE_NOTE_PATTERN.test(text)) return false;
  if (NON_INGREDIENT_PHRASE_PATTERN.test(text)) return false;
  if (hasCookingAction(text)) return false;
  return INGREDIENT_OR_MEASURE_PATTERN.test(text) || /^[\u4e00-\u9fffA-Za-z\s-]{1,32}$/.test(text);
}

function isLikelyCookingStepText(value: string): boolean {
  const text = cleanRecipeTextValue(value);
  if (!text || text.length < 3) return false;
  if (isLikelyNonRecipeChatter(text)) return false;
  return (
    hasCookingAction(text) ||
    EN_STEP_START_PATTERN.test(text) ||
    HEAT_OR_TIP_PATTERN.test(text) ||
    Boolean(parseDurationToSeconds(text))
  );
}

function hasDishTitleCue(value: string): boolean {
  return DISH_TITLE_CUE_PATTERN.test(cleanRecipeTextValue(value));
}

function isLikelyBadRecipeTitle(value: string, recipe?: RecipePayload): boolean {
  const title = cleanRecipeTextValue(value);
  if (!title) return true;
  if (title.length > 30) return true;
  if (isRecipeSchemaPlaceholder(title) || isSchemaNoiseLine(title)) return true;
  if (isLikelyNonRecipeChatter(title)) return true;
  if (hasDishTitleCue(title)) return false;

  const ingredientNames = recipe?.ingredients
    .map((item) => cleanRecipeTextValue(item.name))
    .filter((name) => name.length >= 2 && !COMMON_INGREDIENT_NAME_PATTERN.test(name));
  if (ingredientNames?.some((name) => title.includes(name) || name.includes(title))) return false;

  return NON_RECIPE_TITLE_PATTERN.test(title) || title.length <= 2;
}

function getRecipeTitleIngredientNames(recipe: RecipePayload): string[] {
  const seen = new Set<string>();
  return recipe.ingredients
    .map((item) => cleanRecipeTextValue(item.name))
    .filter((name) => name && isLikelyIngredientName(name))
    .filter((name) => !COMMON_INGREDIENT_NAME_PATTERN.test(name))
    .filter((name) => {
      const key = normalizePlaceholderText(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function inferZhCookingMethod(recipe: RecipePayload): string {
  const steps = recipe.steps.map((step) => step.description).join(" ");
  if (/红烧/.test(steps)) return "红烧";
  if (/凉拌|拌匀|拌一下/.test(steps)) return "凉拌";
  if (/清蒸|蒸/.test(steps)) return "清蒸";
  if (/香煎|煎/.test(steps)) return "香煎";
  if (/炸/.test(steps)) return "酥炸";
  if (/烤/.test(steps)) return "烤";
  if (/炖|焖/.test(steps)) return "焖";
  if (/炒|煸炒|翻炒/.test(steps)) return "家常炒";
  if (/煮/.test(steps)) return "水煮";
  return "家常";
}

function inferEnCookingMethod(recipe: RecipePayload): string {
  const steps = recipe.steps
    .map((step) => step.description)
    .join(" ")
    .toLowerCase();
  if (/roast|bake/.test(steps)) return "Roasted";
  if (/steam/.test(steps)) return "Steamed";
  if (/stir[-\s]?fry|saute|fry/.test(steps)) return "Stir-Fried";
  if (/simmer|stew|braise/.test(steps)) return "Braised";
  if (/boil/.test(steps)) return "Boiled";
  if (/grill/.test(steps)) return "Grilled";
  return "Homestyle";
}

function generateRecipeTitleFromContent(recipe: RecipePayload, language: AppLanguage): string {
  const ingredients = getRecipeTitleIngredientNames(recipe);
  const stepsText = recipe.steps.map((step) => step.description).join(" ");

  if (language === "zh") {
    const hasEggplant = ingredients.some((name) => /茄子/.test(name)) || /茄子/.test(stepsText);
    const hasMincedMeat =
      ingredients.some((name) => /肉末|肉沫/.test(name)) || /肉末|肉沫/.test(stepsText);
    if (hasEggplant && hasMincedMeat) return "肉末茄子";

    const method = inferZhCookingMethod(recipe);
    const primary =
      ingredients.find((name) =>
        /肉|鸡|鸭|鱼|虾|蛋|豆腐|茄子|土豆|番茄|西红柿|白菜|萝卜|黄瓜|面|饭/.test(name),
      ) ?? ingredients[0];
    if (!primary) return "";
    if (ingredients.length >= 2 && ingredients.join("").length <= 10)
      return ingredients.slice(0, 2).join("");
    return `${method}${primary}`;
  }

  const primary = ingredients[0];
  if (!primary) return "";
  const method = inferEnCookingMethod(recipe);
  const secondary = ingredients[1];
  return secondary ? `${method} ${primary} with ${secondary}` : `${method} ${primary}`;
}

function findNarrativeRecipeTitle(text: string): string {
  const lines = text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => cleanRecipeContentText(stripListMarker(line)))
    .filter(Boolean);

  const firstLine = omitSchemaPlaceholder(lines[0] ?? "");
  if (
    firstLine &&
    firstLine.length <= 60 &&
    !findInlineLabel(firstLine, RECIPE_FIELD_LABELS) &&
    !isSchemaNoiseLine(firstLine) &&
    !hasCookingAction(firstLine)
  ) {
    return firstLine;
  }

  return "";
}

function isLikelyInstructionIngredient(item: RecipePayload["ingredients"][number]): boolean {
  const name = item.name.trim();
  const amount = item.amount.trim();
  if (!name) return false;
  if (isEnglishIngredientSectionLabel(name) || isIngredientFragmentText(name)) return true;
  if (EN_META_RECIPE_NOTE_PATTERN.test(`${name} ${amount}`)) return true;
  if (amount && name.length <= 24 && countCookingContentCues(name) <= 1) return false;

  const cueCount = countCookingContentCues(name);
  const hasInstructionPunctuation = /[，,。；;]|(?:然后|接着|随后|最后|until|then)\b/i.test(name);
  return (
    (cueCount >= 2 && name.length >= 12) ||
    (cueCount >= 1 && hasInstructionPunctuation) ||
    (HEURISTIC_STEP_PATTERN.test(name) && name.length >= 18)
  );
}

function normalizeIngredient(value: unknown): RecipePayload["ingredients"][number] | null {
  if (typeof value === "string") {
    const text = cleanRecipeContentText(stripListMarker(value));
    if (!text) return null;
    if (isSchemaNoiseLine(text)) return null;
    if (containsMetaReasoning(text)) return null;

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
      const name = omitSchemaPlaceholder(stripMetaReasoningFragments(nameFromLabel));
      const amount = omitSchemaPlaceholder(stripMetaReasoningFragments(amountFromLabel));
      return name || amount ? { name, amount } : null;
    }

    if (findInlineLabel(text, STEP_TEXT_LABELS)) return null;

    const parts = text.split(/\s*[：:]\s*/);
    if (parts.length >= 2) {
      const name = omitSchemaPlaceholder(stripMetaReasoningFragments(parts[0]));
      const amount = omitSchemaPlaceholder(
        stripMetaReasoningFragments(truncateRecipeFieldTail(parts.slice(1).join(":"))),
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
      const name = omitSchemaPlaceholder(stripMetaReasoningFragments(trailingAmount[1]));
      const amount = omitSchemaPlaceholder(stripMetaReasoningFragments(trailingAmount[2]));
      if (name || amount) return { name, amount };
    }

    const delimitedAmount = text.match(
      /^(.+?)(?:\s+|，|,)([\d一二两三四五六七八九十半少许适量大约约].*)$/,
    );
    if (delimitedAmount) {
      return {
        name: omitSchemaPlaceholder(stripMetaReasoningFragments(delimitedAmount[1])),
        amount: omitSchemaPlaceholder(
          stripMetaReasoningFragments(truncateRecipeFieldTail(delimitedAmount[2])),
        ),
      };
    }

    const leadingAmount = text.match(
      new RegExp(`^((?:${quantityText})(?:\\s*${unitText})?)(?:\\s*(?:of\\s+)?)?(.+)$`, "i"),
    );
    if (leadingAmount) {
      const amount = omitSchemaPlaceholder(stripMetaReasoningFragments(leadingAmount[1]));
      const name = omitSchemaPlaceholder(stripMetaReasoningFragments(leadingAmount[2]));
      if (name || amount) return { name, amount };
    }

    return { name: text, amount: "" };
  }

  if (!isRecord(value)) return null;
  const name = omitSchemaPlaceholder(
    stripMetaReasoningFragments(
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
  const amount = omitSchemaPlaceholder(stripMetaReasoningFragments(readIngredientAmount(value)));
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

function sanitizeRecipeIngredients(
  ingredients: RecipePayload["ingredients"],
): RecipePayload["ingredients"] {
  const seen = new Set<string>();

  return ingredients
    .map((item) => ({
      name: omitSchemaPlaceholder(stripMetaReasoningFragments(item.name)),
      amount: omitSchemaPlaceholder(stripMetaReasoningFragments(item.amount)),
    }))
    .filter((item) => {
      if (!item.name && !item.amount) return false;
      if (item.name && isSchemaNoiseLine(item.name)) return false;
      if (item.amount && isSchemaNoiseLine(item.amount)) return false;
      if (item.name && isEnglishIngredientSectionLabel(item.name)) return false;
      if (item.name && isIngredientFragmentText(item.name) && !item.amount) return false;
      if (EN_META_RECIPE_NOTE_PATTERN.test(`${item.name} ${item.amount}`)) return false;
      if (isLikelyInstructionIngredient(item)) return false;
      if (!isLikelyIngredientName(item.name) && !INGREDIENT_OR_MEASURE_PATTERN.test(item.amount)) {
        return false;
      }
      if (containsMetaReasoning(`${item.name} ${item.amount}`)) return false;

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

    const description = stripMetaReasoningFragments(
      readInlineLabeledValue(text, STEP_TEXT_LABELS) || text,
    );
    if (isRecipeSchemaPlaceholder(description) || isSchemaNoiseLine(description)) return null;
    if (containsMetaReasoning(description)) return null;
    if (!isLikelyCookingStepText(description)) return null;
    const durationSec = parseDurationToSeconds(description);
    return description
      ? { order: index + 1, description, ...(durationSec ? { durationSec } : {}) }
      : null;
  }

  if (!isRecord(value)) return null;
  const description = omitSchemaPlaceholder(
    stripMetaReasoningFragments(
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
  if (!isLikelyCookingStepText(description)) return null;

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
    stripMetaReasoningFragments(
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

function sanitizeRecipeSteps(steps: RecipePayload["steps"]): RecipePayload["steps"] {
  const seen = new Set<string>();
  return steps
    .map((step) => {
      const description = stripMetaReasoningFragments(step.description);
      const tips = step.tips ? stripMetaReasoningFragments(step.tips) : "";
      const durationSec = step.durationSec ?? parseDurationToSeconds(description);
      return {
        ...step,
        description,
        ...(durationSec ? { durationSec } : {}),
        ...(tips ? { tips } : {}),
      };
    })
    .filter((step) => {
      if (!step.description) return false;
      if (isSchemaNoiseLine(step.description) || isRecipeSchemaPlaceholder(step.description)) {
        return false;
      }
      if (containsMetaReasoning(step.description)) return false;
      if (EN_META_RECIPE_NOTE_PATTERN.test(step.description)) return false;
      if (isEnglishIngredientSectionLabel(step.description)) return false;
      if (isIngredientFragmentText(step.description)) return false;
      if (isLikelyIngredientOnlyStep(step.description)) return false;
      if (!isLikelyCookingStepText(step.description)) return false;

      const key = normalizePlaceholderText(step.description);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
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
  if (isSchemaOnlyRecord(recipe)) return null;

  const tags = readFirstRecord(recipe, ["tags", "tag", "metadata", "meta", "labels", "标签"]) ?? {};
  const ingredients = sanitizeRecipeIngredients(
    normalizeIngredients(
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
    ),
  );
  const steps = sanitizeRecipeSteps(
    normalizeSteps(
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
    ),
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

  const normalized: RecipePayload = {
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

  return hasUsableRecipePayload(normalized) ? normalized : null;
}

function coerceRecipePayload(value: unknown): RecipePayload {
  const normalized = normalizeRecipePayload(value);
  if (normalized) return normalized;

  const recipe = unwrapRecipeObject(value);
  if (!recipe || isSchemaOnlyRecord(recipe)) {
    return { title: "", ingredients: [], steps: [], tags: {} };
  }

  const tags = readFirstRecord(recipe, ["tags", "tag", "metadata", "meta", "labels", "标签"]) ?? {};
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
    title: omitSchemaPlaceholder(
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
    ),
    ingredients: sanitizeRecipeIngredients(
      normalizeIngredients(
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
      ),
    ),
    steps: sanitizeRecipeSteps(
      normalizeSteps(
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
      ),
    ),
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

  const ingredients = sanitizeRecipeIngredients(normalizeIngredients(ingredientBlock));
  const steps = sanitizeRecipeSteps(normalizeSteps(stepBlock));
  if (ingredients.length === 0 && steps.length === 0) return null;

  const recipe = { title, ingredients, steps, tags: cuisine ? { cuisine } : {} };
  return hasUsableRecipePayload(recipe) ? recipe : null;
}

function normalizeHeuristicSentence(value: string): string {
  return stripMetaReasoningFragments(
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
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /(?:Source title|Source URL|Title|Yield|Cuisine|Category|Total time|Cook time|Prep time)\s*:\s*/gi,
      "\n",
    )
    .replace(/(?:Instructions|步骤|做法)\s*:\s*/gi, "\n")
    .replace(/[。！？!?；;]/g, "\n")
    .replace(
      /\. +(?=(?:Roughly|Start|Heat|Saute|Add|Pour|Stir|Season|Lower|Cover|Let|Meanwhile|Cook|Drain|Toss|Finish|Bring|Tear|Pass|Serve|Blend|Reheat)\b)/g,
      "\n",
    )
    .replace(/([，,])\s*(然后|再|接着|随后|最后|最后再|下一步)/g, "\n$2")
    .replace(
      /([，,;])\s*(?=(?:then\s+)?(?:start by|heat|saute|soften|add|pour|stir|season|lower|cover|bring|reduce|let|tear|blend|pass|reheat|cook|drain|toss|finish|serve)\b)/gi,
      "\n",
    )
    .replace(
      /\bthen\s+(?=(?:soften|add|bring|reduce|let|tear|season|blend|pass|reheat|cook|drain|toss|finish|serve)\b)/gi,
      "",
    )
    .replace(EN_STEP_BOUNDARY_PATTERN, "\n")
    .replace(/(?:\n|^)\s*(?:\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/g, "\n");

  return normalized
    .split(/\n+/)
    .flatMap((segment) => segment.split(/(?<=\S)\s{2,}/))
    .flatMap(splitLongEnglishInstructionSegment)
    .map((segment) => normalizeHeuristicSentence(segment))
    .filter(Boolean);
}

function splitLongEnglishInstructionSegment(segment: string): string[] {
  const source = segment.trim();
  if (source.length < 180 || !/[A-Za-z]/.test(source) || /[\u3400-\u9fff]/.test(source)) {
    return [source];
  }

  const sentences = source
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length > 1) return sentences;

  const clauses = source
    .split(
      /(?<=\S)\s+(?=(?:Heat|Saute|Add|Pour|Stir|Season|Lower|Cover|Let|Meanwhile|Cook|Drain|Toss|Finish|Serve)\b)/,
    )
    .map((part) => part.trim())
    .filter(Boolean);
  return clauses.length > 1 ? clauses : [source];
}

function isLikelyRecipeStep(text: string): boolean {
  if (!text || text.length < 4) return false;
  if (HEURISTIC_FILLER_PATTERN.test(text) && !HEURISTIC_STEP_PATTERN.test(text)) return false;
  if (containsMetaReasoning(text)) return false;
  return (
    hasCookingAction(text) ||
    HEURISTIC_STEP_PATTERN.test(text) ||
    EN_STEP_START_PATTERN.test(text) ||
    HEAT_OR_TIP_PATTERN.test(text) ||
    Boolean(parseDurationToSeconds(text))
  );
}

function inferRecipeTitleFromText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const labeledTitle = text.match(/(?:Source title|Title|菜名|标题|名称)\s*[：:]\s*([^\n]+)/i)?.[1];
  const normalizedLabeledTitle = omitSchemaPlaceholder(
    stripMetaReasoningFragments(labeledTitle ?? ""),
  );
  if (normalizedLabeledTitle && !HEURISTIC_FILLER_PATTERN.test(normalizedLabeledTitle)) {
    return normalizedLabeledTitle;
  }

  const narrativeTitle = findNarrativeRecipeTitle(text);
  if (narrativeTitle && !HEURISTIC_FILLER_PATTERN.test(narrativeTitle)) {
    return narrativeTitle;
  }

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

function stripEnglishIngredientPreparation(value: string): string {
  return cleanRecipeContentText(
    value
      .replace(
        /\b(?:roughly|finely|thinly|coarsely)\s+(?:chopped|sliced|diced|minced|torn)\b/gi,
        "",
      )
      .replace(
        /\b(?:chopped|sliced|diced|minced|torn|fresh|ripe|tinned|canned|large|small|medium)\b/gi,
        "",
      )
      .replace(/\s+/g, " "),
  );
}

function parseEnglishNarrativeIngredientName(value: string): string {
  const cleaned = stripEnglishIngredientPreparation(value)
    .replace(/^(?:of|from)\s+/i, "")
    .replace(/\b(?:if using|if fresh|for serving|for dunking)\b[\s\S]*$/i, "")
    .replace(/\b(?:to|over|until|with|along|straight)\b[\s\S]*$/i, "")
    .replace(/^(?:a|an)\s+(?:few|little|small|good|generous)\s+/i, "")
    .replace(/^(?:a|an)\s+(?:scattering|drizzle|splash|pinch|knob|handful)\s+of\s+/i, "")
    .trim();
  if (!cleaned || EN_NARRATIVE_NON_INGREDIENT_PATTERN.test(cleaned)) return "";
  if (isEnglishIngredientSectionLabel(cleaned) || isIngredientFragmentText(cleaned)) return "";
  if (EN_META_RECIPE_NOTE_PATTERN.test(cleaned)) return "";

  const explicitFood = cleaned.match(EN_NARRATIVE_FOOD_PATTERN)?.[0];
  if (explicitFood) return cleanRecipeContentText(explicitFood);

  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  if (!/^[A-Za-z][A-Za-z\s-]{1,24}$/.test(words)) return "";
  return cleanRecipeContentText(words);
}

function inferNarrativeIngredientsFromText(text: string): RecipePayload["ingredients"] {
  const source = trimRecipeSourceText(text);
  const candidates: RecipePayload["ingredients"] = [];

  const amountUnitFood = new RegExp(
    `\\b((?:(?:${EN_NARRATIVE_AMOUNT_MODIFIER_PATTERN})\\s+)*(?:${EN_NARRATIVE_AMOUNT_WORD_PATTERN})\\s+(?:${EN_NARRATIVE_UNIT_PATTERN}))\\s+(?:of\\s+)?([A-Za-z][A-Za-z\\s-]{1,48})`,
    "gi",
  );
  for (const match of source.matchAll(amountUnitFood)) {
    const amount = cleanRecipeContentText(match[1] ?? "");
    const name = parseEnglishNarrativeIngredientName(match[2] ?? "");
    if (name && amount) candidates.push({ name, amount });
  }

  const amountFood = new RegExp(
    `\\b((?:(?:${EN_NARRATIVE_AMOUNT_MODIFIER_PATTERN})\\s+)*(?:${EN_NARRATIVE_AMOUNT_WORD_PATTERN}))\\s+((?:\\w+\\s+){0,3}?${EN_NARRATIVE_FOOD_SOURCE})\\b`,
    "gi",
  );
  for (const match of source.matchAll(amountFood)) {
    const amount = cleanRecipeContentText(match[1] ?? "");
    const name = parseEnglishNarrativeIngredientName(match[2] ?? "");
    if (name && amount && EN_NARRATIVE_FOOD_PATTERN.test(name)) {
      candidates.push({ name, amount });
    }
  }

  const enoughStock = source.match(/\benough\s+([A-Za-z\s-]*stock)\s+to\b/i)?.[1];
  if (enoughStock)
    candidates.push({ name: cleanRecipeContentText(enoughStock), amount: "enough to cover" });

  for (const match of source.matchAll(
    /\bseason\s+well\s+with\s+([A-Za-z\s,\sand-]+?)(?:,|\.|and\s+blend|$)/gi,
  )) {
    const seasonings = (match[1] ?? "")
      .split(/\s+and\s+|,/i)
      .map((item) => parseEnglishNarrativeIngredientName(item))
      .filter(Boolean);
    for (const name of seasonings) candidates.push({ name, amount: "to taste" });
  }

  for (const match of source.matchAll(
    /\b(?:finish|serve)\s+with\s+([A-Za-z\s,\-]+?)(?:\.|$)/gi,
  )) {
    const extras = (match[1] ?? "")
      .split(/\s+and\s+|,/i)
      .map((item) => parseEnglishNarrativeIngredientName(item))
      .filter(Boolean);
    for (const name of extras) candidates.push({ name, amount: "" });
  }

  const byName = new Map<string, RecipePayload["ingredients"][number]>();
  for (const candidate of candidates) {
    const key = normalizePlaceholderText(candidate.name);
    if (!key) continue;
    const current = byName.get(key);
    if (
      !current ||
      candidate.amount.length > current.amount.length ||
      (!/^(?:a|an)$/i.test(candidate.amount) && /^(?:a|an)$/i.test(current.amount))
    ) {
      byName.set(key, candidate);
    }
  }

  return [...byName.values()];
}

function inferIngredientsFromText(text: string): RecipePayload["ingredients"] {
  const matches = [
    ...text.matchAll(
      /(?:Ingredients?|食材|配料|用料|准备|材料)[:：]?\s*([^\n]+(?:\n(?!.*(?:Instructions?|步骤|做法|开始|先|然后|接着|最后|Source URL|Title)).+)*)/gi,
    ),
  ];
  const candidates = matches
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .flatMap((block) => block.split(/[\n,，、]/))
    .map((item) => cleanRecipeTextValue(item))
    .filter(Boolean);

  return sanitizeRecipeIngredients([
    ...normalizeIngredients(candidates),
    ...inferNarrativeIngredientsFromText(text),
  ]);
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

  return sanitizeRecipeSteps(steps)
    .slice(0, 20)
    .map((step, index) => ({ ...step, order: index + 1 }));
}

function shouldPreferHeuristicSteps(
  currentSteps: RecipePayload["steps"],
  heuristicSteps?: RecipePayload["steps"],
): boolean {
  if (!heuristicSteps?.length) return false;
  if (currentSteps.length === 0) return true;
  if (heuristicSteps.length <= currentSteps.length) return false;

  const currentText = currentSteps.map((step) => step.description).join(" ");
  const currentCueCount = countCookingContentCues(currentText);
  return (
    (currentSteps.length === 1 && currentText.length > 180) ||
    (currentSteps.length === 1 && currentCueCount >= 4) ||
    heuristicSteps.length >= currentSteps.length + 3
  );
}

function buildHeuristicRecipePayload(text: string): RecipePayload | null {
  const source = trimRecipeSourceText(text);
  if (!source) return null;

  const ingredients = inferIngredientsFromText(source);
  const steps = inferStepsFromText(source);
  if (ingredients.length === 0 && steps.length === 0) return null;

  const recipe = {
    title: inferRecipeTitleFromText(source),
    ingredients,
    steps,
    tags: {},
  };
  return hasUsableRecipePayload(recipe) ? recipe : null;
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
    title: omitSchemaPlaceholder(stripMetaReasoningFragments(recipe.title)),
    ingredients: sanitizeRecipeIngredients(recipe.ingredients),
    steps: sanitizeRecipeSteps(recipe.steps),
    tags: { ...recipe.tags, flavor: recipe.tags.flavor ? [...recipe.tags.flavor] : undefined },
  };

  for (const text of fallbackTexts) {
    if (!text?.trim()) continue;
    const heuristic = buildHeuristicRecipePayload(text);
    if (!heuristic) continue;

    enriched = {
      title: enriched.title || heuristic.title,
      ingredients:
        enriched.ingredients.length > 0
          ? enriched.ingredients
          : sanitizeRecipeIngredients(heuristic.ingredients),
      steps: shouldPreferHeuristicSteps(enriched.steps, heuristic.steps)
        ? sanitizeRecipeSteps(heuristic.steps)
        : enriched.steps,
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
  const ingredients = sanitizeRecipeIngredients(recipe.ingredients)
    .map((item) => ({
      name: localizeShortRecipeText(item.name, language),
      amount: localizeShortRecipeText(item.amount, language),
    }))
    .filter((item) => item.name || item.amount);

  const steps = sanitizeRecipeSteps(recipe.steps)
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
    .filter((item) => item && !containsMetaReasoning(item))
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

export function cleanStructuredRecipePayload(
  recipe: unknown,
  language?: AppLanguage,
  fallbackText?: string,
): RecipePayload {
  const resolvedLanguage = resolveRecipeLanguage(language);
  const cleaned = enrichRecipePayload(coerceRecipePayload(recipe), fallbackText);
  const localized = localizeRecipePayload(cleaned, resolvedLanguage);
  const heuristic = fallbackText ? buildHeuristicRecipePayload(fallbackText) : null;

  const result = {
    ...localized,
    title: localized.title || heuristic?.title || "",
    ingredients:
      localized.ingredients.length > 0
        ? localized.ingredients
        : heuristic
          ? sanitizeRecipeIngredients(heuristic.ingredients)
          : [],
    steps: shouldPreferHeuristicSteps(localized.steps, heuristic?.steps)
      ? sanitizeRecipeSteps(heuristic?.steps ?? [])
      : localized.steps.length > 0
        ? localized.steps
        : heuristic
          ? sanitizeRecipeSteps(heuristic.steps)
          : [],
  };

  const title = isLikelyBadRecipeTitle(result.title, result)
    ? generateRecipeTitleFromContent(result, resolvedLanguage) || result.title
    : result.title;

  return {
    ...result,
    title,
    steps: result.steps.map((step, index) => ({ ...step, order: index + 1 })),
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
    const message = data.choices[0]?.message;
    if (typeof message?.content === "string") return message.content;
    if (typeof message?.reasoning_content === "string") return message.reasoning_content;
    return "";
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
    let bestRecipe: RecipePayload | null = null;
    let bestScore = 0;

    for (const candidate of collectJsonCandidates(result)) {
      const parsed = parseJsonCandidate(candidate);
      if (parsed === null) continue;

      const normalized = normalizeRecipePayload(parsed);
      if (!normalized || !hasUsableRecipePayload(normalized)) continue;

      const score = getRecipePayloadQuality(normalized);
      if (score > bestScore) {
        bestRecipe = normalized;
        bestScore = score;
      }
    }

    const labeled = parseLabeledRecipeText(result);
    if (labeled) {
      const score = getRecipePayloadQuality(labeled);
      if (score > bestScore) {
        bestRecipe = labeled;
        bestScore = score;
      }
    }

    return bestRecipe;
  }

  private async parseOrRepairRecipePayload(
    result: string,
    errorMessage: string,
    fallbackSourceText?: string,
  ): Promise<RecipePayload> {
    const parsed = this.parseRecipePayload(result, errorMessage);
    if (parsed) {
      const cleaned = cleanStructuredRecipePayload(
        parsed,
        undefined,
        [result, fallbackSourceText].filter(Boolean).join("\n\n"),
      );
      if (hasUsableRecipePayload(cleaned)) return cleaned;
    }

    const repairPrompt = [
      "Convert the following failed recipe extraction response into valid JSON only.",
      "Do not add markdown or explanation.",
      "Ignore prompt text, schema examples, field mapping notes, and model self-talk.",
      "When original recipe text is available, extract the recipe from it instead of the failed response.",
      "Use this schema exactly:",
      "{",
      '  "title": "Recipe name",',
      '  "ingredients": [{"name": "ingredient", "amount": "amount"}],',
      '  "steps": [{"order": 1, "description": "step text", "durationSec": 300, "tips": "optional tip"}],',
      '  "tags": {"flavor": ["savory"], "difficulty": "easy|medium|hard", "cuisine": "cuisine name", "totalTimeMin": 20}',
      "}",
      "",
      fallbackSourceText
        ? `Original recipe text:\n${trimRecipeSourceText(fallbackSourceText)}`
        : "",
      fallbackSourceText ? "" : "",
      `Failed response:\n${trimRecipeSourceText(result)}`,
    ]
      .filter((line) => line !== "")
      .join("\n");

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
      const cleaned = cleanStructuredRecipePayload(
        repairedParsed,
        undefined,
        [repaired, fallbackSourceText, result].filter(Boolean).join("\n\n"),
      );
      if (hasUsableRecipePayload(cleaned)) return cleaned;
    }

    const heuristic =
      (fallbackSourceText ? buildHeuristicRecipePayload(fallbackSourceText) : null) ??
      buildHeuristicRecipePayload(result);
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

  private async reviewStructuredRecipeInLanguage(
    draftRecipe: RecipePayload,
    sourceText: string,
    language: AppLanguage,
  ): Promise<RecipePayload> {
    const prompt =
      language === "zh"
        ? `请审核下面从做菜视频转写中抽取出的菜谱 JSON，并输出修正后的最终 JSON。

审核目标：
- 如果 title 是频道名、人设名、泛称或无法从转写中确认的名字，请根据主要食材和步骤生成一个自然菜名。
- 删除与做菜无关的寒暄、背景音乐、求赞、关注、评论、转发、家庭闲聊和结尾祝福。
- ingredients 只保留真实食材、调料和用量；不要把“去除农药残留”“保持鲜嫩”“非常下饭”等说明或旁白放进食材。
- steps 只保留实际操作步骤；不要把介绍、效果描述、广告话术或“你不知道怎么做”等句子作为步骤。
- 如果一句话是操作步骤，不要放到 ingredients；如果是火候、注意事项或技巧，可以放进对应步骤的 tips。
- 校对 title、ingredients、steps、tags 的位置是否正确，必要时重排步骤顺序。
- 不确定的用量可以留空字符串；不要编造来源文本没有的食材或步骤。
- 只返回合法 JSON，不要输出 Markdown、解释或思考过程。

Schema：
{
  "title": "菜名",
  "ingredients": [{"name": "食材名", "amount": "用量"}],
  "steps": [{"order": 1, "description": "步骤描述", "durationSec": 300, "tips": "可选提示"}],
  "tags": {"flavor": ["口味"], "difficulty": "easy|medium|hard", "cuisine": "菜系", "totalTimeMin": 20}
}

原始转写：
${trimRecipeSourceText(sourceText)}

待审核菜谱 JSON：
${JSON.stringify(draftRecipe, null, 2)}`
        : `Review this recipe JSON extracted from a cooking-video transcript and return the corrected final JSON.

Review goals:
- If title is a channel name, persona name, generic label, or cannot be confirmed from the transcript, generate a natural dish name from the main ingredients and steps.
- Remove greetings, filler, background music, like/follow/comment/share requests, sponsorships, family chatter, and sign-offs.
- Keep ingredients as real foods, seasonings, and amounts only; do not put benefits, effects, commentary, or instructions into ingredients.
- Keep steps as actual cooking actions only; do not include intro, outcome claims, ads, or non-cooking chatter as steps.
- If a sentence is an action step, do not put it in ingredients; heat control, cautions, and technique notes may go into the matching step tips.
- Verify title, ingredients, steps, and tags are in the correct fields, and reorder steps when needed.
- Leave uncertain amounts as empty strings; do not invent ingredients or steps not supported by the source.
- Return valid JSON only, no markdown, explanations, or chain-of-thought.

Schema:
{
  "title": "Recipe name",
  "ingredients": [{"name": "ingredient", "amount": "amount"}],
  "steps": [{"order": 1, "description": "step description", "durationSec": 300, "tips": "optional tip"}],
  "tags": {"flavor": ["savory"], "difficulty": "easy|medium|hard", "cuisine": "cuisine name", "totalTimeMin": 20}
}

Transcript:
${trimRecipeSourceText(sourceText)}

Draft recipe JSON:
${JSON.stringify(draftRecipe, null, 2)}`;

    try {
      const result = await this.chat(
        [
          {
            role: "system",
            content:
              language === "zh"
                ? "你是严格的菜谱审核员。只返回修正后的合法 JSON，不要输出解释、Markdown 或思考过程。"
                : "You are a strict recipe extraction reviewer. Return corrected valid JSON only, no markdown, explanations, or chain-of-thought.",
          },
          { role: "user", content: prompt },
        ],
        { maxTokens: 1600, responseFormat: "json_object", temperature: 0 },
      );

      const parsed = this.parseRecipePayload(result, "Failed to parse reviewed recipe JSON");
      if (!parsed) return draftRecipe;

      const reviewed = cleanStructuredRecipePayload(parsed, language);
      if (!hasUsableRecipePayload(reviewed)) return draftRecipe;

      const reviewedTitle = isLikelyBadRecipeTitle(reviewed.title, reviewed)
        ? generateRecipeTitleFromContent(reviewed, language) || reviewed.title
        : reviewed.title;

      return {
        ...reviewed,
        title:
          reviewedTitle ||
          generateRecipeTitleFromContent(draftRecipe, language) ||
          draftRecipe.title,
        tags: mergeRecipeTags(reviewed.tags, draftRecipe.tags),
      };
    } catch (err) {
      console.warn("Recipe review failed, using structured draft", err);
      return draftRecipe;
    }
  }

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
- 忽略寒暄、广告、口头禅、背景音乐、求点赞关注评论转发、家庭闲聊、结尾祝福和其他与做菜无关的内容。
- 保留真正有用的菜名、食材、步骤、火候、时长和关键技巧。
- ingredients 只放真实食材、调料和用量；不要放操作句、功效说明或旁白。
- steps 只放实际烹饪操作；不要放开场白、效果描述、广告话术或结尾互动。
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
- Ignore filler chatter, greetings, background music, ads, like/follow/comment/share requests, family chatter, sign-offs, and other non-recipe content.
- Title, ingredients, and steps should be in English unless the source clearly requires another language.
- Ingredients must contain real foods, seasonings, and amounts only; do not put action sentences, benefits, commentary, or transcript chatter into ingredients.
- Steps must contain actual cooking actions only; do not include intro, outcome claims, ads, or sign-off interactions as steps.
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
    const cleaned = await this.reviewStructuredRecipeInLanguage(
      cleanStructuredRecipePayload(recipe, language, transcript),
      transcript,
      language,
    );
    if (!hasUsableRecipePayload(cleaned)) {
      throw new Error("No usable recipe content was extracted from the transcript");
    }
    return cleaned;
  }

  private async structureRecipeFromTextInLanguage(
    recipeText: string,
    language: AppLanguage,
  ): Promise<RecipePayload> {
    if (!recipeText.trim()) {
      throw new Error("Cannot structure recipe from empty recipe text");
    }

    const outputLanguage = resolveRecipeTextLanguage(recipeText, language);

    const prompt = [
      outputLanguage === "zh"
        ? "你需要把原始菜谱文字整理成 CookTalk 可用的结构化 JSON。"
        : "You are converting rough recipe text into structured CookTalk recipe JSON.",
      outputLanguage === "zh"
        ? "输入可能是网页摘录、聊天记录、做菜笔记，或者没有排版的整段菜谱文字。"
        : "The input may be a web page excerpt, pasted recipe, plain notes, or unformatted cooking text.",
      outputLanguage === "zh"
        ? "只返回合法 JSON，不要输出 Markdown，结构请严格遵循下面的 schema："
        : "Return valid JSON only, no markdown, using this schema:",
      "{",
      outputLanguage === "zh" ? '  "title": "菜名",' : '  "title": "Recipe name",',
      outputLanguage === "zh"
        ? '  "ingredients": [{"name": "食材名", "amount": "用量"}],'
        : '  "ingredients": [{"name": "ingredient", "amount": "amount"}],',
      outputLanguage === "zh"
        ? '  "steps": [{"order": 1, "description": "步骤描述", "durationSec": 300, "tips": "可选提示"}],'
        : '  "steps": [{"order": 1, "description": "step text", "durationSec": 300, "tips": "optional tip"}],',
      '  "tags": {',
      outputLanguage === "zh" ? '    "flavor": ["口味"],' : '    "flavor": ["savory"],',
      '    "difficulty": "easy|medium|hard",',
      outputLanguage === "zh" ? '    "cuisine": "菜系",' : '    "cuisine": "cuisine name",',
      '    "totalTimeMin": 20,',
      '    "servings": 2,',
      outputLanguage === "zh" ? '    "spiceLevel": "辣度",' : '    "spiceLevel": "mild",',
      outputLanguage === "zh" ? '    "notes": "可选备注"' : '    "notes": "optional notes"',
      "  }",
      "}",
      outputLanguage === "zh" ? "要求：" : "Rules:",
      outputLanguage === "zh"
        ? "- 尽量保留用户原本想表达的菜名和做法。"
        : "- Preserve the user's intended dish and wording where practical.",
      outputLanguage === "zh"
        ? "- 把内容拆成清晰的食材列表和有顺序的步骤。"
        : "- Break the recipe into clear ingredients and ordered steps.",
      outputLanguage === "zh"
        ? "- 如果输入来自网页 JSON 或 JSON-LD，只提取实际菜谱值；不要把 @type、@context、recipeIngredient、recipeInstructions、schema 字段名写进标题、食材或步骤。"
        : "- If the input is web JSON or JSON-LD, extract only actual recipe values; never put @type, @context, recipeIngredient, recipeInstructions, or schema field names into title, ingredients, or steps.",
      outputLanguage === "zh"
        ? "- 食材的 name 只放食材名称，amount 只放数量和单位；不要把整段步骤或 JSON 片段塞进食材字段。"
        : "- Put only the ingredient name in name and only quantity/unit in amount; do not place full steps or JSON fragments in ingredient fields.",
      outputLanguage === "zh"
        ? "- 步骤文字要简洁，适合做菜时朗读。"
        : "- Keep step text concise and readable for cooking playback.",
      outputLanguage === "zh"
        ? "- 装盘、点缀、for serving 这类上桌配料要保留在 ingredients 里，但 'for serving'、'toppings' 这类标签本身不是食材。"
        : "- Include garnish, topping, and for-serving items in ingredients when they are actual foods, but never keep labels like 'for serving' or 'toppings' as ingredient names.",
      outputLanguage === "zh"
        ? "- 不要把食材行、配料短语或 topping 说明写成步骤；步骤必须是明确的烹饪动作。"
        : "- Never turn ingredient lines, topping phrases, or serving notes into steps. Steps must be actual cooking actions.",
      outputLanguage === "zh"
        ? "- 标题、食材、步骤、菜系、口味、辣度、备注要跟随输入菜谱的主要语言；如果粘贴的菜谱是英文，回填结果也必须是英文；不要因为界面语言而翻译；difficulty 只能用 easy、medium、hard。"
        : "- Match the main language of the pasted recipe for title, ingredients, steps, cuisine, flavor, spice level, and notes. If the pasted recipe is English, the structured recipe must stay English; do not translate it because of the interface language. difficulty must be easy, medium, or hard.",
      outputLanguage === "zh"
        ? "- 只有在文本里有依据时，才补充可推断的可选信息。"
        : "- Infer optional metadata only when reasonably supported by the text.",
      outputLanguage === "zh"
        ? "- 不确定的可选字段宁可省略，也不要编造。"
        : "- Omit unknown optional fields instead of inventing details.",
      outputLanguage === "zh"
        ? "- 不要输出 Markdown、schema 解释、字段映射说明、思考过程或自言自语。"
        : "- Do not include markdown, schema explanations, field mapping notes, chain-of-thought, or self-talk.",
      "",
      `${outputLanguage === "zh" ? "菜谱文字" : "Recipe text"}:
${trimRecipeSourceText(recipeText)}`,
    ].join("\n");

    const result = await this.chat(
      [
        {
          role: "system",
          content:
            outputLanguage === "zh"
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
    const cleaned = cleanStructuredRecipePayload(recipe, outputLanguage, recipeText);
    if (!hasUsableRecipePayload(cleaned)) {
      throw new Error("Failed to parse structured recipe JSON from text input");
    }
    return cleaned;
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

    const parsedRecipe = await this.parseOrRepairRecipePayload(
      result,
      "Failed to parse refined recipe JSON from LLM response",
    );
    return cleanStructuredRecipePayload(parsedRecipe, undefined, JSON.stringify(parsedRecipe));
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
