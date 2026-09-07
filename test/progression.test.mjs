// Tests für Programmlogik und Progression.
// Schwerpunkt: das Level muss Kraft messen, nicht die Templatewahl, und nur
// gemessene oder ausdrücklich bestätigte Sätze dürfen es verändern.
import assert from 'node:assert/strict';
import { boot } from './harness.mjs';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message.split('\n')[0]); }
}
const section = t => console.log('\n' + t);

const FULL = { bar: true, dumbbells: true };
const setup = (store = FULL, levels = null) => {
  const b = boot({ store: { mikeTrainingPrefs: JSON.stringify(store) } });
  b.api.setState({ levels: levels || b.api.DEFAULT_LEVELS, sessionSets: {}, sessionConfirmed: {},
                   selectedTemplate: 'A', workout: [], currentIdx: 0 });
  return b;
};
const restsFor = (w, pattern) => w.map((p, i) => [p, i])
  .filter(([p]) => p.kind === 'rest' && p.logFor && p.logFor.pattern === pattern)
  .map(([, i]) => i);
const holdsFor = (w, pattern) => restsFor(w, pattern).map(i => ({ work: i - 1, rest: i }));
const runRest = (api, w, idx) => { api.setState({ workout: w, currentIdx: idx }); api.renderPhase(); };
const confirmSets = (api, w, pattern, value) => {
  for (const i of restsFor(w, pattern)) {
    api.setState({ workout: w, currentIdx: i });
    api.renderPhase();
    api.setState({ stepperVal: value });
    api.commitReps(true);
  }
};

// ══════════════════════════════════════════════════════════════════════
section('Vergleichbarkeit der Progression (Kernproblem des Reviews)');

test('dieselbe Leistung ergibt in jedem Template dasselbe Urteil', () => {
  const verdicts = new Set();
  for (const k of setup().api.TEMPLATE_ORDER) {
    const { api } = setup();
    const w = api.buildWorkout(k, false, { rotation: 0 });
    if (!restsFor(w, 'push').length) continue;   // push kommt nicht in jedem Template vor
    confirmSets(api, w, 'push', 12);
    const { changes } = api.applyProgression(k);
    verdicts.add(changes.length ? changes[0].dir : 'keine');
  }
  assert.equal(verdicts.size, 1, `12 Wdh müssen überall gleich zählen, waren: ${[...verdicts]}`);
});

test('das Wdh-Fenster kommt von der Übung, nicht vom Template', () => {
  const { api } = setup();
  for (const k of api.TEMPLATE_ORDER) {
    assert.ok(!('reps' in api.TEMPLATES[k]), k + ': Template darf kein Wdh-Fenster setzen');
    assert.ok(!('holdSec' in api.TEMPLATES[k]), k + ': Template darf keine Haltezeit setzen');
    assert.ok(!('tempo' in api.TEMPLATES[k]), k + ': Template darf kein Tempo setzen');
  }
  assert.deepEqual(api.repRange('push'), [8, 15]);
  assert.deepEqual(api.repRange('dblateral'), [12, 20], 'Seitheben bleibt im hohen Bereich');
  assert.deepEqual(api.holdRange('core'), [20, 40]);
});

test('jede Leiter bringt genau ein Fenster mit', () => {
  const { api } = setup();
  for (const [p, l] of Object.entries(api.LADDERS)) {
    const units = [...new Set(l.levels.map(e => e.unit))];
    assert.equal(units.length, 1, `${p}: gemischte Einheiten ${units} — dann ist die Leiter nicht vergleichbar`);
    if (units[0] === 'sec') {
      assert.ok(Array.isArray(l.hold) && !l.reps, p + ': braucht ein Haltefenster');
      assert.ok(l.hold[0] < l.hold[1], p + ': Fenster verkehrt');
    } else {
      assert.ok(Array.isArray(l.reps) && !l.hold, p + ': braucht ein Wdh-Fenster');
      assert.ok(l.reps[0] < l.reps[1], p + ': Fenster verkehrt');
    }
  }
});

test('Tempo ist einheitlich, außer die Leiter schreibt eines vor', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const tempos = new Set(w.filter(p => p.kind === 'work-reps' && !api.LADDERS[p.pattern].ownTempo)
                          .map(p => p.detail.includes(api.TEMPO)));
  assert.deepEqual([...tempos], [true], 'überall dasselbe Tempo');
  const lat = api.buildWorkout('B', false, { rotation: 0 }).find(p => p.pattern === 'dblateral');
  assert.ok(!lat.detail.includes(api.TEMPO), 'Seitheben schreibt sein Tempo selbst vor');
});

// ══════════════════════════════════════════════════════════════════════
section('Nur Gemessenes oder Bestätigtes verändert das Level');

test('unbestätigte Wdh leveln nicht hoch', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  for (const i of restsFor(w, 'push')) runRest(api, w, i);
  assert.deepEqual(api.getState().sessionConfirmed.push, [false, false]);
  const { changes, unconfirmed } = api.applyProgression('A');
  assert.deepEqual(changes, []);
  assert.ok(unconfirmed.includes('push'));
});

test('bestätigte Wdh am oberen Ende leveln hoch, darunter ab', () => {
  const up = setup(FULL, { push: 3, vpush: 3, pull: 2, vpull: 1, squat: 2, hinge: 1, core: 2,
                           dbrow: 2, dbrdl: 1, dbsquat: 2, dblateral: 1 });
  let w = up.api.buildWorkout('A', false, { rotation: 0 });
  confirmSets(up.api, w, 'push', 15);
  assert.deepEqual(up.api.applyProgression('A').changes.map(c => c.dir), ['up']);
  assert.equal(up.api.getState().levels.push, 4);

  const down = setup(FULL, { push: 3, vpush: 3, pull: 2, vpull: 1, squat: 2, hinge: 1, core: 2,
                             dbrow: 2, dbrdl: 1, dbsquat: 2, dblateral: 1 });
  w = down.api.buildWorkout('A', false, { rotation: 0 });
  confirmSets(down.api, w, 'push', 5);
  assert.deepEqual(down.api.applyProgression('A').changes.map(c => c.dir), ['down']);
  assert.equal(down.api.getState().levels.push, 2);
});

test('ein bestätigter plus ein unbestätigter Satz reichen nicht', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const [first, second] = restsFor(w, 'push');
  api.setState({ workout: w, currentIdx: first }); api.renderPhase();
  api.setState({ stepperVal: 15 }); api.commitReps(true);
  runRest(api, w, second);
  assert.deepEqual(api.applyProgression('A').changes, []);
});

test('Haltezeit wird gemessen: abgebrochener Halt levelt nicht hoch', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const sets = holdsFor(w, 'core');
  assert.equal(sets.length, 2);
  for (const s of sets) { w[s.work].heldFraction = 0.6; runRest(api, w, s.rest); }
  assert.deepEqual(api.getState().sessionSets.core, [24, 24], 'Anteil von 40 Sek.');
  assert.deepEqual(api.applyProgression('A').changes, []);
});

test('voll gehaltener Halt levelt hoch', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  for (const s of holdsFor(w, 'core')) { w[s.work].heldFraction = 1; runRest(api, w, s.rest); }
  assert.deepEqual(api.getState().sessionSets.core, [40, 40]);
  assert.deepEqual(api.applyProgression('A').changes.map(c => c.dir), ['up']);
});

test('kurzer zweiter Halt wird nicht vom ersten überschrieben', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const sets = holdsFor(w, 'core');
  w[sets[0].work].heldFraction = 1;
  w[sets[1].work].heldFraction = 0.6;
  for (const s of sets) runRest(api, w, s.rest);
  assert.deepEqual(api.getState().sessionSets.core, [40, 24], 'jeder Satz mit eigener Messung');
  assert.deepEqual(api.applyProgression('A').changes, []);
});

test('sofort übersprungener Halt levelt nicht ab', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  for (const s of holdsFor(w, 'core')) { w[s.work].heldFraction = 0; runRest(api, w, s.rest); }
  assert.deepEqual(api.getState().sessionConfirmed.core, [false, false]);
  assert.deepEqual(api.applyProgression('A').changes, []);
});

test('?fast verzerrt die gemessene Haltezeit nicht', () => {
  const b = boot({ search: '?fast', store: { mikeTrainingPrefs: JSON.stringify(FULL) } });
  b.api.setState({ levels: b.api.DEFAULT_LEVELS, sessionSets: {}, sessionConfirmed: {}, selectedTemplate: 'A' });
  const w = b.api.buildWorkout('A', false, { rotation: 0 });
  const sets = holdsFor(w, 'core');
  assert.ok(w[sets[0].work].dur < 40, 'fast kürzt die Dauer');
  for (const s of sets) { w[s.work].heldFraction = 1; runRest(b.api, w, s.rest); }
  assert.deepEqual(b.api.getState().sessionSets.core, [40, 40]);
});

// ══════════════════════════════════════════════════════════════════════
section('Startwerte aus dem Verlauf');

test('Log hält das trainierte Level, nicht das nach dem Aufstieg', () => {
  const { api } = setup();
  const trained = { core: 2 };
  assert.equal(api.LADDERS.core.levels[1].unit, 'sec');
  const entry = { v: 3, sets: { core: [40, 40] }, confirmed: { core: [true, true] }, levels: trained };
  assert.equal(api.historySetValue(entry, { pattern: 'core', unit: 'sec' }), 40);
  assert.equal(api.historySetValue(entry, { pattern: 'core', unit: 'reps' }), null,
    'Sekunden dürfen kein Wdh-Startwert werden');
});

test('unbestätigte und einheitenfremde Werte werden nicht vorgeschlagen', () => {
  const { api } = setup();
  const bad = { v: 3, sets: { push: [12, 11] }, confirmed: { push: [false, false] }, levels: { push: 4 } };
  const good = { v: 3, sets: { push: [12, 11] }, confirmed: { push: [true, true] }, levels: { push: 4 } };
  assert.equal(api.historySetValue(bad, { pattern: 'push', unit: 'reps' }), null);
  assert.equal(api.historySetValue(good, { pattern: 'push', unit: 'reps' }), 12);
  const v2 = { v: 2, sets: { push: [10] }, levels: { push: 4 } };
  assert.equal(api.historySetValue(v2, { pattern: 'push', unit: 'reps' }), 10, 'Altdaten bleiben nutzbar');
});

test('Satz 2 startet beim Ergebnis von Satz 1 (nur bei Wdh)', () => {
  const { api } = setup();
  api.setState({ sessionSets: { push: [13] }, sessionConfirmed: { push: [true] } });
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const second = restsFor(w, 'push')[1];
  api.setState({ workout: w, currentIdx: second });
  assert.equal(api.prefillReps(w[second].logFor), 13);
});

test('ohne Verlauf startet der Vorschlag in der Fenstermitte der Übung', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const i = restsFor(w, 'push')[0];
  api.setState({ workout: w, currentIdx: i });
  assert.equal(api.prefillReps(w[i].logFor), 12, 'Mitte von 8–15');
});

// ══════════════════════════════════════════════════════════════════════
section('Leitern: monoton und in einer Bewegungsfamilie');

test('keine Stufe verlangt Ausrüstung, die die Leiter nicht deklariert', () => {
  const { api } = setup();
  const text = Object.values(api.LADDERS).flatMap(l =>
    l.levels.map(e => [l, e.detail + ' ' + e.name]));
  for (const [l, t] of text) {
    if (!l.requires) assert.ok(!/\bkg\b/.test(t), l.label + ': Gewicht ohne requires — ' + t);
  }
  const all = text.map(([, t]) => t).join(' ');
  assert.ok(!/\bBand\b|Bänder|Widerstandsband/.test(all), 'keine Bänder vorhanden');
  assert.ok(!/Tisch/.test(all), 'Mikes Tisch trägt nicht — keine Tischübungen');
  assert.ok(!/Handstand/.test(all), 'Handstand nicht in der automatischen Leiter');
});

test('Hantel-Leitern steigen im Gewicht monoton', () => {
  const { api } = setup();
  const parse = n => {
    const m = n.match(/(\d+(?:,\d+)?)\s*kg/);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  };
  for (const p of ['dbrow', 'dbsquat', 'dblateral']) {
    const kgs = api.LADDERS[p].levels.map(e => parse(e.name));
    assert.ok(kgs.every(Boolean), p + ': jede Stufe nennt ein Gewicht');
    for (let i = 1; i < kgs.length; i++) {
      assert.ok(kgs[i] > kgs[i - 1], `${p}: Stufe ${i + 1} (${kgs[i]}) nicht schwerer als ${kgs[i - 1]}`);
    }
    assert.ok(Math.max(...kgs) <= 12.5, p + ': über dem Gerätelimit');
  }
});

test('Kreuzheben: die einbeinige Stufe senkt die Last nicht', () => {
  const { api } = setup();
  const lv = api.LADDERS.dbrdl.levels;
  // beidbeinig: Last pro Bein = Gesamt/2; einbeinig: volle Hantel auf einem Bein
  assert.match(lv[2].name, /2× 12,5 kg/, 'letzte beidbeinige Stufe = 25 kg gesamt');
  assert.match(lv[3].name, /Einbeinig · 12,5 kg/, 'einbeinig mit demselben Gewicht, nicht weniger');
  assert.equal(lv[3].sides, 2, 'pro Seite');
});

test('einseitige Stufen sind als solche markiert und zählen pro Seite', () => {
  const { api } = setup();
  for (const [p, l] of Object.entries(api.LADDERS)) {
    for (const e of l.levels) {
      const perSide = /pro Seite/.test(e.detail);
      assert.equal(!!e.sides && e.sides > 1, perSide,
        `${p}/${e.name}: "pro Seite" und sides müssen zusammenpassen`);
    }
  }
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const uni = w.find(p => p.kind === 'work-reps' && p.sides === 2);
  assert.ok(/pro Seite/.test(uni.target), 'Ziel nennt die Seite: ' + uni.target);
  const rest = w[w.indexOf(uni) + 1];
  assert.match(rest.detail, /Schwächere Seite/, 'für die Progression zählt die schwächere Seite');
});

// ══════════════════════════════════════════════════════════════════════
section('Ausrüstung: ersetzen statt ergänzen');

test('mit Hanteln ersetzen Hantelübungen die schlecht dosierbaren Varianten', () => {
  const { api } = setup();
  assert.equal(api.resolvePattern('pull'), 'dbrow', 'Möbelrudern → Hantelrudern');
  assert.equal(api.resolvePattern('hinge'), 'dbrdl', 'Brücken → Kreuzheben');
  assert.equal(api.resolvePattern('squat'), 'dbsquat', 'Split Squats → belastet');
});

test('ohne Hanteln bleibt alles auf Körpergewicht', () => {
  const { api } = setup({ bar: true, dumbbells: false });
  for (const p of ['pull', 'hinge', 'squat']) assert.equal(api.resolvePattern(p), p);
  assert.equal(api.resolvePattern('dblateral'), 'core', 'Abschlussblock fällt auf Rumpf zurück');
});

test('ohne Stange läuft Klimmzug über den Fallback bis zur Hantel', () => {
  assert.equal(setup({ bar: false, dumbbells: true }).api.resolvePattern('vpull'), 'dbrow',
    'vpull → pull → dbrow, transitiv');
  assert.equal(setup({ bar: false, dumbbells: false }).api.resolvePattern('vpull'), 'pull');
  assert.equal(setup({ bar: true, dumbbells: true }).api.resolvePattern('vpull'), 'vpull');
});

test('jede Session hat zehn Satzplätze, mit und ohne Ausrüstung', () => {
  for (const store of [FULL, { bar: true, dumbbells: false }, { bar: false, dumbbells: false },
                       { bar: false, dumbbells: true }]) {
    const { api } = setup(store);
    for (const k of api.TEMPLATE_ORDER) {
      const n = api.buildWorkout(k, false, { rotation: 0 }).filter(p => p.logFor).length;
      assert.equal(n, 10, `${k} bei ${JSON.stringify(store)}: ${n} statt 10 Satzplätze`);
    }
  }
});

test('kein Muster steht zweimal in derselben Session', () => {
  for (const store of [FULL, { bar: false, dumbbells: true }, { bar: false, dumbbells: false }]) {
    const { api } = setup(store);
    for (const k of api.TEMPLATE_ORDER) {
      const w = api.buildWorkout(k, false, { rotation: 0 });
      const pats = w.filter(p => p.logFor).map(p => p.logFor.pattern);
      const counts = {};
      pats.forEach(p => counts[p] = (counts[p] || 0) + 1);
      for (const [p, n] of Object.entries(counts)) {
        assert.equal(n, 2, `${k}: ${p} kommt ${n}× vor, erwartet 2 (ein Muster, zwei Sätze)`);
      }
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
section('Zeitbudget und Volumen');

test('jede Session bleibt unter 20 Minuten (ohne Cardio)', () => {
  const { api } = setup();
  for (const k of api.TEMPLATE_ORDER) {
    const min = api.estimateSec(api.buildWorkout(k, false, { rotation: 0 })) / 60;
    assert.ok(min < 20, `${k}: ${min.toFixed(1)} Min`);
  }
});

test('die Dauerschätzung rechnet mit Wiederholungen, Tempo und Seiten', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const uni = w.find(p => p.kind === 'work-reps' && p.sides === 2);
  const bi = w.find(p => p.kind === 'work-reps' && (p.sides || 1) === 1);
  assert.ok(uni.est > bi.est, 'einseitig dauert länger — vorher galt für beide pauschal 40 s');
  const [lo, hi] = api.repRange(bi.pattern);
  assert.equal(bi.est, Math.round(((lo + hi) / 2) * api.SEC_PER_REP), 'Mitte × Sekunden pro Wdh');
});

test('Volumen pro Woche bei 3 Sessions', () => {
  const { api } = setup();
  const n = {};
  for (const k of api.TEMPLATE_ORDER) {
    for (const ph of api.buildWorkout(k, false, { rotation: 0 })) {
      if (ph.logFor) n[ph.logFor.pattern] = (n[ph.logFor.pattern] || 0) + 1;
    }
  }
  const perWeek = p => (n[p] || 0) / (api.TEMPLATE_ORDER.length / 3);
  assert.equal(Object.values(n).reduce((a, b) => a + b, 0), 40, '4 Sessions × 10 Sätze');
  // Drücken und Ziehen je 6, Beine je 6, Abschluss je 3
  assert.equal(perWeek('push') + perWeek('vpush'), 6, 'Drücken');
  assert.equal(perWeek('dbrow') + perWeek('vpull'), 6, 'Ziehen');
  assert.equal(perWeek('dbsquat'), 6, 'knie-dominant');
  assert.equal(perWeek('dbrdl'), 6, 'hüft-dominant');
  assert.equal(perWeek('core'), 3);
  assert.equal(perWeek('dblateral'), 3);
});

test('Warm-Up rotiert, Finisher-Varianten stimmen', () => {
  const { api } = setup();
  const seen = new Set();
  for (let r = 0; r < 4; r++) {
    seen.add(api.buildWorkout('A', false, { rotation: r }).filter(p => p.kind === 'warmup').map(p => p.name).join('+'));
  }
  assert.equal(seen.size, 4);
  const hard = f => api.buildWorkout('A', true, { rotation: 0, finisher: f })
    .filter(p => p.kind === 'cardio-hard').map(p => p.dur);
  assert.deepEqual(hard('hiit'), [20, 20, 20, 20, 20, 20, 20, 20]);
  assert.deepEqual(hard('pyramide'), [30, 40, 50, 60, 50, 40, 30]);
  assert.deepEqual(hard('emom'), [30, 30, 30, 30, 30, 30]);
  assert.equal(api.FINISHERS.tabata.name, '20/10', 'nicht als Tabata-Dosis ausgeben');
});

test('Template-Zyklus läuft über alle vier', () => {
  const { api } = setup();
  assert.deepEqual(api.TEMPLATE_ORDER, ['A', 'B', 'C', 'D']);
  const next = k => api.TEMPLATE_ORDER[(api.TEMPLATE_ORDER.indexOf(k) + 1) % api.TEMPLATE_ORDER.length];
  assert.deepEqual(['A', next('A'), next('B'), next('C'), next('D')], ['A', 'B', 'C', 'D', 'A']);
});

test('isoWeekKey trifft ISO-Wochengrenzen', () => {
  const { api } = setup();
  assert.equal(api.isoWeekKey(new Date(2026, 0, 1).getTime()), '2026-W1');
  assert.equal(api.isoWeekKey(new Date(2026, 0, 5).getTime()), '2026-W2');
  assert.equal(api.isoWeekKey(new Date(2025, 11, 29).getTime()), '2026-W1');
});

// ══════════════════════════════════════════════════════════════════════
section('Übungs-Details');

test('jede Stufe hat eine Anleitung, ohne Waisen', () => {
  const { api } = setup();
  const levels = Object.values(api.LADDERS).flatMap(l => l.levels);
  const names = levels.map(e => e.name);
  assert.equal(new Set(names).size, names.length, 'Stufennamen sind eindeutig');
  const keys = [...new Set(levels.map(e => e.guide || e.name))];
  assert.deepEqual(keys.filter(k => !api.EXERCISE_GUIDE[k]), [], 'ohne Anleitung');
  assert.deepEqual(Object.keys(api.EXERCISE_GUIDE).filter(k => !keys.includes(k)), [], 'Anleitung ohne Stufe');
});

test('jede Anleitung ist vollständig', () => {
  const { api } = setup();
  for (const [name, g] of Object.entries(api.EXERCISE_GUIDE)) {
    assert.ok(g.setup && g.setup.length > 20, name + ': Aufbau');
    assert.ok(g.steps.length >= 2 && g.mistakes.length >= 2, name + ': Schritte/Fehler');
    assert.ok(g.muscles && g.breath, name + ': Muskeln/Atmung');
    for (const x of [...g.steps, ...g.mistakes]) assert.ok(x.length > 10, name + ': zu knapp — ' + x);
  }
});

test('openDetail zeigt Stufe, Anleitung und Nachbarstufen', () => {
  const { api, el } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const idx = w.findIndex(x => x.pattern === 'push' && x.kind === 'work-reps');
  api.setState({ workout: w, currentIdx: idx });
  api.openDetail();
  assert.equal(el('sheetTitle').textContent, 'Liegestütze');
  assert.match(el('sheetKicker').textContent, /Push \(Brust\/Schulter\) · Level 4\/6/);
  const body = el('sheetBody').innerHTML;
  for (const h of ['Diese Stufe', 'Aufbau', 'Ausführung', 'Häufige Fehler', 'Atmung',
                   'Beteiligte Muskeln', 'Zählweise', 'Position in der Leiter']) {
    assert.ok(body.includes(h), 'Abschnitt fehlt: ' + h);
  }
  assert.ok(el('detailSheet')._classes.has('visible'));
});

test('Gewichtsstufen teilen eine Anleitung, zeigen aber ihr Gewicht', () => {
  const { api, el } = setup();
  api.openDetail('dbrow', 1);
  const a = el('sheetBody').innerHTML;
  assert.equal(el('sheetTitle').textContent, 'Einarmiges Rudern · 5 kg');
  assert.ok(a.includes('5 kg · pro Seite'));
  api.openDetail('dbrow', 4);
  const b = el('sheetBody').innerHTML;
  assert.ok(b.includes('12,5 kg · pro Seite'), 'anderes Gewicht');
  assert.ok(a.includes('Schulterblatt') && b.includes('Schulterblatt'), 'gleiche Anleitung');
});

test('Level wird geklemmt, unbekanntes Muster ändert nichts', () => {
  const { api, el } = setup();
  api.openDetail('core', 6);
  assert.equal(el('sheetTitle').textContent, 'Hollow Hold');
  api.openDetail('core', 99);
  assert.equal(el('sheetTitle').textContent, 'Hollow Hold');
  api.openDetail('core', 0);
  assert.equal(el('sheetTitle').textContent, 'Plank (Knie)');
  api.openDetail('gibtsnicht', 3);
  assert.equal(el('sheetTitle').textContent, 'Plank (Knie)');
});

test('Zählweise unterscheidet Halten und Wiederholungen', () => {
  const { api, el } = setup();
  api.openDetail('core', 2);
  assert.ok(el('sheetBody').innerHTML.includes('Sekunden gehalten'));
  api.openDetail('push', 4);
  assert.ok(el('sheetBody').innerHTML.includes('Wiederholungen'));
});

test('Detail öffnen pausiert den Timer, schließen setzt fort', () => {
  const { api, el } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  api.setState({ workout: w, currentIdx: w.findIndex(x => x.kind === 'work-reps'),
                 workoutActive: true, isPaused: false });
  api.openDetail();
  assert.equal(api.getState().isPaused, true);
  assert.ok(!el('sheetPaused')._classes.has('hidden'));
  api.closeDetail();
  assert.equal(api.getState().isPaused, false);
});

test('eine selbst gesetzte Pause bleibt nach dem Schließen bestehen', () => {
  const { api } = setup();
  const w = api.buildWorkout('A', false, { rotation: 0 });
  api.setState({ workout: w, currentIdx: w.findIndex(x => x.kind === 'work-reps'),
                 workoutActive: true, isPaused: true });
  api.openDetail();
  assert.equal(api.getState().detailPausedByMe, false);
  api.closeDetail();
  assert.equal(api.getState().isPaused, true);
});

test('Levels-Liste zeigt nur verfügbare Leitern', () => {
  assert.ok(!setup({ bar: false, dumbbells: false }).api.visiblePatterns().some(p => p.startsWith('db')));
  assert.equal(setup(FULL).api.visiblePatterns().filter(p => p.startsWith('db')).length, 4);
  assert.ok(!setup({ bar: false, dumbbells: true }).api.visiblePatterns().includes('vpull'));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
