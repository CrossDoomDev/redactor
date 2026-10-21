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

test("block code is detected, then converted back into regular text", async ({ page }) => {
  await putSelection(page, "<pre><code>first\nsecond</code></pre>", "pre code", 3);
  const blockButton = page.locator('[data-action="codeBlock"]');
  await expect(blockButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-action="inlineCode"]')).toHaveAttribute("aria-pressed", "false");
  await blockButton.click();
  await expect(page.locator("#editor pre")).toHaveCount(0);
  await expect(page.locator("#editor p")).toContainText("first");
  await expect(page.locator("#editor p")).toContainText("second");
  await expect(blockButton).toHaveAttribute("aria-pressed", "false");
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
