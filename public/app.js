const form = document.getElementById("requestForm");
const statusMessage = document.getElementById("statusMessage");
const currentSong = document.getElementById("currentSong");
const queueList = document.getElementById("queueList");
const nextButton = document.getElementById("nextButton");
const resetButton = document.getElementById("resetButton");
const modeToggleButton = document.getElementById("modeToggleButton");
const qrSection = document.getElementById("qrSection");
const adminSection = document.getElementById("adminSection");
const requestSection = document.getElementById("requestSection");
const queueSection = document.getElementById("queueSection");
const nextSongSection = document.getElementById("nextSongSection");
const nextSongContent = document.getElementById("nextSongContent");
const lyricsSection = document.getElementById("lyricsSection");
const adminControls = document.getElementById("adminControls");
const adminForm = document.getElementById("adminForm");
const adminPinInput = document.getElementById("adminPin");
const adminSession = document.getElementById("adminSession");
const adminLogoutButton = document.getElementById("adminLogoutButton");
const customLyricsForm = document.getElementById("customLyricsForm");
const customLyricsSong = document.getElementById("customLyricsSong");
const customLyricsArtist = document.getElementById("customLyricsArtist");
const customLyricsText = document.getElementById("customLyricsText");
const fillCurrentSongButton = document.getElementById("fillCurrentSongButton");
const openShironetButton = document.getElementById("openShironetButton");
const qrImage = document.getElementById("qrImage");
const shareUrlText = document.getElementById("shareUrl");
const copyLinkButton = document.getElementById("copyLinkButton");
const lyricsMeta = document.getElementById("lyricsMeta");
const lyricsContent = document.getElementById("lyricsContent");
const ADMIN_PIN_STORAGE_KEY = "karaoke-admin-pin";
let adminPin = localStorage.getItem(ADMIN_PIN_STORAGE_KEY) || "";
let isAdmin = false;
let isTvMode = false;
let currentLyricsKey = "";
let lyricsRequestToken = 0;
let latestState = { currentSong: null, queue: [] };

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function renderCurrentSong(item) {
  if (!item) {
    currentSong.className = "song-empty";
    currentSong.textContent = "No one is singing right now.";
    return;
  }

  currentSong.className = "song-now";
  currentSong.innerHTML = `
    <strong>${item.song}</strong> - ${item.artist}<br/>
    <span>Requested by ${item.requester}</span>
  `;
}

function renderNextSong(queue) {
  const nextSong = queue[0];
  if (!nextSong) {
    nextSongContent.className = "song-empty";
    nextSongContent.textContent = "No songs in queue yet.";
    return;
  }

  nextSongContent.className = "tv-next-content";
  nextSongContent.innerHTML = `
    <div class="tv-next-label">Next Song</div>
    <div class="tv-song-title">${nextSong.song}</div>
    <div class="tv-song-artist">${nextSong.artist}</div>
    <div class="tv-song-requester">Singer: ${nextSong.requester}</div>
  `;
}

function setLyricsText(metaText, bodyText) {
  lyricsMeta.textContent = metaText;
  lyricsContent.textContent = bodyText;
}

function loadLyricsForCurrentSong(item, forceReload = false) {
  if (!item) {
    currentLyricsKey = "";
    setLyricsText("Lyrics will appear for the current song.", "No song playing yet.");
    return;
  }

  const nextKey = `${item.artist}::${item.song}`.toLowerCase();
  if (!forceReload && nextKey === currentLyricsKey) return;
  currentLyricsKey = nextKey;
  lyricsRequestToken += 1;
  const requestToken = lyricsRequestToken;

  setLyricsText(`Loading lyrics for ${item.song} - ${item.artist}...`, "Please wait...");

  const params = new URLSearchParams({ artist: item.artist, song: item.song });
  fetch(`/api/lyrics?${params.toString()}`)
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Lyrics not found.");
      }
      if (requestToken !== lyricsRequestToken) return;
      const sourceLabel = data.source === "manual" ? " (custom)" : "";
      setLyricsText(
        `Lyrics for ${data.song} - ${data.artist}${sourceLabel}`,
        data.lyrics || "Lyrics unavailable."
      );
    })
    .catch((error) => {
      if (requestToken !== lyricsRequestToken) return;
      setLyricsText(
        `Lyrics unavailable for ${item.song} - ${item.artist}.`,
        error.message || "Try again later."
      );
    });
}

function renderQueue(queue) {
  queueList.innerHTML = "";

  if (!queue.length) {
    const li = document.createElement("li");
    li.className = "song-empty";
    li.textContent = "No songs in queue yet.";
    queueList.appendChild(li);
    return;
  }

  queue.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "song-item";
    const adminActions = isAdmin && !isTvMode
      ? `<button class="small danger remove-song-button" type="button" data-song-id="${item.id}">Remove</button>`
      : "";
    li.innerHTML = `
      <div class="song-main-row">
        <div>
          <strong>#${index + 1} ${item.song}</strong> - ${item.artist}
        </div>
        ${adminActions}
      </div>
      <div class="requester">Singer: ${item.requester}</div>
    `;
    queueList.appendChild(li);
  });
}

function getAdminHeaders() {
  if (!adminPin) return {};
  return { "x-admin-pin": adminPin };
}

function setAdminUI(enabled) {
  isAdmin = enabled;
  adminControls.classList.toggle("hidden", !enabled || isTvMode);
  adminSession.classList.toggle("hidden", !enabled || isTvMode);
  adminForm.classList.toggle("hidden", enabled || isTvMode);
}

function syncModeToUrl() {
  const url = new URL(window.location.href);
  if (isTvMode) {
    url.searchParams.set("mode", "tv");
  } else {
    url.searchParams.delete("mode");
  }
  window.history.replaceState({}, "", url.toString());
}

function applyMode() {
  document.body.classList.toggle("tv-mode", isTvMode);
  qrSection.classList.toggle("hidden", isTvMode);
  adminSection.classList.toggle("hidden", isTvMode);
  requestSection.classList.toggle("hidden", isTvMode);
  queueSection.classList.toggle("hidden", isTvMode);
  nextSongSection.classList.toggle("hidden", !isTvMode);
  lyricsSection.classList.toggle("hidden", !isTvMode);
  modeToggleButton.textContent = isTvMode ? "Back to Request/Admin Mode" : "Switch to TV Mode";
  setAdminUI(isAdmin);
}

async function verifyAdminPin(pin) {
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "Wrong admin PIN." }));
    throw new Error(data.error || "Wrong admin PIN.");
  }
}

const shareUrl = window.location.origin;
const qrProviders = [
  "https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=",
  "https://quickchart.io/qr?size=260&text="
];
let qrProviderIndex = 0;

function loadQrWithFallback() {
  if (qrProviderIndex >= qrProviders.length) {
    qrImage.style.display = "none";
    showStatus("QR image blocked on this network. Use copied link instead.", true);
    return;
  }

  const provider = qrProviders[qrProviderIndex];
  qrImage.src = `${provider}${encodeURIComponent(shareUrl)}`;
}

qrImage.addEventListener("error", () => {
  qrProviderIndex += 1;
  loadQrWithFallback();
});

loadQrWithFallback();
shareUrlText.textContent = shareUrl;

isTvMode = new URLSearchParams(window.location.search).get("mode") === "tv";
applyMode();

modeToggleButton.addEventListener("click", () => {
  isTvMode = !isTvMode;
  syncModeToUrl();
  applyMode();
});

copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrl);
    showStatus("Link copied. Send it to guests.");
  } catch (_error) {
    showStatus("Could not copy link. Please copy it manually.", true);
  }
});

adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = adminPinInput.value.trim();
  if (!pin) {
    showStatus("Please enter admin PIN.", true);
    return;
  }

  try {
    await verifyAdminPin(pin);
    adminPin = pin;
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, pin);
    setAdminUI(true);
    showStatus("Admin login successful.");
    adminPinInput.value = "";
    fetch("/api/state")
      .then((response) => response.json())
      .then((data) => renderQueue(data.queue))
      .catch(() => {});
  } catch (error) {
    showStatus(error.message, true);
  }
});

adminLogoutButton.addEventListener("click", () => {
  adminPin = "";
  localStorage.removeItem(ADMIN_PIN_STORAGE_KEY);
  setAdminUI(false);
  showStatus("Admin logged out.");
  fetch("/api/state")
    .then((response) => response.json())
    .then((data) => renderQueue(data.queue))
    .catch(() => {});
});

fillCurrentSongButton.addEventListener("click", () => {
  const now = latestState.currentSong;
  if (!now) {
    showStatus("No current song to prefill.", true);
    return;
  }

  customLyricsSong.value = now.song;
  customLyricsArtist.value = now.artist;
  customLyricsText.focus();
});

openShironetButton.addEventListener("click", () => {
  const song = customLyricsSong.value.trim() || (latestState.currentSong && latestState.currentSong.song) || "";
  const artist =
    customLyricsArtist.value.trim() || (latestState.currentSong && latestState.currentSong.artist) || "";

  if (!song || !artist) {
    showStatus("Fill song and artist first (or use current song).", true);
    return;
  }

  const query = encodeURIComponent(`${artist} ${song} שירונט`);
  const url = `https://www.google.com/search?q=${query}`;
  window.open(url, "_blank", "noopener,noreferrer");
});

customLyricsForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const song = customLyricsSong.value.trim();
  const artist = customLyricsArtist.value.trim();
  const lyrics = customLyricsText.value.trim();

  if (!song || !artist || !lyrics) {
    showStatus("Please fill song, artist, and lyrics.", true);
    return;
  }

  fetch("/api/lyrics/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAdminHeaders() },
    body: JSON.stringify({ song, artist, lyrics })
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not save custom lyrics.");
      }
      showStatus("Custom lyrics saved.");
      if (
        latestState.currentSong &&
        latestState.currentSong.song.toLowerCase() === song.toLowerCase() &&
        latestState.currentSong.artist.toLowerCase() === artist.toLowerCase()
      ) {
        loadLyricsForCurrentSong(latestState.currentSong, true);
      }
    })
    .catch((error) => {
      showStatus(error.message, true);
      if (error.message.includes("Admin access")) {
        adminPin = "";
        localStorage.removeItem(ADMIN_PIN_STORAGE_KEY);
        setAdminUI(false);
      }
    });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const payload = {
    song: form.song.value.trim(),
    artist: form.artist.value.trim(),
    requester: form.requester.value.trim()
  };

  fetch("/api/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not add song.");
      }
      form.reset();
      showStatus("Song request added.");
    })
    .catch((error) => {
      showStatus(error.message, true);
    });
});

nextButton.addEventListener("click", () => {
  fetch("/api/next", { method: "POST", headers: getAdminHeaders() })
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Could not move to next song." }));
        throw new Error(data.error || "Could not move to next song.");
      }
    })
    .catch((error) => {
      showStatus(error.message, true);
      if (error.message.includes("Admin access")) {
        adminPin = "";
        localStorage.removeItem(ADMIN_PIN_STORAGE_KEY);
        setAdminUI(false);
      }
    });
});

queueList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("remove-song-button")) return;

  const id = Number(target.dataset.songId);
  if (!Number.isInteger(id)) return;

  fetch("/api/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAdminHeaders() },
    body: JSON.stringify({ id })
  })
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Could not remove song." }));
        throw new Error(data.error || "Could not remove song.");
      }
      showStatus("Song removed from queue.");
    })
    .catch((error) => {
      showStatus(error.message, true);
      if (error.message.includes("Admin access")) {
        adminPin = "";
        localStorage.removeItem(ADMIN_PIN_STORAGE_KEY);
        setAdminUI(false);
      }
    });
});

resetButton.addEventListener("click", () => {
  const confirmed = window.confirm("Reset queue for everyone?");
  if (!confirmed) return;

  fetch("/api/reset", { method: "POST", headers: getAdminHeaders() })
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Could not reset queue." }));
        throw new Error(data.error || "Could not reset queue.");
      }
    })
    .catch((error) => {
      showStatus(error.message, true);
      if (error.message.includes("Admin access")) {
        adminPin = "";
        localStorage.removeItem(ADMIN_PIN_STORAGE_KEY);
        setAdminUI(false);
      }
    });
});

const events = new EventSource("/api/events");
events.onmessage = (event) => {
  const data = JSON.parse(event.data);
  latestState = data;
  renderCurrentSong(data.currentSong);
  renderNextSong(data.queue || []);
  loadLyricsForCurrentSong(data.currentSong);
  renderQueue(data.queue);
};
events.onerror = () => {
  showStatus("Live updates disconnected. Retrying...", true);
};

fetch("/api/state")
  .then((response) => response.json())
  .then((data) => {
    latestState = data;
    renderCurrentSong(data.currentSong);
    renderNextSong(data.queue || []);
    loadLyricsForCurrentSong(data.currentSong);
    renderQueue(data.queue);
  })
  .catch(() => {
    showStatus("Could not load current queue.", true);
});

if (adminPin) {
  verifyAdminPin(adminPin)
    .then(() => {
      setAdminUI(true);
    })
    .catch(() => {
      adminPin = "";
      localStorage.removeItem(ADMIN_PIN_STORAGE_KEY);
      setAdminUI(false);
    });
} else {
  setAdminUI(false);
}
