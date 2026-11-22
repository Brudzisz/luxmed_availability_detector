(() => {
  if (window.__luxmedBeforeUnloadInstalled) {
    return;
  }
  window.__luxmedBeforeUnloadInstalled = true;

  let suppressNextBeforeUnload = false;

  window.addEventListener("luxmed-monitor:prepare-auto-refresh", () => {
    suppressNextBeforeUnload = true;
  });

  window.addEventListener("luxmed-monitor:cancel-auto-refresh", () => {
    suppressNextBeforeUnload = false;
  });

  window.addEventListener(
    "beforeunload",
    (event) => {
      if (!suppressNextBeforeUnload) {
        return;
      }

      suppressNextBeforeUnload = false;
      event.returnValue = "";
      event.stopImmediatePropagation();
    },
    true
  );
})();
