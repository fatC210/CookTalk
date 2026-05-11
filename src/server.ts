import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type WebRecipeSearchResult = {
  title: string;
  url: string;
  source: string;
};

type WebRecipeContentResult = {
  title: string;
  url: string;
  text: string;
};

const MAX_WEB_RECIPE_TEXT_CHARS = 24_000;

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isAllowedOpenAICompatibleTarget(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const pathname = url.pathname.replace(/\/+$/, "").toLowerCase();
  return (
    pathname.endsWith("/chat/completions") ||
    pathname.endsWith("/images/generations") ||
    pathname.endsWith("/responses") ||
    pathname.endsWith("/models") ||
    /\/models\/[^/]+$/.test(pathname)
  );
}

function getProxyHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  [
    "accept-encoding",
    "connection",
    "content-length",
    "host",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
  ].forEach((header) => headers.delete(header));
  return headers;
}

function getResponseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  ["content-encoding", "content-length", "set-cookie", "transfer-encoding"].forEach((header) =>
    headers.delete(header),
  );
  return headers;
}

async function proxyOpenAICompatibleRequest(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    return new Response("Missing target URL", { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid target URL", { status: 400 });
  }

  if (!isAllowedOpenAICompatibleTarget(targetUrl)) {
    return new Response("Target URL is not allowed", { status: 400 });
  }

  const requestBody =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: request.method,
      headers: getProxyHeaders(request),
      body: requestBody,
      redirect: "follow",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.warn(`OpenAI-compatible proxy failed for ${targetUrl.origin}: ${detail}`);
    return new Response(`Upstream request failed: ${detail}`, { status: 502 });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: getResponseHeaders(response),
  });
}

async function searchWebRecipes(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get("q")?.trim();

  if (!query) {
    return jsonResponse({ results: [] });
  }

  const searchQuery = buildRecipeSearchQuery(query);
  const results = await fetchDuckDuckGoResults(searchQuery);
  if (results.length > 0) {
    return jsonResponse({ results });
  }

  const fallbackResults = await fetchBingResults(searchQuery);
  return jsonResponse({ results: fallbackResults });
}

async function fetchWebRecipeContent(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url")?.trim();

  if (!target) {
    return jsonResponse({ error: "Missing recipe URL" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonResponse({ error: "Invalid recipe URL" }, { status: 400 });
  }

  if (!isAllowedRecipeContentUrl(targetUrl)) {
    return jsonResponse({ error: "Recipe URL is not allowed" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CookTalk/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      return jsonResponse({ error: `Recipe page failed: ${response.status}` }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const result = extractWebRecipeContent(body, response.url || targetUrl.toString(), contentType);

    if (!result.text) {
      return jsonResponse({ error: "No readable recipe content found" }, { status: 422 });
    }

    return jsonResponse(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return jsonResponse({ error: `Failed to fetch recipe page: ${detail}` }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedRecipeContentUrl(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    return false;
  }

  return true;
}

function extractWebRecipeContent(
  body: string,
  resolvedUrl: string,
  contentType: string,
): WebRecipeContentResult {
  if (!/html/i.test(contentType)) {
    const text = normalizeReadableText(body).slice(0, MAX_WEB_RECIPE_TEXT_CHARS);
    return {
      title: getHostname(resolvedUrl),
      url: resolvedUrl,
      text,
    };
  }

  const title =
    cleanHtmlText(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
    cleanHtmlText(
      body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ??
        "",
    ) ||
    getHostname(resolvedUrl);

  const structuredData = extractRecipeStructuredData(body);
  const readableHtml = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|p|div|section|article|li|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const text = normalizeReadableText(
    [structuredData, cleanHtmlText(readableHtml)].join("\n\n"),
  ).slice(0, MAX_WEB_RECIPE_TEXT_CHARS);

  return {
    title,
    url: resolvedUrl,
    text,
  };
}

function extractRecipeStructuredData(html: string): string {
  const blocks: string[] = [];
  const jsonLdPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(jsonLdPattern)) {
    const rawJson = decodeHtmlEntities(match[1]).trim();
    if (!rawJson || !/"Recipe"|"recipe"/.test(rawJson)) continue;

    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const recipes = collectRecipeJsonLd(parsed);
      for (const recipe of recipes) {
        blocks.push(formatRecipeJsonLd(recipe));
      }
    } catch {
      blocks.push(rawJson);
    }
  }

  return blocks.join("\n\n");
}

function collectRecipeJsonLd(value: unknown): Record<string, unknown>[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap(collectRecipeJsonLd);
  }

  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const graph = record["@graph"];
  const typeValues = Array.isArray(type) ? type : [type];
  const isRecipe = typeValues.some((item) => String(item).toLowerCase() === "recipe");
  const found = isRecipe ? [record] : [];

  if (graph) {
    found.push(...collectRecipeJsonLd(graph));
  }

  return found;
}

function formatRecipeJsonLd(recipe: Record<string, unknown>): string {
  const parts = [
    stringifyRecipeField("Title", recipe.name),
    stringifyRecipeField("Description", recipe.description),
    stringifyRecipeField("Yield", recipe.recipeYield),
    stringifyRecipeField("Ingredients", recipe.recipeIngredient),
    stringifyRecipeField("Instructions", recipe.recipeInstructions),
    stringifyRecipeField("Cuisine", recipe.recipeCuisine),
    stringifyRecipeField("Category", recipe.recipeCategory),
    stringifyRecipeField("Total time", recipe.totalTime),
    stringifyRecipeField("Cook time", recipe.cookTime),
    stringifyRecipeField("Prep time", recipe.prepTime),
  ].filter(Boolean);

  return parts.join("\n");
}

function stringifyRecipeField(label: string, value: unknown): string {
  if (value == null) return "";

  if (Array.isArray(value)) {
    const text = value
      .map((item, index) => {
        if (typeof item === "string") return `${index + 1}. ${item}`;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const name = typeof record.name === "string" ? record.name : "";
          const text = typeof record.text === "string" ? record.text : "";
          return `${index + 1}. ${[name, text].filter(Boolean).join(" - ")}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return text ? `${label}:\n${text}` : "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const text = typeof record.text === "string" ? record.text : "";
    const joined = [name, text].filter(Boolean).join(" - ");
    return joined ? `${label}: ${joined}` : "";
  }

  return `${label}: ${String(value)}`;
}

function normalizeReadableText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchDuckDuckGoResults(query: string): Promise<WebRecipeSearchResult[]> {
  const searchUrl = new URL("https://duckduckgo.com/html/");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("kl", "cn-zh");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CookTalk/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) return [];
    return parseDuckDuckGoHtml(await response.text()).slice(0, 3);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function parseDuckDuckGoHtml(html: string): WebRecipeSearchResult[] {
  const results: WebRecipeSearchResult[] = [];
  const seenUrls = new Set<string>();
  const resultPattern =
    /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(resultPattern)) {
    const url = resolveSearchResultUrl(match[1]);
    if (!url || seenUrls.has(url)) continue;

    const title = cleanHtmlText(match[2]);
    if (!title) continue;

    seenUrls.add(url);
    results.push({
      title,
      url,
      source: getHostname(url),
    });
  }

  return results;
}

async function fetchBingResults(query: string): Promise<WebRecipeSearchResult[]> {
  const searchUrl = new URL("https://cn.bing.com/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("cc", "cn");
  searchUrl.searchParams.set("setlang", "zh-CN");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CookTalk/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) return [];
    return parseBingHtml(await response.text()).slice(0, 3);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function parseBingHtml(html: string): WebRecipeSearchResult[] {
  const results: WebRecipeSearchResult[] = [];
  const seenUrls = new Set<string>();
  const resultPattern =
    /<li\s+class=["'][^"']*b_algo[^"']*["'][\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(resultPattern)) {
    const url = resolveDirectResultUrl(match[1]);
    if (!url || seenUrls.has(url)) continue;

    const title = cleanHtmlText(match[2]);
    if (!title) continue;

    seenUrls.add(url);
    results.push({
      title,
      url,
      source: getHostname(url),
    });
  }

  return results;
}

function resolveSearchResultUrl(rawHref: string): string | null {
  try {
    const href = decodeHtmlEntities(rawHref);
    const url = href.startsWith("//")
      ? new URL(`https:${href}`)
      : new URL(href, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    const resolved = redirected ? decodeURIComponent(redirected) : url.toString();
    const target = new URL(resolved);
    if (target.protocol !== "https:" && target.protocol !== "http:") return null;
    if (/duckduckgo\.com$/i.test(target.hostname)) return null;
    return target.toString();
  } catch {
    return null;
  }
}

function resolveDirectResultUrl(rawHref: string): string | null {
  try {
    const url = new URL(decodeHtmlEntities(rawHref));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (/bing\.com$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanHtmlText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function buildRecipeSearchQuery(query: string): string {
  const keyword = query.trim();
  if (/^[\u4e00-\u9fa5]+$/.test(keyword) && keyword.length <= 18) {
    return `${keyword}的做法`;
  }
  return `${keyword} 菜谱 做法`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "网页";
  }
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/openai-compatible") {
        return await proxyOpenAICompatibleRequest(request);
      }
      if (url.pathname === "/api/web-recipe-search") {
        return await searchWebRecipes(request);
      }
      if (url.pathname === "/api/web-recipe-content") {
        return await fetchWebRecipeContent(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
