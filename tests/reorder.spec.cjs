const {test, expect} = require('@playwright/test');
const storageKey = 'kursograf.course-editor.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
const course = () => ({
  title: 'Курс с перетаскиванием', activeId: 'a',
  modules: [
    {id: 'first', title: 'Первый модуль', lessonIds: ['a', 'b'], expanded: true},
    {id: 'second', title: 'Второй модуль', lessonIds: ['c'], expanded: true},
    {id: 'empty', title: 'Пустой модуль', lessonIds: [], expanded: true}
  ],
  lessons: ['a', 'b', 'c'].map(id => ({id, title: 'Урок ' + id, activeStepId: id + '-note', steps: [
    {id: id + '-note', type: 'note', title: 'Конспект ' + id, html: '<p>Материал ' + id + '</p>'},
    {id: id + '-quiz', type: 'single', title: 'Задание ' + id, question: 'Вопрос ' + id,
      options: [{text: 'Верно', correct: true}, {text: 'Неверно', correct: false}]},
    {id: id + '-end', type: 'note', title: 'Итог ' + id, html: '<p>Итоговый текст</p>'}
  ]}))
});
async function drag(page, grip, target, {edge = 'before', horizontal = false} = {}) {
  await grip.evaluate(el => el.scrollIntoView({block:'center', inline:'nearest'}));
  const from = await grip.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 8, from.y + from.height / 2, {steps: 3});
  await expect(page.locator('.reorder-ghost')).toBeVisible();
  const to = await target.boundingBox();
  const fraction = edge === 'before' ? 0.2 : 0.8;
  await page.mouse.move(to.x + to.width * (horizontal ? fraction : 0.5),
    to.y + to.height * (horizontal ? 0.5 : fraction), {steps: 8});
  await expect(target).toHaveClass(new RegExp('drop-' + edge));
  await page.mouse.up();
  await expect(page.locator('.reorder-ghost')).toHaveCount(0);
}
const group = (page, id) => page.locator(`[data-module-id="${id}"]`);
const grip = (page, kind, id) => page.locator(`[data-drag-kind="${kind}"][data-drag-id="${id}"]`);

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width:1440, height:1000});
  await page.addInitScript(({key, value}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, {key: storageKey, value: course()});
  await page.goto('/');
});

test('outline is on the right; creation buttons follow their containing list', async ({page}) => {
  const sidebar = await page.locator('#sidebar').boundingBox();
  const main = await page.locator('.main').boundingBox();
  expect(sidebar.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
  await expect(page.locator('#addLesson,.section-heading button')).toHaveCount(0);
  for (const id of ['first', 'second', 'empty']) {
    await expect(group(page, id).locator(':scope > :last-child')).toHaveClass('module-add-lesson');
  }
  const add = await page.locator('#addModule').boundingBox();
  const list = await page.locator('#lessonList').boundingBox();
  expect(add.y).toBeGreaterThanOrEqual(list.y + list.height);
  await group(page, 'second').locator('.module-add-lesson').click();
  const project = await stored(page);
  expect(project.modules[1].lessonIds).toHaveLength(2);
  expect(project.modules[0].lessonIds).toEqual(['a', 'b']);
  await expect(page.locator('[data-step]')).toHaveCount(1);
});

test('module and lesson drag reorder saves active HTML and survives reload', async ({page}) => {
  await page.locator('#tabSource').click();
  await page.locator('#sourceEditor').fill('<p>Текст перед переносом</p>');
  await drag(page, grip(page, 'lesson', 'b'), page.locator('[data-lesson-id="a"]'));
  expect((await stored(page)).modules[0].lessonIds).toEqual(['b', 'a']);
  await drag(page, grip(page, 'module', 'second'), group(page, 'first'));
  expect((await stored(page)).modules.map(m => m.id)).toEqual(['second', 'first', 'empty']);
  await expect(page.locator('#tabSource')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  const project = await stored(page);
  expect(project.modules.map(m => m.id)).toEqual(['second', 'first', 'empty']);
  expect(project.modules[1].lessonIds).toEqual(['b', 'a']);
  expect(project.activeId).toBe('a');
  await expect(page.locator('#editor')).toHaveText('Текст перед переносом');
  await expect(page.locator('#lessonPosition')).toHaveText('МОДУЛЬ 2 · УРОК 2.2');
});

test('lessons move between modules, into empty and collapsed modules, retaining every step', async ({page}) => {
  const before = await page.evaluate(() => structuredClone(window.kursografBridge.selectedLesson().steps));
  await drag(page, grip(page, 'lesson', 'a'), page.locator('[data-lesson-id="c"]'), {edge:'after'});
  expect((await stored(page)).modules[1].lessonIds).toEqual(['c', 'a']);
  await drag(page, grip(page, 'lesson', 'a'), group(page, 'empty'), {edge:'inside'});
  expect((await stored(page)).modules[2].lessonIds).toEqual(['a']);
  await group(page, 'first').locator('.module-toggle').click();
  await drag(page, grip(page, 'lesson', 'a'), group(page, 'first'), {edge:'inside'});
  const project = await stored(page);
  expect(project.modules[0].lessonIds).toEqual(['b', 'a']);
  expect(project.modules[0].expanded).toBe(true);
  expect(project.modules[2].lessonIds).toEqual([]);
  expect(project.lessons.find(l => l.id === 'a').steps).toEqual(before);
  expect(project.modules.flatMap(m => m.lessonIds).sort()).toEqual(['a', 'b', 'c']);
  await page.reload();
  await expect(group(page, 'first').locator('.lesson-item.active')).toContainText('Урок a');
});

test('step drag preserves selected step, separate HTML, quiz settings and numbering', async ({page}) => {
  await page.locator('#tabSource').click();
  await page.locator('#sourceEditor').fill('<p>Изменённый конспект</p>');
  await drag(page, page.locator('[data-step-id="a-quiz"]'), page.locator('[data-step-id="a-note"]'), {horizontal:true});
  await expect(page.locator('#stepPosition')).toHaveText('Шаг 2 из 3');
  await expect(page.locator('[data-step-id="a-note"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tabSource')).toHaveAttribute('aria-selected', 'true');
  expect((await stored(page)).lessons[0].steps.map(s => s.id)).toEqual(['a-quiz', 'a-note', 'a-end']);
  await page.locator('[data-step-id="a-quiz"]').click();
  await expect(page.locator('[data-field="question"]')).toHaveValue('Вопрос a');
  await page.reload();
  await expect(page.locator('#stepPosition')).toHaveText('Шаг 1 из 3');
  await page.locator('[data-step-id="a-note"]').click();
  await expect(page.locator('#editor')).toHaveText('Изменённый конспект');
});

test('Escape and dropping outside the outline leave structure intact', async ({page}) => {
  const begin = async () => {
    const rect = await grip(page, 'lesson', 'a').boundingBox();
    await page.mouse.move(rect.x + 10, rect.y + 10);
    await page.mouse.down();
    await page.mouse.move(rect.x - 15, rect.y + 20, {steps:3});
    await expect(page.locator('.reorder-ghost')).toBeVisible();
  };
  await begin();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.reorder-ghost')).toHaveCount(0);
  await begin();
  await page.mouse.move(50, 200, {steps:5});
  await page.mouse.up();
  await expect(page.locator('.reorder-ghost')).toHaveCount(0);
  expect((await stored(page)).modules[0].lessonIds).toEqual(['a', 'b']);
});

test('keyboard handles reorder and transfer lessons without opening another lesson', async ({page}) => {
  await grip(page, 'lesson', 'a').focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect((await stored(page)).modules[0].lessonIds).toEqual(['b', 'a']);
  await page.keyboard.press('Alt+ArrowRight');
  expect((await stored(page)).modules[1].lessonIds).toEqual(['c', 'a']);
  await expect(grip(page, 'lesson', 'a')).toBeFocused();
  await expect(page.locator('#lessonTitle')).toHaveValue('Урок a');
});

test('touch drag works in the mobile outline', async ({page, context}) => {
  await page.setViewportSize({width:390, height:900});
  await page.locator('#menuToggle').click();
  await expect.poll(async () => Math.round((await page.locator('#sidebar').boundingBox()).x)).toBe(84);
  const from = await grip(page, 'lesson', 'b').boundingBox();
  const to = await page.locator('[data-lesson-id="a"]').boundingBox();
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type,
    touchPoints: type === 'touchEnd' ? [] : [{x, y, id:1}]});
  await touch('touchStart', from.x + 10, from.y + 15);
  await touch('touchMove', from.x - 5, from.y + 15);
  await expect(page.locator('.reorder-ghost')).toBeVisible();
  await touch('touchMove', to.x + to.width / 2, to.y + 5);
  await expect(page.locator('[data-lesson-id="a"]')).toHaveClass(/drop-before/);
  await touch('touchEnd');
  expect((await stored(page)).modules[0].lessonIds).toEqual(['b', 'a']);
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'true');
});

test('long outline scrolls during a drag so a lesson can reach the final module', async ({page}) => {
  await page.setViewportSize({width:1440, height:800});
  const project = course();
  for (let i = 0; i < 24; i++) {
    const id = 'extra-' + i;
    project.modules[0].lessonIds.push(id);
    project.lessons.push({id, title:'Дополнительный урок ' + i, html:'<p>Материал</p>'});
  }
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#fileInput').setInputFiles({name:'long-course.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#courseSummary')).toContainText('27 уроков');
  const from = await grip(page, 'lesson', 'a').boundingBox();
  await page.mouse.move(from.x + 10, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, 780, {steps:8});
  await expect.poll(() => page.locator('#sidebar').evaluate(el => el.scrollTop), {timeout:7000}).toBeGreaterThan(1000);
  await group(page, 'empty').evaluate(el => el.scrollIntoView({block:'center'}));
  const target = await group(page, 'empty').locator('.module-toggle').boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {steps:5});
  await expect(group(page, 'empty')).toHaveClass(/drop-inside/);
  await page.mouse.up();
  const saved = await stored(page);
  expect(saved.modules[2].lessonIds).toEqual(['a']);
  expect(saved.modules.flatMap(m => m.lessonIds)).toHaveLength(27);
  expect(new Set(saved.modules.flatMap(m => m.lessonIds)).size).toBe(27);
});
