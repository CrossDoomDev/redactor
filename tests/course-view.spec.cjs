const {test, expect} = require('@playwright/test');
const storageKey = 'kursograf.course-editor.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
const fixture = () => ({title:'Тестовый курс', activeId:'a', modules:[
  {id:'first', title:'Основы', lessonIds:['a','b'], expanded:true},
  {id:'second', title:'Практика', lessonIds:['c'], expanded:true},
  {id:'empty', title:'Пустой модуль', lessonIds:[], expanded:true}
], lessons:[
  {id:'a', title:'Первый урок', activeStepId:'note', steps:[
    {id:'note', type:'note', html:'<h2>Начало</h2><p>Материал курса</p><pre data-language="gdscript"><code>func ready():\n    pass</code></pre>'},
    {id:'quiz', type:'single', question:'Выберите ответ', correctExplanation:'', options:[{text:'Да',correct:true},{text:'Нет',correct:false}]}
  ]},
  {id:'b', title:'Второй урок', steps:[{id:'b-note', type:'note', html:'<p>Второй материал</p>'}]},
  {id:'c', title:'Третий урок', steps:[{id:'c-note', type:'note', html:'<p>Третий материал</p>'}]}
]});
const definitions = project => ({title:project.title,
  modules:project.modules.map(({id,title,lessonIds})=>({id,title,lessonIds})),
  lessons:project.lessons.map(({id,title,steps})=>({id,title,steps}))});

async function readNote(page) {
  await expect.poll(()=>page.locator('#previewFrame').evaluate(el=>el.contentDocument?.readyState === 'complete' && !!el.contentDocument?.body?.textContent.trim())).toBe(true);
  await page.locator('#previewFrame').evaluate(el=>el.scrollIntoView({block:'end'}));
  const rect = await page.locator('#previewFrame').boundingBox();
  await page.mouse.move(rect.x+20, Math.min(page.viewportSize().height-30, rect.y+rect.height-20));
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('End');
  await expect(page.locator('#stepTabs .active')).toHaveClass(/completed/);
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(({key,value})=>{
    if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(value));
  }, {key:storageKey,value:fixture()});
  await page.goto('/');
});

test('global learner view hides every editing surface and restores the exact HTML draft', async ({page}) => {
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await expect(page.locator('#tabPreview')).toHaveCount(0);
  await page.locator('#tabSource').click();
  const raw='<h2>Последние правки</h2>\n\n<p>Текст\nс переносом</p>';
  await page.locator('#sourceEditor').fill(raw);
  await page.locator('#learnerView').click();
  await expect(page.locator('#learnerView')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-author-only]:visible')).toHaveCount(0);
  await expect(page.locator('[contenteditable="true"]:visible')).toHaveCount(0);
  await expect(page.locator('.module-menu,.lesson-more,.structure-grip,.module-add-lesson')).toHaveCount(0);
  await expect(page.locator('#studentCourseTitle')).toHaveText('Тестовый курс');
  await expect(page.frameLocator('#previewFrame').locator('h2')).toHaveText('Последние правки');
  await expect(page.frameLocator('#previewFrame').locator('body')).toContainText('с переносом');
  await expect(page.locator('#completeNote')).toHaveCount(0);
  await page.locator('#authorView').click();
  await expect(page.locator('#tabSource')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#sourceEditor')).toHaveValue(raw);
  await expect(page.locator('.structure-grip').first()).toBeVisible();
  await expect(page.locator('#addModule')).toBeVisible();
  expect(errors).toEqual([]);
});

test('learner completes notes and quizzes and moves through every lesson and module without editing course data', async ({page}) => {
  // Persist the normalized model before comparing authored content.
  await page.locator('#exportJson').click();
  const before=definitions(await stored(page));
  await page.locator('#learnerView').click();
  await readNote(page);
  await expect(page.locator('#courseProgressLabel')).toHaveText('Пройдено 1 из 4 шагов');
  await page.locator('#nextStep').click();
  await expect(page.locator('.step-settings')).toHaveCount(0);
  await expect(page.locator('[data-correct],[data-option],[data-field]')).toHaveCount(0);
  await page.locator('[data-choice="1"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#stepResult')).toContainText('Ответ неверный');
  await expect(page.locator('#learnerProgress')).toHaveAttribute('value','1');
  await page.locator('[data-choice="0"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#courseProgressLabel')).toHaveText('Пройдено 2 из 4 шагов');
  await expect(page.locator('#nextStep')).toHaveText('Следующий урок →');
  await page.locator('#nextStep').click();
  await expect(page.locator('#lessonHeading')).toHaveText('Второй урок');
  await readNote(page);
  await page.locator('#nextStep').click();
  await expect(page.locator('#lessonHeading')).toHaveText('Третий урок');
  await expect(page.frameLocator('#previewFrame').locator('body')).toHaveText('Третий материал');
  await readNote(page);
  await expect(page.locator('#courseProgressLabel')).toHaveText('Пройдено 4 из 4 шагов');
  await expect(page.locator('#passageStatus')).toHaveText('Все шаги курса пройдены.');
  await expect(page.locator('#nextStep')).toBeDisabled();
  await page.locator('#previousStep').click();
  await expect(page.locator('#lessonHeading')).toHaveText('Второй урок');
  await expect(page.locator('#passageStatus')).toHaveText('Все шаги курса пройдены.');
  expect(definitions(await stored(page))).toEqual(before);
});

test('learner answers survive navigation and view switches and reset when the assignment changes', async ({page}) => {
  await page.locator('[data-step-id="quiz"]').click();
  await page.locator('#learnerView').click();
  await page.locator('[data-choice="0"]').check();
  await page.locator('[data-check]').click();
  await page.locator('[data-lesson-id="b"] .lesson-item').click();
  await page.locator('[data-lesson-id="a"] .lesson-item').click();
  await expect(page.locator('[data-choice="0"]')).toBeChecked();
  await expect(page.locator('#stepResult')).toContainText('✓ Правильно!');
  await page.locator('#authorView').click();
  await expect(page.locator('#stepStudent')).toHaveCount(0);
  await expect(page.locator('[data-field="question"]')).toHaveValue('Выберите ответ');
  await page.locator('#learnerView').click();
  await expect(page.locator('[data-choice="0"]')).toBeChecked();
  await page.locator('#authorView').click();
  await page.locator('[data-field="question"]').fill('Новый вопрос');
  await page.locator('#learnerView').click();
  await expect(page.locator('[data-choice="0"]')).not.toBeChecked();
  await expect(page.locator('#stepResult')).toBeEmpty();
  await expect(page.locator('#courseProgressLabel')).toHaveText('Пройдено 0 из 4 шагов');
});

test('learner cannot reorder steps or open author controls with the keyboard', async ({page}) => {
  await page.locator('#learnerView').click();
  const first=await page.locator('[data-step-id="note"]').boundingBox();
  const second=await page.locator('[data-step-id="quiz"]').boundingBox();
  await page.mouse.move(first.x+20, first.y+20); await page.mouse.down();
  await page.mouse.move(second.x+35, second.y+25,{steps:8}); await page.mouse.up();
  await expect(page.locator('.reorder-ghost')).toHaveCount(0);
  expect((await stored(page)).lessons[0].steps.map(s=>s.id)).toEqual(['note','quiz']);
  await page.locator('[data-lesson-id="a"] .lesson-item').focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect((await stored(page)).modules[0].lessonIds).toEqual(['a','b']);
  await expect(page.locator('#stepMenu')).toBeHidden();
  await expect(page.locator('#addStepInline,#addModule,#importButton,#exportJson,#exportHtml').filter({visible:true})).toHaveCount(0);
  await expect(page.locator('[data-module-id="empty"]')).toHaveText(/В модуле пока нет уроков/);
});

test('both views fit small screens and the mobile outline remains navigable', async ({page}) => {
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  for (const view of ['author','learner']) {
    await page.locator('#'+(view==='author'?'authorView':'learnerView')).click();
    for (const width of [1440,1024,768,390,360,320]) {
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
  await page.locator('#menuToggle').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.locator('[data-lesson-id="c"] .lesson-item').click();
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded','false');
  await expect(page.frameLocator('#previewFrame').locator('body')).toHaveText('Третий материал');
  await expect(page.locator('#learnerView')).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});

test('outcome-specific feedback replaces defaults, survives reload, and keeps the step icon', async ({page}) => {
  await page.locator('[data-step-id="quiz"]').click();
  await page.locator('[data-field="correctExplanation"]').fill('Авторский успех');
  await page.locator('[data-field="incorrectExplanation"]').fill('Авторская подсказка');
  await page.reload();
  await expect(page.locator('[data-field="incorrectExplanation"]')).toHaveValue('Авторская подсказка');
  await page.locator('#learnerView').click();
  await page.locator('[data-choice="1"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#stepResult')).toHaveText('Авторская подсказка');
  await page.locator('[data-choice="0"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#stepResult')).toHaveText('Авторский успех');
  await expect(page.locator('[data-step-id="quiz"]')).toHaveClass(/completed/);
  await expect(page.locator('[data-step-id="quiz"] .step-symbol')).toHaveText('◉');
  await page.locator('#authorView').click();
  await page.locator('[data-field="correctExplanation"]').fill('   ');
  await page.locator('[data-field="incorrectExplanation"]').fill('');
  await page.locator('#learnerView').click();
  await page.locator('[data-choice="1"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#stepResult')).toHaveText('Ответ неверный. Попробуйте ещё раз.');
  await page.locator('[data-choice="0"]').check();
  await page.locator('[data-check]').click();
  await expect(page.locator('#stepResult')).toHaveText('✓ Правильно!');
});

test('long notes complete only after a reading gesture reaches the end, preserving their icon', async ({page}) => {
  await page.locator('#tabSource').click();
  await page.locator('#sourceEditor').fill(Array.from({length:70},(_,i)=>`<p>Абзац ${i}</p>`).join(''));
  await page.locator('#learnerView').click();
  await expect.poll(()=>page.locator('#previewFrame').evaluate(el=>el.clientHeight)).toBeGreaterThan(2000);
  await expect(page.locator('[data-step-id="note"]')).not.toHaveClass(/completed/);
  await page.mouse.move(700,500);
  await page.mouse.wheel(0,150);
  await expect(page.locator('[data-step-id="note"]')).not.toHaveClass(/completed/);
  await page.locator('#previewFrame').evaluate(el=>el.scrollIntoView({block:'end'}));
  await expect(page.locator('[data-step-id="note"]')).toHaveClass(/completed/);
  await expect(page.locator('[data-step-id="note"] .step-symbol')).toHaveText('≡');
  await page.locator('[data-lesson-id="b"] .lesson-item').click();
  await expect(page.locator('[data-step-id="b-note"]')).not.toHaveClass(/completed/);
});
