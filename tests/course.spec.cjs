const {test, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
const storageKey = 'kursograf.course-editor.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
async function addStep(page, type) {
  await page.locator('#addStepInline').click();
  await page.locator(`[data-new="${type}"]`).click();
}
async function importProject(page, project) {
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#fileInput').setInputFiles({name:'course.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#toast')).toContainText('Импорт выполнен');
}
async function writeNote(page, text) {
  await page.locator('#tabSource').click();
  await page.locator('#sourceEditor').fill(`<p>${text}</p>`);
}
async function renameLesson(page, title) {
  await page.locator('.lesson-item.active + .lesson-more').click();
  await page.locator('#structureTitle').fill(title);
  await page.locator('#structureForm button[type="submit"]').click();
}
async function stepAction(page, id) {
  await page.locator('#stepMenu summary').click();
  await page.locator('#' + id).click();
}

test.beforeEach(async ({page}) => { await page.goto('/'); });

test('course outline, names, module CRUD, lesson move, duplication and deletion survive reload', async ({page}) => {
  await page.locator('#courseTitle').fill('Моя инди-игра');
  await expect(page.locator('#projectName')).toHaveText('Моя инди-игра');
  await page.locator('#addModule').click();
  await page.locator('#structureTitle').fill('Продвинутый Godot');
  await page.locator('#structureForm button[type="submit"]').click();
  const module = page.locator('.course-module').last();
  await expect(module.locator('.module-toggle')).toContainText('Продвинутый Godot');
  await module.locator('.module-add-lesson').click();
  await renameLesson(page, 'Сигналы и события');
  await writeNote(page, 'Содержимое нового урока');
  await page.locator('.lesson-item.active + .lesson-more').click();
  await page.locator('#structureModule').selectOption({label:'Знакомство с Godot'});
  await page.locator('#structureForm button[type="submit"]').click();
  await expect(page.locator('.course-module').first()).toContainText('Сигналы и события');
  await expect(page.locator('#editor')).toContainText('Содержимое нового урока');
  await page.locator('.lesson-item.active + .lesson-more').click();
  await page.locator('#structureDuplicate').click();
  await expect(page.locator('#lessonHeading')).toHaveText('Сигналы и события (копия)');
  await expect(page.locator('#editor')).toContainText('Содержимое нового урока');
  await page.locator('.lesson-item.active + .lesson-more').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#structureDelete').click();
  const emptyModule = page.locator('.course-module').last();
  await emptyModule.locator('.module-menu').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#structureDelete').click();
  await page.reload();
  await expect(page.locator('#courseTitle')).toHaveValue('Моя инди-игра');
  await expect(page.locator('.course-module')).toHaveCount(2);
  await expect(page.locator('.lesson-item')).toHaveCount(4);
});

test('text steps keep separate HTML on immediate switches, duplication, reordering and reload', async ({page}) => {
  await writeNote(page, 'Первый конспект');
  await addStep(page, 'note');
  await writeNote(page, 'Второй текст');
  await page.locator('[data-step="0"]').click();
  await expect(page.locator('#editor')).toHaveText('Первый конспект');
  await page.locator('#stepTabs').getByRole('tab', {selected:true}).press('ArrowRight');
  await expect(page.locator('#editor')).toHaveText('Второй текст');
  await stepAction(page, 'stepDuplicate');
  const duplicateId = await page.locator('#stepTabs [aria-selected="true"]').getAttribute('data-step-id');
  await expect(page.locator('#editor')).toHaveText('Второй текст');
  await stepAction(page, 'stepMoveLeft');
  await expect(page.locator('#stepNavigationLabel')).toHaveText('2 / 3');
  await page.locator('.lesson-item').nth(1).click();
  await page.locator('.lesson-item').first().click();
  await expect(page.locator('#stepTabs [aria-selected="true"]')).toHaveAttribute('data-step-id', duplicateId);
  await page.reload();
  await expect(page.locator('#stepTabs [aria-selected="true"]')).toHaveAttribute('data-step-id', duplicateId);
  await expect(page.locator('#editor')).toHaveText('Второй текст');
  page.once('dialog', dialog => dialog.accept());
  await stepAction(page, 'stepDelete');
  await expect(page.locator('[data-step]')).toHaveCount(2);
});

test('single answer preview is interactive and author changes persist with all course steps', async ({page}) => {
  await addStep(page, 'single');
  await page.locator('[data-field="question"]').fill('Какой язык используется в Godot?');
  await page.locator('[data-option="0"]').fill('GDScript');
  await page.locator('[data-option="1"]').fill('HTML');
  await page.locator('[data-field="correctExplanation"]').fill('В Godot используется GDScript.');
  await page.locator('#learnerView').click();
  await page.locator('[data-choice="1"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#stepResult')).toContainText('Ответ неверный');
  await page.locator('[data-choice="0"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#stepResult')).toHaveText('В Godot используется GDScript.');
  await page.locator('#authorView').click();
  await page.locator('[data-step="0"]').click();
  await expect(page.locator('#editor')).toContainText('Добро пожаловать');
  await page.locator('[data-step="1"]').click();
  await page.reload();
  await expect(page.locator('#stepTabs [aria-selected="true"]')).toHaveAttribute('aria-label', 'Шаг 2: Один ответ');
  await expect(page.locator('[data-option="0"]')).toHaveValue('GDScript');
  await expect(page.locator('#exportHtml')).toBeDisabled();
});

for (const type of ['multi','match','sort','table','blanks','number','text']) {
  test(`${type} task checks both wrong and correct answers and persists`, async ({page}) => {
    await addStep(page, type);
    await page.locator('[data-field="question"]').fill('Проверочное задание');
    await page.locator('#learnerView').click();
    // The reversed initial order in sorting is intentionally wrong.
    await page.locator('[data-check]').click();
    await expect(page.locator('#stepResult')).toContainText('Ответ неверный');
    if (type === 'multi') await page.locator('[data-choice="0"]').check();
    if (type === 'match') {
      await page.locator('[data-match="0"]').selectOption('0');
      await page.locator('[data-match="1"]').selectOption('1');
    }
    if (type === 'sort') await page.locator('[data-sort="0:1"]').click();
    if (type === 'table') await page.locator('[data-answer-cell="0:0"]').check();
    if (type === 'blanks') await page.locator('[data-blank]').fill('GDScript');
    if (type === 'number') await page.locator('#answerText').fill('42');
    if (type === 'text') await page.locator('#answerText').fill('ОТВЕТ');
    await page.locator('[data-check]').click();
    await expect(page.locator('#stepResult')).toHaveText('✓ Правильно!');
    await page.reload();
    await expect(page.locator('[data-field="question"]')).toHaveValue('Проверочное задание');
    await expect(page.locator('#stepTabs [aria-selected="true"]')).toHaveAttribute('aria-label', 'Шаг 2: ' + {multi:'Несколько ответов',match:'Сопоставление',sort:'Сортировка',table:'Таблица',blanks:'Пропуски',number:'Числовой ответ',text:'Текстовый ответ'}[type]);
  });
}

test('table deletion remaps correct cells, and invalid task configuration prevents checking', async ({page}) => {
  await addStep(page, 'table');
  await page.locator('[data-cell="1:1"]').check();
  await page.locator('[data-cell="0:0"]').uncheck();
  await page.locator('[data-remove="row:0"]').click();
  await expect(page.locator('[data-cell="0:1"]')).toBeChecked();
  await page.locator('[data-remove="col:0"]').click();
  await expect(page.locator('[data-cell="0:0"]')).toBeChecked();
  await page.locator('#learnerView').click();
  await page.locator('[data-answer-cell="0:0"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#stepResult')).toHaveText('✓ Правильно!');
  await page.locator('#authorView').click();
  await addStep(page, 'multi');
  await page.locator('[data-correct="0"]').uncheck();
  await expect(page.locator('.configuration-warning')).toContainText('правильный ответ');
  await page.locator('#learnerView').click();
  await expect(page.locator('[data-check]')).toBeDisabled();
});

test('legacy HTML project migrates; JSON export/import keeps hierarchy and sanitizes imported steps', async ({page}) => {
  await importProject(page, {lessons:[{id:'old', title:'Старый урок', html:'<p>Старый текст</p>'}]});
  await expect(page.locator('#editor')).toHaveText('Старый текст');
  await expect(page.locator('[data-step]')).toHaveCount(1);
  await addStep(page, 'single');
  await page.locator('[data-option="0"]').fill('Сохранённый ответ');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportJson').click();
  const download = await downloadPromise;
  const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(backup.version).toBe(3);
  expect(backup.modules[0].lessonIds).toEqual(['old']);
  expect(backup.lessons[0].steps).toHaveLength(2);
  backup.lessons[0].steps[0].html = '<p>Безопасный текст<script>window.infected=true</script><img src="x" onerror="window.infected=true"></p>';
  await importProject(page, backup);
  await page.locator('[data-step="0"]').click();
  await expect(page.locator('#editor')).toHaveText('Безопасный текст');
  expect(await page.evaluate(() => window.infected)).toBeUndefined();
  await expect(page.locator('#editor script, #editor [onerror]')).toHaveCount(0);
});

test('HTML import is listed in the active module and malformed step data is normalized', async ({page}) => {
  await page.locator('#fileInput').setInputFiles({name:'imported.html',mimeType:'text/html',buffer:Buffer.from('<p>Импортированный материал</p>')});
  await expect(page.locator('.lesson-item.active')).toContainText('imported');
  await expect(page.locator('#editor')).toHaveText('Импортированный материал');
  await page.reload();
  await expect(page.locator('.lesson-item.active')).toContainText('imported');
  await importProject(page, {lessons:[{id:'broken',title:'Восстановленный урок',steps:[{id:'dup',type:'single',options:null},{id:'dup',type:'table',rows:null,cols:{}},null]}],modules:[null,{id:'m',lessonIds:['broken','broken']},{id:'m'}]});
  await expect(page.locator('[data-step]')).toHaveCount(3);
  await page.locator('[data-step="1"]').click();
  await expect(page.locator('.step-grid')).toHaveCount(1);
  const project = await stored(page);
  expect(new Set(project.modules.map(m=>m.id)).size).toBe(project.modules.length);
  expect(new Set(project.lessons[0].steps.map(s=>s.id)).size).toBe(3);
});

test('responsive layout, mobile outline and all step scripts work without browser errors', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await addStep(page, 'note');
  await addStep(page, 'single');
  for (const width of [1440,1024,768,390,360]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.locator('#menuToggle').click();
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded','true');
  await page.locator('.lesson-item').nth(1).click();
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#stepMenu summary').click();
  await expect(page.locator('#stepDelete')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('lesson names change only in the outline; step types and compact actions stay usable', async ({page}) => {
  await expect(page.locator('#lessonTitle,#stepTitle,.lesson-details,.step-details')).toHaveCount(0);
  await writeNote(page, 'Материал до переименования');
  await renameLesson(page, 'Название из меню');
  await expect(page.locator('#lessonHeading')).toHaveText('Название из меню');
  await expect(page.locator('.lesson-item.active')).toContainText('Название из меню');
  await writeNote(page, 'Материал после переименования');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportHtml').click();
  const download = await downloadPromise;
  const html = await fs.readFile(await download.path(), 'utf8');
  expect(html).toContain('<title>Название из меню</title>');
  await page.reload();
  await expect(page.locator('#lessonHeading')).toHaveText('Название из меню');
  await expect(page.locator('#editor')).toHaveText('Материал после переименования');
  await page.locator('#stepMenu summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#stepDelete')).toBeVisible();
  await expect(page.locator('#stepDelete')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#stepDelete')).toBeHidden();
  await expect(page.locator('#stepMenu summary')).toBeFocused();
  await addStep(page, 'single');
  await expect(page.locator('#stepTabs [aria-selected="true"]')).toHaveAttribute('aria-label', 'Шаг 2: Один ответ');
  await expect(page.locator('#stepStudent')).toHaveCount(0);
  await page.locator('#stepMenu summary').click();
  await expect(page.locator('#stepDelete')).toBeEnabled();
  await page.locator('[data-field="question"]').click();
  await expect(page.locator('#stepDelete')).toBeHidden();
  await page.locator('#learnerView').click();
  await expect(page.locator('#stepStudent h3')).toHaveText('Один ответ');
});
