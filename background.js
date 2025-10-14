console.log("[Web Highlighter] Background script loaded.");

// This object will store the undo/redo stacks for each tab
const tabStates = {};

// --- Core Function to Inject Content Script ---
// We wrap this in a function to use it in multiple places.
async function injectContentScript(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    // Only inject into web pages, not into chrome:// URLs or other extension pages
    if (tab && tab.url && tab.url.startsWith("http")) {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"],
      });
      console.log(
        `[Web Highlighter] Injected content script into tab ${tabId}`
      );
    }
  } catch (err) {
    // This can happen if the tab is a special page (e.g., chrome://extensions)
    console.warn(
      `[Web Highlighter] Could not inject script into tab ${tabId}: ${err.message}`
    );
  }
}

// --- Event Listeners ---

// 1. Inject when a tab is updated (e.g., page loads/reloads)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    injectContentScript(tabId);
  }
});

// 2. Inject when the user switches to a new tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  injectContentScript(activeInfo.tabId);
});

// 3. Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id || request.tabId; // Get tabId reliably
  if (!tabId) {
    console.error(
      "[Web Highlighter] Could not determine tab ID for message:",
      request
    );
    return;
  }

  console.log(
    `[Web Highlighter] Background received action '${request.action}' for tab ${tabId}`
  );

  if (!tabStates[tabId]) {
    tabStates[tabId] = { undoStack: [], redoStack: [] };
  }

  if (request.action === "push-to-undo") {
    tabStates[tabId].undoStack.push(request.command);
    tabStates[tabId].redoStack = []; // Clear redo stack on new action
    sendResponse({ status: "ok" });
    return true;
  }

  if (request.action === "undo" || request.action === "redo") {
    const sourceStack =
      request.action === "undo"
        ? tabStates[tabId].undoStack
        : tabStates[tabId].redoStack;
    const destinationStack =
      request.action === "undo"
        ? tabStates[tabId].redoStack
        : tabStates[tabId].undoStack;

    const command = sourceStack.pop();
    if (command) {
      destinationStack.push(command);
      const message = {
        action: "execute-command",
        command: request.action === "undo" ? invertCommand(command) : command,
      };
      chrome.tabs.sendMessage(tabId, message);
    }
    sendResponse({ status: "ok" });
    return true;
  }
});

// 4. Listen for keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log(
    `[Web Highlighter] Command '${command}' triggered for tab ${tab.id}`
  );
  if (command === "highlight-text") {
    // Ensure content script is there before sending the message
    await injectContentScript(tab.id);
    const { lastUsedColor } = await chrome.storage.sync.get("lastUsedColor");
    chrome.tabs.sendMessage(tab.id, {
      action: "highlight",
      color: lastUsedColor || "#fdffb6", // Default to yellow
    });
  }
});

// --- Helper Functions ---
function invertCommand(command) {
  switch (command.type) {
    case "add":
      return { type: "remove", highlightId: command.highlight.id };
    case "remove":
      return { type: "add", highlight: command.highlight };
    case "clear":
      return { type: "add-multiple", highlights: command.removedHighlights };
    default:
      return command;
  }
}
