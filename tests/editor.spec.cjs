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

test("link is highlighted and removed without deleting its text", async ({ page }) => {
  await putSelection(page, '<p>Откройте <a href="https://godotengine.org">документацию</a>.</p>', "a", 3);
  const link = page.locator('[data-action="link"]');
  await expect(link).toHaveAttribute("aria-pressed", "true");
  await link.click();
  await expect(page.locator("#editor a")).toHaveCount(0);
  await expect(page.locator("#editor")).toContainText("документацию");
  await expect(link).toHaveAttribute("aria-pressed", "false");
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
