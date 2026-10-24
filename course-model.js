"use strict";
// Portable course data. Server persistence can later replace localStorage without changing the hierarchy.
window.CourseModel = (() => {
  const types = {
    note: {name: "Конспект", icon: "≡", description: "Текст, изображения и примеры кода"},
    single: {name: "Один ответ", icon: "◉", description: "Выбор одного правильного варианта"},
    multi: {name: "Несколько ответов", icon: "☑", description: "Выбор нескольких правильных вариантов"},
    match: {name: "Сопоставление", icon: "⇄", description: "Соединение элементов в пары"},
    sort: {name: "Сортировка", icon: "↕", description: "Восстановление правильного порядка"},
    table: {name: "Таблица", icon: "▦", description: "Выбор правильных ячеек"},
    blanks: {name: "Пропуски", icon: "▤", description: "Заполнение пропусков в тексте"},
    number: {name: "Числовой ответ", icon: "№", description: "Число с допустимой погрешностью"},
    text: {name: "Текстовый ответ", icon: "T", description: "Короткий ответ с автоматической проверкой"}
  };
  const defaults = {
    note: {html: "<p></p>"},
    single: {options: [{text: "Вариант 1", correct: true}, {text: "Вариант 2", correct: false}]},
    multi: {options: [{text: "Вариант 1", correct: true}, {text: "Вариант 2", correct: false}]},
    match: {pairs: [["Термин", "Определение"], ["Термин 2", "Определение 2"]]},
    sort: {items: ["Первый элемент", "Второй элемент"]},
    table: {rows: ["Строка 1", "Строка 2"], cols: ["Столбец 1", "Столбец 2"], correct: ["0:0"]},
    blanks: {template: "Язык Godot — {{GDScript}}."},
    number: {answer: 42, tolerance: 0},
    text: {answers: ["ответ"], caseSensitive: false}
  };
  const id = () => crypto.randomUUID();
  const text = (value, fallback = "", limit = 20000) => String(value ?? fallback).slice(0, limit);
  const finite = (value, fallback) => value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const list = (value, fallback) => (Array.isArray(value) && value.length ? value : fallback).slice(0, 100);
  function createStep(type = "note") {
    if (!Object.hasOwn(types, type)) type = "note";
    return {id: id(), type, title: types[type].name, question: "", explanation: "", correctExplanation: "", incorrectExplanation: "", points: type === "note" ? 0 : 1, ...structuredClone(defaults[type])};
  }
  function normalizeStep(raw, sanitize) {
    raw = raw && typeof raw === "object" ? raw : {};
    const step = createStep(raw.type);
    step.id = text(raw.id || step.id, "", 90);
    step.title = text(raw.title, step.title, 160);
    step.question = text(raw.question);
    // Preserve legacy shared feedback on success; new feedback is outcome-specific.
    step.explanation = text(raw.explanation);
    step.correctExplanation = text(raw.correctExplanation ?? raw.explanation);
    step.incorrectExplanation = text(raw.incorrectExplanation);
    step.points = Math.max(0, Math.min(100, finite(raw.points, step.points)));
    if (step.type === "note") step.html = sanitize(text(raw.html, "", 3 * 1024 * 1024));
    if (["single", "multi"].includes(step.type)) {
      step.options = list(raw.options, step.options).map(o => ({text: text(o?.text, "Вариант"), correct: o?.correct === true}));
      if (step.type === "single") {
        const first = step.options.findIndex(o => o.correct);
        step.options.forEach((o, i) => o.correct = i === first);
      }
    }
    if (step.type === "match") step.pairs = list(raw.pairs, step.pairs).map(p => [text(p?.[0]), text(p?.[1])]);
    if (step.type === "sort") step.items = list(raw.items, step.items).map(v => text(v));
    if (step.type === "table") {
      step.rows = list(raw.rows, step.rows).map(v => text(v));
      step.cols = list(raw.cols, step.cols).map(v => text(v));
      step.correct = [...new Set((Array.isArray(raw.correct) ? raw.correct : step.correct).filter(v => typeof v === "string" && /^\d+:\d+$/.test(v) && +v.split(":")[0] < step.rows.length && +v.split(":")[1] < step.cols.length))];
    }
    if (step.type === "blanks") step.template = text(raw.template, step.template);
    if (step.type === "number") { step.answer = finite(raw.answer, 42); step.tolerance = Math.max(0, finite(raw.tolerance, 0)); }
    if (step.type === "text") { step.answers = list(raw.answers, step.answers).map(v => text(v)); step.caseSensitive = raw.caseSensitive === true; }
    return step;
  }
  return {types, createStep, normalizeStep};
})();
