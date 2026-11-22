const REFRESH_ALARM = "luxmed-refresh";
const REFRESH_INTERVAL_MINUTES = 3;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60 * 1000;
const SEARCH_RETRY_DELAY_MS = 1000;
const PAGE_STABILITY_DELAY_MS = 1000;
const alertingTabs = new Set();
const DEFAULT_STATE = {
  enabled: false,
  tabId: null,
  status: "stopped",
  lastAvailability: "unknown",
  lastCheckedAt: null
};

async function readMonitorState() {
  const { monitorState } = await chrome.storage.local.get("monitorState");
  return { ...DEFAULT_STATE, ...monitorState };
}

async function ensureRefreshAlarm() {
  const state = await readMonitorState();
  const alarm = await chrome.alarms.get(REFRESH_ALARM);
  if (!state.enabled || state.status !== "no-terms") {
    if (alarm) {
      await chrome.alarms.clear(REFRESH_ALARM);
    }
    return;
  }

  if (!alarm || alarm.periodInMinutes !== undefined) {
    if (alarm) {
      await chrome.alarms.clear(REFRESH_ALARM);
    }
    await chrome.alarms.create(REFRESH_ALARM, {
      when: Date.now() + REFRESH_INTERVAL_MS
    });
  }
}

async function scheduleNextCheck() {
  const state = await readMonitorState();
  if (!state.enabled || state.status !== "no-terms") {
    return;
  }

  const alarm = await chrome.alarms.get(REFRESH_ALARM);
  if (alarm && alarm.periodInMinutes === undefined) {
    return;
  }
  if (alarm) {
    await chrome.alarms.clear(REFRESH_ALARM);
  }
  await chrome.alarms.create(REFRESH_ALARM, {
    when: Date.now() + REFRESH_INTERVAL_MS
  });
}

async function setMonitorState(changes) {
  const current = await readMonitorState();
  const next = { ...current, ...changes };
  await chrome.storage.local.set({ monitorState: next });
  return next;
}

function isLuxMedUrl(url) {
  try {
    return new URL(url).hostname === "luxmed.pl" ||
      new URL(url).hostname.endsWith(".luxmed.pl");
  } catch {
    return false;
  }
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function isMissingReceiverError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Could not establish connection|Receiving end does not exist/i.test(message);
}

async function sendTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["scripts/beforeunload.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      files: ["scripts/detector.js", "scripts/content.js"]
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function stopMonitoring(status = "stopped") {
  await chrome.alarms.clear(REFRESH_ALARM);
  await setMonitorState({
    enabled: false,
    status,
    lastAvailability: "unknown"
  });
}

async function createAudioDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")]
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Odtworzenie sygnału po wykryciu dostępnych terminów."
    });
  }
}

async function playAlert() {
  await createAudioDocument();
  const result = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "PLAY_ALERT"
  });
  if (!result?.ok) {
    throw new Error(result?.error ?? "Nie udało się odtworzyć sygnału dźwiękowego.");
  }
}

async function handlePageStatus(pageState, tabId, { scheduleCheck = true } = {}) {
  const state = await readMonitorState();
  if (!state.enabled || state.tabId !== tabId) {
    return;
  }

  if (pageState?.hasRecentSearch) {
    try {
      await chrome.alarms.clear(REFRESH_ALARM);
      const result = await sendTabMessage(tabId, {
        type: "SELECT_RECENT_SEARCH"
      });
      if (!result?.ok) {
        throw new Error(result?.error ?? "Nie udało się wybrać ostatniej usługi.");
      }
      await setMonitorState({
        status: "selecting-service",
        lastAvailability: "unknown",
        lastCheckedAt: Date.now()
      });
    } catch (error) {
      await setMonitorState({
        status: "page-not-detected",
        error: error instanceof Error ? error.message : String(error),
        lastCheckedAt: Date.now()
      });
    }
    return;
  }

  if (pageState?.hasNoTermsMessage) {
    await setMonitorState({
      status: "no-terms",
      lastAvailability: "no-terms",
      lastCheckedAt: Date.now()
    });
    if (scheduleCheck) {
      await scheduleNextCheck();
    }
    return;
  }

  if (pageState?.hasSearchForm || pageState?.isSubmittingSearch) {
    await chrome.alarms.clear(REFRESH_ALARM);
    if (pageState?.hasSearchForm && !pageState?.isSubmittingSearch) {
      try {
        const result = await sendTabMessage(tabId, {
          type: "SUBMIT_SEARCH"
        });
        if (!result?.ok) {
          throw new Error(result?.error ?? "Nie udało się rozpocząć wyszukiwania.");
        }
      } catch (error) {
        await setMonitorState({
          status: "search-error",
          error: error instanceof Error ? error.message : String(error),
          lastCheckedAt: Date.now()
        });
        return;
      }
    }
    await setMonitorState({
      status: "searching",
      lastAvailability: "unknown",
      lastCheckedAt: Date.now()
    });
    return;
  }

  if (pageState?.isAppointmentPage && !pageState?.hasResultsReady) {
    await chrome.alarms.clear(REFRESH_ALARM);
    await setMonitorState({
      status: "searching",
      lastAvailability: "unknown",
      lastCheckedAt: Date.now()
    });
    return;
  }

  if (
    (state.status === "refreshing" || state.status === "selecting-service") &&
    !pageState?.hasAppointmentCue
  ) {
    return;
  }

  if (!pageState?.isAppointmentPage) {
    await chrome.alarms.clear(REFRESH_ALARM);
    await setMonitorState({
      status: "page-not-detected",
      lastAvailability: "unknown",
      lastCheckedAt: Date.now()
    });
    return;
  }

  await chrome.alarms.clear(REFRESH_ALARM);
  const shouldAlert =
    state.lastAvailability !== "available" && !alertingTabs.has(tabId);
  if (shouldAlert) {
    alertingTabs.add(tabId);
  }
  await setMonitorState({
    enabled: false,
    status: "available",
    lastAvailability: "available",
    lastCheckedAt: Date.now()
  });

  if (shouldAlert) {
    try {
      await playAlert();
    } catch (error) {
      await setMonitorState({
        status: "audio-error",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      alertingTabs.delete(tabId);
    }
  }
}

async function refreshMonitoredTab() {
  const state = await readMonitorState();
  if (
    !state.enabled ||
    state.status !== "no-terms" ||
    state.tabId === null
  ) {
    return;
  }

  const tab = await getTab(state.tabId);
  if (!tab || !isLuxMedUrl(tab.url ?? "")) {
    await stopMonitoring("page-not-detected");
    return;
  }

  if (tab.status !== "complete") {
    await scheduleNextCheck();
    return;
  }

  try {
    const pageState = await sendTabMessage(state.tabId, {
      type: "CHECK_AND_REFRESH"
    });
    if (
      pageState?.hasRecentSearch ||
      pageState?.hasSearchForm ||
      pageState?.isSubmittingSearch ||
      !pageState?.hasResultsReady ||
      !pageState?.hasNoTermsMessage
    ) {
      await handlePageStatus(pageState, state.tabId);
      return;
    }

    await handlePageStatus(pageState, state.tabId, { scheduleCheck: false });
    const currentState = await readMonitorState();
    if (!currentState.enabled || currentState.status !== "no-terms") {
      return;
    }

    const preparation = await sendTabMessage(state.tabId, {
      type: "PREPARE_AUTO_REFRESH"
    });
    if (!preparation?.ok) {
      throw new Error("Nie udało się przygotować automatycznego odświeżenia.");
    }

    await setMonitorState({ status: "refreshing", lastRefreshAt: Date.now() });
    await chrome.tabs.reload(state.tabId);
  } catch (error) {
    try {
      await sendTabMessage(state.tabId, {
        type: "CANCEL_AUTO_REFRESH"
      });
    } catch {
      // The content script may be unavailable if the tab navigated away.
    }
    await setMonitorState({
      status: "refresh-error",
      error: error instanceof Error ? error.message : String(error),
      lastRefreshAt: Date.now()
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") {
    return false;
  }

  if (message.type === "WAIT_BEFORE_SEARCH") {
    void readMonitorState().then((state) => {
      if (!state.enabled || state.tabId !== sender.tab?.id) {
        sendResponse({ ok: false });
        return;
      }
      setTimeout(() => sendResponse({ ok: true }), SEARCH_RETRY_DELAY_MS);
    });
    return true;
  }

  if (message.type === "WAIT_FOR_STABLE_PAGE") {
    setTimeout(() => sendResponse({ ok: true }), PAGE_STABILITY_DELAY_MS);
    return true;
  }

  if (message.type === "FLOW_ERROR") {
    if (sender.tab?.id !== undefined) {
      void readMonitorState().then((state) => {
        if (state.enabled && state.tabId === sender.tab?.id) {
          return setMonitorState({
            status: "search-error",
            error: message.error,
            lastCheckedAt: Date.now()
          });
        }
      });
    }
    return false;
  }

  if (message.type === "PAGE_STATUS") {
    if (sender.tab?.id !== undefined) {
      void handlePageStatus(message.pageState, sender.tab.id);
    }
    return false;
  }

  if (message.type === "GET_STATE") {
    void ensureRefreshAlarm()
      .then(readMonitorState)
      .then((state) => sendResponse(state));
    return true;
  }

  if (message.type === "START_MONITOR") {
    void (async () => {
      const tab = await getTab(message.tabId);
      if (!tab || !isLuxMedUrl(tab.url ?? "")) {
        sendResponse({
          ok: false,
          error: "Otwórz stronę Lux Med z wyszukanymi terminami."
        });
        return;
      }

      await chrome.alarms.clear(REFRESH_ALARM);
      await setMonitorState({
        enabled: true,
        tabId: tab.id,
        status: "checking",
        lastAvailability: "unknown",
        lastCheckedAt: null,
        lastRefreshAt: null,
        error: null
      });

      try {
        const pageState = await sendTabMessage(tab.id, {
          type: "CHECK_AND_REFRESH"
        });
        await handlePageStatus(pageState, tab.id);
      } catch {
        await setMonitorState({
          status: "page-not-detected",
          error: "Nie udało się odczytać strony. Odśwież kartę i spróbuj ponownie."
        });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "STOP_MONITOR") {
    void stopMonitoring().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    void refreshMonitoredTab();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void readMonitorState().then((state) => {
    if (state.tabId === tabId) {
      return stopMonitoring("stopped");
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  void ensureRefreshAlarm();
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureRefreshAlarm();
});