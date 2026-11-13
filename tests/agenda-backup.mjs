// Data-only portable backup checks. No DOM, audio, network or browser storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, setProfileLunchChoices } from '../display-core.mjs';
import { ProfileStore, PROFILE_KEY, exportProfiles, importDisplayProfiles } from '../profile-store.mjs';
import { ClassroomStore, CLASSROOM_KEY } from '../agenda/classroom-model.mjs?v=agenda-release-1';
import { AgendaController } from '../agenda/classroom-sequence.mjs?v=agenda-release-1';
import { destinationChoices } from '../agenda/classroom-planning.mjs?v=agenda-release-1';
import { builtInConfiguration, snapshotChoices, snapshotConfiguration } from '../school-setup.mjs';
import { scheduleSnapshot } from '../schedule-presentation.mjs';
import { AGENDA_MODE_ENABLED, isAgendaPreviewEnabled } from '../agenda/feature-flag.mjs?v=agenda-release-1';
import { exportAgendaBackup, parseAgendaBackup, backupDestinations, previewAgendaRestore, restoreAgendaBackup, MAX_BACKUP_BYTES } from '../agenda/classroom-backup.mjs';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const config = normalize(read('../public/samples/classroom-demo.json'));
const profiles = [{ id: 'school-profile', configuration: config }, { id: 'other-profile', configuration: { ...structuredClone(config), profileName: 'Other teacher' } }];
const date = '2026-11-12', choices = destinationChoices(config, date), at = choices[0].event.startAt + 1000;
const lesson = (day = date, choice = choices[0]) => ({ date: day, activityID: choice.id, title: 'Film lesson', instructions: 'Work in pairs', items: ['Discuss', 'Record'], itemDurationsMs: [30000, 60000] });
const memory = () => { const map = new Map(); return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };
const makeStore = () => new ClassroomStore(memory());
const source = makeStore();
source.saveAgenda(profiles[0].id, lesson());
source.saveAgenda(profiles[0].id, lesson('2026-11-13', choices[1]));
source.saveAgenda(profiles[1].id, { ...lesson(), title: 'Second profile lesson' });
source.change(profiles[0].id, p => { p.transitionSound = true; });
const backup = parseAgendaBackup(JSON.stringify(await exportAgendaBackup(source, profiles)));
const mappings = Object.fromEntries(profiles.map(p => [p.id, p.id]));
const legacy = value => { const old = structuredClone(value); old.formatVersion = 1;
  for (const p of old.profiles) { if (p.descriptor) delete p.descriptor.definitionSignature; for (const a of p.agendas) delete a.evidence; }
  return parseAgendaBackup(JSON.stringify(old)); };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
async function restore(store, { data = backup, mapping = mappings, targets = profiles, choose, preview, ...options } = {}) {
  preview ??= await previewAgendaRestore(data, mapping, targets, store, at);
  const selections = preview.map(row => ({ key: row.key, include: true, replace: false, ...choose?.(row) }));
  return restoreAgendaBackup({ backup: data, mappings: mapping, selections, preview, getProfiles: () => targets, store, now: () => at, ...options });
}

await test('round trip across profiles/dates, preferences informational, storage namespace unchanged', async () => {
  const storage = memory(), store = new ClassroomStore(storage);
  const result = await restore(store);
  assert.equal(result.imported.length, 3);
  for (const p of profiles) assert.deepEqual(store.profile(p.id).agendas, source.profile(p.id).agendas);
  assert.equal(store.profile(profiles[0].id).transitionSound, undefined);
  assert.deepEqual([...storage.map.keys()], [CLASSROOM_KEY]);
  assert.deepEqual(new ClassroomStore(storage).snapshot, store.snapshot);
  store.saveAgenda(profiles[0].id, { ...lesson(), title: 'Edited independently' });
  assert.equal(store.agenda(profiles[1].id, date, choices[0].id).title, 'Second profile lesson');
});

await test('Display backup creates new IDs; Agenda mapping remains explicit and verified', async () => {
  const schedules = new ProfileStore(memory(), () => 'old-display-id');
  schedules.add([config]);
  const officialBackup = exportProfiles(schedules.snapshot);
  const restored = new ProfileStore(memory(), () => 'new-display-id');
  restored.add(importDisplayProfiles(officialBackup));
  const agendaSource = makeStore(); agendaSource.saveAgenda('old-display-id', lesson());
  const portable = await exportAgendaBackup(agendaSource, schedules.snapshot.savedProfiles);
  const available = await backupDestinations(portable, restored.snapshot.savedProfiles);
  assert.equal(available[0].exact, '');
  assert.equal(available[0].candidates[0].id, 'new-display-id');
  const store = makeStore();
  assert.equal((await restore(store, { data: portable, mapping: {}, targets: restored.snapshot.savedProfiles })).imported.length, 0);
  assert.equal((await restore(store, { data: portable, mapping: { 'old-display-id': 'new-display-id' }, targets: restored.snapshot.savedProfiles })).imported.length, 1);
  assert.equal(restored.snapshot.savedProfiles.length, 1);
});

await test('same UUID is insufficient when schedule identity differs; display-only changes remain compatible', async () => {
  const wrong = structuredClone(profiles); wrong[0].configuration.school.id = 'other.school';
  assert.equal((await backupDestinations(backup, wrong))[0].exact, '');
  const preview = await previewAgendaRestore(backup, mappings, wrong, makeStore(), at);
  assert.equal(preview[0].status, 'incompatible');
  const renamed = structuredClone(profiles); renamed[0].configuration.profileName = 'Home'; renamed[0].configuration.preferences.hour24 = true;
  assert.equal((await backupDestinations(backup, renamed))[0].exact, profiles[0].id);
  const changed = structuredClone(profiles); changed[0].configuration.rotation.noSchoolDates.push(date);
  assert.equal((await backupDestinations(backup, changed))[0].exact, '');
});

await test('new backups import unaffected lessons across lunch differences and reject changed split classes', async () => {
  const schedule = read('../public/builtins/wmhs/schedule.json'), calendar = read('../public/builtins/wmhs/calendar.json');
  const sourceConfig = builtInConfiguration('wmhs', schedule, calendar);
  for (const rows of Object.values(sourceConfig.assignments)) rows['4'].lunch = 'L1';
  const targetConfig = structuredClone(sourceConfig);
  for (const rows of Object.values(targetConfig.assignments)) rows['4'].lunch = 'L2';
  const day = '2026-09-01', sourceChoices = destinationChoices(sourceConfig, day);
  const unaffected = sourceChoices.find(c => c.event.periodID === '1');
  const affected = sourceChoices.find(c => c.event.periodID === '4');
  assert(unaffected && affected);
  const sourceProfile = [{ id: 'wmhs-original', configuration: sourceConfig }];
  const destinationProfile = [{ id: 'wmhs-restored', configuration: targetConfig }];
  const saved = makeStore(); saved.saveAgenda('wmhs-original', lesson(day, unaffected));
  saved.saveAgenda('wmhs-original', { ...lesson(day, affected), title: 'Split lesson' });
  const data = parseAgendaBackup(JSON.stringify(await exportAgendaBackup(saved, sourceProfile)));
  assert.equal(data.formatVersion, 2);
  assert.equal((await backupDestinations(data, destinationProfile))[0].candidates.length, 1);
  const map = { 'wmhs-original': 'wmhs-restored' }, rows = await previewAgendaRestore(data, map, destinationProfile, makeStore(), at);
  assert.equal(rows.find(r => r.agenda.activityID === unaffected.id).status, 'ready');
  assert.equal(rows.find(r => r.agenda.activityID === affected.id).status, 'incompatible');
  assert(rows.every(r => r.profileDifference));
  const destination = makeStore();
  const report = await restore(destination, { data, mapping: map, targets: destinationProfile });
  assert.equal(report.imported.length, 1); assert.equal(report.incompatible.length, 1);
  assert.equal(destination.profile('wmhs-restored').agendas[0].activityID, unaffected.id);
  assert.equal(targetConfig.assignments['1']['4'].lunch, 'L2');
  const old = legacy(data);
  assert.equal((await backupDestinations(old, destinationProfile))[0].candidates.length, 0);
  assert.equal((await restore(makeStore(), { data: old, mapping: map, targets: destinationProfile })).incompatible.length, 2);
  assert.equal((await restore(makeStore(), { data: old, mapping: { 'wmhs-original': 'wmhs-original' }, targets: sourceProfile })).imported.length, 2);
});

await test('WSHS lunch choices use the official resolver and preserve unaffected lessons', async () => {
  const school = snapshotChoices('wshs', read('../public/builtins/wshs/profiles.json'))[0];
  const sourceConfig = snapshotConfiguration(school, read('../public/builtins/wshs/wshs.json'));
  const dayID = sourceConfig.portable.shared.schoolDefinitionSnapshot.cycle.dayIDs[0];
  const sourceLunch = setProfileLunchChoices(sourceConfig, [{ day: dayID, period: 'P5', lunch: 'L1' }]);
  const targetLunch = setProfileLunchChoices(sourceLunch, [{ day: dayID, period: 'P5', lunch: 'L2' }]);
  const day = '2026-11-12', sourceChoices = destinationChoices(sourceLunch, day);
  const unaffected = sourceChoices.find(c => c.event.periodID === 'P1');
  assert(unaffected);
  const sourceProfile = [{ id: 'wshs-a', configuration: sourceLunch }], targetProfile = [{ id: 'wshs-b', configuration: targetLunch }];
  const saved = makeStore(); saved.saveAgenda('wshs-a', lesson(day, unaffected));
  const data = parseAgendaBackup(JSON.stringify(await exportAgendaBackup(saved, sourceProfile)));
  assert.equal((await backupDestinations(data, targetProfile))[0].candidates.length, 1);
  assert.equal((await restore(makeStore(), { data, mapping: { 'wshs-a': 'wshs-b' }, targets: targetProfile })).imported.length, 1);
});

await test('changed class details, boundaries, school and activity identity cannot use per-lesson fallback', async () => {
  const changed = structuredClone(profiles);
  changed[0].configuration.assignments.every.p1.title = 'Different class';
  const sourceChoice = choices[0], changedChoice = destinationChoices(changed[0].configuration, date).find(c => c.id === sourceChoice.id);
  assert(changedChoice); assert.notEqual(changedChoice.event.title, sourceChoice.event.title);
  assert.equal((await previewAgendaRestore(backup, mappings, changed, makeStore(), at))[0].status, 'incompatible');
  const wrong = structuredClone(profiles); wrong[0].configuration.school.id = 'other.school';
  assert.equal((await backupDestinations(backup, wrong))[0].candidates.length, 1); // The second, unchanged profile remains available.
  assert.equal((await previewAgendaRestore(backup, mappings, wrong, makeStore(), at))[0].status, 'incompatible');
  const bad = structuredClone(backup); bad.profiles[0].agendas[0].activityID = '["period","wrong"]';
  assert.equal((await restore(makeStore(), { data: bad })).incompatible.length, 1);
  const altered = structuredClone(backup); altered.profiles[0].agendas[0].evidence.segments[0].endAt += 60000;
  const different = structuredClone(profiles); different[0].configuration.assignments.every.p1.room = 'Different';
  assert.equal((await previewAgendaRestore(altered, mappings, different, makeStore(), at))[0].status, 'incompatible');
});

await test('missing profiles, missing source descriptors, closed dates and wrong exact activity IDs stay unimported', async () => {
  assert.equal((await restore(makeStore(), { targets: [] })).incompatible.length, 3);
  const orphan = structuredClone(backup); orphan.profiles[0].descriptor = null;
  assert.equal((await restore(makeStore(), { data: orphan })).incompatible.length, 2);
  for (const change of [a => { a.activityID = '["period","not-a-class"]'; }, a => { a.date = '2026-11-14'; }]) {
    const bad = structuredClone(backup); change(bad.profiles[0].agendas[0]);
    assert.equal((await restore(makeStore(), { data: bad })).incompatible.length, 1);
  }
});

await test('WSHS exam lessons map after Display restore with a new UUID', async () => {
  const school = snapshotChoices('wshs', read('../public/builtins/wshs/profiles.json'))[0];
  const configuration = snapshotConfiguration(school, read('../public/builtins/wshs/wshs.json'));
  const sourceProfiles = [{ id: 'wshs-work', configuration }];
  const sourceStore = makeStore();
  const exams = destinationChoices(configuration, '2026-12-16');
  sourceStore.saveAgenda('wshs-work', { ...lesson(), date: '2026-12-16', activityID: exams[0].id });
  const portable = parseAgendaBackup(JSON.stringify(await exportAgendaBackup(sourceStore, sourceProfiles)));
  const targetProfiles = [{ id: 'wshs-home', configuration: normalize(structuredClone(configuration)) }];
  assert.equal((await backupDestinations(portable, targetProfiles))[0].exact, '');
  const store = makeStore();
  const result = await restore(store, { data: portable, targets: targetProfiles, mapping: { 'wshs-work': 'wshs-home' } });
  assert.equal(result.imported.length, 1);
  assert.equal(store.profile('wshs-home').agendas[0].activityID, exams[0].id);
});

await test('duplicates skip, conflicts require confirmation, stale previews cannot overwrite', async () => {
  const store = makeStore(); await restore(store);
  assert.equal((await restore(store)).skipped.length, 3);
  store.saveAgenda(profiles[0].id, { ...lesson(), title: 'Keep me' });
  assert.equal((await restore(store)).imported.length, 0);
  assert.equal(store.agenda(profiles[0].id, date, choices[0].id).title, 'Keep me');
  const preview = await previewAgendaRestore(backup, mappings, profiles, store, at);
  store.saveAgenda(profiles[0].id, { ...lesson(), title: 'Changed after preview' });
  assert.equal((await restore(store, { preview, choose: () => ({ replace: true }) })).imported.length, 0);
  assert.equal((await restore(store, { choose: () => ({ replace: true }) })).imported.length, 1);
  assert.equal(store.profile(profiles[0].id).agendas.length, 2);
});

await test('running, paused and recovery sessions stay protected, no session state in export', async () => {
  const store = makeStore(); store.saveAgenda(profiles[0].id, { ...lesson(), title: 'Active lesson' });
  const controller = new AgendaController(store), snapshot = scheduleSnapshot(config, at);
  controller.start(profiles[0].id, { snapshot, now: at, startIndex: 0 });
  for (const status of ['running', 'paused', 'recover']) {
    store.change(profiles[0].id, p => { p.agendaRun.status = status; if (status !== 'running') p.timer.status = 'paused'; });
    const before = store.runState(profiles[0].id);
    const report = await restore(store, { choose: () => ({ replace: true }) });
    assert(report.skipped.some(item => item.includes('protects')));
    assert.deepEqual(store.runState(profiles[0].id), before);
  }
  const exported = await exportAgendaBackup(store, profiles);
  const raw = JSON.stringify(exported);
  for (const field of ['"timer"','"agendaRun"','"completed"','"skipped"','"presentation"']) assert(!raw.includes(field));
  const destination = makeStore();
  await restore(destination, { data: exported });
  assert.deepEqual(destination.runState(profiles[0].id), { agendaRun: null, timer: null });
});

await test('manual timers protected and destination chime preferences retained', async () => {
  const store = makeStore();
  store.start(profiles[0].id, { name: 'Single', durationMs: 60000, snapshot: scheduleSnapshot(config, at), now: at });
  store.change(profiles[0].id, p => { p.transitionSound = false; });
  for (const paused of [false, true]) {
    if (paused) store.pause(profiles[0].id, at + 1000);
    const before = store.runState(profiles[0].id);
    assert((await restore(store)).skipped.some(item => item.includes('protects')));
    assert.deepEqual(store.runState(profiles[0].id), before);
  }
  assert.equal(store.profile(profiles[0].id).transitionSound, false);
});

await test('multiple source profiles cannot collide on one destination record', async () => {
  const map = { ...mappings, [profiles[1].id]: profiles[0].id };
  const rows = await previewAgendaRestore(backup, map, profiles, makeStore(), at);
  assert.equal(rows.filter(r => r.reason.startsWith('Multiple')).length, 2);
});

await test('invalid, oversized, unsupported and duplicated file records rejected before writes', () => {
  assert.throws(() => parseAgendaBackup('not-json'));
  assert.throws(() => parseAgendaBackup(' '.repeat(MAX_BACKUP_BYTES + 1)));
  for (const change of [b => { b.formatVersion = 3; }, b => { b.format = 'bellsync-display-profiles'; },
    b => { b.profiles[0].agendas[0].evidence.segments[0].endAt = 'tomorrow'; },
    b => { b.profiles[0].agendas[0].itemDurationsMs = [0, 60000]; },
    b => { b.profiles[0].agendas[0].timer = {}; },
    b => { b.profiles[0].agendas.push(b.profiles[0].agendas[0]); },
    b => { b.profiles.push(b.profiles[0]); },
    b => { b.profiles[0].agendas[0].items = Array(51).fill('Too many'); }]) {
    const bad = structuredClone(backup); change(bad);
    assert.throws(() => parseAgendaBackup(JSON.stringify(bad)));
  }
});

await test('failed multi-profile writes and other-tab changes are atomic', async () => {
  const storage = memory(), store = new ClassroomStore(storage), before = store.snapshot;
  storage.setItem = () => { throw Error('Storage full'); };
  await assert.rejects(() => restore(store), /Storage full/);
  assert.deepEqual(store.snapshot, before); assert.equal(storage.getItem(CLASSROOM_KEY), null);
  const memory2 = memory(), first = new ClassroomStore(memory2), second = new ClassroomStore(memory2);
  second.saveAgenda(profiles[0].id, lesson());
  const raw = memory2.getItem(CLASSROOM_KEY);
  await assert.rejects(() => exportAgendaBackup(first, profiles), /another tab/);
  await assert.rejects(() => restore(first), /another tab/);
  assert.equal(memory2.getItem(CLASSROOM_KEY), raw);
});

await test('cancellation and official profile changes before commit abort without writes', async () => {
  const store = makeStore();
  await assert.rejects(() => restore(store, { assertReady: () => { throw Error('Cancelled'); } }), /Cancelled/);
  assert.equal(store.snapshot.profiles.length, 0);
  let calls = 0;
  const preview = await previewAgendaRestore(backup, mappings, profiles, store, at);
  await assert.rejects(() => restoreAgendaBackup({ backup, mappings, selections: preview.map(r => ({ key: r.key, include: true })), preview, store,
    getProfiles: () => ++calls === 1 ? profiles : [], now: () => at }), /profiles changed/);
  assert.equal(store.snapshot.profiles.length, 0);
});

await test('official Display backups unchanged and public gate restricted to approved hosts', () => {
  assert(!JSON.stringify(backup).includes(PROFILE_KEY));
  assert.equal(AGENDA_MODE_ENABLED, true);
  assert(isAgendaPreviewEnabled({ hostname: 'display.bellsync.app', search: '' }));
  assert(!isAgendaPreviewEnabled({ hostname: 'example.com', search: '?agenda=1' }));
  assert(isAgendaPreviewEnabled({ hostname: '127.0.0.1', search: '' }));
  assert(isAgendaPreviewEnabled({ hostname: '127.0.0.1', search: '?agenda=1' }));
});
console.log(`${passed} data-only Agenda backup checks passed.`);
