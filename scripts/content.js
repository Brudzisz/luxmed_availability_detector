(() => {
  if (globalThis.__luxmedMonitorContentLoaded) {
    return;
  }
  globalThis.__luxmedMonitorContentLoaded = true;

  const STATUS_MESSAGE = "PAGE_STATUS";
  let lastReportedState = "";
  let observer;
  let pageUpdateRevision = 0;
  let pageReportScheduled = false;
  let recentSearchClickAttempted = false;
  let shouldSubmitSearch = false;
  let searchSubmitScheduled = false;
  let searchSubmitAttempted = false;
  let searchSubmissionPending = false;

  function waitForBackgroundDelay(type) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
        } else if (!response?.ok) {
          reject(new Error("Nie udało się odczekać na stabilizację strony."));
        } else {
          resolve();
        }
      });
    });
  }

  async function waitUntilPageStable() {
    while (true) {
      const revision = pageUpdateRevision;
      await waitForBackgroundDelay("WAIT_FOR_STABLE_PAGE");
      if (revision === pageUpdateRevision) {
        return;
      }
    }
  }

  function reportFlowError(error) {
    chrome.runtime.sendMessage(
      {
        type: "FLOW_ERROR",
        error: error instanceof Error ? error.message : String(error)
      },
      () => void chrome.runtime.lastError
    );
  }

  function getRecentSearchButton() {
    return document
      .querySelector(".recent-search-parameters-box")
      ?.querySelector("button");
  }

  function getPageState() {
    const detectedState = globalThis.LuxMedDetector.detectAppointmentPage(
      document,
      window.location
    );
    const recentSearchButton = getRecentSearchButton();
    const searchButton = document.querySelector(
      'button[type="submit"].btn-search'
    );
    const hasSearchButton =
      searchButton && searchButton.getClientRects().length > 0;
    if (
      searchSubmissionPending &&
      (detectedState.hasNoTermsMessage ||
        detectedState.hasAppointmentCue ||
        (!hasSearchButton && detectedState.hasAppointmentRoute))
    ) {
      searchSubmissionPending = false;
    }

    return {
      ...detectedState,
      hasRecentSearch: Boolean(
        recentSearchButton &&
        !recentSearchButton.disabled &&
        recentSearchButton.getClientRects().length > 0
      ),
      hasSearchForm: Boolean(
        hasSearchButton && (shouldSubmitSearch || searchSubmissionPending)
      ),
      isSubmittingSearch: searchSubmissionPending
    };
  }

  function findSearchButton() {
    const button = document.querySelector(
      'button[type="submit"].btn-search'
    );
    if (
      !(button instanceof HTMLButtonElement) ||
      button.getClientRects().length === 0
    ) {
      return null;
    }

    return button;
  }

  function retrySearchWhenReady() {
    if (searchSubmitScheduled) {
      return;
    }

    searchSubmitScheduled = true;
    chrome.runtime.sendMessage({ type: "WAIT_BEFORE_SEARCH" }, (response) => {
      searchSubmitScheduled = false;
      const error = chrome.runtime.lastError;
      if (error) {
        reportFlowError(error);
        return;
      }

      if (response?.ok) {
        submitSearchIfReady();
      }
    });
  }

  function submitSearchIfReady() {
    if (
      !shouldSubmitSearch ||
      searchSubmitAttempted ||
      searchSubmitScheduled
    ) {
      return;
    }

    const searchButton = findSearchButton();
    if (!searchButton) {
      return;
    }
    if (searchButton.disabled) {
      retrySearchWhenReady();
      return;
    }

    searchSubmitAttempted = true;
    shouldSubmitSearch = false;
    searchSubmissionPending = true;
    searchButton.click();
    reportPageState();
  }

  function reportPageState() {
    const pageState = getPageState();
    const stateKey = JSON.stringify(pageState);
    if (stateKey === lastReportedState) {
      return pageState;
    }

    lastReportedState = stateKey;
    chrome.runtime.sendMessage(
      { type: STATUS_MESSAGE, pageState },
      () => void chrome.runtime.lastError
    );
    return pageState;
  }

  function observePageChanges() {
    observer = new MutationObserver(() => {
      pageUpdateRevision += 1;
      submitSearchIfReady();
      if (globalThis.LuxMedDetector.hasResultsReadyMarker(document)) {
        reportPageState();
      }
      if (pageReportScheduled) {
        return;
      }
      pageReportScheduled = true;
      void waitUntilPageStable().then(() => {
        pageReportScheduled = false;
        submitSearchIfReady();
        reportPageState();
      }).catch((error) => {
        pageReportScheduled = false;
        reportFlowError(error);
      });
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "style"]
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SELECT_RECENT_SEARCH") {
      if (recentSearchClickAttempted) {
        sendResponse({ ok: true, alreadyClicked: true });
        return false;
      }

      const recentSearchButton = getRecentSearchButton();
      if (
        !(recentSearchButton instanceof HTMLButtonElement) ||
        recentSearchButton.disabled ||
        recentSearchButton.getClientRects().length === 0
      ) {
        sendResponse({
          ok: false,
          error: "Nie znaleziono aktywnej ostatnio wyszukiwanej usługi."
        });
        return false;
      }

      recentSearchClickAttempted = true;
      shouldSubmitSearch = true;
      recentSearchButton.click();
      submitSearchIfReady();
      sendResponse({
        ok: true,
        serviceName: recentSearchButton.textContent.trim()
      });
      return false;
    }

    if (message.type === "PREPARE_AUTO_REFRESH") {
      window.dispatchEvent(new Event("luxmed-monitor:prepare-auto-refresh"));
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "CANCEL_AUTO_REFRESH") {
      window.dispatchEvent(new Event("luxmed-monitor:cancel-auto-refresh"));
      sendResponse({ ok: true });
      return false;
    }

    if (message.type !== "CHECK_AND_REFRESH") {
      return false;
    }

    try {
      const pageState = getPageState();
      lastReportedState = JSON.stringify(pageState);
      sendResponse(pageState);
    } catch (error) {
      reportFlowError(error);
      sendResponse({
        isAppointmentPage: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return false;
  });

  observePageChanges();
  pageUpdateRevision += 1;
  submitSearchIfReady();
  if (globalThis.LuxMedDetector.hasResultsReadyMarker(document)) {
    reportPageState();
  } else {
    pageReportScheduled = true;
    void waitUntilPageStable().then(() => {
      pageReportScheduled = false;
      submitSearchIfReady();
      reportPageState();
    }).catch((error) => {
      pageReportScheduled = false;
      reportFlowError(error);
    });
  }
})();