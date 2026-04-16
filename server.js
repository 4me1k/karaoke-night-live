const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

let queue = [];
let currentSong = null;
let nextId = 1;
const sseClients = new Set();

function getState() {
  return { currentSong, queue };
}

function broadcastState() {
  const payload = `data: ${JSON.stringify(getState())}\n\n`;

  for (const response of sseClients) {
    response.write(payload);
  }
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function getContentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function serveStatic(requestPath, response) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, fileData) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": getContentType(filePath) });
    response.end(fileData);
  });
}

const server = http.createServer(async (request, response) => {
  const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
  const { pathname } = parsedUrl;

  if (request.method === "GET" && pathname === "/api/state") {
    sendJson(response, 200, getState());
    return;
  }

  if (request.method === "GET" && pathname === "/api/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    response.write(`data: ${JSON.stringify(getState())}\n\n`);

    sseClients.add(response);
    request.on("close", () => {
      sseClients.delete(response);
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/add") {
    try {
      const payload = await parseBody(request);
      const song = String(payload.song || "").trim();
      const artist = String(payload.artist || "").trim();
      const requester = String(payload.requester || "").trim();

      if (!song || !artist || !requester) {
        sendJson(response, 400, { error: "Please fill Song, Artist, and Your Name." });
        return;
      }

      const item = { id: nextId++, song, artist, requester, createdAt: Date.now() };
      queue.push(item);

      if (!currentSong) {
        currentSong = queue.shift();
      }

      broadcastState();
      sendJson(response, 200, { ok: true });
      return;
    } catch (_error) {
      sendJson(response, 400, { error: "Invalid request body." });
      return;
    }
  }

  if (request.method === "POST" && pathname === "/api/next") {
    currentSong = queue.shift() || null;
    broadcastState();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/reset") {
    currentSong = null;
    queue = [];
    nextId = 1;
    broadcastState();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET") {
    serveStatic(pathname, response);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Karaoke app running at http://localhost:${PORT}`);
});
