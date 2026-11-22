const statusElement = document.getElementById("status");
const lastCheckElement = document.getElementById("last-check");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");

const STATUS_TEXT = {
  stopped: "Monitor jest wyłączony.",
  checking: "Sprawdzam dostępność terminów…",
  "selecting-service": "Wybieram ostatnio wyszukiwaną usługę…",
  searching: "Wyszukuję terminy…",
  refreshing: "Odświeżam stronę…",
  "search-error": "Nie udało się wyszukać terminów.",
  available: "Wykryto dostępny termin! Wybierz go na stronie.",
  "no-terms": "Brak dostępnych terminów.",
  "page-not-detected": "Nie wykryto strony wyboru terminu. Otwórz wyniki wyszukiwania.",
  "audio-error": "Termin wykryty, ale nie udało się odtworzyć dźwięku.",
  "refresh-error": "Nie udało się odświeżyć strony."
};

function displayStatus(state) {
  const status = state.status ?? "stopped";
  const isError =
    status === "page-not-detected" ||
    status === "audio-error" ||
    status === "refresh-error" ||
    status === "search-error";
  statusElement.textContent =
    (status === "audio-error" ||
      status === "refresh-error" ||
      status === "search-error") &&
    state.error
      ? `${STATUS_TEXT[status]} ${state.error}`
      : STATUS_TEXT[status] ?? STATUS_TEXT.checking;
  statusElement.dataset.state = isError ? "error" : status;
  startButton.disabled = state.enabled;
  stopButton.disabled = !state.enabled;
  lastCheckElement.textContent = state.lastCheckedAt
    ? `Ostatnie sprawdzenie: ${new Date(state.lastCheckedAt).toLocaleTimeString("pl-PL")}`
    : "";
}

async function loadState() {
  displayStatus(await chrome.runtime.sendMessage({ type: "GET_STATE" }));
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await chrome.runtime.sendMessage({
    type: "START_MONITOR",
    tabId: tab?.id
  });
  if (!result?.ok) {
    displayStatus({
      status: "page-not-detected",
      error: result?.error ?? "Nie udało się uruchomić monitorowania."
    });
    statusElement.textContent = result?.error ?? statusElement.textContent;
    return;
  }
  await loadState();
});

stopButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "STOP_MONITOR" });
  await loadState();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.monitorState?.newValue) {
    displayStatus(changes.monitorState.newValue);
  }
});

void loadState();