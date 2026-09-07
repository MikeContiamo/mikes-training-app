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

test('kurzer zweiter Halt wird nicht vom ersten überschrieben', () => {
  const { api } = boot();
  api.setState({ levels: { push: 4, vpush: 2, pull: 2, vpull: 3, squat: 3, hinge: 1, core: 3 },
                 selectedTemplate: 'A', sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const sets = coreSetPhases(w);
  w[sets[0].work].heldFraction = 1;    // Satz 1: volle 40 Sek.
  w[sets[1].work].heldFraction = 0.6;  // Satz 2: nur 24 Sek.
  for (const s of sets) runRest(api, w, s.rest);
  assert.deepEqual(api.getState().sessionSets.core, [40, 24], 'jeder Satz mit seiner eigenen Messung');
  const { changes } = api.applyProgression('A');
  assert.deepEqual(changes, [], 'kein Level-Up, wenn der zweite Satz einbricht');
  assert.equal(api.getState().levels.core, 3);
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
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  for (const k of api.TEMPLATE_ORDER) {
    const w = api.buildWorkout(k, false, { rotation: 0 });
    assert.equal(w.filter(p => p.kind === 'warmup').length, 2, k + ': Warm-Up');
    const want = [...api.TEMPLATES[k].mix.flat(), ...(api.TEMPLATES[k].accessory || []), 'core'];
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
    (api.TEMPLATES[k].accessory || []).forEach(p => seen.add(p));
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

console.log('\nHanteln');

test('Hantel-Block genau in B, C und D', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  const withDb = api.TEMPLATE_ORDER.filter(k => (api.TEMPLATES[k].accessory || []).length);
  assert.deepEqual(withDb, ['B', 'C', 'D'], 'drei der fünf Workouts');
  for (const k of api.TEMPLATE_ORDER) {
    const w = api.buildWorkout(k, false, { rotation: 0 });
    const block = w.filter(p => p.section && p.section.startsWith('Hantel-Block'));
    assert.equal(block.length > 0, withDb.includes(k), k + ': Hantel-Block vorhanden?');
    if (block.length) assert.equal(block.filter(p => p.logFor).length, 4, k + ': 2 Übungen × 2 Sätze');
  }
});

test('A und E bleiben reines Körpergewicht (für unterwegs)', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  for (const k of ['A', 'E']) {
    const pats = api.buildWorkout(k, false, { rotation: 0 }).filter(p => p.logFor).map(p => p.logFor.pattern);
    assert.ok(!pats.some(p => p.startsWith('db')), k + ': keine Hantelübung');
  }
});

test('ohne Hanteln entfällt der Block, die Session bleibt vollständig', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: false }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  for (const k of ['B', 'C', 'D']) {
    const w = api.buildWorkout(k, false, { rotation: 0 });
    const pats = [...new Set(w.filter(p => p.logFor).map(p => p.logFor.pattern))];
    assert.ok(!pats.some(p => p.startsWith('db')), k + ': keine Hantelübung ohne Hanteln');
    // Hauptteil und Core stehen trotzdem
    for (const p of [...api.TEMPLATES[k].mix.flat(), 'core']) {
      assert.equal(w.filter(x => x.logFor && x.logFor.pattern === p).length, 2, k + '/' + p);
    }
    assert.ok(!w.some(p => p.section && p.section.startsWith('Hantel-Block')));
  }
});

test('alle sechs Hantelübungen kommen im Zyklus dran', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  const seen = new Set();
  for (const k of api.TEMPLATE_ORDER) {
    for (const ph of api.buildWorkout(k, false, { rotation: 0 })) {
      if (ph.logFor && ph.logFor.pattern.startsWith('db')) seen.add(ph.logFor.pattern);
    }
  }
  assert.deepEqual([...seen].sort(), ['dbcurl', 'dblateral', 'dbpress', 'dbrdl', 'dbrow', 'dbtricep']);
});

test('Gewicht ist die Progressionsstufe', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: true }) } });
  api.setState({ levels: Object.assign({}, api.DEFAULT_LEVELS, { dbcurl: 2 }), selectedTemplate: 'B',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('B', false, { rotation: 0 });
  const curl = w.find(p => p.pattern === 'dbcurl');
  assert.match(curl.name, /7,5 kg/, 'Level 2 = 7,5 kg');
  // Oberes Ende des B-Bereichs (6–10) in beiden Sätzen bestätigen
  for (const r of w.filter(p => p.logFor && p.logFor.pattern === 'dbcurl')) {
    api.setState({ workout: w, currentIdx: w.indexOf(r) });
    api.renderPhase();
    api.setState({ stepperVal: 10 });
    api.commitReps(true);
  }
  const { changes } = api.applyProgression('B');
  assert.deepEqual(changes.map(c => c.pattern), ['dbcurl']);
  assert.equal(api.getState().levels.dbcurl, 3);
  assert.match(changes[0].newName, /10 kg/, 'nächste Stufe = mehr Gewicht');
});

test('über 12,5 kg geht die Leiter einarmig oder langsamer weiter', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ dumbbells: true }) } });
  for (const p of ['dbpress', 'dbrow', 'dbcurl', 'dbtricep', 'dbrdl']) {
    const lv = api.LADDERS[p].levels;
    const last = lv[lv.length - 1].name;
    assert.ok(/einarmig|langsam|Einarmig|Einbeinig/.test(last), p + ': Ausweg am Limit fehlt — ' + last);
  }
  // Seitheben ist bewusst bei 12,5 kg gedeckelt und arbeitet über Wdh
  assert.deepEqual(api.LADDERS.dblateral.reps, [12, 20]);
});

test('eigenes Tempo einer Leiter überschreibt das des Templates nicht doppelt', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  const w = api.buildWorkout('C', false, { rotation: 0 });
  const lat = w.find(p => p.pattern === 'dblateral');
  assert.ok(!lat.detail.includes(api.TEMPLATES.C.tempo), 'kein widersprüchliches Template-Tempo');
  assert.ok(lat.detail.includes('bewusst langsam'), 'eigener Hinweis bleibt');
  // Ohne ownTempo hängt das Template-Tempo weiterhin an
  const push = w.find(p => p.pattern === 'push');
  assert.ok(push.detail.includes(api.TEMPLATES.C.tempo), 'sonst wie gehabt');
  assert.ok(!api.LADDERS.push.ownTempo, 'push schreibt kein eigenes Tempo vor');
});

test('eigener Wdh-Bereich der Leiter schlägt den des Templates', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ dumbbells: true }) } });
  assert.deepEqual(api.repRange(api.TEMPLATES.B, 'dblateral'), [12, 20], 'Leiter gewinnt');
  assert.deepEqual(api.repRange(api.TEMPLATES.B, 'dbcurl'), [6, 10], 'sonst Template');
  // Und die Progression rechnet damit: 10 Wdh wären im B-Bereich (6–10) das
  // obere Ende und würden hochleveln — für Seitheben sind sie zu wenig.
  api.setState({ levels: Object.assign({}, api.DEFAULT_LEVELS, { dblateral: 2 }),
                 sessionSets: { dblateral: [10, 10] }, sessionConfirmed: { dblateral: [true, true] } });
  const low = api.applyProgression('B').changes;
  assert.ok(!low.some(c => c.dir === 'up'), 'kein Level-Up bei 10 Wdh');
  assert.deepEqual(low.map(c => c.dir), ['down'], 'zu schwer → eine Gewichtsstufe zurück');
  api.setState({ levels: Object.assign({}, api.DEFAULT_LEVELS, { dblateral: 2 }),
                 sessionSets: { dblateral: [20, 20] }, sessionConfirmed: { dblateral: [true, true] } });
  const high = api.applyProgression('B').changes;
  assert.deepEqual(high.map(c => c.dir), ['up'], 'bei 20 Wdh eine Stufe mehr Gewicht');
});

test('Hantel-Sessions kosten rund 6 Minuten mehr', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS });
  const min = k => api.estimateSec(api.buildWorkout(k, false, { rotation: 0 })) / 60;
  assert.ok(min('A') < 20, 'A bleibt unter 20 Min: ' + min('A'));
  for (const k of ['B', 'C', 'D']) {
    assert.ok(min(k) > min('A') + 4 && min(k) < 27, k + ' = ' + min(k) + ' Min');
  }
});

test('Levels-Liste zeigt Hantel-Leitern nur mit Hanteln', () => {
  const off = boot({ store: { mikeTrainingPrefs: JSON.stringify({ dumbbells: false }) } }).api;
  assert.ok(!off.visiblePatterns().some(p => p.startsWith('db')));
  const on = boot({ store: { mikeTrainingPrefs: JSON.stringify({ dumbbells: true }) } }).api;
  assert.equal(on.visiblePatterns().filter(p => p.startsWith('db')).length, 6);
});

test('Log hält das trainierte Level, nicht das nach dem Aufstieg', () => {
  const { api } = boot();
  // Core Level 5 = Hollow Hold (Sekunden); voll gehalten → Aufstieg auf 6 = V-Ups (Wdh)
  api.setState({ levels: { push: 4, vpush: 2, pull: 2, vpull: 3, squat: 3, hinge: 1, core: 5 },
                 selectedTemplate: 'A', sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false, { rotation: 0 });
  for (const s of coreSetPhases(w)) { w[s.work].heldFraction = 1; runRest(api, w, s.rest); }
  api.applyProgression('A');
  assert.equal(api.getState().levels.core, 6, 'Aufstieg fand statt');
  // So schreibt finishWorkout den Eintrag: levels = Stand VOR der Progression
  const entry = { v: 3, sets: api.getState().sessionSets, confirmed: api.getState().sessionConfirmed,
                  levels: { core: 5 } };
  assert.equal(api.LADDERS.core.levels[4].unit, 'sec', 'trainiert wurde eine Halte-Übung');
  assert.equal(api.historySetValue(entry, { pattern: 'core', unit: 'reps' }), null,
    '40 Sekunden dürfen kein Wdh-Startwert werden');
  assert.equal(api.historySetValue(entry, { pattern: 'core', unit: 'sec' }), 40);
  // Mit dem Level NACH dem Aufstieg wäre die Prüfung wirkungslos (der alte Fehler)
  const broken = Object.assign({}, entry, { levels: { core: 6 } });
  assert.equal(api.historySetValue(broken, { pattern: 'core', unit: 'reps' }), 40,
    'belegt, warum das trainierte Level gespeichert werden muss');
});

test('kein Template-Tempo, wo die Stufe selbst eines vorschreibt', () => {
  const { api } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true, dumbbells: true }) } });
  api.setState({ levels: Object.assign({}, api.DEFAULT_LEVELS, { dbcurl: 5, dbrow: 5 }) });
  const curl = api.buildWorkout('B', false, { rotation: 0 }).find(p => p.pattern === 'dbcurl');
  assert.ok(curl.detail.includes('3 Sek.'), 'eigene Vorgabe der Stufe');
  assert.ok(!curl.detail.includes('4 Sek.'), 'kein widersprüchliches 4-Sek-Tempo aus B');
  const row = api.buildWorkout('C', false, { rotation: 0 }).find(p => p.pattern === 'dbrow');
  assert.ok(row.detail.includes('oben 1 Sek. halten'), 'eigene Vorgabe der Stufe');
  assert.ok(!row.detail.includes('keine Pause oben'), 'kein widersprüchliches C-Tempo');
});

test('keine Hilfsmittel anbieten, die es nicht gibt', () => {
  const { api } = boot();
  const all = Object.values(api.LADDERS).flatMap(l => l.levels).map(e => e.detail).join(' ');
  assert.ok(!/\bBand\b|Bänder|Widerstandsband/.test(all), 'keine Bänder — Mike hat keine');
});

console.log('\nÜbungs-Details');

test('jede Leiter-Übung hat eine Anleitung, ohne Waisen', () => {
  const { api } = boot();
  const levels = Object.values(api.LADDERS).flatMap(l => l.levels);
  const names = levels.map(e => e.name);
  assert.equal(new Set(names).size, names.length, 'Stufennamen sind eindeutig');
  // Gewichtsstufen teilen eine Anleitung — der Schlüssel ist guide, sonst name.
  const keys = [...new Set(levels.map(e => e.guide || e.name))];
  const missing = keys.filter(k => !api.EXERCISE_GUIDE[k]);
  const orphan = Object.keys(api.EXERCISE_GUIDE).filter(k => !keys.includes(k));
  assert.deepEqual(missing, [], 'ohne Anleitung');
  assert.deepEqual(orphan, [], 'Anleitung ohne Übung');
});

test('jede Anleitung ist vollständig', () => {
  const { api } = boot();
  for (const [name, g] of Object.entries(api.EXERCISE_GUIDE)) {
    assert.ok(g.setup && g.setup.length > 20, name + ': Aufbau');
    assert.ok(Array.isArray(g.steps) && g.steps.length >= 2, name + ': Ausführung');
    assert.ok(Array.isArray(g.mistakes) && g.mistakes.length >= 2, name + ': Fehler');
    assert.ok(g.muscles && g.breath, name + ': Muskeln/Atmung');
    for (const x of [...g.steps, ...g.mistakes]) assert.ok(x.length > 10, name + ': zu knapp — ' + x);
  }
});

test('openDetail zeigt die Übung der aktuellen Phase', () => {
  const { api, el } = boot();
  api.setState({ levels: Object.assign({}, api.DEFAULT_LEVELS, { push: 4 }), selectedTemplate: 'A',
                 sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const idx = w.findIndex(x => x.pattern === 'push' && x.kind === 'work-reps');
  api.setState({ workout: w, currentIdx: idx });
  api.openDetail();
  assert.equal(el('sheetTitle').textContent, 'Liegestütze');
  assert.match(el('sheetKicker').textContent, /Push \(Brust\/Schulter\) · Level 4\/6/);
  const body = el('sheetBody').innerHTML;
  for (const h of ['Aufbau', 'Ausführung', 'Häufige Fehler', 'Atmung', 'Beteiligte Muskeln', 'Zählweise', 'Position in der Leiter']) {
    assert.ok(body.includes(h), 'Abschnitt fehlt: ' + h);
  }
  assert.ok(el('detailSheet')._classes.has('visible'), 'Sheet offen');
});

test('openDetail funktioniert auch in der Pause (Muster aus logFor)', () => {
  const { api, el } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS, selectedTemplate: 'A', sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false, { rotation: 0 });
  const idx = w.findIndex(x => x.logFor && x.logFor.pattern === 'squat');
  api.setState({ workout: w, currentIdx: idx });
  api.openDetail();
  assert.match(el('sheetKicker').textContent, /Squat \(Beine\)/);
});

test('phasePattern: nur Leiter-Phasen, nicht Warm-Up oder Cardio', () => {
  const { api } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS });
  const w = api.buildWorkout('A', true, { rotation: 0, finisher: 'hiit' });
  assert.equal(api.phasePattern(w.find(p => p.kind === 'warmup')), null);
  assert.equal(api.phasePattern(w.find(p => p.kind === 'cardio-hard')), null);
  assert.ok(api.phasePattern(w.find(p => p.kind === 'work-reps')));
  assert.ok(api.phasePattern(w.find(p => p.logFor)));
});

test('openDetail gezielt aus der Levels-Liste, Level wird geklemmt', () => {
  const { api, el } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS, workout: [], currentIdx: 0 });
  api.openDetail('core', 6);
  assert.equal(el('sheetTitle').textContent, 'V-Ups');
  api.openDetail('core', 99);
  assert.equal(el('sheetTitle').textContent, 'V-Ups', 'nach oben geklemmt');
  api.openDetail('core', 0);
  assert.equal(el('sheetTitle').textContent, 'Plank (Knie)', 'nach unten geklemmt');
  api.openDetail('gibtsnicht', 3);
  assert.equal(el('sheetTitle').textContent, 'Plank (Knie)', 'unbekanntes Muster ändert nichts');
});

test('Leiter-Navigation nennt Nachbarstufen und die Ränder', () => {
  const { api, el } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS, workout: [], currentIdx: 0 });
  api.openDetail('push', 3);
  let b = el('sheetBody').innerHTML;
  assert.ok(b.includes('Knie-Liegestütze') === false || b.includes('Erhöhte Liegestütze'), 'leichtere Stufe genannt');
  assert.ok(b.includes('Liegestütze</strong>'), 'schwerere Stufe genannt');
  api.openDetail('push', 1);
  assert.ok(el('sheetBody').innerHTML.includes('Leichteste Stufe'));
  api.openDetail('push', 6);
  assert.ok(el('sheetBody').innerHTML.includes('Schwerste Stufe'));
});

test('Zählweise unterscheidet Halten und Wiederholungen', () => {
  const { api, el } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS, workout: [], currentIdx: 0 });
  api.openDetail('vpull', 1);   // Aktives Hängen = Sekunden
  assert.ok(el('sheetBody').innerHTML.includes('Sekunden gehalten'));
  api.openDetail('vpull', 5);   // Klimmzüge = Wdh
  assert.ok(el('sheetBody').innerHTML.includes('Wiederholungen'));
});

test('Detail öffnen pausiert den Timer, schließen setzt fort', () => {
  const { api, el } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS, selectedTemplate: 'A', sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false, { rotation: 0 });
  api.setState({ workout: w, currentIdx: w.findIndex(x => x.kind === 'work-reps'),
                 workoutActive: true, isPaused: false });
  api.openDetail();
  assert.equal(api.getState().isPaused, true, 'pausiert');
  assert.ok(!el('sheetPaused')._classes.has('hidden'), 'Hinweis sichtbar');
  api.closeDetail();
  assert.equal(api.getState().isPaused, false, 'wieder gestartet');
  assert.ok(!el('detailSheet')._classes.has('visible'), 'Sheet zu');
});

test('eine selbst gesetzte Pause bleibt nach dem Schließen bestehen', () => {
  const { api } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS, selectedTemplate: 'A', sessionSets: {}, sessionConfirmed: {} });
  const w = api.buildWorkout('A', false, { rotation: 0 });
  api.setState({ workout: w, currentIdx: w.findIndex(x => x.kind === 'work-reps'),
                 workoutActive: true, isPaused: true });
  api.openDetail();
  assert.equal(api.getState().detailPausedByMe, false, 'nicht selbst pausiert');
  api.closeDetail();
  assert.equal(api.getState().isPaused, true, 'Pause bleibt');
});

test('auf dem Startbildschirm läuft kein Timer mit', () => {
  const { api } = boot();
  api.setState({ levels: api.DEFAULT_LEVELS, workout: [], currentIdx: 0, workoutActive: false, isPaused: false });
  api.openDetail('hinge', 2);
  assert.equal(api.getState().isPaused, false);
  api.closeDetail();
  assert.equal(api.getState().isPaused, false);
});

test('Levels-Liste blendet Stangen-Leitern ohne Stange aus', () => {
  const noBar = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: false }) } }).api;
  assert.ok(!noBar.visiblePatterns().includes('vpull'));
  assert.ok(noBar.visiblePatterns().includes('vpush'), 'Pike braucht keine Stange');
  const withBar = boot({ store: { mikeTrainingPrefs: JSON.stringify({ bar: true }) } }).api;
  assert.ok(withBar.visiblePatterns().includes('vpull'));
});

test('Gewichtsstufen zeigen dieselbe Anleitung plus die eigene Stufe', () => {
  const { api, el } = boot({ store: { mikeTrainingPrefs: JSON.stringify({ dumbbells: true }) } });
  api.setState({ levels: api.DEFAULT_LEVELS, workout: [], currentIdx: 0 });
  api.openDetail('dbcurl', 2);
  const a = el('sheetBody').innerHTML;
  assert.equal(el('sheetTitle').textContent, 'Curls · 7,5 kg');
  assert.ok(a.includes('Diese Stufe'), 'Stufen-Hinweis');
  assert.ok(a.includes('7,5 kg pro Hand'), 'Gewicht der Stufe');
  assert.ok(a.includes('Ellbogen bleiben am Rumpf fixiert'), 'geteilte Anleitung');
  api.openDetail('dbcurl', 4);
  const b = el('sheetBody').innerHTML;
  assert.ok(b.includes('12,5 kg pro Hand'), 'anderes Gewicht');
  assert.ok(b.includes('Ellbogen bleiben am Rumpf fixiert'), 'gleiche Anleitung');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
