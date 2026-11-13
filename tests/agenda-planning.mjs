// Data-only checks; no browser, DOM, audio or production storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize } from '../display-core.mjs';
import { ClassroomStore, CLASSROOM_KEY, validItemDuration } from '../agenda/classroom-model.mjs';
import { AgendaController } from '../agenda/classroom-sequence.mjs';
import { snapshotChoices, snapshotConfiguration } from '../school-setup.mjs';
import { scheduleSnapshot } from '../schedule-presentation.mjs';
import { isAgendaPreviewEnabled } from '../agenda/feature-flag.mjs';
import { planReadiness, fitDurations, destinationChoices, classBudget, copyAgendas, copyAgendaContent } from '../agenda/classroom-planning.mjs';
const configuration = normalize(JSON.parse(fs.readFileSync(new URL('../public/samples/classroom-demo.json', import.meta.url), 'utf8')));
const date = '2026-11-12';
const choices = destinationChoices(configuration, date);
assert(choices.length >= 3);
const now = choices[0].event.startAt + 1000;
const source = { date, activityID: choices[0].id, title: 'Lesson', instructions: 'Work in pairs.', items: ['Roster', 'Recording', 'Upload'], itemDurationsMs: [null, 35 * 60000, null] };
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data }; };
let count = 0;
function test(name, fn) { fn(); console.log(`PASS ${name}`); count++; }
const target = (store, choice, replacement = false, destDate = date) => ({ id: choice.id, original: JSON.stringify(store.profile('teacher').agendas.find(a => a.date === destDate && a.activityID === choice.id) ?? null), replace: replacement });
const apply = (store, targets, extras = {}) => copyAgendas({ store, profileID: 'teacher', source, date, targets, configuration, now, ...extras });

test('missing durations, start-index semantics, and overrun remain separate', () => {
  const readiness = planReadiness(source, 1, 30 * 60000);
  assert.equal(readiness.plan, null);
  assert.deepEqual(readiness.missing.map(m => m.title), ['Upload']);
  assert.equal(readiness.overrunMs, 5 * 60000);
  const valid = { ...source, itemDurationsMs: [null, 35 * 60000, 30000] };
  assert(planReadiness(valid, 1, 1000).plan); // Overrun still permits existing confirmation.
  assert.equal(planReadiness(valid, 0, 1000).plan, null);
});

test('fit suggestions preserve minimums, fractional durations and exact totals', () => {
  for (let n = 1; n <= 50; n++) {
    const durations = Array.from({ length: n }, (_, i) => 1000 + ((i + 1) * 31769) % 86400000);
    const budget = Math.max(n * 1000, Math.floor(durations.reduce((a, b) => a + b, 0) / 3));
    const proposal = fitDurations(durations, budget);
    assert(proposal.every(validItemDuration));
    assert(proposal.reduce((a, b) => a + b, 0) <= budget);
    assert.equal(proposal.length, n);
  }
  assert.throws(() => fitDurations([60000, null], 10000), /Enter a duration/);
  assert.throws(() => fitDurations([60000, 60000], 1999), /not enough/);
  assert.deepEqual(fitDurations([1500, 30000], 40000), [1500, 30000]);
});

test('budget follows resolved end, and split previews use first segment only', () => {
  const event = choices[0].event;
  assert.equal(classBudget(choices[0], event, now).availableMs, event.endAt - now);
  const split = { events: [event, { ...event, startAt: event.endAt + 10000, endAt: event.endAt + 40000 }] };
  assert.equal(classBudget(split, null, now).availableMs, event.endAt - event.startAt);
  assert.equal(classBudget(choices[0], event, event.endAt + 1).availableMs, 0);
});

test('copies whitelist lesson content and are independently mutable', () => {
  const content = copyAgendaContent({ ...source, completed: [0], timer: { status: 'running' }, item: 2 }, date, choices[1].id);
  assert.equal(content.completed, undefined); assert.equal(content.timer, undefined); assert.equal(content.item, undefined);
  const storage = memory(), store = new ClassroomStore(storage);
  store.saveAgenda('teacher', source);
  const result = apply(store, [target(store, choices[1]), target(store, choices[2])]);
  assert.equal(result.copied.length, 2);
  assert.equal(store.profile('teacher').agendas.length, 3);
  const edited = store.agenda('teacher', date, choices[1].id);
  edited.items[0] = 'Changed'; edited.itemDurationsMs[1] = 1000;
  store.saveAgenda('teacher', edited);
  assert.equal(store.agenda('teacher', date, choices[2].id).items[0], 'Roster');
  assert.equal(store.agenda('teacher', date, source.activityID).itemDurationsMs[1], 35 * 60000);
  assert.equal(new ClassroomStore(storage).profile('teacher').agendas.length, 3);
  assert.deepEqual([...storage.data.keys()], [CLASSROOM_KEY]);
});

test('existing agendas need consent, stale consent is refused, repeated copies replace once', () => {
  const store = new ClassroomStore(memory());
  apply(store, [target(store, choices[1])]);
  const unapproved = apply(store, [target(store, choices[1])]);
  assert.equal(unapproved.copied.length, 0); assert.match(unapproved.skipped[0], /kept/);
  const stale = target(store, choices[1], true);
  store.saveAgenda('teacher', { ...store.agenda('teacher', date, choices[1].id), title: 'Changed in dialog' });
  assert.match(apply(store, [stale]).skipped[0], /changed/);
  const approved = target(store, choices[1], true);
  assert.equal(apply(store, [approved, approved]).copied.length, 1);
  assert.equal(store.profile('teacher').agendas.length, 1);
});

test('active manual destinations and unrelated data are protected', () => {
  const store = new ClassroomStore(memory());
  const event = choices[1].event, start = event.startAt + 1000;
  const snapshot = scheduleSnapshot(configuration, start);
  store.start('teacher', { name: 'Active', durationMs: 60000, snapshot, now: start });
  const before = store.runState('teacher');
  const result = apply(store, [target(store, choices[1]), target(store, choices[2])], { now: start });
  assert.equal(result.skipped.length, 1); assert.equal(result.copied.length, 1);
  assert.deepEqual(store.runState('teacher'), before);
  store.pause('teacher', start + 1000);
  assert.equal(apply(store, [target(store, choices[1])], { now: start + 10000 }).copied.length, 0);
});

test('automatic runs remain untouched and protected until terminal', () => {
  const store = new ClassroomStore(memory()), event = choices[1].event, start = event.startAt + 1000;
  const snapshot = scheduleSnapshot(configuration, start);
  const agenda = { ...source, activityID: choices[1].id, itemDurationsMs: [60000, 60000, 60000] };
  store.saveAgenda('teacher', agenda);
  const controller = new AgendaController(store);
  controller.start('teacher', { snapshot, now: start, startIndex: 0 });
  const before = store.runState('teacher');
  assert.equal(apply(store, [target(store, choices[1], true)], { now: start }).copied.length, 0);
  assert.deepEqual(store.runState('teacher'), before);
  controller.pause('teacher', start + 1000);
  assert.equal(apply(store, [target(store, choices[1], true)], { now: start + 1000 }).copied.length, 0);
  store.change('teacher', profile => { profile.agendaRun.status = 'recover'; });
  const recovering = store.runState('teacher');
  assert.equal(apply(store, [target(store, choices[1], true)], { now: start + 1000 }).copied.length, 0);
  assert.deepEqual(store.runState('teacher'), recovering);
  controller.stop('teacher', start + 1000, { confirmed: true });
  assert.equal(apply(store, [target(store, choices[1], true)], { now: start + 1000 }).copied.length, 1);
  assert.deepEqual(store.runState('teacher'), { agendaRun: null, timer: null });
});

test('source, invalid identities, closures, dates and class length warnings', () => {
  const store = new ClassroomStore(memory());
  const sourceSkipped = apply(store, [target(store, choices[0]), { id: 'lunch', original: 'null' }]);
  assert.equal(sourceSkipped.copied.length, 0); assert.equal(sourceSkipped.skipped.length, 2);
  const closed = structuredClone(configuration);
  closed.rotation.noSchoolDates.push('2026-11-13');
  assert.equal(destinationChoices(closed, '2026-11-13').length, 0);
  // A weekend in the existing fixture is independently closed by its resolver.
  assert.equal(destinationChoices(configuration, '2026-11-14').length, 0);
  assert.equal(apply(store, [target(store, choices[1])], { date: '2026-11-14' }).copied.length, 0);
  const nextDate = '2026-11-13', next = destinationChoices(configuration, nextDate)[0];
  assert.equal(apply(store, [target(store, next, false, nextDate)], { date: nextDate }).copied.length, 1);
  assert.equal(store.agenda('teacher', nextDate, next.id).date, nextDate);
  const long = { ...source, itemDurationsMs: [86400000, 86400000, 86400000] };
  const result = apply(store, [target(store, choices[1])], { source: long });
  assert(result.copied[0].overrunMs > 0);
  assert.deepEqual(store.agenda('teacher', date, choices[1].id).itemDurationsMs, long.itemDurationsMs);
});

test('WSHS exam and holiday destinations use exact production identities', () => {
  const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
  const choice = snapshotChoices('wshs', read('../public/builtins/wshs/profiles.json'))[0];
  const config = snapshotConfiguration(choice, read('../public/builtins/wshs/wshs.json'));
  assert.equal(destinationChoices(config, '2026-11-26').length, 0);
  const exams = destinationChoices(config, '2026-12-16');
  assert(exams.length > 0);
  assert(exams.every(c => c.event.kind === 'academic' && c.event.activitySource));
  assert(exams.every(c => !/break|lunch/i.test(c.event.title)));
  const regular = destinationChoices(config, '2026-12-15');
  assert(regular.some(c => !exams.some(e => e.id === c.id)));
});

test('storage write failure leaves every destination and source unchanged', () => {
  const storage = memory(), store = new ClassroomStore(storage);
  store.saveAgenda('teacher', source);
  const before = store.snapshot, raw = storage.getItem(CLASSROOM_KEY);
  storage.setItem = () => { throw Error('Storage full'); };
  assert.throws(() => apply(store, [target(store, choices[1]), target(store, choices[2])]), /Storage full/);
  assert.deepEqual(store.snapshot, before);
  assert.equal(storage.getItem(CLASSROOM_KEY), raw);
});

test('stale storage fails atomically, only the production domain and localhost enable Agenda', () => {
  const storage = memory(), store = new ClassroomStore(storage);
  const other = new ClassroomStore(storage);
  other.saveAgenda('teacher', source);
  const saved = storage.getItem(CLASSROOM_KEY);
  assert.throws(() => apply(store, [target(store, choices[1])]), /another tab/);
  assert.equal(storage.getItem(CLASSROOM_KEY), saved);
  assert(isAgendaPreviewEnabled({ hostname: 'display.bellsync.app', search: '' }));
  assert(!isAgendaPreviewEnabled({ hostname: 'example.com', search: '?agenda=1' }));
  assert(isAgendaPreviewEnabled({ hostname: '127.0.0.1', search: '' }));
  assert(isAgendaPreviewEnabled({ hostname: '127.0.0.1', search: '?agenda=1' }));
});
console.log(`${count} data-only Agenda planning checks passed.`);
