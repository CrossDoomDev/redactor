const { test, expect } = require("@playwright/test");

async function putSelection(page, html, selector, from = 0, to = from) {
  await page.evaluate(({ html, selector, from, to }) => {
    const editor = document.getElementById("editor");
    editor.innerHTML = html;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
    const target = editor.querySelector(selector);
    if (!target) throw new Error("Cannot select missing element: " + selector);
    const walk = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const node = walk.nextNode();
    if (!node) throw new Error("Target has no text: " + selector);
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { html, selector, from, to });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("bold at cursor is highlighted and clicking removes current bold run", async ({ page }) => {
  await putSelection(page, "<p>Начало <strong>жирный текст</strong> конец</p>", "strong", 3);
  await expect(page.locator('[data-command="bold"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-command="bold"]').click();
  await expect(page.locator('[data-command="bold"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#editor strong")).toHaveCount(0);
  await expect(page.locator("#editor")).toContainText("жирный текст");
});

test("selected portion of bold text is unwrapped without removing styles outside", async ({ page }) => {
  await putSelection(page, "<p><strong>abcdef</strong></p>", "strong", 2, 4);
  await expect(page.locator('[data-command="bold"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-command="bold"]').click();
  await expect(page.locator("#editor")).toContainText("abcdef");
  await expect(page.locator("#editor strong")).toHaveCount(2);
  await expect(page.locator("#editor")).toContainText("cd");
});

test("italic and underline at cursor are independently switchable", async ({ page }) => {
  await putSelection(page, "<p><em><u>пример</u></em></p>", "u", 2);
  await expect(page.locator('[data-command="italic"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-command="underline"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-command="underline"]').click();
  await expect(page.locator("#editor u")).toHaveCount(0);
  await expect(page.locator("#editor em")).toHaveCount(1);
  await page.locator('[data-command="italic"]').click();
  await expect(page.locator("#editor em")).toHaveCount(0);
});

test("quote button is active inside a quote and toggles it off without nesting", async ({ page }) => {
  await putSelection(page, "<blockquote><p>Важная цитата</p></blockquote>", "blockquote p", 4);
  const quoteButton = page.locator('[data-action="quote"]');
  await expect(quoteButton).toHaveAttribute("aria-pressed", "true");
  await quoteButton.click();
  await expect(page.locator("#editor blockquote")).toHaveCount(0);
  await expect(page.locator("#editor")).toContainText("Важная цитата");
  await expect(quoteButton).toHaveAttribute("aria-pressed", "false");
});

test("existing link opens populated dialog; editing and removal preserve text", async ({ page }) => {
  await putSelection(page, '<p>Откройте <a href="https://godotengine.org">документацию</a>.</p>', "a", 3);
  const link = page.locator('[data-action="link"]');
  await expect(link).toHaveAttribute("aria-pressed", "true");
  await link.click();
  await expect(page.locator("#linkDialog")).toBeVisible();
  await expect(page.locator("#editor a")).toHaveCount(1);
  await expect(page.locator("#linkText")).toHaveValue("документацию");
  await expect(page.locator("#linkUrl")).toHaveValue("https://godotengine.org");
  await page.locator("#linkUrl").fill("https://docs.godotengine.org/");
  await page.locator("#linkApply").click();
  await expect(page.locator("#editor a")).toHaveAttribute("href", "https://docs.godotengine.org/");
  await putSelection(page, '<p>Откройте <a href="https://docs.godotengine.org/">документацию</a>.</p>', "a", 3);
  await link.click();
  await page.locator("#linkRemove").click();
  await expect(page.locator("#editor a")).toHaveCount(0);
  await expect(page.locator("#editor")).toContainText("документацию");
  await expect(link).toHaveAttribute("aria-pressed", "false");
});

test("create link to selected text and cancel never removes existing link", async ({ page }) => {
  await putSelection(page, "<p>Сайт Godot полезен</p>", "p", 5, 10);
  await page.locator('[data-action="link"]').click();
  await expect(page.locator("#linkText")).toHaveValue("Godot");
  await page.locator("#linkUrl").fill("https://godotengine.org/");
  await page.locator("#linkApply").click();
  await expect(page.locator("#editor a")).toHaveText("Godot");
  await expect(page.locator("#editor a")).toHaveAttribute("href", "https://godotengine.org/");
  await putSelection(page, '<p>Сайт <a href="https://godotengine.org/">Godot</a> полезен</p>', "a", 1);
  await page.locator('[data-action="link"]').click();
  await page.locator("#linkCancel").click();
  await expect(page.locator("#editor a")).toHaveText("Godot");
});

test("code button at empty caret enables typing, does not insert word code, then exits style", async ({ page }) => {
  await putSelection(page, "<p>Начало </p>", "p", 7);
  const button = page.locator('[data-action="inlineCode"]');
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#editor code")).toHaveCount(0);
  await expect(page.locator("#editor")).not.toContainText("код");
  await page.keyboard.type("my_var");
  await expect(page.locator("#editor code")).toHaveText("my_var");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  // Toggling a styled code run off makes the whole run ordinary text.
  await expect(page.locator("#editor code")).toHaveCount(0);
  await page.keyboard.type(" after");
  await expect(page.locator("#editor code")).toHaveCount(0);
  await expect(page.locator("#editor")).toContainText("my_var after");
});

test("cursor in the middle of code removes formatting from the entire run", async ({ page }) => {
  await putSelection(page, "<p>До <code>abcdef</code> после</p>", "code", 3);
  const button = page.locator('[data-action="inlineCode"]');
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect(page.locator("#editor code")).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#editor")).toHaveText("До abcdef после");
  await page.keyboard.type("XYZ");
  await expect(page.locator("#editor")).toHaveText("До abcXYZdef после");
  await expect(page.locator("#editor code")).toHaveCount(0);
});

test("only code run under caret is unwrapped; adjacent code stays formatted", async ({ page }) => {
  await putSelection(page, "<p><code>первый</code> текст <code>второй</code></p>", "code", 3);
  await page.locator('[data-action="inlineCode"]').click();
  await expect(page.locator("#editor code")).toHaveCount(1);
  await expect(page.locator("#editor code")).toHaveText("второй");
  await expect(page.locator("#editor")).toHaveText("первый текст второй");
});

test("empty code mode can be cancelled without modifying content", async ({ page }) => {
  await putSelection(page, "<p>Пример</p>", "p", 3);
  const button = page.locator('[data-action="inlineCode"]');
  const original = await page.locator("#editor").innerHTML();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await page.locator("#editor").innerHTML()).toBe(original);
});

test("HTML source is pretty printed and manual whitespace is preserved on reopening", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.getElementById("editor");
    editor.innerHTML = "<h2>Начало</h2><ul><li>Раз</li><li>Два</li></ul><pre><code>    if true:\n        print(42)</code></pre>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#tabSource").click();
  const source = page.locator("#sourceEditor");
  const formatted = await source.inputValue();
  expect(formatted).toContain("  <li>Раз</li>");
  expect(formatted).toContain("  <li>Два</li>");
  expect(formatted).toContain("    if true:\n        print(42)");
  const custom = (await source.inputValue()).replace("  <li>Раз</li>", "      <li>Раз</li>");
  await source.fill(custom);
  await page.locator("#tabVisual").click();
  await page.locator("#tabSource").click();
  expect(await source.inputValue()).toContain("      <li>Раз</li>");
});


test("inline code toggles only the selected part and preserves surrounding code", async ({ page }) => {
  await putSelection(page, "<p><code>abcdef</code></p>", "code", 2, 4);
  const codeButton = page.locator('[data-action="inlineCode"]');
  await expect(codeButton).toHaveAttribute("aria-pressed", "true");
  await codeButton.click();
  await expect(page.locator("#editor code")).toHaveCount(2);
  await expect(page.locator("#editor code").nth(0)).toHaveText("ab");
  await expect(page.locator("#editor code").nth(1)).toHaveText("ef");
  await expect(page.locator("#editor")).toContainText("abcdef");
  await expect(codeButton).toHaveAttribute("aria-pressed", "false");
});

test("protected code block is highlighted and cannot be formatted or typed into", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.getElementById("editor");
    editor.innerHTML = '<p>До</p><pre><code>func example():\n    print("Hello")</code></pre><p>После</p>';
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#editor pre")).toHaveAttribute("contenteditable", "false");
  await expect(page.locator("#editor pre")).toHaveAttribute("data-language", "gdscript");
  await expect(page.locator("#editor .code-token-keyword")).toHaveCount(1);
  const original = await page.locator("#editor pre").innerText();
  await page.locator("#editor pre").click();
  // Noneditable content remains selectable and the formatting toolbar locks.
  await expect(page.locator('[data-action="codeBlock"]')).toBeDisabled();
  await page.keyboard.type("malicious");
  await expect(page.locator("#editor pre")).toContainText("func example()");
  expect(await page.locator("#editor pre").innerText()).toBe(original);
  await expect(page.locator('[data-command="bold"]')).toBeDisabled();
});

test("double clicking protected block opens modal; changing code only on Apply", async ({ page }) => {
  await page.locator("#editor pre").dblclick();
  await expect(page.locator("#codeDialog")).toBeVisible();
  await expect(page.locator("#codeLanguage")).toHaveValue("gdscript");
  const original = await page.locator("#editor pre").innerText();
  await page.locator("#codeTextarea").fill('extends Node2D\n\nfunc _ready():\n\tprint("ok")');
  await expect(page.locator("#editor pre")).toHaveText(original.trim());
  await page.locator("#codeCancel").click();
  await expect(page.locator("#codeDialog")).not.toBeVisible();
  await expect(page.locator("#editor pre")).toContainText(original.trim());
  await page.locator("#editor pre").dblclick();
  await page.locator("#codeLanguage").selectOption("none");
  await page.locator("#codeTextarea").fill("func example():\n\tpass");
  await expect(page.locator("#codeHighlight .code-token-keyword")).toHaveCount(0);
  await expect(page.locator("#codePreview")).toHaveCount(0);
  await page.locator("#codeApply").click();
  await expect(page.locator("#editor pre")).toHaveAttribute("data-language", "none");
  await expect(page.locator("#editor pre")).toContainText("func example():");
  await expect(page.locator("#editor .code-token-keyword")).toHaveCount(0);
});

test("double-click directly on highlighted token opens code dialog", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const span = page.locator("#editor pre .code-token-keyword").first();
  await expect(span).toBeVisible();
  await span.dblclick();
  await expect(page.locator("#codeDialog")).toBeVisible();
  await expect(page.locator("#codeTextarea")).toHaveValue(/func/);
  await expect(page.locator("#codeLanguage")).toHaveValue("gdscript");
  expect(errors).toEqual([]);
});

test("double-click opens editor after code block is remounted", async ({ page }) => {
  await page.locator("#tabSource").click();
  await page.locator("#tabVisual").click();
  const pre = page.locator("#editor pre").first();
  await expect(pre).toHaveAttribute("contenteditable", "false");
  await pre.locator("code").dblclick();
  await expect(page.locator("#codeDialog")).toBeVisible();
});

test("cached older dialog HTML is upgraded when double-clicking", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    const textarea = document.getElementById("codeTextarea");
    const shell = textarea.parentElement;
    shell.before(textarea);
    shell.remove();
    const heading = document.createElement("div");
    heading.className = "code-preview-title";
    heading.textContent = "Предпросмотр подсветки";
    const preview = document.createElement("pre");
    preview.id = "codePreview";
    preview.appendChild(document.createElement("code"));
    textarea.after(heading, preview);
  });
  await page.locator("#editor pre .code-token-keyword").first().dblclick();
  await expect(page.locator("#codeDialog")).toBeVisible();
  await expect(page.locator("#codeHighlight")).toBeVisible();
  await expect(page.locator("#codePreview")).toHaveCount(0);
  await expect(page.locator("#codeTextarea")).toHaveValue(/func/);
  expect(errors).toEqual([]);
});

test("code dialog never closes from backdrop or Escape", async ({ page }) => {
  await page.locator("#editor pre").dblclick();
  const dialog = page.locator("#codeDialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  await page.locator("#codeCancel").click();
  await expect(dialog).not.toBeVisible();
});

test("code modal inserts tabs and auto-indent after GDScript blocks", async ({ page }) => {
  await page.locator("#editor pre").dblclick();
  const textarea = page.locator("#codeTextarea");
  await textarea.fill("func ready():");
  await textarea.press("End");
  await textarea.press("Enter");
  await expect(textarea).toHaveValue("func ready():\n\t");
  await page.keyboard.type("if condition:");
  await textarea.press("Enter");
  await expect(textarea).toHaveValue("func ready():\n\tif condition:\n\t\t");
  await page.keyboard.type("pass");
  await textarea.press("Enter");
  await expect(textarea).toHaveValue("func ready():\n\tif condition:\n\t\tpass\n\t\t");
  await textarea.press("Tab");
  await expect(textarea).toHaveValue("func ready():\n\tif condition:\n\t\tpass\n\t\t\t");
  await page.locator("#codeLanguage").selectOption("none");
  await textarea.fill("if condition:");
  await textarea.press("End");
  await textarea.press("Enter");
  await expect(textarea).toHaveValue("if condition:\n");
});

test("syntax highlighting appears inside editable code field with no lower preview", async ({ page }) => {
  await page.locator("#editor pre").dblclick();
  const input = page.locator("#codeTextarea");
  const layer = page.locator("#codeHighlight");
  await expect(page.locator("#codePreview")).toHaveCount(0);
  await expect(layer).toBeVisible();
  await input.fill('func _ready():\n\tprint("Hello") # hint');
  await expect(layer.locator(".code-token-keyword")).toContainText("func");
  await expect(layer.locator(".code-token-string")).toContainText('"Hello"');
  await expect(layer.locator(".code-token-comment")).toContainText("# hint");
  expect(await layer.innerText()).toContain('func _ready():\n\tprint("Hello") # hint');
  // The original textarea is the real interactive input; highlighting is a
  // visually aligned, pointer-transparent layer, not a separate preview.
  expect(await input.evaluate((el) => getComputedStyle(el).color)).toBe("rgba(0, 0, 0, 0)");
  await page.locator("#codeLanguage").selectOption("none");
  await expect(layer.locator("[class^=code-token-]")).toHaveCount(0);
  await expect(input).toHaveValue('func _ready():\n\tprint("Hello") # hint');
});

test("scroll position of code highlight follows textarea in both directions", async ({ page }) => {
  await page.locator("#editor pre").dblclick();
  const manyLines = Array.from({ length: 90 }, (_, index) => "func line_" + index + "():\tpass").join("\n");
  await page.locator("#codeTextarea").fill(manyLines);
  await page.locator("#codeTextarea").evaluate((el) => {
    el.scrollTop = 260;
    el.scrollLeft = 80;
    el.dispatchEvent(new Event("scroll"));
  });
  const offsets = await page.evaluate(() => {
    const a = document.getElementById("codeTextarea"), b = document.getElementById("codeHighlight");
    return { inputTop: a.scrollTop, layerTop: b.scrollTop, inputLeft: a.scrollLeft, layerLeft: b.scrollLeft };
  });
  expect(offsets.inputTop).toBeGreaterThan(0);
  expect(offsets.inputTop).toBe(offsets.layerTop);
  expect(offsets.inputLeft).toBe(offsets.layerLeft);
});

test("single Backspace removes one indentation level of tabs or four spaces", async ({ page }) => {
  await page.locator("#editor pre").dblclick();
  const input = page.locator("#codeTextarea");
  await input.fill("func example():\n\t\t");
  await input.press("End");
  await input.press("Backspace");
  await expect(input).toHaveValue("func example():\n\t");
  await input.press("Backspace");
  await expect(input).toHaveValue("func example():\n");

  await input.fill("if ready:\n        ");
  await input.press("End");
  await input.press("Backspace");
  await expect(input).toHaveValue("if ready:\n    ");
  await input.press("Backspace");
  await expect(input).toHaveValue("if ready:\n");

  // Backspace in the middle of ordinary source deletes only a character.
  await input.fill("abcdef");
  await input.press("End");
  await input.press("Backspace");
  await expect(input).toHaveValue("abcde");
});

test("multi-line code text and language survive HTML mode and backup", async ({ page }) => {
  await page.locator("#editor pre").dblclick();
  await page.locator("#codeLanguage").selectOption("none");
  await page.locator("#codeTextarea").fill("\tline\n\t\tindented");
  await page.locator("#codeApply").click();
  await page.locator("#tabSource").click();
  const source = await page.locator("#sourceEditor").inputValue();
  expect(source).toContain('data-language="none"');
  expect(source).toContain("\tline\n\t\tindented");
  expect(source).not.toContain("code-token");
  await page.locator("#tabVisual").click();
  await page.locator("#editor pre").dblclick();
  await expect(page.locator("#codeTextarea")).toHaveValue("\tline\n\t\tindented");
  await expect(page.locator("#codeLanguage")).toHaveValue("none");
});

test("heading, nested center alignment, and list states reflect the cursor", async ({ page }) => {
  await putSelection(page, '<div style="text-align:center"><h2>Раздел</h2></div>', "h2", 2);
  await expect(page.locator("#blockType")).toHaveValue("h2");
  await expect(page.locator('[data-command="justifyCenter"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#blockType").selectOption("p");
  await expect(page.locator("#editor h2")).toHaveCount(0);

  await putSelection(page, "<ul><li>Пункт списка</li></ul>", "li", 3);
  await expect(page.locator('[data-command="insertUnorderedList"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-command="insertOrderedList"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator('[data-command="insertUnorderedList"]').click();
  await expect(page.locator("#editor ul")).toHaveCount(0);
});

test("paste preserves safe HTML and removes scripts", async ({ page }) => {
  await putSelection(page, "<p>Начало</p>", "p", 6);
  await page.evaluate(() => {
    const payload = new DataTransfer();
    payload.setData("text/html", '<h2>Заголовок</h2><p><strong>Текст</strong></p><script>window.injected=true</script>');
    payload.setData("text/plain", "Заголовок\nТекст");
    document.getElementById("editor").dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: payload
    }));
  });
  await expect(page.locator("#editor h2")).toContainText("Заголовок");
  await expect(page.locator("#editor strong")).toContainText("Текст");
  await expect(page.locator("#editor script")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test("formatting toolbar sticks beneath header while lesson scrolls", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.querySelector("#editor");
    editor.innerHTML = Array.from({length: 85}, (_, i) => "<p>Длинный урок: абзац " + i + "</p>").join("");
    editor.dispatchEvent(new Event("input", {bubbles: true}));
  });
  await page.evaluate(() => window.scrollTo(0, 620));
  await expect.poll(() => page.evaluate(() => Math.round(document.querySelector("#formatbar").getBoundingClientRect().top))).toBe(72);
  const css = await page.locator("#formatbar").evaluate((el) => ({position: getComputedStyle(el).position, top: getComputedStyle(el).top}));
  expect(css.position).toBe("sticky");
  expect(css.top).toBe("72px");
});

test("color palette styles selection, reflects selected color and resets it", async ({ page }) => {
  await putSelection(page, "<p>Цветной текст</p>", "p", 0, 7);
  const colorButton = page.locator("#textColorButton");
  await colorButton.click();
  await expect(page.locator("#colorPalette")).toBeVisible();
  await page.getByRole("button", {name: "Применить цвет #dc2626"}).click();
  await expect(page.locator("#editor [style*='color']")).toHaveCount(1);
  await page.evaluate(() => {
    const span = document.querySelector("#editor [style*='color']");
    const text = Array.from(span.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
    const r = document.createRange(); r.setStart(text, 2); r.collapse(true);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(r);
  });
  await expect(colorButton).toHaveClass(/active/);
  await expect(page.locator("#colorIndicator")).toHaveCSS("background-color", "rgb(220, 38, 38)");
  await colorButton.click();
  await page.locator("#resetTextColor").click();
  await expect(page.locator("#editor [style*='color']")).toHaveCount(0);
  await expect(colorButton).not.toHaveClass(/active/);
});

test("color survives sanitizer and HTML mode, unsafe attributes remain stripped", async ({ page }) => {
  await putSelection(page, "<p>Выделение</p>", "p", 0, 9);
  await page.locator("#textColorButton").click();
  await page.getByRole("button", {name: "Применить цвет #2563eb"}).click();
  await page.locator("#tabSource").click();
  const src = await page.locator("#sourceEditor").inputValue();
  expect(src).toContain("color: rgb(37, 99, 235)");
  await page.locator("#tabVisual").click();
  await expect(page.locator("#editor [style*='color']")).toContainText("Выделение");
});

test("clipboard PNG creates embedded image with alignment and scalable width", async ({ page }) => {
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==";
  await page.locator("#editor").click();
  await page.evaluate((pixel) => {
    const data = Uint8Array.from(atob(pixel), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], "sample.png", {type:"image/png"}));
    const event = new ClipboardEvent("paste", {bubbles:true, cancelable:true, clipboardData:transfer});
    document.querySelector("#editor").dispatchEvent(event);
  }, pixel);
  const image = page.locator("#editor figure.lesson-image img").first();
  await expect(image).toBeVisible();
  const initial = Number(await image.getAttribute("width"));
  expect(initial).toBeGreaterThanOrEqual(60);
  await image.click();
  await expect(page.locator("#imageSizing")).toBeVisible();
  await page.locator("#shrinkImage").click();
  expect(Number(await image.getAttribute("width"))).toBeLessThan(initial);
  await page.locator('[data-command="justifyCenter"]').click();
  await expect(page.locator("#editor figure.lesson-image").first()).toHaveCSS("text-align", "center");
  await page.locator('[data-command="justifyRight"]').click();
  await expect(page.locator("#editor figure.lesson-image").first()).toHaveCSS("text-align", "right");
  await page.locator("#tabSource").click();
  const html = await page.locator("#sourceEditor").inputValue();
  expect(html).toContain("data:image/png;base64,");
  expect(html).toContain("<img ");
  expect(html).toContain('text-align: right');
  await page.locator("#tabVisual").click();
  await expect(page.locator("#editor figure.lesson-image img")).toHaveCount(1);
});

test("malicious pasted image URLs are rejected", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.getElementById("editor");
    editor.innerHTML = '<p>hello</p><img src="javascript:alert(1)" onerror="window.evil=1">';
    editor.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await page.locator("#tabSource").click();
  const src = await page.locator("#sourceEditor").inputValue();
  expect(src).not.toContain("javascript:");
  expect(src).not.toContain("onerror");
});

async function prepareResizableImage(page) {
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==";
  await page.evaluate((pixel) => {
    const editor = document.getElementById("editor");
    editor.innerHTML = '<p>Выше картинки</p><figure class="lesson-image" style="text-align: left"><img width="280" alt="Пример" src="data:image/png;base64,' + pixel + '"></figure><p>Ниже картинки</p>';
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }, pixel);
  const img = page.locator("#editor figure.lesson-image img");
  await expect(img).toBeVisible();
  await img.hover();
  await expect(page.locator("#imageResizeOverlay")).toHaveClass(/visible/);
  return img;
}
async function dragImageHandle(page, corner, dx, dy) {
  // The opposite corner may move below the browser viewport after enlarging
  // the image, so bring the image fully into view before the next drag.
  await page.locator("#editor figure.lesson-image img").scrollIntoViewIfNeeded();
  const handle = page.locator("#imageResizeOverlay .image-resize-" + corner);
  await expect(handle).toBeVisible();
  await expect(handle).toBeInViewport();
  const rect = await handle.boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}
test("image corner markers appear on hover with diagonal resize cursor", async ({ page }) => {
  await prepareResizableImage(page);
  const overlay = page.locator("#imageResizeOverlay");
  await expect(overlay).toHaveClass(/visible/);
  await expect(page.locator("#imageResizeOverlay .image-resize-handle")).toHaveCount(4);
  await expect(page.locator("#imageResizeOverlay .image-resize-nw")).toHaveCSS("cursor", "nwse-resize");
  await expect(page.locator("#imageResizeOverlay .image-resize-ne")).toHaveCSS("cursor", "nesw-resize");
  const html = await page.locator("#editor").innerHTML();
  expect(html).not.toContain("image-resize-handle");
});

test("bottom-right resize increases image width proportionally and persists through HTML mode", async ({ page }) => {
  const img = await prepareResizableImage(page);
  const before = await img.boundingBox();
  await dragImageHandle(page, "se", 110, 110);
  const after = await img.boundingBox();
  expect(Number(await img.getAttribute("width"))).toBeGreaterThan(280);
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.height / after.width).toBeCloseTo(before.height / before.width, 1);
  await expect(page.locator("#imageSizeLabel")).toContainText("px");
  await page.locator("#tabSource").click();
  await expect(page.locator("#imageResizeOverlay")).not.toHaveClass(/visible/);
  const html = await page.locator("#sourceEditor").inputValue();
  expect(html).toMatch(/<img[^>]*width="3\d\d"/);
  expect(html).not.toContain("image-resize-handle");
  await page.locator("#tabVisual").click();
  expect(Number(await img.getAttribute("width"))).toBeGreaterThan(280);
});

test("top-left resizing inward makes image smaller and does not change source image", async ({ page }) => {
  const img = await prepareResizableImage(page);
  const beforeSrc = await img.getAttribute("src");
  await dragImageHandle(page, "nw", 70, 70);
  const width = Number(await img.getAttribute("width"));
  expect(width).toBeLessThan(280);
  expect(width).toBeGreaterThanOrEqual(60);
  expect(await img.getAttribute("src")).toBe(beforeSrc);
});

test("all four handles support pointer drag and selected image stays adjustable", async ({ page }) => {
  const img = await prepareResizableImage(page);
  await img.click();
  await expect(page.locator("#imageSizing")).toBeVisible();
  await dragImageHandle(page, "ne", 40, -30);
  const grown = Number(await img.getAttribute("width"));
  expect(grown).toBeGreaterThan(280);
  await dragImageHandle(page, "sw", 40, -30);
  const shrunk = Number(await img.getAttribute("width"));
  expect(shrunk).toBeLessThan(grown);
  await expect(page.locator("#imageResizeOverlay")).toHaveClass(/visible/);
});

test("corner handle overlay repositions when page scrolls", async ({ page }) => {
  const img = await prepareResizableImage(page);
  // Scrolling can move the pointer off the image. Select it so the overlay
  // must remain visible independently of hover in the taller course editor.
  await img.click();
  const before = await img.boundingBox();
  const overlay = page.locator("#imageResizeOverlay");
  const first = await overlay.boundingBox();
  expect(first.x).toBeCloseTo(before.x, 0);
  expect(first.y).toBeCloseTo(before.y, 0);
  await page.evaluate(() => {
    window.scrollTo(0, 150);
    window.dispatchEvent(new Event("scroll"));
  });
  const second = await img.boundingBox();
  if (second.y >= -second.height && second.y <= 800) {
    await expect.poll(async () => (await overlay.boundingBox())?.y).toBeCloseTo(second.y, 0);
  }
});

test("panoramic image resizes smoothly past 490 px when pointer direction changes", async ({ page }) => {
  // Reproduces the former discontinuity: for a very wide image a tiny
  // vertical movement made the old max(dx,dy*aspect) expression leap.
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2000;
    canvas.height = 50;
    const editor = document.querySelector("#editor");
    editor.innerHTML = '<figure class="lesson-image" style="text-align: left"><img alt="Широкое изображение" width="450" src="' +
      canvas.toDataURL("image/png") + '"></figure><p>После иллюстрации</p>';
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const img = page.locator("#editor figure.lesson-image img");
  await expect.poll(() => img.evaluate(el => el.naturalWidth)).toBe(2000);
  await img.scrollIntoViewIfNeeded();
  await img.hover();
  const handle = page.locator("#imageResizeOverlay .image-resize-se");
  await expect(handle).toBeInViewport();
  const rect = await handle.boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 39, y);
  const widthBefore = Number(await img.getAttribute("width"));
  expect(widthBefore).toBeGreaterThanOrEqual(486);
  expect(widthBefore).toBeLessThanOrEqual(493);
  // The old implementation jumped from ~489 to ~530 here, even though
  // the pointer moved just one horizontal and two vertical pixels.
  await page.mouse.move(x + 40, y + 2);
  const widthAfter = Number(await img.getAttribute("width"));
  expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(4);
  await page.mouse.move(x + 41, y + 3);
  const widthThird = Number(await img.getAttribute("width"));
  expect(Math.abs(widthThird - widthAfter)).toBeLessThanOrEqual(4);
  await page.mouse.up();
  await page.locator("#tabSource").click();
  expect(await page.locator("#sourceEditor").inputValue()).toContain('width="' + widthThird + '"');
});

test("continuous diagonal resize remains monotone with varying X and Y movement", async ({ page }) => {
  const img = await prepareResizableImage(page);
  const handle = page.locator("#imageResizeOverlay .image-resize-se");
  const rect = await handle.boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const samples = [];
  for (const [dx, dy] of [[10, 4], [20, 8], [30, 9], [40, 10], [50, 15], [60, 17]]) {
    await page.mouse.move(x + dx, y + dy);
    samples.push(Number(await img.getAttribute("width")));
  }
  await page.mouse.up();
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    expect(samples[i] - samples[i - 1]).toBeLessThanOrEqual(15);
  }
});

test("image drag round trip through original size remains continuous and reversible", async ({ page }) => {
  const sample = await prepareResizableImage(page);
  const handle = page.locator("#imageResizeOverlay .image-resize-se");
  const rect = await handle.boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x,y); await page.mouse.down();
  const points = [[15,10],[50,32],[100,65],[150,90],[120,72],[80,48],[40,24],
    [15,9],[5,3],[2,1],[0,0],[-2,-1],[-5,-3],[-12,-6],[-35,-22],
    [-12,-6],[-3,-2],[0,0],[3,2],[12,7],[45,30]];
  const readings = [];
  for(const [dx,dy] of points) {
    await page.mouse.move(x+dx,y+dy);
    const state = await sample.evaluate(el=>({width:Number(el.getAttribute("width")),rendered:el.getBoundingClientRect().width}));
    readings.push({...state,dx,dy});
  }
  await page.mouse.up();
  console.log("ROUNDTRIP", JSON.stringify(readings));
  for(let i=1;i<readings.length;i++){
    const dx=readings[i].dx-readings[i-1].dx;
    const dy=readings[i].dy-readings[i-1].dy;
    expect(Math.abs(readings[i].width-readings[i-1].width))
      .toBeLessThanOrEqual(Math.sqrt(dx*dx+dy*dy)+2);
    expect(Math.abs(readings[i].rendered-readings[i-1].rendered))
      .toBeLessThanOrEqual(Math.sqrt(dx*dx+dy*dy)+2);
  }
  for(const r of readings.filter(x=>x.dx===0&&x.dy===0))expect(r.width).toBe(280);
});

test("drag away from width boundary then reverse responds immediately", async ({ page }) => {
  // A 490px container reproduces the reported 'magnet near 490' effect.
  await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200; c.height = 400;
    const ed = document.querySelector("#editor");
    ed.innerHTML = '<figure class="lesson-image" style="width:490px;text-align:left"><img width="450" src="' +
      c.toDataURL("image/png") + '" alt="Широкий рисунок"></figure><p>Текст</p>';
    ed.dispatchEvent(new Event("input", { bubbles:true }));
  });
  const img = page.locator("#editor figure img");
  await img.scrollIntoViewIfNeeded();
  await img.hover();
  const rect = await page.locator("#imageResizeOverlay .image-resize-se").boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+160,y+40,{steps:6});
  const atLimit = Number(await img.getAttribute("width"));
  expect(atLimit).toBe(490);
  await page.mouse.move(x+150,y+38);
  const afterReverse = Number(await img.getAttribute("width"));
  await page.mouse.up();
  expect(afterReverse).toBeLessThan(atLimit);
});

test("minimum image width has no magnetic dead zone on reversing drag", async ({ page }) => {
  const img = await prepareResizableImage(page);
  const handle = page.locator("#imageResizeOverlay .image-resize-se");
  await expect(handle).toBeInViewport();
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x-260,y-260,{steps:6});
  const minWidth = Number(await img.getAttribute("width"));
  expect(minWidth).toBe(60);
  await page.mouse.move(x-244,y-246);
  const afterReverse = Number(await img.getAttribute("width"));
  await page.mouse.up();
  expect(afterReverse).toBeGreaterThan(minWidth);
});


test("mockup typography makes H1 H2 H3 visibly larger with clear hierarchy", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.getElementById("editor");
    editor.innerHTML = "<h1>Главный заголовок</h1><h2>Заголовок раздела</h2><h3>Подраздел</h3><p>Обычный текст</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const sizes = await page.locator("#editor").evaluate((root) => {
    const measure = (tag) => parseFloat(getComputedStyle(root.querySelector(tag)).fontSize);
    return ["h1","h2","h3","p"].map(measure);
  });
  expect(sizes[0]).toBeGreaterThanOrEqual(31);
  expect(sizes[1]).toBeGreaterThanOrEqual(24);
  expect(sizes[2]).toBeGreaterThanOrEqual(20);
  expect(sizes[0] - sizes[1]).toBeGreaterThanOrEqual(5);
  expect(sizes[1] - sizes[2]).toBeGreaterThanOrEqual(3);
  expect(sizes[3]).toBeLessThan(sizes[2]);
});

test("uniform SVG toolbar icons replace inconsistent unicode symbols without losing actions", async ({ page }) => {
  const toolbar = page.locator("#formatbar");
  const icons = toolbar.locator("button .tool-icon");
  expect(await icons.count()).toBeGreaterThanOrEqual(18);
  for (const action of ["inlineCode", "quote", "codeBlock", "link"]) {
    const button = toolbar.locator('[data-action="' + action + '"]');
    await expect(button.locator("svg.tool-icon use")).toHaveCount(1);
    await expect(button.locator("svg.tool-icon")).toHaveCSS("width", "20px");
    await expect(button.locator("svg.tool-icon")).toHaveCSS("height", "20px");
  }
  await expect(toolbar.locator('[data-command="justifyLeft"] svg')).toBeVisible();
  await expect(toolbar.locator('[data-command="insertOrderedList"] svg')).toBeVisible();
  await expect(toolbar.locator("#insertImageButton svg")).toBeVisible();
  await expect(toolbar.locator("#textColorButton")).toBeVisible();
});

test("lavender syntax colors appear in lesson, editing dialog, and exported HTML", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.getElementById("editor");
    editor.innerHTML = "<h1>Большой заголовок</h1><pre data-language='gdscript'><code>func ready():\n    print('hello')</code></pre>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const pre = page.locator("#editor pre");
  await expect(pre).toHaveCSS("background-color", "rgb(244, 241, 255)");
  await expect(pre.locator(".code-token-keyword")).toHaveCSS("color", "rgb(186, 49, 86)");
  await pre.dblclick();
  await expect(page.locator("#codeDialog")).toBeVisible();
  await expect(page.locator("#codeHighlight")).toHaveCSS("background-color", "rgb(244, 241, 255)");
  await expect(page.locator("#codeHighlight .code-token-keyword")).toHaveCount(1);
  await page.locator("#codeCancel").click();
  await page.locator("#tabPreview").click();
  const srcDoc = await page.locator("#previewFrame").getAttribute("srcdoc");
  expect(srcDoc).toContain("--code-surface:#f4f1ff");
  expect(srcDoc).toContain("background:var(--code-surface)");
  expect(srcDoc).toContain("font-size:36px");
});

test("redesigned toolbar stays sticky during page scroll", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.getElementById("editor");
    editor.innerHTML = Array.from({length: 80}, (_, i) => "<p>Абзац " + i + " в длинном уроке</p>").join("");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    window.scrollTo(0, 550);
  });
  await expect.poll(() => page.locator("#formatbar").evaluate(el => Math.round(el.getBoundingClientRect().top))).toBe(72);
  await expect(page.locator("#formatbar")).toHaveCSS("position", "sticky");
});


test("HTML source highlights tags, attribute values and comments without changing source", async ({ page }) => {
  await page.locator("#tabSource").click();
  const html = '<!-- Тест -->\n<section class="lesson" data-x="test">\n  <h2 style="color: #ff0000">Текст &amp; значение</h2>\n</section>';
  await page.locator("#sourceEditor").fill(html);
  const layer = page.locator("#htmlSourceHighlight");
  await expect(layer.locator(".html-token-comment")).toContainText("<!-- Тест -->");
  await expect(layer.locator(".html-token-tag").first()).toHaveText("section");
  await expect(layer.locator(".html-token-attribute").first()).toHaveText("class");
  await expect(layer.locator(".html-token-string").first()).toHaveText('"lesson"');
  await expect(layer.locator(".html-token-entity")).toContainText("&amp;");
  await expect(page.locator("#sourceEditor")).toHaveValue(html);
  expect(await page.locator("#sourceEditor").evaluate(el => getComputedStyle(el).caretColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("HTML source editor scrolls with highlighted layer and keeps typed indentation", async ({ page }) => {
  await page.locator("#tabSource").click();
  const source = page.locator("#sourceEditor");
  await source.fill(Array.from({length: 100}, (_,i)=>'<p data-i="' + i + '">Строка</p>').join("\n"));
  const layout = await page.evaluate(() => {
    const e=document.querySelector("#sourceEditor"), d=document.querySelector("#htmlSourceHighlight");
    return {
      textHeight:e.clientHeight, textContentHeight:e.scrollHeight,
      highlightHeight:d.clientHeight, textScrollWidth:e.scrollWidth,
      textClientWidth:e.clientWidth, textScrollY:e.scrollTop,
      bodyHeight:document.documentElement.scrollHeight, viewHeight:window.innerHeight
    };
  });
  expect(layout.textHeight).toBeGreaterThan(1500);
  expect(layout.textContentHeight).toBeLessThanOrEqual(layout.textHeight+3);
  expect(layout.highlightHeight).toBe(layout.textHeight);
  expect(layout.textScrollWidth).toBeLessThanOrEqual(layout.textClientWidth+3);
  expect(layout.textScrollY).toBe(0);
  expect(layout.bodyHeight).toBeGreaterThan(layout.viewHeight);
  await source.fill("<div>\n</div>");
  await source.evaluate(el=>{el.setSelectionRange(6,6);el.focus();});
  await source.press("Tab");
  await expect(source).toHaveValue("<div>\n  </div>");
  await page.locator("#tabVisual").click();
  await page.locator("#tabSource").click();
  expect(await source.inputValue()).toContain("\n  </div>");
});


test("very long HTML attribute wraps without horizontal scroll and expands on typing", async ({ page }) => {
  await page.locator("#tabSource").click();
  const source=page.locator("#sourceEditor");
  await source.fill('<p data-long="' + 'X'.repeat(4600) + '">Текст</p>');
  const metrics=await source.evaluate(e=>({
    clientWidth:e.clientWidth, scrollWidth:e.scrollWidth,
    clientHeight:e.clientHeight, scrollHeight:e.scrollHeight,
    overflowX:getComputedStyle(e).overflowX, overflowY:getComputedStyle(e).overflowY
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 3);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 3);
  expect(metrics.clientHeight).toBeGreaterThan(700);
  expect(metrics.overflowX).toBe("hidden");
  expect(metrics.overflowY).toBe("hidden");
  await source.fill("<p>Короткий</p>");
  expect(await source.evaluate(e=>e.clientHeight)).toBeLessThan(450);
});

test("editor and preview retain modest matching side margins", async ({ page }) => {
  await page.evaluate(() => {
    const editor=document.querySelector("#editor");
    editor.innerHTML='<p>Введение</p><pre data-language="gdscript"><code>func test():\n    pass</code></pre>';
    editor.dispatchEvent(new Event("input",{bubbles:true}));
  });
  const layout=await page.evaluate(()=>{
    const e=document.querySelector("#editor"), parent=e.closest(".editor-card");
    return {inner:e.clientWidth, parent:parent.clientWidth, paddingLeft:parseFloat(getComputedStyle(e).paddingLeft)};
  });
  expect(layout.paddingLeft).toBeGreaterThanOrEqual(18);
  expect(layout.paddingLeft).toBeLessThanOrEqual(29);
  await page.locator("#tabPreview").click();
  await expect.poll(()=>page.locator("#previewFrame").evaluate(f=>!!f.contentDocument?.body)).toBe(true);
  const preview=await page.locator("#previewFrame").evaluate(f=>{
    const b=f.contentDocument.body, st=f.contentWindow.getComputedStyle(b);
    const pre=b.querySelector("pre");
    return {
      marginLeft:parseFloat(st.marginLeft), paddingLeft:parseFloat(st.paddingLeft),
      maxWidth:st.maxWidth, codeWeight:f.contentWindow.getComputedStyle(pre).fontWeight,
      innerCodeWeight:f.contentWindow.getComputedStyle(pre.querySelector("code")).fontWeight,
      width:b.getBoundingClientRect().width, frameWidth:f.clientWidth
    };
  });
  expect(preview.marginLeft).toBeLessThanOrEqual(8);
  expect(preview.paddingLeft).toBeGreaterThanOrEqual(26);
  expect(preview.paddingLeft).toBeLessThanOrEqual(30);
  expect(preview.maxWidth).toBe("none");
  expect(preview.width).toBeGreaterThan(preview.frameWidth-12);
  expect(Number(preview.codeWeight)).toBeGreaterThanOrEqual(600);
  expect(Number(preview.innerCodeWeight)).toBeGreaterThanOrEqual(600);
});

test("multiline code is semibold in visual view and code-editing modal", async ({ page }) => {
  await page.evaluate(()=>{
    const editor=document.getElementById("editor");
    editor.innerHTML='<pre data-language="gdscript"><code>func example():\n    pass</code></pre>';
    editor.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await expect(page.locator("#editor pre")).toHaveCSS("font-weight","600");
  await expect(page.locator("#editor pre code")).toHaveCSS("font-weight","600");
  await page.locator("#editor pre").dblclick();
  await expect(page.locator("#codeHighlight")).toHaveCSS("font-weight","600");
  await expect(page.locator("#codeTextarea")).toHaveCSS("font-weight","600");
});
test("preview iframe grows to display long lesson and pre without internal scroll", async ({ page }) => {
  await page.evaluate(() => {
    const editor=document.querySelector("#editor");
    editor.innerHTML=Array.from({length:65},(_,i)=>"<p>Абзац №"+i+"</p>").join("")+
      '<pre data-language="gdscript"><code>'+
      Array.from({length:75},(_,i)=>"func line_"+i+"():\n    print('long code line')").join("\n")+"</code></pre>";
    editor.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await page.locator("#tabPreview").click();
  const frame=page.locator("#previewFrame");
  await expect.poll(() => frame.evaluate(el=>el.clientHeight)).toBeGreaterThan(3500);
  const data=await frame.evaluate(frame=>{
    const doc=frame.contentDocument, pre=doc.querySelector("pre");
    return {
      height:frame.clientHeight, docHeight:doc.documentElement.scrollHeight,
      preOverflow:getComputedStyle(pre).overflowX,
      codeBg:getComputedStyle(pre).backgroundColor, sandbox:frame.getAttribute("sandbox")
    };
  });
  expect(data.docHeight).toBeLessThanOrEqual(data.height+5);
  expect(data.preOverflow).not.toBe("auto");
  expect(data.codeBg).toBe("rgb(244, 241, 255)");
  expect(data.sandbox).toBe("allow-same-origin");
});

test("preview frame gets shorter when lesson is replaced by short content", async ({ page }) => {
  await page.evaluate(() => {
    const editor=document.querySelector("#editor");
    editor.innerHTML=Array.from({length:85},(_,i)=>"<p>Длинный абзац "+i+"</p>").join("");
    editor.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await page.locator("#tabPreview").click();
  await expect.poll(() => page.locator("#previewFrame").evaluate(e=>e.clientHeight)).toBeGreaterThan(2500);
  await page.locator("#tabVisual").click();
  await page.evaluate(() => {
    const editor=document.querySelector("#editor");
    editor.innerHTML="<p>Короткий урок</p>";
    editor.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await page.locator("#tabPreview").click();
  await expect.poll(() => page.locator("#previewFrame").evaluate(e=>e.clientHeight)).toBeLessThan(600);
});

test("same code-surface variable colors editor, code dialog and preview", async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--code-surface","#e7f5ff");
    const editor=document.querySelector("#editor");
    editor.innerHTML='<pre data-language="gdscript"><code>func test():\n    pass</code></pre>';
    editor.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await expect(page.locator("#editor pre")).toHaveCSS("background-color","rgb(231, 245, 255)");
  await page.locator("#editor pre").dblclick();
  await expect(page.locator("#codeHighlight")).toHaveCSS("background-color","rgb(231, 245, 255)");
  await page.locator("#codeCancel").click();
  await page.locator("#tabPreview").click();
  await expect.poll(() => page.locator("#previewFrame").evaluate(e =>
    getComputedStyle(e.contentDocument.querySelector("pre")).backgroundColor)).toBe("rgb(231, 245, 255)");
  const html=await page.locator("#previewFrame").getAttribute("srcdoc");
  expect(html).toContain("--code-surface:#e7f5ff");
});

test("GDScript uses Godot-like semantic categories on the unchanged lavender background", async ({ page }) => {
  const source = [
    'extends StaticBody2D',
    'var kind = "tree"',
    'var tint = Color("4d8b74")',
    'var actor: Node2D',
    'var variant = 0',
    'func _ready() -> void:',
    '    var collider = CollisionShape2D.new()',
    '    shape.radius = 20 if kind == "tree" else 25',
    '    add_child(collider)',
    '    # Draws a sprite',
    '    return'
  ].join("\n");
  await page.evaluate((code) => {
    const e = document.getElementById("editor");
    e.innerHTML = '<pre data-language="gdscript"><code></code></pre>';
    e.querySelector("code").textContent = code;
    e.dispatchEvent(new Event("input", {bubbles:true}));
  }, source);
  const block = page.locator("#editor pre");
  await expect(block).toHaveCSS("background-color", "rgb(244, 241, 255)");
  await expect(block.locator(".code-token-keyword").filter({hasText:"extends"})).toHaveCSS("color", "rgb(186, 49, 86)");
  await expect(block.locator(".code-token-type").filter({hasText:"StaticBody2D"})).toHaveCSS("color", "rgb(8, 126, 120)");
  await expect(block.locator(".code-token-type").filter({hasText:"CollisionShape2D"})).toHaveCount(1);
  await expect(block.locator(".code-token-function").filter({hasText:"_ready"})).toHaveCSS("color", "rgb(35, 107, 174)");
  await expect(block.locator(".code-token-function").filter({hasText:"add_child"})).toHaveCount(1);
  await expect(block.locator(".code-token-string").first()).toHaveCSS("color", "rgb(152, 98, 11)");
  await expect(block.locator(".code-token-number").first()).toHaveCSS("color", "rgb(7, 120, 100)");
  await expect(block.locator(".code-token-comment")).toHaveText("# Draws a sprite");
  await block.dblclick();
  const dialog = page.locator("#codeDialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#codeHighlight .code-token-type").first()).toHaveCSS("color", "rgb(8, 126, 120)");
  await expect(page.locator("#codeHighlight .code-token-keyword").first()).toHaveCSS("color", "rgb(186, 49, 86)");
  await page.locator("#codeCancel").click();
  await page.locator("#tabPreview").click();
  const actual = await page.locator("#previewFrame").evaluate((frame) => {
    const doc = frame.contentDocument;
    const type = doc.querySelector(".code-token-type");
    const keyword = doc.querySelector(".code-token-keyword");
    const pre = doc.querySelector("pre");
    return {
      type: getComputedStyle(type).color,
      keyword: getComputedStyle(keyword).color,
      background: getComputedStyle(pre).backgroundColor
    };
  });
  expect(actual).toEqual({
    type: "rgb(8, 126, 120)",
    keyword: "rgb(186, 49, 86)",
    background: "rgb(244, 241, 255)"
  });
});

test("GDScript lexer keeps string/comment text intact and No Highlight disables tokens", async ({ page }) => {
  const source = 'var text = "if var 123 # not comment" # comment\nvar x = 12.5\n@export var tint: Color';
  await page.evaluate((code) => {
    const editor = document.querySelector("#editor");
    editor.innerHTML = '<pre data-language="gdscript"><code></code></pre>';
    editor.querySelector("code").textContent = code;
    editor.dispatchEvent(new Event("input", {bubbles: true}));
  }, source);
  const pre = page.locator("#editor pre");
  await expect(pre.locator(".code-token-string")).toHaveText('"if var 123 # not comment"');
  await expect(pre.locator(".code-token-comment")).toHaveText("# comment");
  await expect(pre.locator(".code-token-number")).toHaveText("12.5");
  await expect(pre.locator(".code-token-annotation")).toHaveText("@export");
  await expect(pre.locator(".code-token-type")).toHaveText("Color");
  await pre.dblclick();
  await page.locator("#codeLanguage").selectOption("none");
  await expect(page.locator("#codeHighlight [class^='code-token-']")).toHaveCount(0);
  await expect(page.locator("#codeTextarea")).toHaveValue(source);
  await page.locator("#codeApply").click();
  await expect(pre.locator("[class^='code-token-']")).toHaveCount(0);
  await expect(pre).toHaveAttribute("data-language", "none");
});
