import { ClassroomStore, CLASSROOM_KEY } from './classroom-model.mjs?v=agenda-release-1';
import { destinationChoices, destinationBusy, copyAgendaContent } from './classroom-planning.mjs?v=agenda-release-1';
import { eventTitle } from '../display-core.mjs';

export const AGENDA_BACKUP_FORMAT = 'bellsync-agenda-backup';
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_AGENDAS = 5000;
const clone = value => JSON.parse(JSON.stringify(value));
const text = (v, max) => typeof v === 'string' && v.length <= max;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const canonical = value => JSON.stringify(value, (_, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const content = a => copyAgendaContent(a, a.date, a.activityID);
const digest = async value => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))].map(b => b.toString(16).padStart(2, '0')).join('');
const sameSchool = (a, b) => Boolean(a && b && a.schoolID === b.schoolID && a.timeZone === b.timeZone && a.sourceKind === b.sourceKind);
const lessonEvidence = choice => choice && ({ segments: choice.events.map(e => ({ startAt: e.startAt, endAt: e.endAt,
  kind: e.kind, title: eventTitle(e), room: e.room || '', blockID: e.blockID || '', periodID: e.periodID || '' })) });
const validEvidence = value => value === null || (keys(value, ['segments']) && Array.isArray(value.segments) && value.segments.length > 0 && value.segments.length <= 10 &&
  value.segments.every(s => keys(s, ['startAt', 'endAt', 'kind', 'title', 'room', 'blockID', 'periodID']) &&
    Number.isSafeInteger(s.startAt) && Number.isSafeInteger(s.endAt) && s.endAt > s.startAt &&
    ['kind', 'title', 'room', 'blockID', 'periodID'].every(k => text(s[k], 500))));

export async function profileDescriptor(profile) {
  const config = clone(profile.configuration);
  // Conservative compatibility: preserve schedule, assignments, calendars and
  // corrections. Ignore only display preferences, display names and export time.
  delete config.preferences;
  delete config.profileName;
  delete config.school.displayName;
  if (config.portable?.shared) delete config.portable.shared.exportedAt;
  const scheduleSignature = await digest(config);
  // The definition remains fixed when personal assignments or WSHS lunch choices change.
  delete config.assignments;
  delete config.lunchGuidancePrompted;
  if (config.portable?.shared) {
    delete config.portable.shared.assignments;
    delete config.portable.shared.wshsLunchPreferences;
  }
  return { schoolID: config.school.id, schoolName: profile.configuration.school.displayName,
    profileName: profile.configuration.profileName, timeZone: config.school.timeZone,
    sourceKind: config.sourceKind, scheduleSignature, definitionSignature: await digest(config) };
}
const compatible = (a, b) => sameSchool(a, b) && a.scheduleSignature === b.scheduleSignature;
const candidate = (source, destination, version) => sameSchool(source, destination) &&
  (compatible(source, destination) || (version === 2 && source.definitionSignature === destination.definitionSignature));

export function parseAgendaBackup(input) {
  requireValue(typeof input === 'string' && new TextEncoder().encode(input).length <= MAX_BACKUP_BYTES, 'Choose an Agenda backup no larger than 5 MB.');
  let value;
  try { value = JSON.parse(input); } catch { throw Error('This file is not valid JSON. Nothing was imported.'); }
  requireValue(keys(value, ['format', 'formatVersion', 'exportedAt', 'profiles']) && value.format === AGENDA_BACKUP_FORMAT, 'Choose a BellSync Agenda backup. Display schedule backups use Restore Display Backup.');
  requireValue([1, 2].includes(value.formatVersion), 'This Agenda backup version is not supported.');
  requireValue(text(value.exportedAt, 40) && Number.isFinite(Date.parse(value.exportedAt)), 'The backup export date is invalid.');
  requireValue(Array.isArray(value.profiles) && value.profiles.length > 0 && value.profiles.length <= 200, 'The backup must contain 1–200 Agenda profiles.');
  const ids = new Set(); let total = 0;
  for (const p of value.profiles) {
    requireValue(keys(p, ['sourceProfileID', 'descriptor', 'preferences', 'agendas']) && text(p.sourceProfileID, 128) && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(p.sourceProfileID) && !['demo', '__proto__', 'prototype', 'constructor'].includes(p.sourceProfileID) && !ids.has(p.sourceProfileID), 'The backup has an invalid or duplicate source profile.');
    ids.add(p.sourceProfileID);
    if (p.descriptor !== null) {
      const d = p.descriptor;
      requireValue(keys(d, ['schoolID', 'schoolName', 'profileName', 'timeZone', 'sourceKind', 'scheduleSignature', ...(value.formatVersion === 2 ? ['definitionSignature'] : [])]) &&
        ['schoolID', 'schoolName', 'profileName', 'timeZone', 'sourceKind'].every(key => text(d[key], 500) && d[key]) &&
        [d.scheduleSignature, ...(value.formatVersion === 2 ? [d.definitionSignature] : [])].every(s => text(s, 64) && /^[a-f0-9]{64}$/.test(s)), 'The backup contains invalid school or schedule descriptors.');
    }
    requireValue(keys(p.preferences, ['transitionSound']) && (p.preferences.transitionSound === undefined || typeof p.preferences.transitionSound === 'boolean'), 'The backup contains invalid Agenda preferences.');
    requireValue(Array.isArray(p.agendas) && p.agendas.length <= 3650, 'A profile has too many agendas.');
    total += p.agendas.length;
    requireValue(total <= MAX_BACKUP_AGENDAS, 'The backup exceeds 5,000 agendas. Export smaller groups.');
    for (const a of p.agendas) {
      requireValue(keys(a, ['date', 'activityID', 'title', 'instructions', 'items', 'itemDurationsMs', 'activityLabel', ...(value.formatVersion === 2 ? ['evidence'] : [])]) &&
        (a.activityLabel === undefined || text(a.activityLabel, 500)) && (value.formatVersion !== 2 || (Object.hasOwn(a, 'evidence') && validEvidence(a.evidence))), 'The backup contains unsupported lesson fields or session data.');
    }
    // Reuse the production Agenda validator without touching browser storage.
    const validation = { version: 1, profiles: [{ id: p.sourceProfileID, layout: 'focus', agendas: p.agendas.map(content), timer: null, presentation: null }] };
    try { new ClassroomStore({ getItem: () => JSON.stringify(validation) }); }
    catch (error) { throw Error(`Invalid Agenda backup: ${error.message}`); }
  }
  requireValue(total > 0, 'This backup contains no saved agendas.');
  return value;
}

export async function exportAgendaBackup(store, profiles, scope = null) {
  const descriptors = new Map(await Promise.all(profiles.map(async p => [p.id, await profileDescriptor(p)])));
  requireValue(store.storage.getItem(CLASSROOM_KEY) === store.raw, 'Agendas changed in another tab. Reload before exporting.');
  const saved = store.snapshot.profiles.filter(p => p.agendas.length && (!scope || p.id === scope));
  const backup = { format: AGENDA_BACKUP_FORMAT, formatVersion: 2, exportedAt: new Date().toISOString(),
    profiles: saved.map(p => {
      const configuration = profiles.find(profile => profile.id === p.id)?.configuration;
      const byDate = new Map();
      return { sourceProfileID: p.id, descriptor: descriptors.get(p.id) ?? null,
        preferences: typeof p.transitionSound === 'boolean' ? { transitionSound: p.transitionSound } : {},
        agendas: p.agendas.map(a => {
          let label = '';
          if (configuration) {
            try {
              if (!byDate.has(a.date)) byDate.set(a.date, destinationChoices(configuration, a.date));
              const choice = byDate.get(a.date).find(c => c.id === a.activityID);
              if (choice) label = eventTitle(choice.event);
            } catch { /* Preserve saved content even if its old class no longer resolves. */ }
          }
          const choice = byDate.get(a.date)?.find(c => c.id === a.activityID);
          return { ...content(a), activityLabel: label.slice(0, 500), evidence: lessonEvidence(choice) || null };
        }) };
    }) };
  // Export exactly the bounded, validated portable format accepted by import.
  parseAgendaBackup(JSON.stringify(backup));
  return backup;
}

export async function backupDestinations(backup, profiles) {
  const available = await Promise.all(profiles.map(async p => ({ id: p.id, descriptor: await profileDescriptor(p) })));
  return backup.profiles.map(source => ({ sourceProfileID: source.sourceProfileID,
    candidates: available.filter(p => candidate(source.descriptor, p.descriptor, backup.formatVersion)),
    exact: available.find(p => p.id === source.sourceProfileID && candidate(source.descriptor, p.descriptor, backup.formatVersion))?.id || '' }));
}

export async function previewAgendaRestore(backup, mappings, profiles, store, now) {
  const descriptors = new Map(await Promise.all(profiles.map(async p => [p.id, await profileDescriptor(p)])));
  const rows = [], timelines = new Map();
  for (const [pi, source] of backup.profiles.entries()) {
    const destination = profiles.find(p => p.id === mappings[source.sourceProfileID]);
    const profile = destination && store.profile(destination.id);
    for (const [ai, agenda] of source.agendas.entries()) {
      const difference = Boolean(destination && source.descriptor && !compatible(source.descriptor, descriptors.get(destination.id)));
      const row = { key: `${pi}:${ai}`, sourceProfileID: source.sourceProfileID, targetID: destination?.id || '', profileDifference: difference,
        targetName: destination?.configuration.profileName || '', agenda: content(agenda), label: agenda.activityLabel || 'Saved class',
        original: null, status: 'ready', reason: '' };
      const reject = reason => { row.status = 'incompatible'; row.reason = reason; };
      if (!source.descriptor) reject('The original school profile is missing; its identity cannot be verified.');
      else if (!destination) reject('Choose an existing compatible school profile.');
      else if (!candidate(source.descriptor, descriptors.get(destination.id), backup.formatVersion)) reject('The school or schedule definition does not match. Restore the matching Display profile first.');
      else {
        const key = JSON.stringify([destination.id, agenda.date]);
        if (!timelines.has(key)) {
          try { timelines.set(key, destinationChoices(destination.configuration, agenda.date)); }
          catch { timelines.set(key, []); }
        }
        const choice = timelines.get(key).find(c => c.id === agenda.activityID);
        if (!choice) reject('This exact class is unavailable or ineligible on the lesson date.');
        else if (difference && (!agenda.evidence || canonical(agenda.evidence) !== canonical(lessonEvidence(choice))))
          reject(backup.formatVersion === 1 ? 'This older backup requires an exact schedule match.' : !agenda.evidence ?
            'The backup has no verified class boundaries for this lesson. Restore the original Display profile.' :
            'This class has different instructional times, lunch boundaries, or class details.');
        else {
          row.label = eventTitle(choice.event);
          const existing = profile.agendas.find(a => a.date === agenda.date && a.activityID === agenda.activityID);
          row.original = JSON.stringify(existing ?? null);
          if (existing && canonical(content(existing)) === canonical(content(agenda))) { row.status = 'duplicate'; row.reason = 'Identical lesson already saved; it will be kept.'; }
          else if (destinationBusy(profile, agenda.date, agenda.activityID, now, destination.configuration)) { row.status = 'protected'; row.reason = 'An active, paused or recovery session protects this lesson.'; }
          else if (existing) { row.status = 'conflict'; row.reason = 'A different lesson exists. Select Replace to overwrite it.'; }
        }
      }
      rows.push(row);
    }
  }
  const targets = new Map();
  for (const row of rows.filter(r => ['ready', 'conflict'].includes(r.status))) {
    const key = JSON.stringify([row.targetID, row.agenda.date, row.agenda.activityID]);
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key).push(row);
  }
  for (const matches of targets.values()) if (matches.length > 1) for (const row of matches) {
    row.status = 'incompatible'; row.reason = 'Multiple source lessons map here. Map these source profiles separately.';
  }
  return rows;
}

export async function restoreAgendaBackup({ backup, mappings, selections, preview, getProfiles, store, now = () => Date.now(), assertReady = () => {} }) {
  const profiles = getProfiles(), signature = canonical(profiles);
  const fresh = await previewAgendaRestore(backup, mappings, profiles, store, now());
  assertReady();
  requireValue(signature === canonical(getProfiles()), 'School profiles changed. Review the import again.');
  const chosen = new Map(selections.map(s => [s.key, s]));
  const imported = [], skipped = [], incompatible = [];
  const approved = [];
  for (const row of fresh) {
    const choice = chosen.get(row.key), prior = preview.find(p => p.key === row.key);
    const name = `${row.agenda.title || 'Untitled agenda'} · ${row.agenda.date} · ${row.label}${row.targetName ? ` → ${row.targetName}` : ''}`;
    if (row.status === 'incompatible') { incompatible.push(`${name}: ${row.reason}`); continue; }
    if (!choice?.include || ['duplicate', 'protected'].includes(row.status)) { skipped.push(`${name}: ${row.reason || 'not selected'}`); continue; }
    if (!prior || prior.targetID !== row.targetID || prior.original !== row.original || prior.status !== row.status || prior.profileDifference !== row.profileDifference) { skipped.push(`${name}: destination changed; review again`); continue; }
    if (row.status === 'conflict' && !choice.replace) { skipped.push(`${name}: existing lesson kept`); continue; }
    approved.push({ row, name });
  }
  if (approved.length) store.changeAll(draft => {
    for (const { row, name } of approved) {
      const configuration = profiles.find(p => p.id === row.targetID).configuration;
      let profile = draft.profiles.find(p => p.id === row.targetID);
      if (!profile) { profile = store.profile(row.targetID); draft.profiles.push(profile); }
      const matches = v => v?.date === row.agenda.date && v.activityID === row.agenda.activityID;
      if (destinationBusy(profile, row.agenda.date, row.agenda.activityID, now(), configuration)) { skipped.push(`${name}: active session kept`); continue; }
      const existing = profile.agendas.find(matches);
      if (JSON.stringify(existing ?? null) !== row.original) { skipped.push(`${name}: destination changed; review again`); continue; }
      profile.agendas = profile.agendas.filter(a => !matches(a));
      profile.agendas.push(clone(row.agenda));
      // Old terminal history must not appear to belong to imported content.
      if (matches(profile.agendaRun)) profile.agendaRun = null;
      if (matches(profile.timer)) profile.timer = null;
      if (matches(profile.presentation)) profile.presentation = null;
      imported.push(name);
    }
  });
  return { imported, skipped, incompatible };
}
