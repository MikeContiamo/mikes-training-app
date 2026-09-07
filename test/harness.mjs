// Minimaler DOM-Stub, damit die App-Logik in Node testbar ist.
// Nur so viel, wie index.html tatsächlich anfasst.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function makeEl(id) {
  const el = {
    id, textContent: '', innerHTML: '', disabled: false,
    style: {}, dataset: {},
    _classes: new Set(),
    firstChild: { textContent: '' },
    classList: {
      add: (...c) => c.forEach(x => el._classes.add(x)),
      remove: (...c) => c.forEach(x => el._classes.delete(x)),
      contains: c => el._classes.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !el._classes.has(c) : !!on;
        want ? el._classes.add(c) : el._classes.delete(c);
        return want;
      },
    },
    set className(v) { el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return [...el._classes].join(' '); },
    addEventListener() {}, offsetHeight: 0, checked: false,
  };
  return el;
}

export function boot({ search = '', store = {}, htmlPath = null } = {}) {
  const els = new Map();
  const $ = id => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };

  const localStorage = {
    _d: { ...store },
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };

  const sandbox = {
    document: {
      getElementById: $,
      querySelectorAll: () => [],
      addEventListener: () => {},
      visibilityState: 'visible',
    },
    localStorage,
    location: { search, protocol: 'http:', hostname: 'test' },
    navigator: { vibrate: () => {}, userAgent: 'node' },
    window: {},
    URLSearchParams,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    confirm: () => true,
    console,
    Math, Date, JSON, Object, Array, Number, String, Set, Map, isNaN, parseInt, parseFloat,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const html = readFileSync(htmlPath || join(here, '..', 'index.html'), 'utf8');
  const code = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

  // Im Sandbox-Scope ausführen und die Interna zum Testen herausgeben.
  const exposed = [
    'buildWorkout', 'estimateSec', 'applyProgression', 'prefillReps', 'commitReps',
    'renderPhase', 'enterPhase', 'captureHold', 'isoWeekKey', 'weekStats',
    'historySetValue', 'selectTemplate', 'updatePrimaryLabel', 'stepReps',
    'pickFinisher', 'finisherRounds', 'sessionCount', 'resolvePattern', 'visiblePatterns',
    'observedHold', 'addSet', 'WARMUPS', 'FINISHERS', 'FINISHER_ORDER',
    'EXERCISE_GUIDE', 'openDetail', 'closeDetail', 'phasePattern', 'renderLevels',
    'changeLevel', 'togglePause', 'repRange', 'holdRange', 'hasEquipment',
    'blockLabel', 'TEMPO', 'SEC_PER_REP',
    'LADDERS', 'TEMPLATES', 'PATTERNS', 'DEFAULT_LEVELS', 'TEMPLATE_ORDER',
  ];
  const getters = exposed.map(n => `  get ${n}() { return typeof ${n} === 'undefined' ? undefined : ${n}; },`).join('\n');
  const setters = `
  setState(patch) {
    if ('workout' in patch) workout = patch.workout;
    if ('currentIdx' in patch) currentIdx = patch.currentIdx;
    if ('sessionSets' in patch) sessionSets = patch.sessionSets;
    if ('sessionConfirmed' in patch && typeof sessionConfirmed !== 'undefined') sessionConfirmed = patch.sessionConfirmed;
    if ('levels' in patch) levels = patch.levels;
    if ('stepperVal' in patch) stepperVal = patch.stepperVal;
    if ('phaseEndsAt' in patch) phaseEndsAt = patch.phaseEndsAt;
    if ('selectedTemplate' in patch) selectedTemplate = patch.selectedTemplate;
    if ('workoutActive' in patch) workoutActive = patch.workoutActive;
    if ('isPaused' in patch) isPaused = patch.isPaused;
    if ('prefs' in patch) prefs = patch.prefs;
  },
  getState() { return {
    workout, currentIdx, sessionSets, levels, stepperVal,
    // tolerant, damit derselbe Harness auch gegen ältere Versionen läuft
    sessionConfirmed: typeof sessionConfirmed === 'undefined' ? undefined : sessionConfirmed,
    isPaused: typeof isPaused === 'undefined' ? undefined : isPaused,
    workoutActive: typeof workoutActive === 'undefined' ? undefined : workoutActive,
    detailPausedByMe: typeof detailPausedByMe === 'undefined' ? undefined : detailPausedByMe,
  }; },`;

  const factory = new Function(
    ...Object.keys(sandbox),
    `${code}\n return {\n${getters}\n${setters}\n };`
  );
  const api = factory(...Object.values(sandbox));
  return { api, el: $, localStorage };
}
