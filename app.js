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
  let sourceSnapshot = null;
  let pendingInlineCode = false;
  let plainTypingNode = null;
  let editingLink = null;
  let linkRange = null;
  let activeCodeBlock = null;
  let codeInsertionRange = null;
  let selectedImage = null;
  let imageInsertRange = null;
  const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

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
    "figure", "figcaption", "img", "font"
  ]);
  const DROP_TAGS = new Set([
    "script", "style", "iframe", "object", "embed", "svg", "math", "form",
    "input", "textarea", "select", "button", "link", "meta", "base", "video",
    "audio", "canvas", "template", "noscript"
  ]);
  const ALIGN_TAGS = new Set(["div", "p", "h1", "h2", "h3", "h4", "blockquote", "td", "th", "figure"]);
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


  function colorHex(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
    if (/^#[0-9a-f]{3}$/.test(raw)) return "#" + [...raw.slice(1)].map((x) => x+x).join("");
    const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*1(?:\.0+)?)?\s*\)$/);
    if (rgb) {
      const parts = rgb.slice(1).map(Number);
      if (parts.every((x) => x >= 0 && x <= 255)) return "#" + parts.map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    return "";
  }
  function safeImageUrl(raw) {
    const src = String(raw || "").trim();
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(src) && src.length < 2_500_000) return src;
    try {
      const parsed = new URL(src);
      if (parsed.protocol === "https:") return src;
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

      const clean = document.createElement(tag === "font" ? "span" : tag);
      if (ALIGN_TAGS.has(tag)) {
        let align = (from.getAttribute("align") || "").toLowerCase().trim();
        const inlineStyle = from.getAttribute("style") || "";
        const match = inlineStyle.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center|justify)\s*(?:;|$)/i);
        if (match) align = match[1].toLowerCase();
        if (SAFE_ALIGN.has(align)) clean.style.textAlign = align;
      }
      // Only allow validated text colors, never arbitrary pasted CSS.
      if (tag === "font" || tag === "span" || ALIGN_TAGS.has(tag) || tag === "li") {
        const style = from.getAttribute("style") || "";
        const match = style.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6}|rgba?\([^)]*\))\s*(?:;|$)/i);
        const color = colorHex((match && match[1]) || (tag === "font" ? from.getAttribute("color") : ""));
        if (color) clean.style.color = color;
      }
      if (tag === "figure") {
        clean.className = "lesson-image";
      }
      if (tag === "img") {
        const src = safeImageUrl(from.getAttribute("src"));
        if (!src) return;
        clean.setAttribute("src", src);
        clean.setAttribute("alt", (from.getAttribute("alt") || "Иллюстрация урока").slice(0, 200));
        const rawWidth = parseInt(from.getAttribute("width") || "", 10);
        if (Number.isFinite(rawWidth) && rawWidth >= 40 && rawWidth <= 2000) clean.setAttribute("width", String(rawWidth));
        into.appendChild(clean);
        return;
      }
      if (tag === "pre") {
        const language = (from.getAttribute("data-language") || from.getAttribute("data-lang") || "").trim().toLowerCase();
        clean.setAttribute("data-language", language === "none" ? "none" : "gdscript");
        const plainCode = document.createElement("code");
        plainCode.textContent = from.textContent || "";
        clean.appendChild(plainCode);
        into.appendChild(clean);
        return;
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

  // Pretty-print element structure without changing meaningful inline spaces
  // or the exact indentation and line breaks inside <pre><code>.
  const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "ul", "ol",
    "li", "blockquote", "pre", "table", "thead", "tbody", "tfoot", "tr",
    "td", "th", "figure", "figcaption", "hr", "img"]);
  function prettyHtml(html) {
    const tree = new DOMParser().parseFromString(sanitizeHtml(html), "text/html");
    const indent = (level) => "  ".repeat(level);
    const serialize = (node, level) => {
      if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.localName.toLowerCase();
      const attrs = Array.from(node.attributes)
        .map((attribute) => " " + attribute.name + '="' + escapeHtml(attribute.value) + '"').join("");
      const open = "<" + tag + attrs + ">";
      if (tag === "hr" || tag === "br" || tag === "img") return open;
      // Code whitespace must be reproduced byte-for-byte as text content.
      if (tag === "pre") return open + Array.from(node.childNodes).map((child) => serialize(child, level + 1)).join("") + "</pre>";
      const children = Array.from(node.childNodes);
      const hasBlockChildren = children.some((child) => child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(child.localName.toLowerCase()));
      if (!hasBlockChildren) return open + children.map((child) => serialize(child, level + 1)).join("") + "</" + tag + ">";
      const lines = children.filter((child) => !(child.nodeType === Node.TEXT_NODE && !child.textContent.trim()))
        .map((child) => indent(level + 1) + serialize(child, level + 1));
      return open + (lines.length ? "\n" + lines.join("\n") + "\n" + indent(level) : "") + "</" + tag + ">";
    };
    return Array.from(tree.body.childNodes)
      .filter((node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim())
      .map((node) => serialize(node, 0)).join("\n");
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

  // Display-only highlighting. Source and saved HTML always contain plain code text.
  const GD_TOKENS = /#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:func|static|if|elif|else|for|while|in|match|when|extends|class_name|class|return|break|continue|pass|var|const|enum|signal|await|yield|is|as|and|or|not|set|get|self|super|preload|load|export|onready)\b|\b(?:true|false|null|void|PI|TAU|INF|NAN)\b|\b(?:print|push_error|push_warning|assert|len|range|str|int|float|bool|Vector2|Vector3|Node|Node2D|CharacterBody2D|Sprite2D|Array|Dictionary)\b|\b\d+(?:\.\d+)?\b/g;
  function highlightCode(value, language) {
    if (language === "none") return escapeHtml(value);
    let html = "", last = 0;
    for (const m of value.matchAll(GD_TOKENS)) {
      html += escapeHtml(value.slice(last, m.index));
      const token = m[0];
      const kind = token[0] === "#" ? "comment"
        : token[0] === '"' || token[0] === "'" ? "string"
        : /^\d/.test(token) ? "number"
        : /^(true|false|null|void|PI|TAU|INF|NAN)$/.test(token) ? "constant"
        : /^(print|push_error|push_warning|assert|len|range|str|int|float|bool|Vector2|Vector3|Node|Node2D|CharacterBody2D|Sprite2D|Array|Dictionary)$/.test(token) ? "function"
        : "keyword";
      html += '<span class="code-token-' + kind + '">' + escapeHtml(token) + '</span>';
      last = m.index + token.length;
    }
    return html + escapeHtml(value.slice(last));
  }
  function prepareCodeBlocks(root, locked = true) {
    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.dataset.codePrepared === "yes") return;
      const source = pre.textContent || "";
      const language = pre.getAttribute("data-language") === "none" ? "none" : "gdscript";
      pre.setAttribute("data-language", language);
      const code = document.createElement("code");
      code.innerHTML = highlightCode(source, language);
      pre.replaceChildren(code);
      if (locked) {
        pre.contentEditable = "false";
        pre.title = "Двойной щелчок для редактирования кода";
      }
      pre.dataset.codePrepared = "yes";
    });
  }
  function selectionTouchesCode(range = editorRange()) {
    if (!range) return false;
    return Array.from(editor.querySelectorAll("pre")).some((pre) =>
      pre.contains(range.startContainer) || pre.contains(range.endContainer)
      || (!range.collapsed && range.intersectsNode(pre)));
  }
  // The GitHub Pages HTML and JS files can be cached independently. If a
  // visitor still has the previous dialog markup, upgrade it in place instead
  // of letting a missing highlight layer prevent the dialog from opening.
  function ensureCodeHighlightLayer() {
    let display = $("codeHighlight");
    const input = $("codeTextarea");
    if (!input) return null;
    if (!display) {
      let shell = input.parentElement;
      if (!shell.classList.contains("code-input-shell")) {
        shell = document.createElement("div");
        shell.className = "code-input-shell";
        input.before(shell);
        shell.appendChild(input);
      }
      display = document.createElement("pre");
      display.id = "codeHighlight";
      display.className = "code-highlight";
      display.setAttribute("aria-hidden", "true");
      display.appendChild(document.createElement("code"));
      shell.insertBefore(display, input);
      const oldPreview = $("codePreview");
      if (oldPreview) {
        const heading = oldPreview.previousElementSibling;
        if (heading && heading.classList.contains("code-preview-title")) heading.remove();
        oldPreview.remove();
      }
    }
    if (!display.querySelector("code")) display.appendChild(document.createElement("code"));
    return display;
  }
  function syncCodeHighlightScroll() {
    const input = $("codeTextarea");
    const display = ensureCodeHighlightLayer();
    if (!input || !display) return;
    display.scrollTop = input.scrollTop;
    display.scrollLeft = input.scrollLeft;
  }
  function refreshCodeHighlight() {
    const input = $("codeTextarea");
    const content = input.value;
    // A nonbreaking visual terminator keeps the last blank line visible,
    // without changing the actual source saved in the textarea.
    const display = ensureCodeHighlightLayer();
    if (!display) return;
    display.querySelector("code").innerHTML =
      highlightCode(content, $("codeLanguage").value) + (content.endsWith("\n") ? " " : "");
    syncCodeHighlightScroll();
  }
  function openCodeDialog(pre = null) {
    if (mode !== "visual") return;
    const range = editorRange();
    activeCodeBlock = pre && editor.contains(pre) ? pre : null;
    codeInsertionRange = activeCodeBlock ? null : (range && !selectionTouchesCode(range) ? range.cloneRange() : null);
    $("codeDialogTitle").textContent = activeCodeBlock ? "Редактировать многострочный код" : "Добавить многострочный код";
    $("codeTextarea").value = activeCodeBlock ? activeCodeBlock.textContent : "";
    $("codeLanguage").value = activeCodeBlock?.getAttribute("data-language") === "none" ? "none" : "gdscript";
    const dialog = $("codeDialog");
    if (!dialog.open) dialog.showModal();
    // Show the editor first: a cached/stale highlighting container must never
    // block double-click editing. The renderer upgrades old markup as needed.
    refreshCodeHighlight();
    $("codeTextarea").focus();
  }
  function closeCodeDialog() {
    $("codeDialog").close();
    activeCodeBlock = null;
    codeInsertionRange = null;
    editor.focus();
  }
  function applyCodeDialog(event) {
    event.preventDefault();
    const value = $("codeTextarea").value.replace(/\r\n?/g, "\n");
    const language = $("codeLanguage").value === "none" ? "none" : "gdscript";
    const target = activeCodeBlock && activeCodeBlock.isConnected ? activeCodeBlock : null;
    const selectionRange = codeInsertionRange?.cloneRange() || null;
    closeCodeDialog();
    if (target) {
      target.setAttribute("data-language", language);
      target.removeAttribute("data-code-prepared");
      target.textContent = value;
      prepareCodeBlocks(editor);
      afterFormatting();
    } else {
      if (selectionRange) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(selectionRange);
        savedRange = selectionRange;
      }
      insertHtml('<pre data-language="' + language + '"><code>' + escapeHtml(value) + '</code></pre><p></p>');
      prepareCodeBlocks(editor);
      setToolbarState();
    }
  }
  function onCodeKeydown(event) {
    if (event.isComposing || !["Enter", "Tab", "Backspace"].includes(event.key)) return;
    const field = event.currentTarget;
    const value = field.value, start = field.selectionStart, end = field.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;

    if (event.key === "Backspace") {
      // One Backspace removes a whole indentation unit only while the caret
      // sits in leading whitespace. Backspace within source text is native.
      if (start !== end || start <= lineStart) return;
      const leading = value.slice(lineStart, start);
      if (!/^[ \t]+$/.test(leading)) return;
      const remove = leading.endsWith("\t")
        ? 1 : Math.min(4, (leading.match(/ +$/) || [""])[0].length);
      if (!remove) return;
      event.preventDefault();
      field.setRangeText("", start - remove, start, "start");
    } else if (event.key === "Enter") {
      event.preventDefault();
      const line = value.slice(lineStart, start);
      const indent = (line.match(/^[ \t]*/) || [""])[0];
      const text = line.replace(/#.*$/, "").trimEnd();
      const extra = $("codeLanguage").value === "gdscript" && text.endsWith(":") ? "\t" : "";
      field.setRangeText("\n" + indent + extra, start, end, "end");
    } else {
      event.preventDefault();
      if (start === end) {
        if (event.shiftKey) {
          const preceding = value.slice(lineStart, start);
          if (preceding.endsWith("\t")) {
            field.setRangeText("", start - 1, start, "start");
          } else if (/^[ ]+$/.test(preceding)) {
            const width = Math.min(4, preceding.length);
            field.setRangeText("", start - width, start, "start");
          }
        } else {
          field.setRangeText("\t", start, end, "end");
        }
      } else {
        const affected = value.slice(lineStart, end);
        const changed = affected.split("\n").map((line) => event.shiftKey
          ? line.replace(/^\t|^ {1,4}/, "")
          : "\t" + line).join("\n");
        field.setRangeText(changed, lineStart, end, "select");
      }
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
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
    if (mode === "visual") prepareCodeBlocks(editor);
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
    prepareCodeBlocks(editor);
    sourceEditor.value = prettyHtml(lesson.html);
    sourceSnapshot = sanitizeHtml(lesson.html);
    pendingInlineCode = false;
    savedRange = null;
    pendingInlineCode = false;
    plainTypingNode = null;
    updateCount();
    renderLessons();
    setToolbarState();
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
      if (mode === "source") {
        editor.innerHTML = sanitizeHtml(sourceEditor.value);
        prepareCodeBlocks(editor);
        sourceSnapshot = sanitizeHtml(editor.innerHTML);
      }
      if (next === "source") {
        const html = sanitizeHtml(editor.innerHTML);
        // Leave manually entered line breaks and indentation untouched if
        // the lesson hasn't changed in the visual editor.
        if (html !== sourceSnapshot) sourceEditor.value = prettyHtml(html);
        sourceSnapshot = html;
      }
      pendingInlineCode = false;
      plainTypingNode = null;
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
    if (mode === "preview") updatePreview();
    $("editorHint").textContent = mode === "visual"
      ? "💡 Совет: скопируй оформленный ответ ChatGPT и вставь его с помощью Ctrl+V."
      : mode === "source"
        ? "Безопасность: разрешены текстовые теги, ссылки, таблицы и выравнивание; скрипты удаляются."
        : "Так урок будет выглядеть при публикации в HTML.";
    updateCount();
    setToolbarState();
  }
  const previewCss = 'body{font:15px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#354158;max-width:780px;margin:30px auto;padding:0 26px;overflow-wrap:anywhere}h1,h2,h3{color:#263149;line-height:1.3}h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}p{margin:0 0 15px}a{color:#6355df}li{margin-bottom:7px}blockquote{border-left:4px solid #8575f1;background:#f6f5ff;margin:18px 0;padding:12px 19px}pre{padding:18px;background:#222a3d;color:#f4f6ff;border-radius:10px;white-space:pre-wrap;overflow-x:auto}code{font:13px Consolas,monospace;background:#eff0fb;padding:2px 5px;border-radius:4px}pre code{background:none;padding:0;color:inherit}table{width:100%;border-collapse:collapse}td,th{padding:8px 10px;border:1px solid #dce1ea;text-align:left}th{background:#f6f7fb}hr{border:0;border-top:1px solid #ddd}.code-token-keyword{color:#c8a4ff}.code-token-string{color:#a6e3ad}.code-token-number{color:#ffce83}.code-token-comment{color:#8694ac}.code-token-constant{color:#8ed8ff}.code-token-function{color:#89c9f9}';
  function standaloneHtml() {
    const title = lessonTitle.value.trim() || "Урок";
    const html = prettyHtml(currentHtml());
    const rendered = document.createElement("div");
    rendered.innerHTML = html;
    prepareCodeBlocks(rendered, false);
    return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + escapeHtml(title) + '</title>\n<style>' + previewCss + '</style>\n</head>\n<body>\n' + rendered.innerHTML + '\n</body>\n</html>';
  }
  function updatePreview() {
    previewFrame.srcdoc = standaloneHtml();
  }

  // Keep the last editor selection while the user operates the toolbar.
  // A single cursor and a highlighted fragment are both formatting contexts.
  function editorRange() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) return range.cloneRange();
    }
    return savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange.cloneRange() : null;
  }
  function captureSelection() {
    if (mode !== "visual") return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
  }
  function restoreSelection() {
    const range = editorRange();
    editor.focus();
    if (!range) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function ancestor(node, selector) {
    let element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    while (element && element !== editor) {
      if (element.matches(selector)) return element;
      element = element.parentElement;
    }
    return null;
  }
  function selectedTextNodes(range) {
    if (range.collapsed) return [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const result = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent && node.textContent.trim() && range.intersectsNode(node)) {
        result.push(node);
      }
    }
    return result;
  }
  function hasFormatting(range, selector) {
    if (!range) return false;
    const textNodes = selectedTextNodes(range);
    if (textNodes.length) return textNodes.every((node) => !!ancestor(node, selector));
    return !!ancestor(range.startContainer, selector);
  }
  function blockAlignment(node) {
    const block = ancestor(node, 'p,div,h1,h2,h3,h4,blockquote,li,td,th,pre');
    if (!block) return "left";
    // Computed style includes inherited alignment from surrounding divs,
    // which is common in HTML pasted from ChatGPT and other rich editors.
    const alignment = window.getComputedStyle(block).textAlign.toLowerCase();
    if (alignment === "center" || alignment === "right" || alignment === "justify") return alignment;
    return "left";
  }
  function selectionAlignment(range) {
    if (!range) return "";
    const nodes = selectedTextNodes(range);
    const values = (nodes.length ? nodes : [range.startContainer]).map(blockAlignment);
    return values.every((value) => value === values[0]) ? values[0] : "";
  }
  function currentBlockType(range) {
    if (!range) return "p";
    const nodes = selectedTextNodes(range);
    const blocks = (nodes.length ? nodes : [range.startContainer])
      .map((node) => ancestor(node, "h1,h2,h3")?.localName || "p");
    return blocks.every((value) => value === blocks[0]) ? blocks[0] : "p";
  }
  function queryActiveStates() {
    const range = editorRange();
    if (mode !== "visual") return {};
    if (!range) return { inlineCode: pendingInlineCode };
    const alignment = selectionAlignment(range);
    const state = {
      bold: hasFormatting(range, "b,strong"),
      italic: hasFormatting(range, "i,em"),
      underline: hasFormatting(range, "u"),
      justifyLeft: alignment === "left",
      justifyCenter: alignment === "center",
      justifyRight: alignment === "right",
      insertUnorderedList: hasFormatting(range, "ul"),
      insertOrderedList: hasFormatting(range, "ol"),
      inlineCode: pendingInlineCode || (hasFormatting(range, "code") && !hasFormatting(range, "pre")),
      codeBlock: hasFormatting(range, "pre"),
      quote: hasFormatting(range, "blockquote"),
      link: hasFormatting(range, "a[href]")
    };
    // execCommand may hold a pending inline style at an empty caret.
    if (range.collapsed && window.getSelection()?.rangeCount) {
      ["bold", "italic", "underline"].forEach((command) => {
        try { state[command] ||= !!document.queryCommandState(command); } catch (_) { /* browser-specific */ }
      });
    }
    return state;
  }
  function setToolbarState() {
    const range = mode === "visual" ? editorRange() : null;
    const codeProtected = mode === "visual" && selectionTouchesCode(range);
    formatbar.querySelectorAll("button,select").forEach((control) => {
      control.disabled = mode !== "visual" || codeProtected;
    });
    const states = queryActiveStates();
    formatbar.querySelectorAll("button").forEach((button) => {
      const key = button.dataset.command || button.dataset.action;
      if (!key) return;
      const active = !!states[key];
      button.classList.toggle("active", active);
      if (["bold", "italic", "underline", "justifyLeft", "justifyCenter",
        "justifyRight", "insertUnorderedList", "insertOrderedList",
        "quote", "codeBlock", "inlineCode", "link"].includes(key)) {
        button.setAttribute("aria-pressed", String(active));
      }
    });
    $("blockType").value = currentBlockType(range);
  }
  function afterFormatting() {
    captureSelection();
    markDirty();
    setToolbarState();
  }
  function runCommand(command, value) {
    if (mode !== "visual" || selectionTouchesCode()) return;
    restoreSelection();
    const state = queryActiveStates();
    const inlineSelectors = { bold: "b,strong", italic: "i,em", underline: "u" };
    if (inlineSelectors[command] && state[command]
      && hasFormatting(editorRange(), inlineSelectors[command])) {
      // Native execCommand at a collapsed caret only toggles future typing.
      // Unwrap the currently formatted run instead, preserving surrounding styles.
      removeInlineFromSelection(inlineSelectors[command]);
      return;
    }
    // Clicking the current alignment resets the block to normal left alignment.
    if (["justifyCenter", "justifyRight"].includes(command) && state[command]) {
      document.execCommand("justifyLeft", false, null);
    } else {
      document.execCommand(command, false, value || null);
    }
    afterFormatting();
  }
  function insertHtml(html) {
    if (selectionTouchesCode()) return;
    restoreSelection();
    document.execCommand("insertHTML", false, sanitizeHtml(html));
    afterFormatting();
  }

  // Insert temporary zero-width marker elements and restore the exact selection
  // afterwards. This makes it possible to unwrap selected inline formatting
  // without stripping the other tags or losing the selection.
  let changingSelection = false;
  function withSelectionMarkers(transform) {
    restoreSelection();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const initial = selection.getRangeAt(0).cloneRange();
    if (!editor.contains(initial.commonAncestorContainer)) return;
    changingSelection = true;
    const collapsed = initial.collapsed;
    const makeMarker = () => {
      const marker = document.createElement("span");
      marker.setAttribute("data-editor-selection-marker", "");
      marker.setAttribute("aria-hidden", "true");
      return marker;
    };
    const start = makeMarker();
    const end = collapsed ? null : makeMarker();
    try {
      if (end) {
        const atEnd = initial.cloneRange();
        atEnd.collapse(false);
        atEnd.insertNode(end);
      }
      const atStart = initial.cloneRange();
      atStart.collapse(true);
      atStart.insertNode(start);
      transform(start, end);
    } finally {
      if (start.isConnected) {
        const next = document.createRange();
        next.setStartAfter(start);
        if (end && end.isConnected) next.setEndBefore(end);
        else next.collapse(true);
        if (end) end.remove();
        start.remove();
        selection.removeAllRanges();
        selection.addRange(next);
      } else if (end && end.isConnected) {
        end.remove();
      }
      changingSelection = false;
      afterFormatting();
    }
  }
  function unwrapElement(element) {
    element.replaceWith(...Array.from(element.childNodes));
  }
  function liftMarkerOutOf(marker, selector) {
    let wrapper;
    while ((wrapper = ancestor(marker, selector))) {
      const tailRange = document.createRange();
      tailRange.selectNodeContents(wrapper);
      tailRange.setStartAfter(marker);
      const tail = tailRange.extractContents();
      const remainder = wrapper.cloneNode(false);
      remainder.appendChild(tail);
      wrapper.after(marker, remainder);
      if (!wrapper.hasChildNodes()) wrapper.remove();
      if (!remainder.hasChildNodes()) remainder.remove();
    }
  }
  function removeInlineFromSelection(selector) {
    const range = editorRange();
    if (!range) return;
    withSelectionMarkers((start, end) => {
      if (!end) {
        const wrapper = ancestor(start, selector);
        if (wrapper) unwrapElement(wrapper);
        return;
      }
      liftMarkerOutOf(start, selector);
      liftMarkerOutOf(end, selector);
      const between = document.createRange();
      between.setStartAfter(start);
      between.setEndBefore(end);
      const wrappers = Array.from(editor.querySelectorAll(selector))
        .filter((element) => between.intersectsNode(element));
      wrappers.forEach((wrapper) => {
        if (wrapper.isConnected) unwrapElement(wrapper);
      });
    });
  }
  function addInlineCode() {
    const range = editorRange();
    if (!range) return;
    if (range.collapsed) {
      pendingInlineCode = true;
      setToolbarState();
      return;
    }
    const text = range.toString();
    if (!text.trim()) return;
    withSelectionMarkers((start, end) => {
      const selectedRange = document.createRange();
      selectedRange.setStartAfter(start);
      selectedRange.setEndBefore(end);
      const extracted = selectedRange.extractContents();
      // Inline code may not contain paragraph/list elements.
      if (Array.from(extracted.querySelectorAll("p,div,h1,h2,h3,ul,ol,li,pre,blockquote")).length) {
        start.after(document.createTextNode(text));
        toast("Для нескольких абзацев используй «Блок кода».");
        return;
      }
      const code = document.createElement("code");
      code.appendChild(extracted);
      start.after(code);
    });
  }
  function exitInlineCodeAtCaret() {
    // With only a caret (no selection), the user wants to remove inline-code
    // styling from the ENTIRE code run, not split it at the caret.
    // withSelectionMarkers preserves the caret position during unwrapping.
    pendingInlineCode = false;
    plainTypingNode = null;
    removeInlineFromSelection("code");
  }
  function insertPlainTextOutsideCode(text) {
    if (!plainTypingNode || !plainTypingNode.isConnected || !text) return false;
    const selection = window.getSelection();
    const offset = selection.anchorNode === plainTypingNode
      ? selection.anchorOffset : plainTypingNode.length;
    plainTypingNode.insertData(offset, text);
    const caret = document.createRange();
    caret.setStart(plainTypingNode, offset + text.length);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    afterFormatting();
    return true;
  }
  function insertPendingCodeText(text) {
    if (!text || !pendingInlineCode) return false;
    restoreSelection();
    const selection = window.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) return false;
    // execCommand("insertHTML") is rejected by some Chromium versions while
    // already handling beforeinput. Use the live Range for this first keystroke.
    range.deleteContents();
    const code = document.createElement("code");
    const textNode = document.createTextNode(text);
    code.appendChild(textNode);
    range.insertNode(code);
    const caret = document.createRange();
    caret.setStart(textNode, textNode.textContent.length);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    pendingInlineCode = false;
    afterFormatting();
    return true;
  }

  function openLinkDialog() {
    if (mode !== "visual") return;
    pendingInlineCode = false;
    restoreSelection();
    linkRange = editorRange();
    const selected = linkRange ? selectedTextNodes(linkRange) : [];
    editingLink = linkRange
      ? (ancestor(linkRange.startContainer, "a[href]") || (selected.length && ancestor(selected[0], "a[href]")) || null)
      : null;
    $("linkDialogTitle").textContent = editingLink ? "Изменить ссылку" : "Вставить ссылку";
    $("linkText").value = editingLink ? editingLink.textContent : (linkRange ? linkRange.toString() : "");
    $("linkUrl").value = editingLink ? (editingLink.getAttribute("href") || "") : "";
    $("linkRemove").hidden = !editingLink;
    $("linkHelp").classList.remove("error");
    $("linkHelp").textContent = "Разрешены HTTP, HTTPS, mailto и внутренние ссылки.";
    $("linkDialog").showModal();
    $("linkUrl").focus();
  }
  function closeLinkDialog() {
    $("linkDialog").close();
    editingLink = null;
    linkRange = null;
  }
  function applyLinkSelection() {
    if (!linkRange || !editor.contains(linkRange.commonAncestorContainer)) {
      editor.focus();
      return;
    }
    editor.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(linkRange.cloneRange());
    captureSelection();
  }
  function updateLink(event) {
    event.preventDefault();
    const value = $("linkUrl").value.trim();
    const url = safeLink(value);
    if (!url) {
      $("linkHelp").textContent = "Укажи безопасный адрес: https://, http://, mailto: или /путь.";
      $("linkHelp").classList.add("error");
      $("linkUrl").focus();
      return;
    }
    const text = $("linkText").value.trim();
    if (!text) {
      $("linkHelp").textContent = "Текст ссылки не может быть пустым.";
      $("linkHelp").classList.add("error");
      $("linkText").focus();
      return;
    }
    const target = editingLink && editingLink.isConnected ? editingLink : null;
    const originalRange = linkRange ? linkRange.cloneRange() : null;
    closeLinkDialog();
    if (target) {
      target.href = url;
      target.setAttribute("rel", "noopener noreferrer");
      target.setAttribute("target", "_blank");
      if (target.textContent !== text) target.textContent = text;
      editor.focus();
      const caret = document.createRange();
      caret.selectNodeContents(target);
      caret.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(caret);
      afterFormatting();
      toast("Ссылка обновлена.");
      return;
    }
    applySavedLinkRange(url, text, originalRange);
    toast("Ссылка создана.");
  }
  function applySavedLinkRange(url, text, originalRange) {
    // The dialog has already closed, so the saved editor Range is restored
    // before inserting new HTML in place of the highlighted fragment.
    linkRange = originalRange;
    applyLinkSelection();
    linkRange = null;
    insertHtml('<a href="' + escapeHtml(url) + '">' + escapeHtml(text) + '</a>');
  }
  function removeEditedLink() {
    if (!editingLink || !editingLink.isConnected) { closeLinkDialog(); return; }
    const target = editingLink;
    const content = Array.from(target.childNodes);
    closeLinkDialog();
    target.replaceWith(...content);
    editor.focus();
    const selection = window.getSelection();
    const caret = document.createRange();
    if (content.length) caret.setStartAfter(content[content.length - 1]);
    else { caret.selectNodeContents(editor); caret.collapse(false); }
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    afterFormatting();
    toast("Ссылка удалена, текст сохранён.");
  }

  function clearBlockquote(element) {
    const children = Array.from(element.childNodes);
    const hasBlocks = children.some((node) => node.nodeType === 1
      && /^(P|DIV|H1|H2|H3|UL|OL|PRE|BLOCKQUOTE)$/.test(node.nodeName));
    if (hasBlocks) unwrapElement(element);
    else {
      const paragraph = document.createElement("p");
      paragraph.append(...children);
      element.replaceWith(paragraph);
    }
  }
  function clearPre(element) {
    const paragraph = document.createElement("p");
    const appendTextLines = (value) => {
      value.split("\n").forEach((line, index) => {
        if (index) paragraph.appendChild(document.createElement("br"));
        if (line) paragraph.appendChild(document.createTextNode(line));
      });
    };
    const process = (node) => {
      if (node.nodeType === Node.TEXT_NODE) appendTextLines(node.textContent || "");
      else if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-editor-selection-marker")) paragraph.appendChild(node);
      else if (node.nodeType === Node.ELEMENT_NODE) Array.from(node.childNodes).forEach(process);
    };
    Array.from(element.childNodes).forEach(process);
    element.replaceWith(paragraph);
  }
  function removeBlockFormat(selector, clear) {
    withSelectionMarkers((start, end) => {
      const range = document.createRange();
      range.setStartAfter(start);
      if (end) range.setEndBefore(end);
      else range.collapse(true);
      const targets = Array.from(editor.querySelectorAll(selector))
        .filter((element) => !end
          ? element.contains(start)
          : (range.intersectsNode(element) || element.contains(start) || element.contains(end)));
      targets.forEach((element) => { if (element.isConnected) clear(element); });
    });
  }
  function specialAction(action) {
    if (mode !== "visual" || selectionTouchesCode()) return;
    restoreSelection();
    const states = queryActiveStates();
    const selection = window.getSelection();
    const selectedText = selection && selection.rangeCount ? selection.toString() : "";
    if (action === "inlineCode") {
      const range = editorRange();
      if (pendingInlineCode) {
        pendingInlineCode = false;
        setToolbarState();
      } else if (states.inlineCode) {
        if (range && range.collapsed) exitInlineCodeAtCaret();
        else removeInlineFromSelection("code");
      } else addInlineCode();
    } else if (action === "quote") {
      if (states.quote) removeBlockFormat("blockquote", clearBlockquote);
      else runCommand("formatBlock", "blockquote");
    } else if (action === "codeBlock") {
      openCodeDialog();
    } else if (action === "link") {
      openLinkDialog();
    }
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
  $("codeDialog").addEventListener("cancel", (event) => event.preventDefault());
  $("codeCancel").addEventListener("click", closeCodeDialog);
  $("codeForm").addEventListener("submit", applyCodeDialog);
  $("codeLanguage").addEventListener("change", refreshCodeHighlight);
  $("codeTextarea").addEventListener("input", refreshCodeHighlight);
  $("codeTextarea").addEventListener("scroll", syncCodeHighlightScroll);
  $("codeTextarea").addEventListener("keydown", onCodeKeydown);
  editor.addEventListener("dblclick", (event) => {
    const target = event.target;
    const element = target instanceof Element ? target : target?.parentElement;
    const pre = element?.closest("pre");
    if (!pre || !editor.contains(pre)) return;
    event.preventDefault();
    event.stopPropagation();
    openCodeDialog(pre);
  }, true);
  editor.addEventListener("cut", (event) => {
    if (selectionTouchesCode()) event.preventDefault();
  });
  editor.addEventListener("drop", (event) => {
    if (selectionTouchesCode()) event.preventDefault();
  });
  editor.addEventListener("beforeinput", (event) => {
    if (selectionTouchesCode()) { event.preventDefault(); return; }
    if (event.isComposing) return;
    if (event.inputType === "insertText" && event.data) {
      if (plainTypingNode && insertPlainTextOutsideCode(event.data)) {
        event.preventDefault();
        return;
      }
      if (pendingInlineCode && insertPendingCodeText(event.data)) event.preventDefault();
    }
  });
  editor.addEventListener("compositionend", () => {
    // Some IMEs insert text through composition rather than insertText.
    // Reconcile the pending-mode indicator with the actual caret position.
    if (pendingInlineCode) { pendingInlineCode = false; setToolbarState(); }
  });
  editor.addEventListener("keydown", (event) => {
    if (selectionTouchesCode() &&
      (event.key === "Backspace" || event.key === "Delete"
       || ((event.ctrlKey || event.metaKey) && /^[biuxv]$/i.test(event.key)))) {
      event.preventDefault();
      return;
    }
    if (pendingInlineCode && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","Escape","Enter"].includes(event.key)) {
      pendingInlineCode = false;
      plainTypingNode = null;
      setToolbarState();
    }
  });
  editor.addEventListener("click", () => {
    plainTypingNode = null;
    if (pendingInlineCode) { pendingInlineCode = false; setToolbarState(); }
  });
  $("linkForm").addEventListener("submit", updateLink);
  $("linkRemove").addEventListener("click", removeEditedLink);
  $("linkCancel").addEventListener("click", closeLinkDialog);
  $("linkCancelTop").addEventListener("click", closeLinkDialog);
  $("linkDialog").addEventListener("close", () => { editingLink = null; linkRange = null; });
  editor.addEventListener("paste", (event) => {
    if (selectionTouchesCode()) { event.preventDefault(); return; }
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
  editor.addEventListener("input", () => { markDirty(); setToolbarState(); });
  sourceEditor.addEventListener("input", markDirty);
  lessonTitle.addEventListener("input", () => {
    selectedLesson().title = lessonTitle.value.trim() || "Без названия";
    renderLessons();
    markDirty();
  });
  editor.addEventListener("keyup", () => { captureSelection(); setToolbarState(); });
  editor.addEventListener("mouseup", () => { captureSelection(); setToolbarState(); });
  document.addEventListener("selectionchange", () => {
    if (mode === "visual" && !changingSelection) { captureSelection(); setToolbarState(); }
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
