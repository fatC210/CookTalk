import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import worker from "../dist/server/index.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const clientDir = resolve("dist/client");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

function toNodeHeaders(headers) {
  const nodeHeaders = {};
  for (const [key, value] of headers) {
    if (key.toLowerCase() !== "set-cookie") {
      nodeHeaders[key] = value;
    }
  }

  const setCookie = headers.getSetCookie?.();
  if (setCookie?.length) {
    nodeHeaders["set-cookie"] = setCookie;
  }

  return nodeHeaders;
}

function writeResponse(res, response) {
  res.writeHead(response.status, response.statusText, toNodeHeaders(response.headers));

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

function getRequestUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] ?? "http";
  const hostHeader = req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${port}`;
  return `${protocol}://${hostHeader}${req.url ?? "/"}`;
}

function toWebRequest(req) {
  const url = getRequestUrl(req);
  const method = req.method ?? "GET";
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }

  return new Request(url, {
    method,
    headers,
    body: Readable.toWeb(req),
    duplex: "half",
  });
}

function getStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const normalized = normalize(decoded).replace(/^([/\\])+/, "");
  const resolvedPath = resolve(join(clientDir, normalized));

  if (resolvedPath !== clientDir && !resolvedPath.startsWith(`${clientDir}${sep}`)) {
    return null;
  }

  return resolvedPath;
}

async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const url = new URL(getRequestUrl(req));
  const staticPath = getStaticPath(url.pathname);
  if (!staticPath) return false;

  let fileStat;
  try {
    fileStat = await stat(staticPath);
  } catch {
    return false;
  }

  if (!fileStat.isFile()) {
    return false;
  }

  const headers = {
    "content-length": fileStat.size,
    "content-type": mimeTypes.get(extname(staticPath).toLowerCase()) ?? "application/octet-stream",
  };

  if (url.pathname.startsWith("/assets/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
  } else {
    createReadStream(staticPath).pipe(res);
  }

  return true;
}

const server = createServer(async (req, res) => {
  try {
    if (await serveStatic(req, res)) return;

    const response = await worker.fetch(toWebRequest(req), process.env, {
      waitUntil(promise) {
        Promise.resolve(promise).catch((error) => console.error(error));
      },
      passThroughOnException() {},
    });

    writeResponse(res, response);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`CookTalk listening on http://${host}:${port}`);
});
