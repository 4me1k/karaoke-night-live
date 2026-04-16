const form = document.getElementById("requestForm");
const statusMessage = document.getElementById("statusMessage");
const currentSong = document.getElementById("currentSong");
const queueList = document.getElementById("queueList");
const nextButton = document.getElementById("nextButton");
const resetButton = document.getElementById("resetButton");

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
    li.innerHTML = `
      <div>
        <strong>#${index + 1} ${item.song}</strong> - ${item.artist}
      </div>
      <div class="requester">Singer: ${item.requester}</div>
    `;
    queueList.appendChild(li);
  });
}

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
  fetch("/api/next", { method: "POST" }).catch(() => {
    showStatus("Could not move to next song.", true);
  });
});

resetButton.addEventListener("click", () => {
  const confirmed = window.confirm("Reset queue for everyone?");
  if (confirmed) {
    fetch("/api/reset", { method: "POST" }).catch(() => {
      showStatus("Could not reset queue.", true);
    });
  }
});

const events = new EventSource("/api/events");
events.onmessage = (event) => {
  const data = JSON.parse(event.data);
  renderCurrentSong(data.currentSong);
  renderQueue(data.queue);
};
events.onerror = () => {
  showStatus("Live updates disconnected. Retrying...", true);
};

fetch("/api/state")
  .then((response) => response.json())
  .then((data) => {
    renderCurrentSong(data.currentSong);
    renderQueue(data.queue);
  })
  .catch(() => {
    showStatus("Could not load current queue.", true);
});
