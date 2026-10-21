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
  await expect(page.locator("#codePreview .code-token-keyword")).toHaveCount(0);
  await page.locator("#codeApply").click();
  await expect(page.locator("#editor pre")).toHaveAttribute("data-language", "none");
  await expect(page.locator("#editor pre")).toContainText("func example():");
  await expect(page.locator("#editor .code-token-keyword")).toHaveCount(0);
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
