// Regressionstests für die Progression-Logik: sie darf nur auf gemessenen
// oder ausdrücklich bestätigten Sätzen hochleveln.
import assert from 'node:assert/strict';
import { boot } from './harness.mjs';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// Indizes der Core-Phasen (work-time + zugehörige Pause) in einem Workout finden
function coreSetPhases(workout) {
  const out = [];
  workout.forEach((p, i) => {
    if (p.kind === 'rest' && p.logFor && p.logFor.pattern === 'core') out.push({ work: i - 1, rest: i });
  });
  return out;
}
function repSetPhases(workout, pattern) {
  const out = [];
  workout.forEach((p, i) => {
    if (p.kind === 'rest' && p.logFor && p.logFor.pattern === pattern) out.push({ work: i - 1, rest: i });
  });
  return out;
}

// Eine Pause "durchlaufen lassen", ohne den Stepper anzufassen
function runRest(api, workout, idx) {
  api.setState({ workout, currentIdx: idx });
  api.renderPhase();
}

console.log('\nHalte-Sätze (Core, Einheit = Sekunden)');

test('abgebrochener Halt levelt NICHT hoch (war: immer Level-Up)', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false);
  const sets = coreSetPhases(w);
  assert.equal(sets.length, 2, 'zwei Core-Sätze erwartet');
  for (const s of sets) {
    w[s.work].heldFraction = 0.6;   // bei 24 von 40 Sek. abgebrochen
    runRest(api, w, s.rest);
  }
  const st = api.getState();
  assert.deepEqual(st.sessionSets.core, [24, 24], 'gemessene 24 Sek. erwartet, nicht 40');
  const { changes } = api.applyProgression('A');
  assert.deepEqual(changes, [], 'kein Level-Up bei 24/40 Sek.');
  assert.equal(api.getState().levels.core, 3, 'Core-Level unverändert');
});

test('voll gehaltener Halt levelt hoch', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false);
  for (const s of coreSetPhases(w)) {
    w[s.work].heldFraction = 1;
    runRest(api, w, s.rest);
  }
  assert.deepEqual(api.getState().sessionSets.core, [40, 40]);
  const { changes } = api.applyProgression('A');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].pattern, 'core');
  assert.equal(changes[0].dir, 'up');
  assert.equal(api.getState().levels.core, 4);
});

test('sofort übersprungener Halt levelt NICHT ab (Auslassen ist kein Scheitern)', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false);
  for (const s of coreSetPhases(w)) { w[s.work].heldFraction = 0; runRest(api, w, s.rest); }
  assert.deepEqual(api.getState().sessionConfirmed.core, [false, false], 'als nicht angegangen markiert');
  const { changes, unconfirmed } = api.applyProgression('A');
  assert.deepEqual(changes, [], 'kein Level-Down');
  assert.equal(api.getState().levels.core, 3, 'Core-Level unverändert');
  assert.ok(unconfirmed.includes('core'));
});

test('Halt wird als Anteil gespeichert — ?fast verzerrt die Werte nicht', () => {
  const { api } = boot({ search: '?fast' });
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false);
  const sets = coreSetPhases(w);
  assert.ok(w[sets[0].work].dur < 40, 'fast-Modus kürzt die Dauer');
  for (const s of sets) { w[s.work].heldFraction = 1; runRest(api, w, s.rest); }
  assert.deepEqual(api.getState().sessionSets.core, [40, 40], 'trotzdem 40 Sek. protokolliert');
});

console.log('\nWdh-Sätze (Einheit = Wiederholungen)');

test('unbestätigte Wdh levelt NICHT hoch (war: stiller Level-Up)', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false);
  for (const s of repSetPhases(w, 'push')) runRest(api, w, s.rest);
  const st = api.getState();
  assert.equal(st.sessionSets.push.length, 2, 'Werte werden vorgeschlagen');
  assert.deepEqual(st.sessionConfirmed.push, [false, false], 'aber als unbestätigt markiert');
  const { changes, unconfirmed } = api.applyProgression('A');
  assert.deepEqual(changes, [], 'kein Level-Up ohne Bestätigung');
  assert.ok(unconfirmed.includes('push'), 'wird als unbestätigt zurückgemeldet');
});

test('bestätigte Wdh am oberen Ende levelt hoch', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false);
  for (const s of repSetPhases(w, 'push')) {
    api.setState({ workout: w, currentIdx: s.rest });
    api.renderPhase();
    api.setState({ stepperVal: 15 });   // Top des A-Bereichs 8–15
    api.commitReps(true);
  }
  assert.deepEqual(api.getState().sessionConfirmed.push, [true, true]);
  const { changes } = api.applyProgression('A');
  assert.deepEqual(changes.map(c => c.pattern), ['push']);
  assert.equal(api.getState().levels.push, 5);
});

test('bestätigte Wdh unter dem Bereich levelt ab', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false);
  for (const s of repSetPhases(w, 'push')) {
    api.setState({ workout: w, currentIdx: s.rest });
    api.renderPhase();
    api.setState({ stepperVal: 5 });    // unter 8
    api.commitReps(true);
  }
  const { changes } = api.applyProgression('A');
  assert.equal(changes[0].dir, 'down');
  assert.equal(api.getState().levels.push, 3);
});

test('ein bestätigter + ein unbestätigter Satz reichen nicht', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false);
  const sets = repSetPhases(w, 'push');
  api.setState({ workout: w, currentIdx: sets[0].rest }); api.renderPhase();
  api.setState({ stepperVal: 15 }); api.commitReps(true);
  runRest(api, w, sets[1].rest);      // zweiter Satz nur vorgeschlagen
  const { changes } = api.applyProgression('A');
  assert.deepEqual(changes, [], 'Double Progression braucht zwei belegte Sätze');
});

console.log('\nHistory-Startwerte');

test('Sekunden-History liefert keinen Wdh-Startwert (war: „40 Wdh V-Ups")', () => {
  const { api } = boot();
  const entry = { v: 2, ts: Date.now(), sets: { core: [40, 40] }, levels: { core: 3 } };
  assert.equal(api.historySetValue(entry, { pattern: 'core', unit: 'reps' }), null);
  assert.equal(api.historySetValue(entry, { pattern: 'core', unit: 'sec' }), 40);
});

test('unbestätigte History-Werte werden nicht als Startwert benutzt', () => {
  const { api } = boot();
  const bad  = { v: 3, sets: { push: [12, 11] }, confirmed: { push: [false, false] }, levels: { push: 4 } };
  const good = { v: 3, sets: { push: [12, 11] }, confirmed: { push: [true, true] },  levels: { push: 4 } };
  assert.equal(api.historySetValue(bad, { pattern: 'push', unit: 'reps' }), null);
  assert.equal(api.historySetValue(good, { pattern: 'push', unit: 'reps' }), 12);
});

test('Altdaten (v2) bleiben als Startwert nutzbar', () => {
  const { api } = boot();
  const v2 = { v: 2, sets: { push: [12, 11] }, levels: { push: 4 } };
  assert.equal(api.historySetValue(v2, { pattern: 'push', unit: 'reps' }), 12);
});

test('Satz 2 startet beim Ergebnis von Satz 1', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, pull: 2, squat: 3, hinge: 1, core: 3 }, selectedTemplate: 'A',
                 sessionSets: { push: [13] }, sessionConfirmed: { push: [true] } });
  const w = api.buildWorkout('A', false);
  const sets = repSetPhases(w, 'push');
  api.setState({ workout: w, currentIdx: sets[1].rest });
  assert.equal(api.prefillReps(w[sets[1].rest].logFor), 13);
});

console.log('\nWorkout-Aufbau & Wochenlogik');

test('jedes Template: Warm-Up + eigener Muster-Mix, je 2 Sätze', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  for (const k of api.TEMPLATE_ORDER) {
    const w = api.buildWorkout(k, false, { rotation: 0 });
    assert.equal(w.filter(p => p.kind === 'warmup').length, 2, k + ': Warm-Up');
    const want = [...api.TEMPLATES[k].mix.flat(), 'core'];
    for (const p of want) {
      const n = w.filter(x => x.logFor && x.logFor.pattern === p).length;
      assert.equal(n, 2, `${k}/${p}: 2 Sätze erwartet, ${n} gefunden`);
    }
    const got = [...new Set(w.filter(x => x.logFor).map(x => x.logFor.pattern))];
    assert.deepEqual(got.sort(), [...new Set(want)].sort(), k + ': keine fremden Muster');
    assert.ok(w.every(p => p.section && p.name), k + ': jede Phase hat Label und Namen');
  }
});

test('die 5 Templates decken alle Muster ab und variieren den Mix', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  const seen = new Set();
  const mixes = new Set();
  for (const k of api.TEMPLATE_ORDER) {
    api.TEMPLATES[k].mix.flat().forEach(p => seen.add(p));
    mixes.add(JSON.stringify(api.TEMPLATES[k].mix));
  }
  seen.add('core');
  assert.deepEqual([...seen].sort(), [...api.PATTERNS].sort(), 'jedes Muster kommt vor');
  assert.ok(mixes.size >= 4, `mindestens 4 verschiedene Mixe, sind ${mixes.size}`);
});

test('Druck- und Zugvolumen bleiben pro Zyklus erhalten', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  const n = {};
  for (const k of api.TEMPLATE_ORDER) {
    for (const ph of api.buildWorkout(k, false, { rotation: 0 })) {
      if (ph.logFor) n[ph.logFor.pattern] = (n[ph.logFor.pattern] || 0) + 1;
    }
  }
  // 5 Sessions × 2 Sätze = 10 Sätze pro Bewegungsrichtung
  assert.equal(n.push + n.vpush, 10, 'Druck gesamt');
  assert.equal(n.pull + n.vpull, 10, 'Zug gesamt');
  assert.equal(n.core, 10, 'Core');
});

test('ohne Stange fällt Vertical Pull auf Rudern zurück', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: false }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  const w = api.buildWorkout('B', false, { rotation: 0 });   // B = [vpush, vpull]
  const pats = new Set(w.filter(p => p.logFor).map(p => p.logFor.pattern));
  assert.ok(!pats.has('vpull'), 'keine Klimmzüge ohne Stange');
  assert.ok(pats.has('pull'), 'stattdessen horizontales Ziehen');
  assert.ok(!api.buildWorkout('B', false, { rotation: 0 }).some(p => /Klimmzug/.test(p.name || '')));
});

test('mit Stange kommen Klimmzüge vor', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true }) } });
  api.setState({ levels: Object.assign({}, api.DEFAULT_LEVELS, { vpull: 5 }) });
  const w = api.buildWorkout('B', false, { rotation: 0 });
  assert.ok(w.some(p => p.name === 'Klimmzüge (Untergriff)'));
});

test('gemischte Einheiten in einer Leiter: Aktives Hängen wird als Zeit geführt', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true }) } });
  api.setState({ levels: Object.assign({}, api.DEFAULT_LEVELS, { vpull: 1 }) });
  const w = api.buildWorkout('B', false, { rotation: 0 });
  const work = w.filter(p => p.pattern === 'vpull' && p.kind === 'work-time');
  assert.equal(work.length, 2, 'Level 1 ist eine Halte-Übung');
  const rests = w.filter(p => p.logFor && p.logFor.pattern === 'vpull');
  assert.ok(rests.every(r => r.logFor.unit === 'sec' && r.logFor.full > 0));
});

test('Warm-Up rotiert über 4 Varianten', () => {
  const { api } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS });
  const seen = new Set();
  for (let r = 0; r < 4; r++) {
    seen.add(api.buildWorkout('A', false, { rotation: r }).filter(p => p.kind === 'warmup').map(p => p.name).join('+'));
  }
  assert.equal(seen.size, 4, 'vier verschiedene Warm-Ups');
  const a = api.buildWorkout('A', false, { rotation: 0 }).filter(p => p.kind === 'warmup').map(p => p.name);
  const b = api.buildWorkout('A', false, { rotation: 4 }).filter(p => p.kind === 'warmup').map(p => p.name);
  assert.deepEqual(a, b, 'danach von vorn');
});

test('Finisher-Varianten haben die erwartete Intervallstruktur', () => {
  const { api } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS });
  const shape = f => {
    const w = api.buildWorkout('A', true, { rotation: 0, finisher: f });
    const hard = w.filter(p => p.kind === 'cardio-hard');
    return { rounds: hard.length, secs: hard.map(p => p.dur) };
  };
  assert.deepEqual(shape('hiit'),   { rounds: 8, secs: [20, 20, 20, 20, 20, 20, 20, 20] });
  assert.deepEqual(shape('tabata'), { rounds: 8, secs: [20, 20, 20, 20, 20, 20, 20, 20] });
  assert.deepEqual(shape('pyramide'), { rounds: 7, secs: [30, 40, 50, 60, 50, 40, 30] });
  assert.deepEqual(shape('emom'),   { rounds: 6, secs: [30, 30, 30, 30, 30, 30] });
  // Tabata unterscheidet sich von HIIT durch die kurze Erholung
  const easy = f => api.buildWorkout('A', true, { rotation: 0, finisher: f })
    .filter(p => p.kind === 'cardio-easy').map(p => p.dur);
  assert.ok(easy('tabata').includes(10), 'Tabata: 10s Pause');
  assert.ok(easy('hiit').includes(40), 'HIIT: 40s locker');
});

test('Finisher rotiert automatisch, feste Wahl gewinnt', () => {
  const { api } = boot();
  const seen = new Set([0, 1, 2, 3].map(r => api.pickFinisher(r)));
  assert.equal(seen.size, 4, 'alle vier kommen dran');
  assert.equal(api.pickFinisher(0), api.pickFinisher(4), 'dann von vorn');
  const fixed = boot({ store: { mikeTrainingPrefs: JSON.stringify({ finisher: 'tabata' }) } }).api;
  assert.equal(fixed.pickFinisher(0), 'tabata');
  assert.equal(fixed.pickFinisher(3), 'tabata');
});

test('Template-Zyklus läuft über alle 5', () => {
  const { api } = boot();
  const order = api.TEMPLATE_ORDER;
  assert.equal(order.length, 5);
  const next = k => order[(order.indexOf(k) + 1) % order.length];
  let k = 'A'; const path = [k];
  for (let i = 0; i < 5; i++) { k = next(k); path.push(k); }
  assert.deepEqual(path, ['A', 'B', 'C', 'D', 'E', 'A'], 'kein Abschneiden bei 3');
});

test('isoWeekKey trifft ISO-Wochengrenzen', () => {
  const { api } = boot();
  assert.equal(api.isoWeekKey(new Date(2026, 0, 1).getTime()), '2026-W1');
  assert.equal(api.isoWeekKey(new Date(2026, 0, 5).getTime()), '2026-W2');
  assert.equal(api.isoWeekKey(new Date(2025, 11, 29).getTime()), '2026-W1');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
