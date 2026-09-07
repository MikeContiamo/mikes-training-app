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

test('buildWorkout: Warm-Up, 5 Muster, je 2 Sätze', () => {
  const { api } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS, selectedTemplate: 'A' });
  const w = api.buildWorkout('A', false);
  assert.equal(w.filter(p => p.kind === 'warmup').length, 2);
  for (const p of api.PATTERNS) {
    const n = w.filter(x => x.logFor && x.logFor.pattern === p).length;
    assert.equal(n, 2, `${p}: 2 Sätze erwartet, ${n} gefunden`);
  }
  assert.ok(w.every(p => p.section && p.name), 'jede Phase hat Label und Namen');
});

test('Cardio-Finisher hängt 8 Intervalle an', () => {
  const { api } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS });
  const w = api.buildWorkout('A', true);
  assert.equal(w.filter(p => p.kind === 'cardio-hard').length, 8);
});

test('isoWeekKey trifft ISO-Wochengrenzen', () => {
  const { api } = boot();
  assert.equal(api.isoWeekKey(new Date(2026, 0, 1).getTime()), '2026-W1');
  assert.equal(api.isoWeekKey(new Date(2026, 0, 5).getTime()), '2026-W2');
  assert.equal(api.isoWeekKey(new Date(2025, 11, 29).getTime()), '2026-W1');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
