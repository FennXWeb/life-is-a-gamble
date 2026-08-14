const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function containedPath(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^[/\\]+/, "");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolved;
}

async function createAssetResponse(clientRoot, request) {
  const url = new URL(request.url);
  const filePath = containedPath(clientRoot, url.pathname);
  if (!filePath) return new Response("Forbidden", { status: 403 });
  try {
    const data = await fs.readFile(filePath);
    return new Response(request.method === "HEAD" ? null : data, {
      status: 200,
      headers: {
        "Cache-Control": url.pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
        "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      },
    });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return new Response("Not found", { status: 404 });
    throw error;
  }
}

async function toWebRequest(request, origin) {
  const method = request.method || "GET";
  const init = { method, headers: request.headers };
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    init.body = Buffer.concat(chunks);
  }
  return new Request(new URL(request.url || "/", origin), init);
}

async function sendWebResponse(response, target) {
  target.statusCode = response.status;
  target.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    if (name !== "content-encoding" && name !== "content-length") target.setHeader(name, value);
  });
  if (!response.body) return target.end();
  const body = Buffer.from(await response.arrayBuffer());
  target.setHeader("Content-Length", body.byteLength);
  target.end(body);
}

async function createGameServer(runtimeRoot) {
  const serverEntry = path.join(runtimeRoot, "server", "index.js");
  const clientRoot = path.join(runtimeRoot, "client");
  const moduleUrl = `${pathToFileURL(serverEntry).href}?desktop=${Date.now()}`;
  const worker = (await import(moduleUrl)).default;
  if (!worker || typeof worker.fetch !== "function") throw new Error("The game server bundle does not expose a fetch handler.");

  const waitUntilTasks = new Set();
  const executionContext = {
    passThroughOnException() {},
    waitUntil(promise) {
      const task = Promise.resolve(promise).catch((error) => console.error("Background game task failed", error));
      waitUntilTasks.add(task);
      task.finally(() => waitUntilTasks.delete(task));
    },
  };
  const environment = {
    ASSETS: { fetch: (request) => createAssetResponse(clientRoot, request) },
    DESKTOP_RUNTIME: "windows",
  };

  let origin = "http://127.0.0.1";
  const server = http.createServer(async (request, response) => {
    try {
      const webRequest = await toWebRequest(request, origin);
      if (webRequest.method === "GET" || webRequest.method === "HEAD") {
        const assetResponse = await createAssetResponse(clientRoot, webRequest);
        if (assetResponse.status !== 404) {
          await sendWebResponse(assetResponse, response);
          return;
        }
      }
      await sendWebResponse(await worker.fetch(webRequest, environment, executionContext), response);
    } catch (error) {
      console.error("Game request failed", error);
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("The local game runtime encountered an error.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled([...waitUntilTasks]);
    },
  };
}

module.exports = { createGameServer };
