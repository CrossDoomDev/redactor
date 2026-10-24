"use strict";
(() => {
  const b = window.kursografBridge;
  const {types, createStep} = window.CourseModel;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const lesson = () => b.selectedLesson();
  const selected = () => b.selectedStep();
  const index = () => lesson().steps.indexOf(selected());
  let sortAnswer = [];

  function field(label, key, value, area = false, numeric = false) {
    return `<label class="step-field">${label}${area
      ? `<textarea data-field="${key}">${esc(value)}</textarea>`
      : `<input data-field="${key}" ${numeric ? 'type="number" step="any"' : ''} ${key === "points" || key === "tolerance" ? 'min="0"' : ''} ${key === "points" ? 'max="100"' : ''} value="${esc(value)}">`}</label>`;
  }
  function removeButton(kind, i, disabled = false) {
    return `<button type="button" data-remove="${kind}:${i}" aria-label="Удалить элемент ${i + 1}" ${disabled ? 'disabled' : ''}>×</button>`;
  }
  function items(values, kind) {
    const min = kind === "item" ? 2 : 1;
    return values.map((value, i) => `<div class="step-line"><span class="item-number">${i + 1}</span><input aria-label="${kind === "item" ? "Элемент" : kind === "row" ? "Строка" : "Столбец"} ${i + 1}" data-item="${kind}:${i}" value="${esc(value)}">${removeButton(kind, i, values.length <= min)}</div>`).join("") + `<button type="button" class="button button-secondary" data-add="${kind}">＋ Добавить</button>`;
  }
  function grid(step, author) {
    return `<div class="grid-scroll"><table class="step-grid"><caption>${author ? "Отметьте правильные ячейки" : "Выберите ячейки"}</caption><thead><tr><th scope="col"></th>${step.cols.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${step.rows.map((row, i) => `<tr><th scope="row">${esc(row)}</th>${step.cols.map((col, j) => `<td><input type="checkbox" aria-label="${esc(row)}: ${esc(col)}" data-${author ? "cell" : "answer-cell"}="${i}:${j}" ${author && step.correct.includes(i + ":" + j) ? "checked" : ""}></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function settings(step) {
    switch (step.type) {
      case "single": case "multi":
        return `<h3>Варианты ответов</h3><p class="field-help">Отметьте ${step.type === "single" ? "правильный ответ" : "все правильные ответы"} слева от текста.</p>` + step.options.map((o, i) => `<div class="step-line"><input type="${step.type === "single" ? "radio" : "checkbox"}" name="correctOption" aria-label="Правильный вариант ${i + 1}" data-correct="${i}" ${o.correct ? "checked" : ""}><input aria-label="Вариант ${i + 1}" data-option="${i}" value="${esc(o.text)}">${removeButton("option", i, step.options.length <= 2)}</div>`).join("") + '<button type="button" class="button button-secondary" data-add="option">＋ Вариант ответа</button>';
      case "match":
        return '<h3>Правильные пары</h3><p class="field-help">В предпросмотре правая часть перемешана.</p>' + step.pairs.map((pair, i) => `<div class="step-line"><input aria-label="Левая часть пары ${i + 1}" data-pair="${i}:0" value="${esc(pair[0])}"><span>↔</span><input aria-label="Правая часть пары ${i + 1}" data-pair="${i}:1" value="${esc(pair[1])}">${removeButton("pair", i, step.pairs.length <= 1)}</div>`).join("") + '<button type="button" class="button button-secondary" data-add="pair">＋ Добавить пару</button>';
      case "sort": return '<h3>Элементы в правильном порядке</h3><p class="field-help">Ученик получит элементы в другом порядке.</p>' + items(step.items, "item");
      case "table": return '<h3>Строки</h3>' + items(step.rows, "row") + '<h3>Столбцы</h3>' + items(step.cols, "col") + grid(step, true);
      case "blanks": return field("Текст с пропусками", "template", step.template, true) + '<p class="field-help">Заключайте правильные ответы в двойные скобки: Язык Godot — {{GDScript}}.</p>';
      case "number": return field("Правильное число", "answer", step.answer, false, true) + field("Допустимая погрешность", "tolerance", step.tolerance, false, true);
      case "text": return field("Допустимые ответы, каждый с новой строки", "answers", step.answers.join("\n"), true) + `<label class="check-label"><input type="checkbox" data-bool="caseSensitive" ${step.caseSensitive ? "checked" : ""}> Учитывать регистр</label>`;
      default: return "";
    }
  }
  function configurationError(step) {
    const nonempty = value => String(value ?? "").trim().length > 0;
    if (["single", "multi"].includes(step.type) && (step.options.length < 2 || step.options.some(o => !nonempty(o.text)) || !step.options.some(o => o.correct))) return "Заполните минимум два варианта и отметьте правильный ответ.";
    if (step.type === "match" && (!step.pairs.length || step.pairs.some(p => p.some(v => !nonempty(v))))) return "Заполните обе части каждой пары.";
    if (step.type === "sort" && (step.items.length < 2 || step.items.some(v => !nonempty(v)))) return "Добавьте минимум два непустых элемента.";
    if (step.type === "table" && (!step.correct.length || [...step.rows, ...step.cols].some(v => !nonempty(v)))) return "Заполните названия строк и столбцов и отметьте правильные ячейки.";
    if (step.type === "blanks" && !/\{\{\s*[^{}\s][^{}]*\}\}/.test(step.template)) return "Добавьте хотя бы один непустой пропуск в {{двойных скобках}}.";
    if (step.type === "number" && (!nonempty(step.answer) || !Number.isFinite(Number(step.answer)) || !nonempty(step.tolerance) || !Number.isFinite(Number(step.tolerance)) || Number(step.tolerance) < 0)) return "Укажите число и неотрицательную погрешность.";
    if (step.type === "text" && !step.answers.some(nonempty)) return "Добавьте хотя бы один допустимый ответ.";
    if (step.points === "" || !Number.isFinite(Number(step.points)) || +step.points < 0 || +step.points > 100) return "Баллы должны быть числом от 0 до 100.";
    return "";
  }
  function renderTabs() {
    const active = index(), step = selected();
    $("stepTabs").innerHTML = lesson().steps.map((s, i) => `<button type="button" id="step-tab-${i}" class="step-tab ${i === active ? "active" : ""}" data-step="${i}" data-step-id="${esc(s.id)}" role="tab" aria-selected="${i === active}" aria-controls="stepContent" tabindex="${i === active ? "0" : "-1"}" aria-label="Шаг ${i + 1}: ${esc(types[s.type].name)}" title="${types[s.type].name}. Перетащите, чтобы изменить порядок."><span class="step-number">${i + 1}</span><span class="step-symbol" aria-hidden="true">${types[s.type].icon}</span></button>`).join("");
    $("stepContent").setAttribute("aria-labelledby", "step-tab-" + active);
    $("stepMenu").open = false;
    $("stepNavigationLabel").textContent = (active + 1) + " / " + lesson().steps.length;
    $("stepMoveLeft").disabled = $("previousStep").disabled = active === 0;
    $("stepMoveRight").disabled = $("nextStep").disabled = active === lesson().steps.length - 1;
    $("stepDelete").disabled = lesson().steps.length === 1;
    $("noteCopyActions").hidden = $("exportHtml").disabled = step.type !== "note";
  }
  function draw() {
    renderTabs();
    const step = selected();
    $("noteEditorRegion").hidden = step.type !== "note";
    $("stepQuizPanel").hidden = step.type === "note";
    if (step.type === "note") return;
    $("stepQuizPanel").innerHTML = `<div class="step-editor-cols"><section class="step-settings" aria-label="Настройки задания"><div class="panel-heading"><h2>Содержание задания</h2><span>Режим автора</span></div>${field("Условие задания", "question", step.question, true)}${settings(step)}<div class="assignment-scoring">${field("Баллы за правильный ответ", "points", step.points, false, true)}</div>${field("Пояснение после проверки", "explanation", step.explanation, true)}</section><section class="step-student" aria-label="Предпросмотр ученика"><div class="panel-heading"><h2>Как видит ученик</h2><span>Предпросмотр</span></div><div id="stepStudent"></div></section></div>`;
    student();
  }
  function student() {
    const step = selected();
    if (step.type === "note") return;
    let html = `<h3>${esc(types[step.type].name)}</h3><p class="student-question">${esc(step.question || "Здесь появится условие задания.")}</p>`;
    if (["single", "multi"].includes(step.type)) html += step.options.map((o, i) => `<label class="student-option"><input type="${step.type === "single" ? "radio" : "checkbox"}" name="studentChoice" data-choice="${i}"><span>${esc(o.text)}</span></label>`).join("");
    if (step.type === "match") html += step.pairs.map((p, i) => `<label class="match-answer"><span>${esc(p[0])}</span><select aria-label="Ответ для ${esc(p[0])}" data-match="${i}"><option value="">Выберите соответствие</option>${step.pairs.map((pair, j) => ({pair, j})).reverse().map(({pair, j}) => `<option value="${j}">${esc(pair[1])}</option>`).join("")}</select></label>`).join("");
    if (step.type === "sort") { sortAnswer = step.items.map((_, i) => i).reverse(); html += '<div id="sortAnswer"></div>'; }
    if (step.type === "table") html += grid(step, false);
    if (step.type === "blanks") {
      let number = 0;
      html += '<div class="blanks-answer">' + esc(step.template).replace(/\{\{([^{}]+)\}\}/g, () => `<input data-blank aria-label="Пропуск ${++number}" placeholder="Ответ">`) + '</div>';
    }
    if (["number", "text"].includes(step.type)) html += `<label class="step-field">Ваш ответ<input id="answerText" ${step.type === "number" ? 'inputmode="decimal"' : ''} autocomplete="off" placeholder="Введите ответ"></label>`;
    const error = configurationError(step);
    $("stepStudent").innerHTML = html + `${error ? `<p class="configuration-warning" role="status">${esc(error)}</p>` : ""}<div class="student-submit"><button type="button" class="button button-primary" data-check ${error ? "disabled" : ""}>Проверить ответ</button><span>${esc(step.points)} балл.</span></div><div id="stepResult" role="status" aria-live="polite"></div>`;
    drawSort();
  }
  function drawSort() {
    if (!$("sortAnswer")) return;
    $("sortAnswer").innerHTML = sortAnswer.map((answer, i) => `<div class="sort-answer-row"><span>${esc(selected().items[answer])}</span><button type="button" class="button button-secondary" data-sort="${i}:-1" aria-label="Переместить ответ ${i + 1} выше" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="button button-secondary" data-sort="${i}:1" aria-label="Переместить ответ ${i + 1} ниже" ${i === sortAnswer.length - 1 ? 'disabled' : ''}>↓</button></div>`).join("");
  }
  function check() {
    const step = selected(), query = selector => [...$("stepStudent").querySelectorAll(selector)];
    if (configurationError(step)) return;
    let ok = false;
    if (["single", "multi"].includes(step.type)) {
      const answers = query("[data-choice]:checked").map(el => +el.dataset.choice);
      const correct = step.options.flatMap((o, i) => o.correct ? [i] : []);
      ok = answers.length === correct.length && correct.every(i => answers.includes(i));
    }
    if (step.type === "match") ok = query("[data-match]").every((el, i) => el.value !== "" && step.pairs[+el.value][1] === step.pairs[i][1]);
    if (step.type === "sort") ok = sortAnswer.every((answer, i) => step.items[answer] === step.items[i]);
    if (step.type === "table") {
      const answers = query("[data-answer-cell]:checked").map(el => el.dataset.answerCell);
      ok = answers.length === step.correct.length && step.correct.every(cell => answers.includes(cell));
    }
    if (step.type === "blanks") {
      const answers = [...step.template.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1].trim());
      ok = query("[data-blank]").every((el, i) => el.value.trim() === answers[i]);
    }
    if (step.type === "number") {
      const raw = $("answerText").value.trim();
      const value = Number(raw.replace(",", "."));
      ok = raw !== "" && Number.isFinite(value) && Math.abs(value - Number(step.answer)) <= Number(step.tolerance);
    }
    if (step.type === "text") {
      const normalize = value => step.caseSensitive ? value.trim() : value.trim().toLocaleLowerCase("ru");
      const value = $("answerText").value;
      ok = value.trim() !== "" && step.answers.filter(v => v.trim()).some(answer => normalize(answer) === normalize(value));
    }
    const result = $("stepResult");
    result.className = ok ? "result-correct" : "result-incorrect";
    result.textContent = (ok ? "✓ Правильно!" : "Ответ неверный. Попробуйте ещё раз.") + (step.explanation ? " " + step.explanation : "");
  }
  function add(type) {
    if (lesson().steps.length >= 150) { b.toast("В одном уроке поддерживается до 150 шагов."); return; }
    b.saveNow();
    const step = createStep(type);
    lesson().steps.splice(index() + 1, 0, step);
    $("stepTypeDialog").close();
    b.switchStep(step.id);
    $("stepTabs").querySelector('[aria-selected="true"]').focus();
  }
  function move(direction) {
    b.saveNow();
    const steps = lesson().steps, from = index(), to = from + direction;
    if (to < 0 || to >= steps.length) return;
    [steps[from], steps[to]] = [steps[to], steps[from]];
    b.persist(); draw();
  }
  window.CourseReorder.bind({
    root: $("stepTabs"), handle: ".step-tab",
    source(tab) {
      const step = lesson().steps.find(s => s.id === tab.dataset.stepId);
      return step && {id: step.id, lessonId: lesson().id, label: types[step.type].name};
    },
    locate(data, hit, x) {
      const tab = hit.closest(".step-tab");
      if (!tab || tab.dataset.stepId === data.id) return null;
      const rect = tab.getBoundingClientRect();
      return {id: tab.dataset.stepId, element: tab, edge: x < rect.left + rect.width / 2 ? "before" : "after"};
    },
    commit(data, target) {
      if (lesson().id !== data.lessonId) return;
      b.saveNow();
      const steps = lesson().steps, from = steps.findIndex(s => s.id === data.id);
      let to = steps.findIndex(s => s.id === target.id);
      if (from < 0 || to < 0) return;
      if (target.edge === "after") to++;
      const [step] = steps.splice(from, 1);
      if (from < to) to--;
      steps.splice(to, 0, step);
      b.persist(); renderTabs();
      b.toast("Порядок шагов изменён.");
    }
  });
  $("stepTypeChoices").innerHTML = Object.entries(types).map(([type, {name, icon, description}]) => `<button type="button" data-new="${type}"><span class="type-choice-icon" aria-hidden="true">${icon}</span><span><strong>${name}</strong><small>${description}</small></span></button>`).join("");
  $("addStepInline").addEventListener("click", () => $("stepTypeDialog").showModal());
  $("closeStepTypes").addEventListener("click", () => $("stepTypeDialog").close());
  $("stepTypeChoices").addEventListener("click", event => { const button = event.target.closest("[data-new]"); if (button) add(button.dataset.new); });
  $("stepTabs").addEventListener("click", event => { const tab = event.target.closest("[data-step]"); if (tab) b.switchStep(lesson().steps[+tab.dataset.step].id); });
  $("stepTabs").addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? lesson().steps.length - 1 : (index() + (event.key === "ArrowRight" ? 1 : -1) + lesson().steps.length) % lesson().steps.length;
    b.switchStep(lesson().steps[target].id); $("stepTabs").querySelector('[aria-selected="true"]').focus();
  });
  $("stepMenu").addEventListener("click", event => {
    if (event.target.closest("button:not(:disabled)")) {
      $("stepMenu").open = false;
      $("stepMenu").querySelector("summary").focus();
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!$("stepMenu").contains(event.target)) $("stepMenu").open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("stepMenu").open) {
      $("stepMenu").open = false;
      $("stepMenu").querySelector("summary").focus();
    }
  });
  $("previousStep").onclick = () => { if (index() > 0) b.switchStep(lesson().steps[index() - 1].id); };
  $("nextStep").onclick = () => { if (index() < lesson().steps.length - 1) b.switchStep(lesson().steps[index() + 1].id); };
  $("stepMoveLeft").onclick = () => move(-1);
  $("stepMoveRight").onclick = () => move(1);
  $("stepDuplicate").onclick = () => {
    if (lesson().steps.length >= 150) { b.toast("В одном уроке поддерживается до 150 шагов."); return; }
    b.saveNow();
    const copy = structuredClone(selected()); copy.id = b.makeId();
    lesson().steps.splice(index() + 1, 0, copy); b.switchStep(copy.id);
  };
  $("stepDelete").onclick = () => {
    if (lesson().steps.length <= 1 || !confirm("Удалить шаг " + (index() + 1) + " («" + types[selected().type].name + "»)?")) return;
    b.saveNow();
    const old = index(); lesson().steps.splice(old, 1);
    lesson().activeStepId = lesson().steps[Math.min(old, lesson().steps.length - 1)].id;
    b.setMode("visual"); b.mountLesson(); b.persist();
  };
  $("stepQuizPanel").addEventListener("input", event => {
    const t = event.target, step = selected();
    if (!t.closest(".step-settings")) { if ($("stepResult")) $("stepResult").textContent = ""; return; }
    if (t.dataset.field) step[t.dataset.field] = t.dataset.field === "answers" ? t.value.split("\n") : t.type === "number" && t.value !== "" ? Number(t.value) : t.value;
    else if (t.dataset.option !== undefined) step.options[+t.dataset.option].text = t.value;
    else if (t.dataset.pair) { const [i, j] = t.dataset.pair.split(":").map(Number); step.pairs[i][j] = t.value; }
    else if (t.dataset.item) { const [kind, i] = t.dataset.item.split(":"); step[kind === "item" ? "items" : kind === "row" ? "rows" : "cols"][+i] = t.value; }
    else return;
    if (t.dataset.item && step.type === "table") $("stepQuizPanel").querySelector(".step-settings .grid-scroll").outerHTML = grid(step, true);
    b.persist(); student();
  });
  $("stepQuizPanel").addEventListener("change", event => {
    const t = event.target, step = selected();
    if (!t.closest(".step-settings")) return;
    if (t.dataset.correct !== undefined) {
      if (step.type === "single") step.options.forEach((option, i) => option.correct = i === +t.dataset.correct);
      else step.options[+t.dataset.correct].correct = t.checked;
    } else if (t.dataset.cell) {
      step.correct = step.correct.filter(cell => cell !== t.dataset.cell);
      if (t.checked) step.correct.push(t.dataset.cell);
    } else if (t.dataset.bool) step[t.dataset.bool] = t.checked;
    else return;
    b.persist(); student();
  });
  $("stepQuizPanel").addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    const step = selected();
    if (button.hasAttribute("data-check")) { check(); return; }
    if (button.dataset.sort) {
      const [i, d] = button.dataset.sort.split(":").map(Number);
      if (sortAnswer[i + d] !== undefined) [sortAnswer[i], sortAnswer[i + d]] = [sortAnswer[i + d], sortAnswer[i]];
      drawSort(); $("stepResult").textContent = ""; return;
    }
    const kind = button.dataset.add;
    const collection = {option: "options", pair: "pairs", item: "items", row: "rows", col: "cols"}[kind];
    if (collection && step[collection].length >= 100) { b.toast("Поддерживается до 100 элементов в списке."); return; }
    if (kind === "option") step.options.push({text: "Новый вариант", correct: false});
    if (kind === "pair") step.pairs.push(["Термин", "Определение"]);
    if (kind === "item") step.items.push("Новый элемент");
    if (kind === "row") step.rows.push("Новая строка");
    if (kind === "col") step.cols.push("Новый столбец");
    if (button.dataset.remove) {
      const [kind, rawIndex] = button.dataset.remove.split(":"), i = +rawIndex;
      const values = step[{option: "options", pair: "pairs", item: "items", row: "rows", col: "cols"}[kind]];
      if (values.length <= (["option", "item"].includes(kind) ? 2 : 1)) return;
      values.splice(i, 1);
      if (["row", "col"].includes(kind)) {
        const axis = kind === "row" ? 0 : 1;
        step.correct = step.correct.flatMap(cell => {
          const coords = cell.split(":").map(Number);
          if (coords[axis] === i) return [];
          if (coords[axis] > i) coords[axis]--;
          return [coords.join(":")];
        });
      }
    }
    b.persist(); draw();
  });
  window.addEventListener("kursograf:lesson-mounted", draw);
  draw();
})();
