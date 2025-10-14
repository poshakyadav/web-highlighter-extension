// --- MAIN EXECUTION ---
// A flag to ensure this script doesn't run multiple times on the same page
if (typeof window.webHighlighterLoaded === "undefined") {
  window.webHighlighterLoaded = true;

  console.log("[Web Highlighter] Content script loaded and running.");

  // Apply existing highlights when the script is first loaded
  loadHighlightsForCurrentPage();

  // --- EVENT LISTENERS ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(
      "[Web Highlighter] Content script received action:",
      request.action
    );

    if (request.action === "highlight") {
      handleHighlight(request.color);
    } else if (request.action === "clear") {
      handleClear();
    } else if (request.action === "execute-command") {
      executeCommand(request.command);
    }
    sendResponse({ status: "completed" });
    return true; // Indicates you wish to send a response asynchronously
  });
}

// --- HANDLER FUNCTIONS ---
function handleHighlight(color) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    console.log(
      "[Web Highlighter] Highlight action ignored, no text selected."
    );
    return;
  }

  const range = selection.getRangeAt(0);
  if (isInsideHighlight(range)) {
    console.warn(
      "[Web Highlighter] Selection is inside an existing highlight. Aborting."
    );
    return;
  }

  const highlightData = createHighlightObject(range, color);
  if (!highlightData) return;

  // *** FIX: Use the LIVE range to create the highlight, not a deserialized one ***
  wrapRangeWithMark(range, highlightData);

  saveHighlight(highlightData);

  chrome.runtime.sendMessage({
    action: "push-to-undo",
    command: { type: "add", highlight: highlightData },
  });

  window.getSelection().removeAllRanges();
}

async function handleClear() {
  const url = window.location.href;
  const allHighlights = await getHighlightsFromStorage();
  const pageHighlights = allHighlights[url] || [];
  if (pageHighlights.length === 0) return;

  chrome.runtime.sendMessage({
    action: "push-to-undo",
    command: { type: "clear", removedHighlights: pageHighlights },
  });
  removeAllHighlightsFromDOM();
  clearHighlightsFromStorage(url);
}

// --- DOM MANIPULATION ---
async function loadHighlightsForCurrentPage() {
  const url = window.location.href;
  const allHighlights = await getHighlightsFromStorage();
  const pageHighlights = allHighlights[url] || [];
  console.log(
    `[Web Highlighter] Found ${pageHighlights.length} highlights for this page.`
  );
  for (const highlight of pageHighlights) {
    // This function is for loading SAVED highlights
    applySavedHighlight(highlight);
  }
}

/**
 * Re-creates a highlight on the page from saved data.
 * @param {object} highlight - The saved highlight object.
 */
function applySavedHighlight(highlight) {
  try {
    const range = deserializeRange(highlight);
    if (range) {
      wrapRangeWithMark(range, highlight);
    }
  } catch (error) {
    console.error(
      "[Web Highlighter] Error applying saved highlight:",
      error,
      highlight
    );
  }
}

/**
 * Wraps a given Range object in a <mark> tag.
 * @param {Range} range - The DOM Range to wrap.
 * @param {object} highlightData - The highlight object containing color and ID.
 */
function wrapRangeWithMark(range, highlightData) {
  const mark = document.createElement("mark");
  mark.style.backgroundColor = highlightData.color;
  mark.className = "web-highlighter-mark";
  mark.dataset.highlightId = highlightData.id;
  try {
    range.surroundContents(mark);
  } catch (error) {
    console.error(
      "[Web Highlighter] Error surrounding contents with mark:",
      error
    );
  }
}

function removeHighlightFromDOM(highlightId) {
  const mark = document.querySelector(
    `mark[data-highlight-id="${highlightId}"]`
  );
  if (mark) {
    const parent = mark.parentNode;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}

function removeAllHighlightsFromDOM() {
  document.querySelectorAll("mark.web-highlighter-mark").forEach((mark) => {
    removeHighlightFromDOM(mark.dataset.highlightId);
  });
}

// --- UNDO/REDO LOGIC ---
function executeCommand(command) {
  console.log("[Web Highlighter] Executing command:", command.type);
  switch (command.type) {
    case "add":
      applySavedHighlight(command.highlight);
      saveHighlight(command.highlight);
      break;
    case "remove":
      removeHighlightFromDOM(command.highlightId);
      removeSingleHighlightFromStorage(
        window.location.href,
        command.highlightId
      );
      break;
    case "add-multiple":
      command.highlights.forEach((h) => {
        applySavedHighlight(h);
        saveHighlight(h);
      });
      break;
  }
}

// --- STORAGE MANAGEMENT ---
async function saveHighlight(highlight) {
  const allHighlights = await getHighlightsFromStorage();
  if (!allHighlights[highlight.url]) {
    allHighlights[highlight.url] = [];
  }
  if (!allHighlights[highlight.url].some((h) => h.id === highlight.id)) {
    allHighlights[highlight.url].push(highlight);
  }
  await chrome.storage.sync.set({ highlights: allHighlights });
}
async function removeSingleHighlightFromStorage(url, highlightId) {
  const allHighlights = await getHighlightsFromStorage();
  if (allHighlights[url]) {
    allHighlights[url] = allHighlights[url].filter((h) => h.id !== highlightId);
    if (allHighlights[url].length === 0) {
      delete allHighlights[url];
    }
  }
  await chrome.storage.sync.set({ highlights: allHighlights });
}
function getHighlightsFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ highlights: {} }, (data) =>
      resolve(data.highlights)
    );
  });
}
async function clearHighlightsFromStorage(url) {
  const allHighlights = await getHighlightsFromStorage();
  delete allHighlights[url];
  await chrome.storage.sync.set({ highlights: allHighlights });
}

// --- UTILITY & SERIALIZATION ---
function createHighlightObject(range, color) {
  const startContainerPath = getXPath(range.startContainer);
  const endContainerPath = getXPath(range.endContainer);
  if (!startContainerPath || !endContainerPath) {
    console.error("[Web Highlighter] Could not generate XPath for selection.");
    return null;
  }
  return {
    id: `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    url: window.location.href,
    text: range.toString(),
    color: color,
    startContainerPath: startContainerPath,
    startOffset: range.startOffset,
    endContainerPath: endContainerPath,
    endOffset: range.endOffset,
  };
}
function deserializeRange(highlight) {
  try {
    const startContainer = getNodeFromXPath(highlight.startContainerPath);
    const endContainer = getNodeFromXPath(highlight.endContainerPath);
    if (!startContainer || !endContainer) {
      console.warn(
        "[Web Highlighter] Could not find start or end container for highlight.",
        highlight
      );
      return null;
    }
    const range = document.createRange();
    range.setStart(startContainer, highlight.startOffset);
    range.setEnd(endContainer, highlight.endOffset);
    return range;
  } catch (e) {
    console.error("[Web Highlighter] Failed to deserialize range", e);
    return null;
  }
}

/**
 * Generates a robust XPath for a given node, handling text nodes correctly.
 * @param {Node} node - The node to generate the XPath for.
 * @returns {string} The XPath string.
 */
function getXPath(node) {
  // If the node is a text node, create a path to it
  if (node.nodeType === Node.TEXT_NODE) {
    let childIndex = 1;
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.TEXT_NODE) {
        childIndex++;
      }
      sibling = sibling.previousSibling;
    }
    return `${getXPath(node.parentNode)}/text()[${childIndex}]`;
  }

  // Standard element node XPath logic
  if (node.id) return `id("${node.id}")`;
  if (node === document.body) return "/html/body";

  let siblingIndex = 1;
  let sibling = node.previousSibling;
  while (sibling) {
    if (
      sibling.nodeType === Node.ELEMENT_NODE &&
      sibling.tagName === node.tagName
    ) {
      siblingIndex++;
    }
    sibling = sibling.previousSibling;
  }

  const parentPath = node.parentNode ? getXPath(node.parentNode) : "";
  return `${parentPath}/${node.tagName.toLowerCase()}[${siblingIndex}]`;
}

function getNodeFromXPath(path) {
  try {
    const result = document.evaluate(
      path,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch (e) {
    console.error("[Web Highlighter] Error evaluating XPath:", path, e);
    return null;
  }
}

function isInsideHighlight(range) {
  let node = range.commonAncestorContainer;
  while (node) {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      node.classList.contains("web-highlighter-mark")
    ) {
      return true;
    }
    node = node.parentNode;
  }
  return false;
}
