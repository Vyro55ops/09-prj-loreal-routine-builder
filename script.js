// Full Cloudflare Worker address, so the chat works from GitHub Pages too
const WORKER_URL = "https://09-prj-loreal-routine-builder.shahvir1.workers.dev/api/chat";
const STORAGE_KEY = "loreal-routine-selected-products";

const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectionCount = document.getElementById("selectionCount");
const clearSelectionButton = document.getElementById("clearSelection");
const generateButton = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendBtn");
const appStatus = document.getElementById("appStatus");
const directionToggle = document.getElementById("directionToggle");

let products = [];
let selectedProductIds = new Set();
let messages = [];
let isBusy = false;
let routineGenerated = false;

const systemMessage = {
  role: "system",
  content:
    "You are a thoughtful L'Oréal beauty advisor. Use the products supplied by the user to create practical, personalized routines, and answer follow-up questions about that routine and related skincare, haircare, makeup, and fragrance topics. Search the web for current information when relevant and include the source links provided to you. Keep advice relevant, explain product order and safe use, and never invent product claims. If a question is unrelated, politely guide the user back to beauty and routine topics.",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function setStatus(message) {
  appStatus.textContent = message;
}

function saveSelection() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selectedProductIds]));
    return true;
  } catch (error) {
    setStatus("Your browser could not save this selection. Check your storage settings.");
    return false;
  }
}

function restoreSelection() {
  try {
    const savedIds = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(savedIds)) {
      throw new Error("Saved product selection is not a list.");
    }

    const availableIds = new Set(products.map((product) => String(product.id)));
    selectedProductIds = new Set(
      savedIds.map(String).filter((id) => availableIds.has(id))
    );
  } catch (error) {
    selectedProductIds = new Set();
    setStatus("Saved selections could not be read. You can make a new selection.");
  }
}

function getSelectedProducts() {
  return products.filter((product) =>
    selectedProductIds.has(String(product.id))
  );
}

function renderProducts() {
  const searchTerm = productSearch.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;
  const visibleProducts = products.filter((product) => {
    const matchesCategory =
      !selectedCategory || product.category === selectedCategory;
    const searchableText =
      `${product.name} ${product.brand} ${product.category} ${product.description}`.toLowerCase();
    return matchesCategory && searchableText.includes(searchTerm);
  });

  if (visibleProducts.length === 0) {
    productsContainer.innerHTML =
      '<p class="empty-state">No products match your search. Try another word or category.</p>';
    return;
  }

  productsContainer.innerHTML = visibleProducts
    .map((product) => {
      const isSelected = selectedProductIds.has(String(product.id));
      return `
        <button
          class="product-card${isSelected ? " is-selected" : ""}"
          type="button"
          data-product-id="${escapeHtml(product.id)}"
          aria-pressed="${isSelected}"
          ${isBusy ? "disabled" : ""}
        >
          <span class="product-image-wrap">
            <img src="${escapeHtml(product.image)}" alt="" loading="lazy" />
            <span class="selection-mark" aria-hidden="true">
              <i class="fa-solid ${isSelected ? "fa-check" : "fa-plus"}"></i>
            </span>
          </span>
          <span class="product-info">
            <span class="product-category">${escapeHtml(product.category)}</span>
            <span class="product-name">${escapeHtml(product.name)}</span>
            <span class="product-brand">${escapeHtml(product.brand)}</span>
            <span class="product-description">${escapeHtml(product.description)}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderSelectedProducts() {
  const selectedProducts = getSelectedProducts();
  selectionCount.textContent = `${selectedProducts.length} selected`;
  clearSelectionButton.disabled = selectedProducts.length === 0 || isBusy;
  generateButton.disabled = selectedProducts.length === 0 || isBusy;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML =
      '<p class="empty-selection">Your edit starts here. Select products you love.</p>';
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
        <span class="selected-product">
          <span>${escapeHtml(product.name)}</span>
          <button
            type="button"
            class="remove-product"
            data-remove-id="${escapeHtml(product.id)}"
            aria-label="Remove ${escapeHtml(product.name)}"
            ${isBusy ? "disabled" : ""}
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </span>
      `
    )
    .join("");
}

function updateSelection() {
  renderProducts();
  renderSelectedProducts();
  saveSelection();
}

function appendMessage(role, text) {
  const messageElement = document.createElement("div");
  messageElement.className = `chat-message ${role}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "assistant" ? "BEAUTY ADVISOR" : "YOU";

  const content = document.createElement("p");
  content.className = "message-content";
  addFormattedText(content, text);

  messageElement.append(label, content);
  chatWindow.append(messageElement);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Goes through the AI's reply one line at a time.
// Lines that start with # (like "### Morning") are Markdown headings,
// so we show them as headings instead of showing the # symbols.
function addFormattedText(container, text) {
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    const headingMatch = line.match(/^\s*#{1,6}\s+(.*)$/);

    if (headingMatch) {
      // Heading line: put the words (without the #'s) in a heading span
      const heading = document.createElement("span");
      heading.className = "message-heading";
      addTextAndLinks(heading, headingMatch[1]);
      container.append(heading);
    } else {
      // Normal line: add it with bold text and links handled
      addTextAndLinks(container, line);
    }

    // Put the line break back (except after the very last line)
    if (index < lines.length - 1) {
      container.append(document.createTextNode("\n"));
    }
  });
}

// Turns the AI's text into safe page content:
// [label](url) and plain https:// links become clickable links,
// and **text** becomes bold text (instead of showing the asterisks)
function addTextAndLinks(container, text) {
  const linkPattern =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+)|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(text)) !== null) {
    // Add any normal text that came before this match
    container.append(document.createTextNode(text.slice(lastIndex, match.index)));

    // If the match is **bold text**, wrap it in a <strong> tag
    if (match[4]) {
      const bold = document.createElement("strong");
      bold.textContent = match[4];
      container.append(bold);
      lastIndex = linkPattern.lastIndex;
      continue;
    }

    // Otherwise the match is a link
    const url = match[2] || match[3];
    const label = match[1] || url;
    const link = document.createElement("a");
    link.href = url;
    link.textContent = label;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    container.append(link);
    lastIndex = linkPattern.lastIndex;
  }

  container.append(document.createTextNode(text.slice(lastIndex)));
}

function setBusy(busy) {
  isBusy = busy;
  renderProducts();
  renderSelectedProducts();
  generateButton.innerHTML = busy
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Creating your routine'
    : '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generate my routine';
  userInput.disabled = busy || !routineGenerated;
  sendButton.disabled = busy || !routineGenerated;
}

async function askWorker(conversation) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: conversation }),
  });

  // Read the reply as text first, so we can show a clear error if it isn't JSON
  // (for example, an HTML error page from the wrong address)
  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `The server at ${WORKER_URL} sent back a web page instead of an answer (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        `The beauty advisor is unavailable (HTTP ${response.status}).`
    );
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("The Worker returned an unexpected response. Please try again.");
  }

  return reply;
}

// Shows a "typing" bubble with three bouncing dots while the AI is thinking
function showThinkingBubble() {
  const bubble = document.createElement("div");
  bubble.className = "chat-message assistant thinking";
  bubble.id = "thinkingBubble";
  bubble.innerHTML = `
    <span class="message-label">BEAUTY ADVISOR</span>
    <span class="typing-dots" role="status" aria-label="Your beauty advisor is thinking">
      <span></span><span></span><span></span>
    </span>
  `;
  chatWindow.append(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Removes the "typing" bubble once the answer (or an error) arrives
function hideThinkingBubble() {
  const bubble = document.getElementById("thinkingBubble");
  if (bubble) bubble.remove();
}

async function sendConversation() {
  setBusy(true);
  setStatus("");
  showThinkingBubble();

  try {
    const reply = await askWorker(messages);
    hideThinkingBubble();
    messages.push({ role: "assistant", content: reply });
    routineGenerated = true;
    appendMessage("assistant", reply);
    userInput.value = "";
  } catch (error) {
    hideThinkingBubble();
    setStatus(error.message);
    appendMessage("assistant", `I couldn't reach your beauty advisor. ${error.message}`);
    messages.pop();
  } finally {
    setBusy(false);
    userInput.focus();
  }
}

productsContainer.addEventListener("click", (event) => {
  const card = event.target.closest("[data-product-id]");
  if (!card) return;

  const productId = card.dataset.productId;
  if (selectedProductIds.has(productId)) {
    selectedProductIds.delete(productId);
  } else {
    selectedProductIds.add(productId);
  }
  updateSelection();
});

selectedProductsList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-id]");
  if (!removeButton) return;

  selectedProductIds.delete(removeButton.dataset.removeId);
  updateSelection();
});

categoryFilter.addEventListener("change", renderProducts);
productSearch.addEventListener("input", renderProducts);

clearSelectionButton.addEventListener("click", () => {
  selectedProductIds.clear();
  updateSelection();
});

generateButton.addEventListener("click", async () => {
  const selectedProducts = getSelectedProducts();
  if (selectedProducts.length === 0 || isBusy) return;

  if (!WORKER_URL) {
    setStatus("Add your class Cloudflare Worker URL to WORKER_URL in script.js to connect the beauty advisor.");
    return;
  }

  chatWindow.replaceChildren();
  routineGenerated = false;
  messages = [
    systemMessage,
    {
      role: "user",
      content: `Create a personalized beauty routine using only these selected products. Use their product details as provided, explain the order and when to use each one, and note any important usage considerations:\n\n${JSON.stringify(selectedProducts, null, 2)}`,
    },
  ];
  appendMessage("user", "Please create a routine with my selected products.");
  userInput.disabled = true;
  sendButton.disabled = true;
  await sendConversation();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = userInput.value.trim();
  if (!question || messages.length === 0 || isBusy) return;

  messages.push({ role: "user", content: question });
  appendMessage("user", question);
  await sendConversation();
});

directionToggle.addEventListener("click", () => {
  const isRtl = document.documentElement.dir !== "rtl";
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
  document.documentElement.lang = isRtl ? "ar" : "en";
  directionToggle.setAttribute("aria-pressed", String(isRtl));
});

async function loadProducts() {
  try {
    const response = await fetch("products.json");
    if (!response.ok) {
      throw new Error(`Could not load products (HTTP ${response.status}).`);
    }

    const data = await response.json();
    if (!Array.isArray(data.products)) {
      throw new Error("The product list has an unexpected format.");
    }

    products = data.products;
    restoreSelection();
    renderProducts();
    renderSelectedProducts();
  } catch (error) {
    setStatus(`${error.message} Refresh the page to try again.`);
    productsContainer.innerHTML =
      '<p class="empty-state">Products could not be loaded.</p>';
  }
}

renderSelectedProducts();
loadProducts();
