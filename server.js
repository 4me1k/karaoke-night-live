const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "karaoke123";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const CUSTOM_SONG_DATA_FILE = path.join(DATA_DIR, "custom-song-data.json");

let queue = [];
let currentSong = null;
let nextId = 1;
const sseClients = new Set();
const lyricsCache = new Map();
const customSongData = new Map();

function normalizeLyricsKeyPart(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeLyricsKey(artist, song) {
  return `${normalizeLyricsKeyPart(artist)}::${normalizeLyricsKeyPart(song)}`;
}

function loadCustomSongData() {
  try {
    const fileData = fs.readFileSync(CUSTOM_SONG_DATA_FILE, "utf-8");
    const parsed = JSON.parse(fileData);
    if (!Array.isArray(parsed)) return;

    for (const item of parsed) {
      const artist = String(item.artist || "").trim();
      const song = String(item.song || "").trim();
      const lyrics = String(item.lyrics || "").trim();
      const chords = String(item.chords || "").trim();
      if (!artist || !song) continue;
      if (!lyrics && !chords) continue;

      customSongData.set(makeLyricsKey(artist, song), {
        artist,
        song,
        lyrics,
        chords,
        updatedAt: Number(item.updatedAt) || Date.now()
      });
    }
  } catch (_error) {
    // No custom song data file yet.
  }
}

function saveCustomSongData() {
  const payload = Array.from(customSongData.values());
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CUSTOM_SONG_DATA_FILE, JSON.stringify(payload, null, 2), "utf-8");
}

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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      let rawData = "";
      response.on("data", (chunk) => {
        rawData += chunk.toString();
      });
      response.on("end", () => {
        try {
          const parsedData = rawData ? JSON.parse(rawData) : {};
          resolve({ statusCode: response.statusCode || 500, data: parsedData });
        } catch (_error) {
          reject(new Error("Invalid response from lyrics provider."));
        }
      });
    });

    request.setTimeout(8000, () => {
      request.destroy(new Error("Lyrics request timeout."));
    });
    request.on("error", reject);
  });
}

async function fetchFromLyricsOvh(artist, song) {
  const artistParam = encodeURIComponent(artist);
  const songParam = encodeURIComponent(song);
  const url = `https://api.lyrics.ovh/v1/${artistParam}/${songParam}`;
  const { statusCode, data } = await fetchJson(url);

  if (statusCode === 404) return null;
  if (statusCode >= 500) throw new Error("lyrics.ovh unavailable");
  if (!data || !data.lyrics) return null;

  const lyrics = String(data.lyrics).trim();
  return lyrics || null;
}

async function fetchFromLrcLib(artist, song) {
  const artistParam = encodeURIComponent(artist);
  const songParam = encodeURIComponent(song);
  const directUrl = `https://lrclib.net/api/get?artist_name=${artistParam}&track_name=${songParam}`;

  const directResponse = await fetchJson(directUrl);
  if (directResponse.statusCode >= 500) {
    throw new Error("lrclib unavailable");
  }

  if (directResponse.statusCode < 400) {
    const directData = directResponse.data || {};
    const directLyrics = String(directData.plainLyrics || directData.syncedLyrics || "").trim();
    if (directLyrics) return directLyrics;
  }

  const searchUrl = `https://lrclib.net/api/search?artist_name=${artistParam}&track_name=${songParam}`;
  const searchResponse = await fetchJson(searchUrl);

  if (searchResponse.statusCode >= 500) {
    throw new Error("lrclib unavailable");
  }

  if (searchResponse.statusCode >= 400) return null;

  const candidates = Array.isArray(searchResponse.data) ? searchResponse.data : [];
  for (const item of candidates) {
    const lyrics = String(item.plainLyrics || item.syncedLyrics || "").trim();
    if (lyrics) return lyrics;
  }

  return null;
}

async function getLyrics(artist, song) {
  const lyricsKey = makeLyricsKey(artist, song);
  const manualSongData = customSongData.get(lyricsKey);
  if (manualSongData && manualSongData.lyrics) {
    return {
      artist: manualSongData.artist,
      song: manualSongData.song,
      lyrics: manualSongData.lyrics,
      source: "manual"
    };
  }

  const cacheKey = lyricsKey;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  const providers = [fetchFromLyricsOvh, fetchFromLrcLib];
  let hadServiceFailure = false;
  let lyrics = null;

  for (const provider of providers) {
    try {
      lyrics = await provider(artist, song);
      if (lyrics) break;
    } catch (_error) {
      hadServiceFailure = true;
    }
  }

  if (!lyrics) {
    if (hadServiceFailure) {
      throw new Error("Lyrics service unavailable.");
    }
    throw new Error("Lyrics not found.");
  }

  const result = {
    artist,
    song,
    lyrics,
    source: "auto"
  };
  lyricsCache.set(cacheKey, result);
  return result;
}

function getChords(artist, song) {
  const key = makeLyricsKey(artist, song);
  const manualSongData = customSongData.get(key);
  if (!manualSongData || !manualSongData.chords) {
    throw new Error("Chords not found.");
  }

  return {
    artist: manualSongData.artist,
    song: manualSongData.song,
    chords: manualSongData.chords,
    source: "manual"
  };
}

function isAdminRequest(request) {
  const pin = String(request.headers["x-admin-pin"] || "").trim();
  return pin && pin === ADMIN_PIN;
}

function requireAdmin(request, response) {
  if (!isAdminRequest(request)) {
    sendJson(response, 403, { error: "Admin access required." });
    return false;
  }
  return true;
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

loadCustomSongData();

const server = http.createServer(async (request, response) => {
  const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
  const { pathname } = parsedUrl;

  if (request.method === "GET" && pathname === "/api/state") {
    sendJson(response, 200, getState());
    return;
  }

  if (request.method === "GET" && pathname === "/api/lyrics") {
    const song = String(parsedUrl.searchParams.get("song") || "").trim();
    const artist = String(parsedUrl.searchParams.get("artist") || "").trim();

    if (!song || !artist) {
      sendJson(response, 400, { error: "Song and artist are required." });
      return;
    }

    try {
      const lyricsResult = await getLyrics(artist, song);
      sendJson(response, 200, { ok: true, ...lyricsResult });
    } catch (error) {
      const message = String(error && error.message ? error.message : "");
      if (message === "Lyrics not found.") {
        sendJson(response, 404, { error: "Lyrics not found." });
        return;
      }
      sendJson(response, 502, { error: "Lyrics providers unavailable right now." });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/chords") {
    const song = String(parsedUrl.searchParams.get("song") || "").trim();
    const artist = String(parsedUrl.searchParams.get("artist") || "").trim();

    if (!song || !artist) {
      sendJson(response, 400, { error: "Song and artist are required." });
      return;
    }

    try {
      const chordsResult = getChords(artist, song);
      sendJson(response, 200, { ok: true, ...chordsResult });
    } catch (_error) {
      sendJson(response, 404, { error: "Chords not found." });
    }
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

  if (request.method === "POST" && pathname === "/api/admin/login") {
    try {
      const payload = await parseBody(request);
      const pin = String(payload.pin || "").trim();

      if (!pin || pin !== ADMIN_PIN) {
        sendJson(response, 401, { error: "Wrong admin PIN." });
        return;
      }

      sendJson(response, 200, { ok: true });
      return;
    } catch (_error) {
      sendJson(response, 400, { error: "Invalid request body." });
      return;
    }
  }

  if (request.method === "POST" && pathname === "/api/lyrics/custom") {
    if (!requireAdmin(request, response)) return;
    try {
      const payload = await parseBody(request);
      const artist = String(payload.artist || "").trim();
      const song = String(payload.song || "").trim();
      const lyrics = String(payload.lyrics || "").trim();

      if (!artist || !song || !lyrics) {
        sendJson(response, 400, { error: "Artist, song and lyrics are required." });
        return;
      }

      const key = makeLyricsKey(artist, song);
      const existing = customSongData.get(key) || { artist, song, chords: "" };
      customSongData.set(key, { ...existing, artist, song, lyrics, updatedAt: Date.now() });
      lyricsCache.delete(key);
      saveCustomSongData();
      sendJson(response, 200, { ok: true });
      return;
    } catch (_error) {
      sendJson(response, 400, { error: "Invalid request body." });
      return;
    }
  }

  if (request.method === "POST" && pathname === "/api/song/custom") {
    if (!requireAdmin(request, response)) return;
    try {
      const payload = await parseBody(request);
      const artist = String(payload.artist || "").trim();
      const song = String(payload.song || "").trim();
      const lyrics = String(payload.lyrics || "").trim();
      const chords = String(payload.chords || "").trim();

      if (!artist || !song || (!lyrics && !chords)) {
        sendJson(response, 400, { error: "Artist, song and at least lyrics or chords are required." });
        return;
      }

      const key = makeLyricsKey(artist, song);
      const existing = customSongData.get(key) || {};
      customSongData.set(key, {
        artist,
        song,
        lyrics: lyrics || String(existing.lyrics || "").trim(),
        chords: chords || String(existing.chords || "").trim(),
        updatedAt: Date.now()
      });
      lyricsCache.delete(key);
      saveCustomSongData();
      sendJson(response, 200, { ok: true });
      return;
    } catch (_error) {
      sendJson(response, 400, { error: "Invalid request body." });
      return;
    }
  }

  if (request.method === "POST" && pathname === "/api/next") {
    if (!requireAdmin(request, response)) return;
    currentSong = queue.shift() || null;
    broadcastState();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/reset") {
    if (!requireAdmin(request, response)) return;
    currentSong = null;
    queue = [];
    nextId = 1;
    broadcastState();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/remove") {
    if (!requireAdmin(request, response)) return;
    try {
      const payload = await parseBody(request);
      const id = Number(payload.id);

      if (!Number.isInteger(id)) {
        sendJson(response, 400, { error: "Song id is required." });
        return;
      }

      const beforeLength = queue.length;
      queue = queue.filter((item) => item.id !== id);

      if (queue.length === beforeLength) {
        sendJson(response, 404, { error: "Song not found in queue." });
        return;
      }

      broadcastState();
      sendJson(response, 200, { ok: true });
      return;
    } catch (_error) {
      sendJson(response, 400, { error: "Invalid request body." });
      return;
    }
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
