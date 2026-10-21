"use strict";
(function () {
  const STORAGE_KEY = "kursograf.course-editor.v1";
  const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);
  const editor = $("editor");
  const sourceEditor = $("sourceEditor");
  const lessonTitle = $("lessonTitle");
  const lessonList = $("lessonList");
  const saveState = $("saveState");
  const previewFrame = $("previewFrame");
  const formatbar = $("formatbar");
  const tabs = document.querySelectorAll("[data-mode]");
  const panels = {
    visual: $("visualPanel"),
    source: $("sourcePanel"),
    preview: $("previewPanel")
  };
  let mode = "visual";
  let saveTimer = null;
  let toastTimer = null;
  let savedRange = null;

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Only a deliberately small, portable subset of HTML is retained.
  // Pasted HTML is untrusted even if it came from a rich text editor.
  const SAFE_TAGS = new Set([
    "p", "div", "span", "br", "hr", "h1", "h2", "h3", "h4", "strong", "b",
    "em", "i", "u", "s", "del", "sup", "sub", "code", "pre", "blockquote",
    "ul", "ol", "li", "a", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "figure", "figcaption"
  ]);
  const DROP_TAGS = new Set([
    "script", "style", "iframe", "object", "embed", "svg", "math", "form",
    "input", "textarea", "select", "button", "link", "meta", "base", "video",
    "audio", "canvas", "template", "noscript"
  ]);
  const ALIGN_TAGS = new Set(["div", "p", "h1", "h2", "h3", "h4", "blockquote", "td", "th"]);
  const SAFE_ALIGN = new Set(["left", "center", "right", "justify"]);

  function safeLink(raw) {
    if (!raw) return "";
    const url = raw.trim();
    if (url.startsWith("#") || url.startsWith("/")) {
      return url.startsWith("//") ? "" : url;
    }
    try {
      const parsed = new URL(url);
      if (["https:", "http:", "mailto:"].includes(parsed.protocol)) return url;
    } catch (_) { /* invalid URL */ }
    return "";
  }

  function sanitizeHtml(unsafe) {
    const parsed = new DOMParser().parseFromString(String(unsafe || ""), "text/html");
    const result = document.createElement("div");

    function appendClean(from, into) {
      if (from.nodeType === Node.TEXT_NODE) {
        into.appendChild(document.createTextNode(from.textContent || ""));
        return;
      }
      if (from.nodeType !== Node.ELEMENT_NODE) return;
      const tag = from.localName.toLowerCase();
      if (DROP_TAGS.has(tag)) return;
      if (!SAFE_TAGS.has(tag)) {
        Array.from(from.childNodes).forEach((child) => appendClean(child, into));
        return;
      }

      const clean = document.createElement(tag);
      if (ALIGN_TAGS.has(tag)) {
        let align = (from.getAttribute("align") || "").toLowerCase().trim();
        const inlineStyle = from.getAttribute("style") || "";
        const match = inlineStyle.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center|justify)\s*(?:;|$)/i);
        if (match) align = match[1].toLowerCase();
        if (SAFE_ALIGN.has(align)) clean.style.textAlign = align;
      }
      if (tag === "a") {
        const href = safeLink(from.getAttribute("href") || "");
        if (href) {
          clean.setAttribute("href", href);
          clean.setAttribute("rel", "noopener noreferrer");
          clean.setAttribute("target", "_blank");
        }
      }
      if (tag === "ol") {
        const start = parseInt(from.getAttribute("start") || "", 10);
        if (Number.isInteger(start) && start >= 1 && start <= 10000) clean.setAttribute("start", String(start));
      }
      if (tag === "td" || tag === "th") {
        ["colspan", "rowspan"].forEach((attribute) => {
          const n = parseInt(from.getAttribute(attribute) || "", 10);
          if (Number.isInteger(n) && n >= 1 && n <= 20) clean.setAttribute(attribute, String(n));
        });
      }
      Array.from(from.childNodes).forEach((child) => appendClean(child, clean));
      into.appendChild(clean);
    }
    Array.from(parsed.body.childNodes).forEach((child) => appendClean(child, result));
    return result.innerHTML;
  }

  function inlineMarkdown(raw) {
    const codes = [];
    const marker = "\uE000";
    const tick = String.fromCharCode(96);
    let text = escapeHtml(raw);
    const codePattern = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");
    text = text.replace(codePattern, (_, code) => {
      const index = codes.push("<code>" + code + "</code>") - 1;
      return marker + index + marker;
    });
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (full, label, href) => {
      const address = safeLink(href.replace(/&amp;/g, "&"));
      return address ? '<a href="' + escapeHtml(address) + '">' + label + "</a>" : full;
    });
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*(?!\s)([^*\n]+)\*/g, "$1<em>$2</em>");
    return text.replace(new RegExp(marker + "(\\d+)" + marker, "g"), (_, index) => codes[Number(index)] || "");
  }

  function splitTableRow(line) {
    const text = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return text.split("|").map((cell) => cell.trim());
  }
  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || "");
  }
  function markdownToHtml(raw) {
    const lines = String(raw).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let paragraph = [];
    let listType = null;
    const FENCE = String.fromCharCode(96).repeat(3);
    function flushP() {
      if (paragraph.length) {
        out.push("<p>" + paragraph.map(inlineMarkdown).join("<br>") + "</p>");
        paragraph = [];
      }
    }
    function closeList() {
      if (listType) out.push("</" + listType + ">");
      listType = null;
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith(FENCE)) {
        flushP(); closeList();
        const code = [];
        for (i++; i < lines.length && !lines[i].trim().startsWith(FENCE); i++) code.push(lines[i]);
        out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
        continue;
      }
      if (!trimmed) { flushP(); closeList(); continue; }
      if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(trimmed)) {
        flushP(); closeList(); out.push("<hr>"); continue;
      }
      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushP(); closeList();
        out.push("<h" + heading[1].length + ">" + inlineMarkdown(heading[2]) + "</h" + heading[1].length + ">");
        continue;
      }
      if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        flushP(); closeList();
        const columns = splitTableRow(line);
        out.push("<table><thead><tr>" + columns.map((v) => "<th>" + inlineMarkdown(v) + "</th>").join("") + "</tr></thead><tbody>");
        i++;
        while (i + 1 < lines.length && lines[i + 1].trim().includes("|") && lines[i + 1].trim()) {
          i++;
          out.push("<tr>" + splitTableRow(lines[i]).map((v) => "<td>" + inlineMarkdown(v) + "</td>").join("") + "</tr>");
        }
        out.push("</tbody></table>");
        continue;
      }
      if (/^>\s?/.test(trimmed)) {
        flushP(); closeList();
        const quotes = [trimmed.replace(/^>\s?/, "")];
        while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1].trim())) {
          i++; quotes.push(lines[i].trim().replace(/^>\s?/, ""));
        }
        out.push("<blockquote><p>" + quotes.map(inlineMarkdown).join("<br>") + "</p></blockquote>");
        continue;
      }
      const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushP();
        const required = unordered ? "ul" : "ol";
        if (listType !== required) { closeList(); out.push("<" + required + ">"); listType = required; }
        out.push("<li>" + inlineMarkdown((unordered || ordered)[1]) + "</li>");
        continue;
      }
      closeList();
      paragraph.push(trimmed);
    }
    flushP(); closeList();
    return sanitizeHtml(out.join("\n"));
  }

  const starterLessons = [
    {
      id: "welcome",
      title: "Введение в Godot 4",
      html: '<h2>Добро пожаловать в первый урок!</h2><p>В этом уроке мы познакомимся с <strong>Godot 4</strong> и подготовим рабочее пространство для создания 2D-игры.</p><p>Для начала установите движок с <a href="https://godotengine.org/download/">официального сайта Godot</a>.</p><h3>Что мы изучим</h3><ul><li>Из чего состоит проект Godot</li><li>Как устроены сцены и узлы</li><li>Как запустить первую сцену</li></ul><blockquote><p><strong>Совет:</strong> скопируйте сюда ответ ChatGPT с оформленными заголовками, списками и кодом — редактор сохранит их HTML-структуру.</p></blockquote><p>Пример GDScript:</p><pre><code>extends Node2D\n\nfunc _ready() -&gt; void:\n    print("Привет, мир!")</code></pre><p style="text-align: center"><em>Начнём создавать свою игру!</em></p>'
    },
    {
      id: "scenes",
      title: "Сцены и узлы",
      html: '<h2>Сцены и узлы в Godot</h2><p>Каждая сцена — это дерево <strong>узлов</strong>. Узлы отвечают за отдельные функции игры.</p><ol><li>Создайте сцену.</li><li>Добавьте корневой узел <code>Node2D</code>.</li><li>Сохраните сцену как <code>main.tscn</code>.</li></ol><p>После сохранения сцена готова к дальнейшей работе.</p>'
    },
    {
      id: "exercise",
      title: "Практическое задание",
      html: '<h2>Практика: первая сцена</h2><p>Создайте сцену <code>Player</code> и поместите в неё <code>Sprite2D</code>.</p><h3>Критерии выполнения</h3><ul><li>Сцена открывается без ошибок.</li><li>Корневой узел называется <code>Player</code>.</li><li>Спрайт виден при запуске проекта.</li></ul>'
    }
  ];

  function makeId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "lesson-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }
  function newProject() {
    return { version: 1, activeId: "welcome", markdown: true, lessons: starterLessons.map((lesson) => ({ ...lesson })) };
  }
  function validateProject(input) {
    if (!input || !Array.isArray(input.lessons) || input.lessons.length === 0 || input.lessons.length > 300) return null;
    const seen = new Set();
    const lessons = input.lessons.map((lesson, index) => {
      const originalId = String(lesson.id || "import-" + index).slice(0, 90);
      const id = seen.has(originalId) ? makeId() : originalId;
      seen.add(id);
      return {
        id: id,
        title: String(lesson.title || "Без названия").slice(0, 160),
        html: sanitizeHtml(String(lesson.html || "").slice(0, MAX_IMPORT_BYTES))
      };
    });
    const active = lessons.some((lesson) => lesson.id === input.activeId) ? input.activeId : lessons[0].id;
    return { version: 1, activeId: active, markdown: input.markdown !== false, lessons: lessons };
  }
  function loadProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const imported = raw && validateProject(JSON.parse(raw));
      return imported || newProject();
    } catch (_) {
      return newProject();
    }
  }
  let project = loadProject();
  function selectedLesson() {
    return project.lessons.find((lesson) => lesson.id === project.activeId) || project.lessons[0];
  }

  function updateSaveState(text, cssClass) {
    saveState.className = "save-state" + (cssClass ? " " + cssClass : "");
    saveState.innerHTML = '<span class="save-dot"></span> ' + escapeHtml(text);
  }
  function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("visible"), 3200);
  }
  function renderLessons() {
    lessonList.replaceChildren();
    project.lessons.forEach((lesson, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lesson-item" + (lesson.id === project.activeId ? " active" : "");
      button.setAttribute("aria-current", lesson.id === project.activeId ? "page" : "false");
      button.title = lesson.title;
      const icon = document.createElement("span");
      icon.className = "lesson-icon";
      icon.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.className = "lesson-item-name";
      name.textContent = lesson.title;
      button.append(icon, name);
      button.addEventListener("click", () => switchLesson(lesson.id));
      lessonList.appendChild(button);
    });
  }
  function currentHtml() {
    return sanitizeHtml(mode === "source" ? sourceEditor.value : editor.innerHTML);
  }
  function updateCount() {
    const html = currentHtml();
    const page = new DOMParser().parseFromString(html, "text/html");
    const text = (page.body.textContent || "").trim();
    const words = text ? text.split(/\s+/).length : 0;
    let noun = "слов";
    if (words % 10 === 1 && words % 100 !== 11) noun = "слово";
    else if ([2, 3, 4].includes(words % 10) && !(words % 100 >= 12 && words % 100 <= 14)) noun = "слова";
    $("wordCount").textContent = words + " " + noun;
  }
  function markDirty() {
    updateSaveState("Не сохранено", "dirty");
    updateCount();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 550);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    const lesson = selectedLesson();
    lesson.title = lessonTitle.value.trim() || "Без названия";
    lesson.html = currentHtml();
    project.markdown = $("markdownToggle").checked;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      updateSaveState("Сохранено локально", "");
    } catch (_) {
      updateSaveState("Ошибка сохранения", "error");
      toast("Не удалось сохранить проект. Выгрузи резервную копию JSON.");
    }
    renderLessons();
  }
  function mountLesson() {
    const lesson = selectedLesson();
    lessonTitle.value = lesson.title;
    editor.innerHTML = sanitizeHtml(lesson.html);
    sourceEditor.value = sanitizeHtml(lesson.html);
    savedRange = null;
    updateCount();
    renderLessons();
  }
  function switchLesson(id) {
    if (project.activeId === id) return;
    saveNow();
    project.activeId = id;
    setMode("visual");
    mountLesson();
    saveNow();
    $("sidebar").classList.remove("open");
  }
  function setMode(next) {
    if (!panels[next]) return;
    if (next !== mode) {
      if (mode === "source") editor.innerHTML = sanitizeHtml(sourceEditor.value);
      if (mode === "visual") sourceEditor.value = sanitizeHtml(editor.innerHTML);
    }
    mode = next;
    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    Object.keys(panels).forEach((name) => { panels[name].hidden = name !== mode; });
    formatbar.querySelectorAll("button,select").forEach((control) => { control.disabled = mode !== "visual"; });
    formatbar.style.opacity = mode === "visual" ? "1" : ".52";
    if (mode === "source") sourceEditor.value = sanitizeHtml(editor.innerHTML);
    if (mode === "preview") updatePreview();
    $("editorHint").textContent = mode === "visual"
      ? "💡 Совет: скопируй оформленный ответ ChatGPT и вставь его с помощью Ctrl+V."
      : mode === "source"
        ? "Безопасность: разрешены текстовые теги, ссылки, таблицы и выравнивание; скрипты удаляются."
        : "Так урок будет выглядеть при публикации в HTML.";
    updateCount();
  }
  const previewCss = 'body{font:15px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#354158;max-width:780px;margin:30px auto;padding:0 26px;overflow-wrap:anywhere}h1,h2,h3{color:#263149;line-height:1.3}h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}p{margin:0 0 15px}a{color:#6355df}li{margin-bottom:7px}blockquote{border-left:4px solid #8575f1;background:#f6f5ff;margin:18px 0;padding:12px 19px}pre{padding:18px;background:#222a3d;color:#f4f6ff;border-radius:10px;white-space:pre-wrap;overflow-x:auto}code{font:13px Consolas,monospace;background:#eff0fb;padding:2px 5px;border-radius:4px}pre code{background:none;padding:0;color:inherit}table{width:100%;border-collapse:collapse}td,th{padding:8px 10px;border:1px solid #dce1ea;text-align:left}th{background:#f6f7fb}hr{border:0;border-top:1px solid #ddd}';
  function standaloneHtml() {
    const title = lessonTitle.value.trim() || "Урок";
    const html = currentHtml();
    return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + escapeHtml(title) + '</title>\n<style>' + previewCss + '</style>\n</head>\n<body>\n' + html + '\n</body>\n</html>';
  }
  function updatePreview() {
    previewFrame.srcdoc = standaloneHtml();
  }

  function captureSelection() {
    if (mode !== "visual") return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
  }
  function restoreSelection() {
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
  }
  function runCommand(command, value) {
    if (mode !== "visual") return;
    restoreSelection();
    document.execCommand(command, false, value || null);
    captureSelection();
    markDirty();
  }
  function insertHtml(html) {
    restoreSelection();
    document.execCommand("insertHTML", false, sanitizeHtml(html));
    captureSelection();
    markDirty();
  }
  function specialAction(action) {
    if (mode !== "visual") return;
    restoreSelection();
    const selection = window.getSelection();
    const text = selection && selection.rangeCount ? selection.toString() : "";
    if (action === "inlineCode") {
      insertHtml("<code>" + escapeHtml(text || "код") + "</code>");
    } else if (action === "quote") {
      runCommand("formatBlock", "blockquote");
    } else if (action === "codeBlock") {
      insertHtml("<pre><code>" + escapeHtml(text || "Введите код...") + "</code></pre><p></p>");
    } else if (action === "link") {
      const raw = window.prompt("Адрес ссылки (https://...):", "https://");
      if (raw === null) return;
      const url = safeLink(raw);
      if (!url) { toast("Разрешены ссылки http, https, mailto или внутренние ссылки."); return; }
      restoreSelection();
      if (text.trim()) document.execCommand("createLink", false, url);
      else insertHtml('<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + "</a>");
      markDirty();
    }
  }
  function setToolbarState() {
    if (mode !== "visual") return;
    ["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList"].forEach((command) => {
      const button = formatbar.querySelector('[data-command="' + command + '"]');
      if (button) button.classList.toggle("active", document.queryCommandState(command));
    });
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    let node = selection.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== editor) {
      if (["P", "H1", "H2", "H3"].includes(node.nodeName)) {
        $("blockType").value = node.nodeName.toLowerCase();
        return;
      }
      node = node.parentNode;
    }
    $("blockType").value = "p";
  }

  function download(content, fileName, mime) {
    const blob = new Blob([content], { type: mime });
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  function safeFilename(text) {
    return (text || "urok").trim().toLowerCase().replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, "-").slice(0, 60) || "urok";
  }
  async function copyRich() {
    const html = currentHtml();
    const textDoc = new DOMParser().parseFromString(html, "text/html");
    const plain = textDoc.body.textContent || "";
    try {
      if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === "undefined") throw new Error("rich clipboard unavailable");
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" })
      });
      await navigator.clipboard.write([item]);
      toast("Оформленный текст скопирован — вставь его в редактор Stepik.");
    } catch (_) {
      const helper = document.createElement("div");
      helper.contentEditable = "true";
      helper.innerHTML = html;
      helper.style.cssText = "position:fixed;left:-10000px;top:0;width:500px";
      document.body.appendChild(helper);
      const selection = window.getSelection();
      const oldRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const range = document.createRange();
      range.selectNodeContents(helper);
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
      const copied = document.execCommand("copy");
      helper.remove();
      if (selection) {
        selection.removeAllRanges();
        if (oldRange) selection.addRange(oldRange);
      }
      toast(copied ? "Оформленный текст скопирован." : "В этом браузере недоступно копирование форматирования.");
    }
  }

  async function copyHtml() {
    const html = currentHtml();
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(html);
      toast("HTML-код скопирован.");
    } catch (_) {
      const temp = document.createElement("textarea");
      temp.value = html;
      temp.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(temp);
      temp.select();
      const copied = document.execCommand("copy");
      temp.remove();
      toast(copied ? "HTML-код скопирован." : "Копирование недоступно: используй вкладку HTML.");
    }
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { toast("Файл слишком большой (лимит 3 МБ)."); return; }
    try {
      const content = await file.text();
      if (/\.json$/i.test(file.name)) {
        const imported = validateProject(JSON.parse(content));
        if (!imported) throw new Error("Некорректный формат проекта.");
        if (!window.confirm("Импорт JSON заменит текущие уроки. Продолжить?")) return;
        project = imported;
      } else if (/\.html?$/i.test(file.name)) {
        saveNow();
        const title = file.name.replace(/\.html?$/i, "").slice(0, 160) || "Импортированный урок";
        const importedHtml = sanitizeHtml(content);
        project.lessons.push({ id: makeId(), title: title, html: importedHtml });
        project.activeId = project.lessons[project.lessons.length - 1].id;
      } else {
        throw new Error("Поддерживаются только .html и .json.");
      }
      $("markdownToggle").checked = project.markdown;
      setMode("visual");
      mountLesson();
      saveNow();
      toast("Импорт выполнен успешно.");
    } catch (error) {
      toast("Ошибка импорта: " + error.message);
    }
  }

  // Rich HTML clipboard is preferred; Markdown is a fallback for "Copy" buttons
  // that expose only text/plain.
  editor.addEventListener("paste", (event) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const rich = clipboard.getData("text/html");
    const plain = clipboard.getData("text/plain");
    if (!rich && !plain) return;
    event.preventDefault();
    const html = rich
      ? sanitizeHtml(rich)
      : $("markdownToggle").checked
        ? markdownToHtml(plain)
        : plain.split(/\n\n+/).map((part) => "<p>" + escapeHtml(part).replace(/\n/g, "<br>") + "</p>").join("");
    insertHtml(html);
    toast(rich ? "HTML-разметка из буфера вставлена." : $("markdownToggle").checked ? "Текст вставлен, Markdown преобразован." : "Текст вставлен без форматирования.");
  });
  editor.addEventListener("input", markDirty);
  sourceEditor.addEventListener("input", markDirty);
  lessonTitle.addEventListener("input", () => {
    selectedLesson().title = lessonTitle.value.trim() || "Без названия";
    renderLessons();
    markDirty();
  });
  editor.addEventListener("keyup", () => { captureSelection(); setToolbarState(); });
  editor.addEventListener("mouseup", () => { captureSelection(); setToolbarState(); });
  document.addEventListener("selectionchange", () => {
    if (mode === "visual") { captureSelection(); setToolbarState(); }
  });
  formatbar.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  formatbar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.command) runCommand(button.dataset.command);
    else if (button.dataset.action) specialAction(button.dataset.action);
    setToolbarState();
  });
  $("blockType").addEventListener("change", (event) => {
    runCommand("formatBlock", event.target.value);
  });
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      saveNow();
      setMode(tab.dataset.mode);
    });
  });
  $("addLesson").addEventListener("click", () => {
    saveNow();
    const lesson = { id: makeId(), title: "Новый урок", html: "<h2>Название раздела</h2><p>Начните писать или вставьте текст из ChatGPT.</p>" };
    project.lessons.push(lesson);
    project.activeId = lesson.id;
    setMode("visual");
    mountLesson();
    saveNow();
    lessonTitle.focus();
    lessonTitle.select();
  });
  $("markdownToggle").addEventListener("change", saveNow);
  $("menuToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("copyRich").addEventListener("click", copyRich);
  $("copyHtml").addEventListener("click", copyHtml);
  $("exportHtml").addEventListener("click", () => {
    saveNow();
    download(standaloneHtml(), safeFilename(selectedLesson().title) + ".html", "text/html;charset=utf-8");
    toast("HTML-файл урока скачан.");
  });
  $("exportJson").addEventListener("click", () => {
    saveNow();
    const backup = { ...project, exportedAt: new Date().toISOString() };
    download(JSON.stringify(backup, null, 2), "kursograf-project.json", "application/json;charset=utf-8");
    toast("Резервная копия проекта скачана.");
  });
  $("importButton").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", async (event) => {
    await importFile(event.target.files[0]);
    event.target.value = "";
  });
  window.addEventListener("beforeunload", () => { if (saveTimer) saveNow(); });
  $("markdownToggle").checked = project.markdown;
  mountLesson();
  setMode("visual");
})();
