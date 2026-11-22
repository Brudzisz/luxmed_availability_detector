(() => {
  const NO_TERMS_TEXT =
    "Nie ma dostępnych terminów. Zapoznaj się z opisami na powyższym kalendarzu, aby dowiedzieć się, kiedy warto wyszukać ponownie.";
  const APPOINTMENT_CUES = [
    "wybierz termin",
    "dostępne terminy",
    "wolne terminy",
    "wybierz datę",
    "termin wizyty"
  ];
  const APPOINTMENT_ROUTE = /termin|wizyta|appointment|calendar|kalendarz/i;

  function normalize(value) {
    return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("pl");
  }

  function hasResultsReadyMarker(document) {
    return Array.from(document.querySelectorAll("div.card-body span")).some(
      (span) => span.textContent?.trim() === "x"
    );
  }

  function detectAppointmentPage(document, location) {
    const bodyText = normalize(document.body?.innerText ?? "");
    const noTermsText = normalize(NO_TERMS_TEXT);
    const hasResultsReady = hasResultsReadyMarker(document);
    const noTermsElement = document.querySelector("app-no-terms-info");
    const hasNoTermsMessage =
      hasResultsReady &&
      (Boolean(noTermsElement) ||
        bodyText.includes(noTermsText) ||
        bodyText.includes("nie ma dostępnych terminów"));

    const hasAppointmentCue = APPOINTMENT_CUES.some((cue) =>
      bodyText.includes(cue)
    );
    const hasAppointmentRoute = APPOINTMENT_ROUTE.test(location.pathname);
    const isAppointmentPage =
      hasNoTermsMessage || hasAppointmentCue || hasAppointmentRoute;

    return {
      isAppointmentPage,
      hasAppointmentCue,
      hasAppointmentRoute,
      hasResultsReady,
      hasAvailableSlots:
        hasResultsReady && isAppointmentPage && !hasNoTermsMessage,
      hasNoTermsMessage
    };
  }

  globalThis.LuxMedDetector = { detectAppointmentPage, hasResultsReadyMarker };
})();