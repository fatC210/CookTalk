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

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
