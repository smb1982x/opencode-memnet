const API_BASE = "";

const state = {
  tags: { project: [] },
  memories: [],
  currentPage: 1,
  pageSize: 20,
  totalPages: 1,
  totalItems: 0,
  selectedTag: "",
  currentView: "project",
  searchQuery: "",
  isSearching: false,
  selectedMemories: new Set(),
  autoRefreshInterval: null,
  userProfile: null,
  authKey: localStorage.getItem("opencode-memnet-apikey") || "",
  activeProfileId: localStorage.getItem("opencode-memnet-active-profile") || "",
  authDisabled: false,
};

marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
});

function renderMarkdown(markdown) {
  const html = marked.parse(markdown);
  return DOMPurify.sanitize(html);
}

async function fetchAPI(endpoint, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const headers = { ...(options.headers || {}) };
    if (state.authKey) {
      headers["Authorization"] = `Bearer ${state.authKey}`;
    }
    const response = await fetch(API_BASE + endpoint, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("API Error:", error);
    return { success: false, error: error.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadTags() {
  const result = await fetchAPI("/api/tags");
  if (result.success) {
    state.tags = result.data;
    populateTagDropdowns();
  }
}

function populateTagDropdowns() {
  const tagFilter = document.getElementById("tag-filter");
  const addTag = document.getElementById("add-tag");

  tagFilter.innerHTML = `<option value="">${t("opt-all-tags")}</option>`;
  addTag.innerHTML = `<option value="">${t("opt-select-tag")}</option>`;

  const scopeTags = state.tags.project;

  scopeTags.forEach((tagInfo) => {
    const displayText = tagInfo.displayName || tagInfo.tag;
    const shortDisplay =
      displayText.length > 50 ? displayText.substring(0, 50) + "..." : displayText;

    const option1 = document.createElement("option");
    option1.value = tagInfo.tag;
    option1.textContent = shortDisplay;
    tagFilter.appendChild(option1);

    const option2 = document.createElement("option");
    option2.value = tagInfo.tag;
    option2.textContent = shortDisplay;
    addTag.appendChild(option2);
  });
}

function renderMemories() {
  const container = document.getElementById("memories-list");

  if (state.memories.length === 0) {
    container.innerHTML = `<div class="empty-state">${t("empty-memories")}</div>`;
    return;
  }

  container.innerHTML = groupMemories(state.memories)
    .map((group) => {
      if (group.isPair) {
        return renderCombinedCard(group);
      } else if (group.type === "prompt") {
        return renderPromptCard(group.item);
      } else {
        return renderMemoryCard(group.item);
      }
    })
    .join("");

  document.querySelectorAll(".memory-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", handleCheckboxChange);
  });

  lucide.createIcons();
}

function groupMemories(items) {
  const map = new Map();
  const pairs = [];
  const processed = new Set();

  items.forEach((item) => map.set(item.id, item));

  items.forEach((item) => {
    if (processed.has(item.id)) return;

    if (item.type === "memory" && item.linkedPromptId && map.has(item.linkedPromptId)) {
      const prompt = map.get(item.linkedPromptId);
      pairs.push({ isPair: true, memory: item, prompt: prompt });
      processed.add(item.id);
      processed.add(prompt.id);
    } else if (item.type === "prompt" && item.linkedMemoryId && map.has(item.linkedMemoryId)) {
      const memory = map.get(item.linkedMemoryId);
      pairs.push({ isPair: true, memory: memory, prompt: item });
      processed.add(item.id);
      processed.add(memory.id);
    } else {
      pairs.push({ isPair: false, type: item.type, item: item });
      processed.add(item.id);
    }
  });

  return pairs.sort((a, b) => {
    const timeA = a.isPair ? a.memory.createdAt : a.item.createdAt;
    const timeB = b.isPair ? b.memory.createdAt : b.item.createdAt;
    return new Date(timeB) - new Date(timeA);
  });
}

function renderCombinedCard(pair) {
  const { memory, prompt } = pair;
  const isSelected = state.selectedMemories.has(memory.id);
  const isPinned = memory.isPinned || false;
  const similarityHtml =
    memory.similarity !== undefined
      ? `<span class="similarity-score">${Math.round(memory.similarity * 100)}%</span>`
      : "";

  const tagsHtml =
    memory.tags && memory.tags.length > 0
      ? `<div class="tags-list">${memory.tags.map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`).join("")}</div>`
      : "";

  const eid = escapeAttr(memory.id);
  const pinButton = isPinned
    ? `<button class="btn-pin pinned" onclick="unpinMemory('${eid}')" title="Unpin"><i data-lucide="pin" class="icon icon-filled"></i></button>`
    : `<button class="btn-pin" onclick="pinMemory('${eid}')" title="Pin"><i data-lucide="pin" class="icon"></i></button>`;

  const createdDate = formatDate(memory.createdAt);
  const updatedDate =
    memory.updatedAt && memory.updatedAt !== memory.createdAt ? formatDate(memory.updatedAt) : null;

  const dateInfo = updatedDate
    ? `<span>${t("date-created")} ${createdDate}</span><span>${t("date-updated")} ${updatedDate}</span>`
    : `<span>${t("date-created")} ${createdDate}</span>`;
  return `
    <div class="combined-card ${isSelected ? "selected" : ""} ${isPinned ? "pinned" : ""}" data-id="${eid}">
      <div class="combined-prompt-section">
        <div class="combined-header">
          <span class="badge badge-prompt">${t("badge-prompt")}</span>
          <span class="prompt-date">${formatDate(prompt.createdAt)}</span>
        </div>
        <div class="prompt-content">${escapeHtml(prompt.content)}</div>
      </div>
      
      <div class="combined-divider">
        <i data-lucide="arrow-down" class="divider-icon"></i>
      </div>

      <div class="combined-memory-section">
        <div class="memory-header">
          <div class="meta">
            <input type="checkbox" class="memory-checkbox" data-id="${eid}" ${isSelected ? "checked" : ""} />
            <span class="badge badge-memory">${t("badge-memory")}</span>
            ${memory.memoryType ? `<span class="badge badge-type">${escapeHtml(memory.memoryType)}</span>` : ""}
            ${similarityHtml}
            ${isPinned ? `<span class="badge badge-pinned">${t("badge-pinned")}</span>` : ""}
            <span class="memory-display-name">${escapeHtml(memory.displayName || memory.id)}</span>
          </div>
          <div class="memory-actions">
            ${pinButton}
            <button class="btn-edit" onclick="editMemory('${eid}')"><i data-lucide="edit-3" class="icon"></i></button>
            <button class="btn-delete" onclick="deleteMemoryWithLink('${eid}', true)">
              <i data-lucide="trash-2" class="icon"></i> ${t("btn-delete-pair")}
            </button>
          </div>
        </div>
        ${tagsHtml}
        <div class="memory-content markdown-content">${renderMarkdown(memory.content)}</div>
        <div class="memory-footer">
          ${dateInfo}
          <span>ID: ${escapeHtml(memory.id)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderPromptCard(prompt) {
  const isLinked = !!prompt.linkedMemoryId;
  const isSelected = state.selectedMemories.has(prompt.id);
  const promptDate = formatDate(prompt.createdAt);
  const eid = escapeAttr(prompt.id);

  return `
    <div class="prompt-card ${isSelected ? "selected" : ""}" data-id="${eid}">
      <div class="prompt-header">
        <div class="meta">
          <input type="checkbox" class="memory-checkbox" data-id="${eid}" ${isSelected ? "checked" : ""} />
          <i data-lucide="message-circle" class="icon"></i>
          <span class="badge badge-prompt">${t("badge-prompt")}</span>
          ${isLinked ? `<span class="badge badge-linked"><i data-lucide="link" class="icon-sm"></i> ${t("badge-linked")}</span>` : ""}
          <span class="prompt-date">${promptDate}</span>
        </div>
        <div class="prompt-actions">
          <button class="btn-delete" onclick="deletePromptWithLink('${eid}', ${isLinked})">
            <i data-lucide="trash-2" class="icon"></i>
            ${isLinked ? t("btn-delete-pair") : t("btn-delete")}
          </button>
        </div>
      </div>
      <div class="prompt-content">
        ${escapeHtml(prompt.content)}
      </div>
      ${isLinked ? `<div class="link-indicator"><i data-lucide="arrow-down" class="icon-sm"></i> ${t("text-generated-above")} <i data-lucide="arrow-up" class="icon-sm"></i></div>` : ""}
    </div>
  `;
}

function renderMemoryCard(memory) {
  const isSelected = state.selectedMemories.has(memory.id);
  const isPinned = memory.isPinned || false;
  const isLinked = !!memory.linkedPromptId;
  const similarityHtml =
    memory.similarity !== undefined
      ? `<span class="similarity-score">${Math.round((memory.similarity || 0) * 100)}%</span>`
      : "";

  let displayInfo = memory.displayName || memory.id;
  if (memory.projectPath) {
    const pathParts = memory.projectPath
      .replace(/\\/g, "/")
      .split("/")
      .filter((p) => p);
    displayInfo = pathParts[pathParts.length - 1] || memory.projectPath;
  }

  let subtitle = "";
  if (memory.projectPath) {
    subtitle = `<span class="memory-subtitle">${escapeHtml(memory.projectPath)}</span>`;
  }

  const eid = escapeAttr(memory.id);
  const pinButton = isPinned
    ? `<button class="btn-pin pinned" onclick="unpinMemory('${eid}')" title="Unpin"><i data-lucide="pin" class="icon icon-filled"></i></button>`
    : `<button class="btn-pin" onclick="pinMemory('${eid}')" title="Pin"><i data-lucide="pin" class="icon"></i></button>`;

  const createdDate = formatDate(memory.createdAt);
  const updatedDate =
    memory.updatedAt && memory.updatedAt !== memory.createdAt ? formatDate(memory.updatedAt) : null;

  const dateInfo = updatedDate
    ? `<span>${t("date-created")} ${createdDate}</span><span>${t("date-updated")} ${updatedDate}</span>`
    : `<span>${t("date-created")} ${createdDate}</span>`;
  const tagsHtml =
    memory.tags && memory.tags.length > 0
      ? `<div class="tags-list">${memory.tags.map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`).join("")}</div>`
      : "";

  return `
    <div class="memory-card ${isSelected ? "selected" : ""} ${isPinned ? "pinned" : ""}" data-id="${eid}">
      <div class="memory-header">
        <div class="meta">
          <input type="checkbox" class="memory-checkbox" data-id="${eid}" ${isSelected ? "checked" : ""} />
          ${memory.memoryType ? `<span class="badge badge-type">${escapeHtml(memory.memoryType)}</span>` : ""}
          ${isLinked ? `<span class="badge badge-linked"><i data-lucide="link" class="icon-sm"></i> ${t("badge-linked")}</span>` : ""}
          ${similarityHtml}
          ${isPinned ? `<span class="badge badge-pinned">${t("badge-pinned")}</span>` : ""}
          <span class="memory-display-name">${escapeHtml(displayInfo)}</span>
          ${subtitle}
        </div>
        <div class="memory-actions">
          ${pinButton}
          <button class="btn-edit" onclick="editMemory('${eid}')"><i data-lucide="edit-3" class="icon"></i></button>
          <button class="btn-delete" onclick="deleteMemoryWithLink('${eid}', ${isLinked})">
            <i data-lucide="trash-2" class="icon"></i>
            ${isLinked ? t("btn-delete-pair") : t("btn-delete")}
          </button>
        </div>
      </div>
      ${tagsHtml}
      <div class="memory-content markdown-content">${renderMarkdown(memory.content)}</div>
      ${isLinked ? `<div class="link-indicator"><i data-lucide="arrow-up" class="icon-sm"></i> ${t("text-from-below")} <i data-lucide="arrow-down" class="icon-sm"></i></div>` : ""}
      <div class="memory-footer">
        ${dateInfo}
        <span>ID: ${escapeHtml(memory.id)}</span>
      </div>
    </div>
  `;
}

function handleCheckboxChange(e) {
  const id = e.target.dataset.id;
  if (e.target.checked) {
    state.selectedMemories.add(id);
  } else {
    state.selectedMemories.delete(id);
  }
  updateBulkActions();
  updateCardSelection(id, e.target.checked);
}

function updateCardSelection(id, selected) {
  const card = document.querySelector(
    `.memory-card[data-id="${id}"], .prompt-card[data-id="${id}"], .combined-card[data-id="${id}"]`
  );
  if (card) {
    if (selected) {
      card.classList.add("selected");
    } else {
      card.classList.remove("selected");
    }
  }
}

function updateBulkActions() {
  const bulkActions = document.getElementById("bulk-actions");
  const selectedCount = document.getElementById("selected-count");

  if (state.selectedMemories.size > 0) {
    bulkActions.classList.remove("hidden");
    selectedCount.textContent = t("text-selected", { count: state.selectedMemories.size });
  } else {
    bulkActions.classList.add("hidden");
  }
}

function updatePagination() {
  const pageInfo = t("text-page", { current: state.currentPage, total: state.totalPages });
  document.getElementById("page-info-top").textContent = pageInfo;
  document.getElementById("page-info-bottom").textContent = pageInfo;
  const hasPrev = state.currentPage > 1;
  const hasNext = state.currentPage < state.totalPages;

  document.getElementById("prev-page-top").disabled = !hasPrev;
  document.getElementById("next-page-top").disabled = !hasNext;
  document.getElementById("prev-page-bottom").disabled = !hasPrev;
  document.getElementById("next-page-bottom").disabled = !hasNext;
}

function updateSectionTitle() {
  const title = state.isSearching
    ? `SEARCH RESULTS (${state.totalItems})`
    : t("section-project", { count: state.totalItems });
  document.getElementById("section-title").textContent = title;
}

async function loadStats() {
  const result = await fetchAPI("/api/stats");
  if (result.success) {
    document.getElementById("stats-total").textContent = t("text-total", {
      count: result.data.total,
    });
  }
}

async function addMemory(e) {
  e.preventDefault();

  const content = document.getElementById("add-content").value.trim();
  const containerTag = document.getElementById("add-tag").value;
  const type = document.getElementById("add-type").value;
  const tagsStr = document.getElementById("add-tags").value.trim();
  const tags = tagsStr
    ? tagsStr
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t)
    : [];

  if (!content || !containerTag) {
    showToast(t("toast-add-error"), "error");
    return;
  }

  const result = await fetchAPI("/api/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      containerTag,
      type: type || undefined,
      tags,
      userEmail: state.activeProfileId || undefined,
    }),
  });

  if (result.success) {
    showToast(t("toast-add-success"), "success");
    document.getElementById("add-form").reset();
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-add-failed"), "error");
  }
}

let loadRequestId = 0;

async function loadMemories() {
  const requestId = ++loadRequestId;
  showRefreshIndicator(true);

  let endpoint = `/api/memories?page=${state.currentPage}&pageSize=${state.pageSize}&includePrompts=true`;

  if (state.isSearching) {
    endpoint = `/api/search?q=${encodeURIComponent(state.searchQuery || "")}&page=${state.currentPage}&pageSize=${state.pageSize}&includePrompts=true`;
    if (state.selectedTag) {
      endpoint += `&tag=${encodeURIComponent(state.selectedTag)}`;
    }
  } else {
    if (state.selectedTag) {
      endpoint += `&tag=${encodeURIComponent(state.selectedTag)}`;
    }
  }

  if (state.activeProfileId) {
    endpoint += `&userEmail=${encodeURIComponent(state.activeProfileId)}`;
  }

  const result = await fetchAPI(endpoint);

  // Discard stale responses from superseded requests
  if (requestId !== loadRequestId) return;

  showRefreshIndicator(false);

  if (result.success) {
    state.memories = result.data.items;
    state.totalPages = result.data.totalPages;
    state.totalItems = result.data.total;
    state.currentPage = result.data.page;

    renderMemories();
    updatePagination();
    updateSectionTitle();
  } else {
    showError(result.error || t("toast-update-failed"));
  }
}

async function deleteMemoryWithLink(id, isLinked) {
  const message = isLinked ? t("confirm-delete-pair") : t("confirm-delete");
  if (!confirm(message)) return;

  const result = await fetchAPI(`/api/memories/${id}?cascade=true`, {
    method: "DELETE",
  });

  if (result.success) {
    showToast(t("toast-delete-success"), "success");

    state.selectedMemories.delete(id);
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-delete-failed"), "error");
  }
}

async function deletePromptWithLink(id, isLinked) {
  const message = isLinked ? t("confirm-delete-prompt") : t("confirm-delete");
  if (!confirm(message)) return;

  const result = await fetchAPI(`/api/prompts/${id}?cascade=true`, {
    method: "DELETE",
  });

  if (result.success) {
    showToast(t("toast-delete-success"), "success");

    state.selectedMemories.delete(id);
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-delete-failed"), "error");
  }
}

async function bulkDelete() {
  if (state.selectedMemories.size === 0) return;

  const message = t("confirm-bulk-delete", { count: state.selectedMemories.size });
  if (!confirm(message)) return;

  const ids = Array.from(state.selectedMemories);

  const promptIds = ids.filter((id) => id.startsWith("prompt_"));
  const memoryIds = ids.filter((id) => !id.startsWith("prompt_"));

  let deletedCount = 0;

  if (promptIds.length > 0) {
    const result = await fetchAPI("/api/prompts/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: promptIds, cascade: true }),
    });
    if (result.success) deletedCount += result.data.deleted;
  }

  if (memoryIds.length > 0) {
    const result = await fetchAPI("/api/memories/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: memoryIds, cascade: true }),
    });
    if (result.success) deletedCount += result.data.deleted;
  }

  showToast(t("toast-bulk-delete-success"), "success");
  state.selectedMemories.clear();
  await loadMemories();
  await loadStats();
  updateBulkActions();
}

function deselectAll() {
  state.selectedMemories.clear();
  document.querySelectorAll(".memory-checkbox").forEach((cb) => (cb.checked = false));
  document
    .querySelectorAll(".memory-card, .prompt-card, .combined-card")
    .forEach((card) => card.classList.remove("selected"));
  updateBulkActions();
}

function selectAllCurrentPage() {
  const checkboxes = document.querySelectorAll(".memory-checkbox");
  if (checkboxes.length === 0) return;

  checkboxes.forEach((cb) => {
    cb.checked = true;
    if (cb.dataset.id) {
      state.selectedMemories.add(cb.dataset.id);
      updateCardSelection(cb.dataset.id, true);
    }
  });

  updateBulkActions();
}

function editMemory(id) {
  const memory = state.memories.find((m) => m.id === id && m.type === "memory");
  if (!memory) return;

  document.getElementById("edit-id").value = memory.id;
  document.getElementById("edit-content").value = memory.content;

  document.getElementById("edit-modal").classList.remove("hidden");
}

async function saveEdit(e) {
  e.preventDefault();

  const id = document.getElementById("edit-id").value;
  const content = document.getElementById("edit-content").value.trim();

  if (!content) {
    showToast(t("toast-add-error"), "error");
    return;
  }

  const result = await fetchAPI(`/api/memories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (result.success) {
    showToast(t("toast-update-success"), "success");
    closeModal();
    await loadMemories();
  } else {
    showToast(result.error || t("toast-update-failed"), "error");
  }
}

function closeModal() {
  document.getElementById("edit-modal").classList.add("hidden");
}

function performSearch() {
  const query = document.getElementById("search-input").value.trim();

  if (!query) {
    clearSearch();
    return;
  }

  state.searchQuery = query;
  state.isSearching = true;
  state.currentPage = 1;

  document.getElementById("clear-search-btn").classList.remove("hidden");

  loadMemories();
}

function clearSearch() {
  state.searchQuery = "";
  state.isSearching = false;
  state.currentPage = 1;

  document.getElementById("search-input").value = "";
  document.getElementById("clear-search-btn").classList.add("hidden");

  loadMemories();
}

function changePage(delta) {
  const newPage = state.currentPage + delta;
  if (newPage < 1 || newPage > state.totalPages) return;

  state.currentPage = newPage;
  loadMemories();
}

let toastTimer = null;
function showToast(message, type = "success") {
  if (toastTimer) clearTimeout(toastTimer);
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");

  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
    toastTimer = null;
  }, 3000);
}

function showError(message) {
  const container = document.getElementById("memories-list");
  container.innerHTML = `<div class="error-state">Error: ${escapeHtml(message)}</div>`;
}

function showRefreshIndicator(show) {
  const indicator = document.getElementById("refresh-indicator");
  if (show) {
    indicator.classList.remove("hidden");
  } else {
    indicator.classList.add("hidden");
  }
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const locale = getLanguage() === "zh" ? "zh-CN" : "en-US";
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function pinMemory(id) {
  const result = await fetchAPI(`/api/memories/${id}/pin`, { method: "POST" });

  if (result.success) {
    showToast(t("toast-update-success"), "success");
    await loadMemories();
  } else {
    showToast(result.error || t("toast-update-failed"), "error");
  }
}

async function unpinMemory(id) {
  const result = await fetchAPI(`/api/memories/${id}/unpin`, { method: "POST" });

  if (result.success) {
    showToast(t("toast-update-success"), "success");
    await loadMemories();
  } else {
    showToast(result.error || t("toast-update-failed"), "error");
  }
}

async function runCleanup() {
  if (!confirm(t("confirm-cleanup"))) return;

  showToast(t("status-cleanup"), "info");
  const result = await fetchAPI("/api/cleanup", { method: "POST" });

  if (result.success) {
    showToast(t("toast-cleanup-success"), "success");
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-cleanup-failed"), "error");
  }
}

async function runDeduplication() {
  if (!confirm(t("confirm-dedup"))) return;

  showToast(t("status-dedup"), "info");
  const result = await fetchAPI("/api/deduplicate", { method: "POST" });

  if (result.success) {
    showToast(t("toast-dedup-success"), "success");
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-dedup-failed"), "error");
  }
}

function startAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval);
  }

  state.autoRefreshInterval = setInterval(() => {
    loadStats();
    if (!state.isSearching) {
      loadMemories();
    }
  }, 30000);
}

function showMigrationWarning(data) {
  const section = document.getElementById("migration-section");
  const message = document.getElementById("migration-message");

  section.classList.remove("hidden");

  const shardInfo =
    data.shardMismatches.length > 0
      ? t("migration-shards-mismatch", { count: data.shardMismatches.length })
      : t("migration-dimension-mismatch");

  message.textContent = t("migration-mismatch-details", {
    configDimensions: data.configDimensions,
    configModel: data.configModel,
    shardInfo,
  });

  lucide.createIcons();
}

function toggleMigrationButtons() {
  const checkbox = document.getElementById("migration-confirm-checkbox");
  const freshBtn = document.getElementById("migration-fresh-btn");
  const reembedBtn = document.getElementById("migration-reembed-btn");

  freshBtn.disabled = !checkbox.checked;
  reembedBtn.disabled = !checkbox.checked;
}

async function runMigration(strategy) {
  const checkbox = document.getElementById("migration-confirm-checkbox");

  if (!checkbox.checked) {
    showToast(t("toast-migration-failed"), "error");
    return;
  }

  const strategyName =
    strategy === "fresh-start" ? "Fresh Start (Delete All)" : "Re-embed (Preserve Data)";

  if (
    !confirm(
      `Run ${strategyName} migration?\n\nThis operation is IRREVERSIBLE and will:\n${strategy === "fresh-start" ? "- DELETE all existing memories\n- Remove all shards" : "- Re-embed all memories with new model\n- This may take several minutes"}\n\nContinue?`
    )
  ) {
    return;
  }

  showToast(t("status-migration-init"), "info");
  const result = await fetchAPI("/api/migration/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy }),
  });

  if (result.success) {
    const data = result.data;
    let message = `Migration complete! `;

    if (strategy === "fresh-start") {
      message += `Deleted ${data.deletedShards} shard(s). Duration: ${(data.duration / 1000).toFixed(2)}s`;
    } else {
      message += `Re-embedded ${data.reEmbeddedMemories} memories. Duration: ${(data.duration / 1000).toFixed(2)}s`;
    }

    showToast(t("toast-migration-success"), "success");
    document.getElementById("migration-section").classList.add("hidden");
    document.getElementById("migration-confirm-checkbox").checked = false;

    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-migration-failed"), "error");
  }
}

async function loadUserProfile() {
  const endpoint = state.activeProfileId
    ? `/api/user-profile?userId=${encodeURIComponent(state.activeProfileId)}`
    : "/api/user-profile";
  const result = await fetchAPI(endpoint);
  if (result.success) {
    state.userProfile = result.data;
    renderUserProfile();
  } else {
    showError(result.error || t("toast-update-failed"));
  }
}

function renderUserProfile() {
  const container = document.getElementById("profile-content");
  const profile = state.userProfile;

  if (!profile.exists) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="user-x" class="icon-large"></i>
        <p>${escapeHtml(profile.message)}</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  let data = profile.profileData;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse profileData string", e);
    }
  }

  const parseField = (field) => {
    if (!field) return [];
    let result = field;
    let lastResult = null;
    while (typeof result === "string" && result !== lastResult) {
      lastResult = result;
      try {
        result = JSON.parse(typeof jsonrepair === "function" ? jsonrepair(result) : result);
      } catch {
        break;
      }
    }
    if (!Array.isArray(result)) return [];
    const flattened = [];
    const walk = (item) => {
      if (Array.isArray(item)) item.forEach(walk);
      else if (item && typeof item === "object") flattened.push(item);
    };
    walk(result);
    return flattened;
  };

  const preferences = parseField(data.preferences);
  const patterns = parseField(data.patterns);
  const workflows = parseField(data.workflows);

  container.innerHTML = `
    <div class="profile-header">
      <div class="profile-info">
        <h3>${escapeHtml(profile.displayName || profile.userId)}</h3>
        <div class="profile-stats">
          <div class="stat-pill">
            <span class="label">${t("profile-version")}</span>
            <span class="value">${profile.version}</span>
          </div>
          <div class="stat-pill">
            <span class="label">${t("profile-prompts")}</span>
            <span class="value">${profile.totalPromptsAnalyzed}</span>
          </div>
          <div class="stat-pill">
            <span class="label">${t("profile-updated")}</span>
            <span class="value">${formatDate(profile.lastAnalyzedAt)}</span>
          </div>
        </div>
      </div>
      <button id="view-changelog-btn" class="btn-secondary compact">
        <i data-lucide="history" class="icon"></i> History
      </button>
    </div>

    <div class="dashboard-grid">
      <div class="dashboard-section preferences-section">
        <h4><i data-lucide="heart" class="icon"></i> ${t("profile-preferences")} <span class="count">${preferences.length}</span></h4>
        ${
          preferences.length === 0
            ? `<p class="empty-text">${t("empty-preferences")}</p>`
            : `
          <div class="cards-grid">
            ${preferences
              .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
              .map(
                (p) => `
              <div class="compact-card preference-card">
                <div class="card-top">
                  <span class="category-tag">${escapeHtml(p.category || "General")}</span>
                  <div class="confidence-ring" style="--p:${Math.round((p.confidence || 0) * 100)}">
                    <span>${Math.round((p.confidence || 0) * 100)}%</span>
                  </div>
                </div>
                <div class="card-body">
                  <p class="card-text">${escapeHtml(p.description || "")}</p>
                </div>
                ${
                  p.evidence && p.evidence.length > 0
                    ? `
                <div class="card-footer">
                  <span class="evidence-toggle" title="${escapeHtml(Array.isArray(p.evidence) ? p.evidence.join("\n") : p.evidence)}">
                    <i data-lucide="info" class="icon-xs"></i> ${Array.isArray(p.evidence) ? p.evidence.length : 1} evidence
                  </span>
                </div>`
                    : ""
                }
              </div>
            `
              )
              .join("")}
          </div>
        `
        }
      </div>

      <div class="dashboard-section patterns-section">
        <h4><i data-lucide="activity" class="icon"></i> ${t("profile-patterns")} <span class="count">${patterns.length}</span></h4>
        ${
          patterns.length === 0
            ? `<p class="empty-text">${t("empty-patterns")}</p>`
            : `
          <div class="cards-grid">
            ${patterns
              .map(
                (p) => `
              <div class="compact-card pattern-card">
                <div class="card-top">
                  <span class="category-tag">${escapeHtml(p.category || "General")}</span>
                </div>
                <div class="card-body">
                  <p class="card-text">${escapeHtml(p.description || "")}</p>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        `
        }
      </div>

      <div class="dashboard-section workflows-section full-width">
        <h4><i data-lucide="workflow" class="icon"></i> ${t("profile-workflows")} <span class="count">${workflows.length}</span></h4>
        ${
          workflows.length === 0
            ? `<p class="empty-text">${t("empty-workflows")}</p>`
            : `
          <div class="workflows-grid">
            ${workflows
              .map(
                (w) => `
              <div class="workflow-row">
                <div class="workflow-title">${escapeHtml(w.description || "")}</div>
                <div class="workflow-steps-horizontal">
                  ${(w.steps || [])
                    .map(
                      (step, i) => `
                    <div class="step-node">
                      <span class="step-idx">${i + 1}</span>
                      <span class="step-content">${escapeHtml(step)}</span>
                    </div>
                    ${i < (w.steps || []).length - 1 ? '<i data-lucide="arrow-right" class="step-arrow"></i>' : ""}
                  `
                    )
                    .join("")}
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        `
        }
      </div>
    </div>
  `;

  document.getElementById("view-changelog-btn")?.addEventListener("click", showChangelog);
  lucide.createIcons();
}

async function showChangelog() {
  const modal = document.getElementById("changelog-modal");
  const list = document.getElementById("changelog-list");

  modal.classList.remove("hidden");
  list.innerHTML = `<div class="loading">${t("loading-changelog")}</div>`;
  const result = await fetchAPI(
    `/api/user-profile/changelog?profileId=${state.userProfile.id}&limit=10`
  );

  if (result.success && result.data.length > 0) {
    list.innerHTML = result.data
      .map(
        (c) => `
      <div class="changelog-item">
        <div class="changelog-header">
          <span class="changelog-version">v${escapeHtml(c.version)}</span>
          <span class="changelog-type">${escapeHtml(c.changeType)}</span>
          <span class="changelog-date">${formatDate(c.createdAt)}</span>
        </div>
        <p class="changelog-summary">${escapeHtml(c.changeSummary)}</p>
      </div>
    `
      )
      .join("");
  } else {
    list.innerHTML = `<div class="empty-state">${t("empty-changelog")}</div>`;
  }
}

async function refreshProfile() {
  showToast(t("loading-profile"), "info");
  const result = await fetchAPI("/api/user-profile/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (result.success) {
    showToast(result.data.message, "success");
    await loadUserProfile();
  } else {
    showToast(result.error || t("toast-update-failed"), "error");
  }
}

// ── Profile sheet ──
function openProfileSheet() {
  document.getElementById("profile-sheet").classList.add("sheet-open");
  loadUserProfile();
}

function closeProfileSheet() {
  document.getElementById("profile-sheet").classList.remove("sheet-open");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", async () => {
  // ── Profile sheet ──
  document.getElementById("profile-btn").addEventListener("click", openProfileSheet);
  document.getElementById("profile-sheet-close").addEventListener("click", closeProfileSheet);
  document.getElementById("profile-sheet").addEventListener("click", (e) => {
    if (e.target.id === "profile-sheet") closeProfileSheet();
  });
  document.getElementById("refresh-profile-btn")?.addEventListener("click", refreshProfile);

  document.getElementById("changelog-close")?.addEventListener("click", () => {
    document.getElementById("changelog-modal").classList.add("hidden");
  });

  // Language is auto-detected from localStorage or browser; no manual toggle button.

  document.getElementById("tag-filter").addEventListener("change", () => {
    state.selectedTag = document.getElementById("tag-filter").value;
    state.currentPage = 1;
    state.isSearching = false;
    state.searchQuery = "";
    document.getElementById("search-input").value = "";
    document.getElementById("clear-search-btn").classList.add("hidden");
    loadMemories();
  });

  document.getElementById("search-btn").addEventListener("click", performSearch);
  document.getElementById("clear-search-btn").addEventListener("click", clearSearch);
  document.getElementById("search-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") performSearch();
  });

  document.getElementById("add-form").addEventListener("submit", addMemory);
  document.getElementById("edit-form").addEventListener("submit", saveEdit);
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("cancel-edit").addEventListener("click", closeModal);

  document.getElementById("prev-page-top").addEventListener("click", () => changePage(-1));
  document.getElementById("next-page-top").addEventListener("click", () => changePage(1));
  document.getElementById("prev-page-bottom").addEventListener("click", () => changePage(-1));
  document.getElementById("next-page-bottom").addEventListener("click", () => changePage(1));

  document.getElementById("bulk-delete-btn").addEventListener("click", bulkDelete);
  document.getElementById("select-all-btn").addEventListener("click", selectAllCurrentPage);
  document.getElementById("deselect-all-btn").addEventListener("click", deselectAll);

  document.getElementById("cleanup-btn").addEventListener("click", runCleanup);
  document.getElementById("deduplicate-btn").addEventListener("click", runDeduplication);

  document
    .getElementById("migration-confirm-checkbox")
    .addEventListener("change", toggleMigrationButtons);
  document
    .getElementById("migration-fresh-btn")
    .addEventListener("click", () => runMigration("fresh-start"));
  document
    .getElementById("migration-reembed-btn")
    .addEventListener("click", () => runMigration("re-embed"));

  document.getElementById("edit-modal").addEventListener("click", (e) => {
    if (e.target.id === "edit-modal") closeModal();
  });

  // ── Settings panel ──

  async function populateProfileDropdown() {
    if (!state.authKey && !state.authDisabled) return;
    try {
      const headers = {};
      if (state.authKey) headers["Authorization"] = `Bearer ${state.authKey}`;
      const res = await fetch("/api/user-profiles", { headers });
      const data = await res.json();

      if (data.success && data.data.profiles.length > 0) {
        const select = document.getElementById("settings-profile");
        select.innerHTML = "";
        data.data.profiles.forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.userId;
          opt.textContent = p.displayName + " (" + p.userEmail + ")";
          select.appendChild(opt);
        });
        select.disabled = false;

        const defaultId = data.data.defaultUserId;
        select._populating = true;
        const targetId = state.activeProfileId || defaultId;
        if (data.data.profiles.some((p) => p.userId === targetId)) {
          select.value = targetId;
        } else if (data.data.profiles.some((p) => p.userId === defaultId)) {
          select.value = defaultId;
        } else if (data.data.profiles.length > 0) {
          select.value = data.data.profiles[0].userId;
        }
        if (!state.activeProfileId && data.data.profiles.length > 0) {
          state.activeProfileId = data.data.profiles[0].userId;
        }
        select._populating = false;
      }
    } catch (e) {
      console.warn("Failed to load profiles:", e);
    }
  }

  document.getElementById("settings-toggle").addEventListener("click", () => {
    const panel = document.getElementById("settings-panel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      if (!state.authDisabled) {
        document.getElementById("settings-apikey").value = state.authKey;
        document.getElementById("settings-apikey").focus();
      }
      if (state.authKey || state.authDisabled) populateProfileDropdown();
      if (state.activeProfileId && state.memories.length === 0) {
        loadMemories();
        loadStats();
      }
    }
  });
  document.getElementById("settings-close").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.add("hidden");
  });
  document.getElementById("settings-profile").addEventListener("change", () => {
    if (document.getElementById("settings-profile")._populating) return;
    const newProfileId = document.getElementById("settings-profile").value;
    if (state.activeProfileId === newProfileId) return;
    state.activeProfileId = newProfileId;
    localStorage.setItem("opencode-memnet-active-profile", newProfileId);
    state.currentPage = 1;

    // Clear current data and reload for the new profile
    state.memories = [];
    state.tags = { project: [] };
    document.getElementById("memories-list").innerHTML =
      '<div class="loading">Switching profile...</div>';
    document.getElementById("stats-total").textContent = "Total: 0";
    document.getElementById("section-title").textContent = "PROJECT MEMORIES (0)";

    loadMemories();
    loadStats();
  });
  document.getElementById("settings-save").addEventListener("click", async () => {
    if (!state.authDisabled) {
      const key = document.getElementById("settings-apikey").value.trim();
      state.authKey = key;
      localStorage.setItem("opencode-memnet-apikey", key);
    }

    // Try to load profiles and set the default
    await populateProfileDropdown();

    document.getElementById("settings-panel").classList.add("hidden");
    loadTags();
    loadMemories();
    loadStats();
  });
  document.getElementById("settings-apikey").addEventListener("keypress", (e) => {
    if (e.key === "Enter") document.getElementById("settings-save").click();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.getElementById("settings-panel").classList.add("hidden");
      closeProfileSheet();
    }
  });

  // Check if auth is disabled by testing an authenticated endpoint without credentials
  try {
    const testRes = await fetch("/api/tags");
    if (testRes.ok) {
      state.authDisabled = true;
      console.log("Auth disabled — loading data without API key");
      document.getElementById("settings-apikey").value = "(auth disabled)";
      document.getElementById("settings-apikey").readOnly = true;
      document.getElementById("settings-profile").disabled = false;
      // Auto-load profiles since we have access
      populateProfileDropdown();
      // Hide settings cog — all panel settings (API key, profile) are auth-related
      document.getElementById("settings-toggle").style.display = "none";
    }
  } catch (e) {
    console.warn("Auth check failed:", e);
  }

  await loadTags();
  await loadMemories();
  await loadStats();

  // Fallback: if memories still show the loading indicator after init,
  // retry after a short delay (headless Chromium event loop edge case)
  setTimeout(() => {
    const list = document.getElementById("memories-list");
    if (list && list.querySelector(".loading")) {
      console.warn("[opencode-memnet] Memories stuck in loading state, retrying...");
      loadMemories();
      loadStats();
    }
  }, 3000);

  // Migration status bar polling
  setInterval(async () => {
    try {
      const headers = {};
      if (state.authKey) headers["Authorization"] = `Bearer ${state.authKey}`;
      const res = await fetch("/api/migration/tags/progress", { headers });
      const data = await res.json();
      if (data.success) {
        const bar = document.getElementById("migration-status-bar");
        if (bar) {
          if (data.data.status === "running") {
            bar.textContent = `Status: Migrating Memories (${data.data.processed} of ${data.data.total})...`;
          } else {
            bar.textContent = "Status: Idle";
          }
        }
      }
    } catch {
      /* ignore poll errors */
    }
  }, 2000);

  startAutoRefresh();

  lucide.createIcons();
});
