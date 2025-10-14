document.addEventListener("DOMContentLoaded", () => {
  const colorPalette = document.getElementById("color-palette");
  const undoBtn = document.getElementById("undo-btn");
  const redoBtn = document.getElementById("redo-btn");
  const clearButton = document.getElementById("clear-page-btn");

  /**
   * A robust function to ensure the content script is loaded in the active tab
   * before executing a callback function (like sending a message).
   * @param {function(number)} callback - The function to execute after ensuring the script is ready. It receives the tabId.
   */
  async function ensureScripting(callback) {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Don't try to inject on restricted URLs
    if (!tab || tab.url?.startsWith("chrome://")) {
      console.warn(
        "[Web Highlighter] Cannot execute script on a restricted page."
      );
      return;
    }

    try {
      // Try to inject the script. If it's already there, this won't re-inject or cause errors.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      // If injection is successful, execute the callback
      callback(tab.id);
    } catch (e) {
      console.error(
        "[Web Highlighter] Failed to inject script or send message:",
        e
      );
      // You could display an error message in the popup UI here if desired
    }
  }

  // Event listener for color selection
  colorPalette.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("color-box")) {
      const color = target.dataset.color;
      chrome.storage.sync.set({ lastUsedColor: color });

      ensureScripting((tabId) => {
        chrome.tabs.sendMessage(tabId, {
          action: "highlight",
          color: color,
        });
      });
    }
  });

  // Event listener for the undo button
  undoBtn.addEventListener("click", () => {
    ensureScripting((tabId) => {
      chrome.runtime.sendMessage({
        action: "undo",
        tabId: tabId,
      });
    });
  });

  // Event listener for the redo button
  redoBtn.addEventListener("click", () => {
    ensureScripting((tabId) => {
      chrome.runtime.sendMessage({
        action: "redo",
        tabId: tabId,
      });
    });
  });

  // Event listener for clearing highlights
  clearButton.addEventListener("click", () => {
    ensureScripting((tabId) => {
      chrome.tabs.sendMessage(tabId, { action: "clear" });
    });
  });
});
