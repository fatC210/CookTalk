import type { Recipe } from "./db";
import { getApiKey } from "./crypto";

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

export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";
export const DEFAULT_IMAGE_MODEL = "gpt-image-1.5";
const API_VALIDATION_TIMEOUT_MS = 10_000;
const OPENAI_COMPATIBLE_PROXY_PATH = "/api/openai-compatible";

export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/chat\/completions$/i, "").replace(/\/images\/generations$/i, "");
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
    const response = await fetchWithTimeout(
      `${baseUrl}/models/${encodeURIComponent(config.model)}`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
    );

    return response.ok;
  } catch {
    return false;
  }
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

  async chat(messages: ChatMessage[]): Promise<string> {
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
      }),
    });

    if (!response.ok) throw new Error(`LLM failed: ${response.status}`);
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

    if (!response.ok) throw new Error(`LLM failed: ${response.status}`);

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
          ? delta
              .map((item) => (typeof item.text === "string" ? item.text : ""))
              .join("")
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

  private parseRecipePayload(result: string, errorMessage: string): RecipePayload {
    const cleaned = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      return JSON.parse(cleaned) as RecipePayload;
    } catch {
      throw new Error(errorMessage);
    }
  }

  async structureRecipe(transcript: string): Promise<RecipePayload> {
    const prompt = `以下是一段烹饪视频的语音转录。请提取为 JSON 格式：
{
  "title": "菜名",
  "ingredients": [{"name": "食材名", "amount": "用量"}],
  "steps": [{"order": 1, "description": "步骤描述", "durationSec": 秒数, "tips": "提示（可选）"}],
  "tags": {"flavor": ["口味"], "difficulty": "easy|medium|hard", "cuisine": "菜系", "totalTimeMin": 总时间分钟}
}
规则：忽略口播废话/广告；从"煮3分钟"等表述提取时间；关键火候/手法提示放入 tips。务必返回有效 JSON。

转录内容：
${transcript}`;

    const result = await this.chat([
      {
        role: "system",
        content:
          "You are a professional chef assistant. Always respond with valid JSON only, no markdown.",
      },
      { role: "user", content: prompt },
    ]);

    return this.parseRecipePayload(result, "Failed to parse recipe JSON from LLM response");
  }

  async structureRecipeFromText(recipeText: string): Promise<RecipePayload> {
    const prompt = [
      "You are converting rough recipe text into structured CookTalk recipe JSON.",
      "The input may be a pasted recipe, plain notes, or unformatted cooking text.",
      "Return valid JSON only, no markdown, using this schema:",
      "{",
      '  "title": "Recipe name",',
      '  "ingredients": [{"name": "ingredient", "amount": "amount"}],',
      '  "steps": [{"order": 1, "description": "step text", "durationSec": 300, "tips": "optional tip"}],',
      '  "tags": {',
      '    "flavor": ["savory"],',
      '    "difficulty": "easy|medium|hard",',
      '    "cuisine": "cuisine name",',
      '    "totalTimeMin": 20,',
      '    "servings": 2,',
      '    "spiceLevel": "mild",',
      '    "notes": "optional notes"',
      "  }",
      "}",
      "Rules:",
      "- Preserve the user's intended dish and wording where practical.",
      "- Break the recipe into clear ingredients and ordered steps.",
      "- Keep step text concise and readable for cooking playback.",
      "- Infer optional metadata only when reasonably supported by the text.",
      "- Omit unknown optional fields instead of inventing details.",
      "",
      `Recipe text:\n${recipeText}`,
    ].join("\n");

    const result = await this.chat([
      {
        role: "system",
        content:
          "You are a professional chef assistant. Always respond with valid JSON only, no markdown.",
      },
      { role: "user", content: prompt },
    ]);

    return this.parseRecipePayload(
      result,
      "Failed to parse structured recipe JSON from text input",
    );
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

    const result = await this.chat([
      {
        role: "system",
        content:
          "You are a professional chef assistant. Always respond with valid JSON only, no markdown.",
      },
      { role: "user", content: prompt },
    ]);

    return this.parseRecipePayload(result, "Failed to parse refined recipe JSON from LLM response");
  }

  async generateCoverPrompt(dishName: string, customStyle?: string): Promise<string> {
    const base = `A high-quality, appetizing top-down food photography of ${dishName}, on a clean ceramic plate, natural lighting, shallow depth of field, professional food magazine style, no text, no watermark.`;
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
  private endpoint: string;
  private apiKey: string;
  private model: string;

  constructor(endpoint: string, apiKey: string, model: string = DEFAULT_IMAGE_MODEL) {
    this.endpoint = normalizeOpenAIBaseUrl(endpoint);
    this.apiKey = apiKey;
    this.model = model.trim() || DEFAULT_IMAGE_MODEL;
  }

  async generateImage(prompt: string): Promise<Blob> {
    const isGptImageModel = this.model.toLowerCase().startsWith("gpt-image-");
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

    const response = await fetchOpenAICompatible(`${this.endpoint}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) throw new Error(`Image gen failed: ${response.status}`);
    const data = (await response.json()) as ImageGenerationResponse;
    const image = data.data?.[0];
    if (!image) throw new Error("Image gen failed: empty response");

    if (image.url) {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) throw new Error(`Image download failed: ${imageResponse.status}`);
      return await imageResponse.blob();
    }

    const b64 = image.b64_json;
    if (!b64) throw new Error("Image gen failed: missing image data");

    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: `image/${data.output_format ?? "png"}` });
  }
}
