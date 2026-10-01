import { normalize, importBackup, validateNative, defaultPreferences } from './display-core.mjs';

export const PROFILE_KEY = 'bellsync.webDisplay.profiles.v1';
export const LEGACY_KEY = 'bellsync.webDisplay.config.v1';
export const DEMO_ID = 'demo';
export const COLLECTION_FORMAT = 'bellsync-display-profiles';
const copy = v => JSON.parse(JSON.stringify(v));
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = message => { throw Error(message); };
const empty = () => ({schemaVersion:1,activeProfileID:null,lastRealProfileID:null,savedProfiles:[]});
const validID = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) && !['demo','__proto__','prototype','constructor'].includes(id);

export function validateStore(value) {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.savedProfiles) || value.savedProfiles.length > 200) fail('Invalid or unsupported Display profile collection.');
  const ids = new Set();
  const savedProfiles = value.savedProfiles.map(p => {
    if (!object(p) || !validID(p.id) || ids.has(p.id)) fail('Invalid or duplicate profile ID.');
    ids.add(p.id);
    return {id:p.id,configuration:normalize(p.configuration)};
  });
  if (value.activeProfileID !== null && value.activeProfileID !== DEMO_ID && !ids.has(value.activeProfileID)) fail('The active profile is missing.');
  const lastRealProfileID = value.lastRealProfileID ?? null;
  if (lastRealProfileID !== null && !ids.has(lastRealProfileID)) fail('The previous profile is missing.');
  return {schemaVersion:1,activeProfileID:value.activeProfileID,lastRealProfileID,savedProfiles};
}

// Every mutation validates a detached draft, then commits with one localStorage
// write. Failed writes never change in-memory state. The legacy key is retained.
export class ProfileStore {
  constructor(storage, makeID = () => globalThis.crypto.randomUUID()) {
    this.storage = storage;
    this.makeID = makeID;
    this.raw = storage.getItem(PROFILE_KEY);
    this.value = this.raw === null ? empty() : validateStore(JSON.parse(this.raw));
    if (this.raw === null) {
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacy !== null) this.add([normalize(JSON.parse(legacy))]);
    }
  }
  get snapshot() { return copy(this.value); }
  get activeConfiguration() {
    const p=this.value.savedProfiles.find(p=>p.id===this.value.activeProfileID);
    return p ? copy(p.configuration) : null;
  }
  commit(value) {
    const next=validateStore(value);
    if (this.storage.getItem(PROFILE_KEY) !== this.raw) fail('Schedules changed in another tab. Reload this page before saving.');
    const raw=JSON.stringify(next);
    try { this.storage.setItem(PROFILE_KEY,raw); }
    catch { fail('BellSync Display could not save schedules in this browser. Existing profiles were left unchanged.'); }
    this.raw=raw; this.value=next;
  }
  add(configurations, {activate=true}={}) {
    if (!Array.isArray(configurations) || !configurations.length) fail('No schedules to import.');
    const configs=configurations.map(normalize); // Validate the entire batch before assigning IDs or writing.
    const next=this.snapshot, ids=[];
    for(const configuration of configs) {
      const id=this.makeID();
      if(!validID(id) || next.savedProfiles.some(p=>p.id===id)) fail('Could not create a unique profile ID. Please retry.');
      next.savedProfiles.push({id,configuration}); ids.push(id);
    }
    if(activate) { next.activeProfileID=ids[0];next.lastRealProfileID=ids[0]; }
    this.commit(next); return ids;
  }
  replace(id, configuration) {
    const next=this.snapshot, p=next.savedProfiles.find(p=>p.id===id);
    if(!p) fail('This saved profile no longer exists.');
    p.configuration=normalize(configuration);this.commit(next);
  }
  rename(id,name) {
    const profile=this.value.savedProfiles.find(p=>p.id===id);
    if(!profile) fail('This saved profile no longer exists.');
    this.replace(id,{...profile.configuration,profileName:name});
  }
  select(id) {
    const next=this.snapshot;
    if(id !== DEMO_ID && id !== null && !next.savedProfiles.some(p=>p.id===id)) fail('This saved profile no longer exists.');
    next.activeProfileID=id;
    if(id && id !== DEMO_ID) next.lastRealProfileID=id;
    this.commit(next);
  }
  leaveDemo() {
    this.select(this.value.lastRealProfileID || this.value.savedProfiles[0]?.id || null);
  }
  remove(id) {
    const next=this.snapshot;
    if(!next.savedProfiles.some(p=>p.id===id)) fail('This saved profile no longer exists.');
    next.savedProfiles=next.savedProfiles.filter(p=>p.id!==id);
    if(next.activeProfileID===id) next.activeProfileID=next.savedProfiles[0]?.id || null;
    if(next.lastRealProfileID===id) next.lastRealProfileID=next.savedProfiles[0]?.id || null;
    this.commit(next);
  }
}

// Native contract: BellSyncScheduleBundle in Sources/BellSyncConfiguration.swift.
// Unsupported schools/features can be skipped; structurally malformed entries
// abort preparation so an apparently valid partial batch is never saved silently.
export function inspectNativeImport(raw) {
  if(!object(raw)) fail('Invalid BellSync file.');
  const bundle=Object.hasOwn(raw,'bundleFormatVersion') || Object.hasOwn(raw,'schedules');
  if(bundle && (raw.bundleFormatVersion !== 1 || !Array.isArray(raw.schedules) || !raw.schedules.length || raw.schedules.length > 200)) fail('Invalid, empty, or unsupported BellSync schedule bundle.');
  if(bundle && raw.createdAt !== undefined && !(typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)) && !(typeof raw.createdAt === 'string' && Number.isFinite(Date.parse(raw.createdAt)))) fail('Invalid bundle creation date.');
  const entries=bundle ? raw.schedules : [raw];
  const supported=[],unsupported=[];
  entries.forEach((entry,index)=>{
    if(!object(entry) || !Number.isInteger(entry.formatVersion) || typeof entry.schoolProfileID !== 'string' || !entry.schoolProfileID.trim() || !object(entry.assignments)) fail(`Schedule ${index+1} is malformed. Nothing was imported.`);
    if(entry.scheduleName != null && typeof entry.scheduleName !== 'string') fail(`Schedule ${index+1} has an invalid name.`);
    for(const rows of Object.values(entry.assignments)) {
      if(!object(rows)) fail(`Schedule ${index+1} has malformed assignments.`);
      for(const a of Object.values(rows)) {
        if(!object(a) || ['title','room','block'].some(k=>a[k] !== undefined && typeof a[k] !== 'string') || (a.lunch != null && typeof a.lunch !== 'string')) fail(`Schedule ${index+1} has malformed class data.`);
      }
    }
    const name=entry.scheduleName?.trim() || `Imported Schedule ${index+1}`;
    const reject=reason=>unsupported.push({name,schoolID:entry.schoolProfileID,reason});
    if(entry.formatVersion !== 1) { reject(`Schedule version ${entry.formatVersion} is not supported.`);return; }
    if(entry.schoolProfileID !== 'wmhs') { reject(`School “${entry.schoolProfileID}” has no supported web definition.`);return; }
    if(entry.sharedSchool != null) {
      if(!object(entry.sharedSchool)) fail(`Schedule ${index+1} has malformed school data.`);
      reject('Embedded school definitions are not yet supported.');return;
    }
    const shared={...entry,scheduleName:name};
    // Full Phase 1 validation remains mandatory for supported WMHS entries.
    validateNative(shared);
    const extras=[];
    if(shared.date) extras.push('date-specific schedules');
    if(shared.activityNameOverrides?.length) extras.push('personal activity-name overrides');
    if(shared.personalBlockColors?.length) extras.push('personal block colors');
    if(shared.usesSchoolSchedule === true) extras.push('school-wide schedule mode');
    if(extras.length) { reject(`Not yet supported: ${extras.join(', ')}.`);return; }
    supported.push({shared,name,needsName:!entry.scheduleName?.trim()});
  });
  return {bundle,supported,unsupported};
}
export function nativeConfigurations(plan, schedule, calendar) {
  return plan.supported.map(({shared})=>normalize({
    schemaVersion:2,sourceKind:'bellsync-v1',
    school:{id:'wmhs',displayName:'Wakefield Memorial High School',timeZone:schedule.time_zone},
    profileName:shared.scheduleName,assignments:shared.assignments,templates:schedule.bells,calendar,
    preferences:defaultPreferences(),
    nativeMetadata:{schoolContentVersion:shared.schoolContentVersion ?? null,notes:shared.notes ?? null,createdAt:shared.createdAt ?? null}
  }));
}
export function exportProfiles(store) {
  return {format:COLLECTION_FORMAT,formatVersion:1,exportedAt:new Date().toISOString(),profiles:validateStore(store)};
}
export function importDisplayProfiles(raw) {
  if(object(raw) && raw.format === COLLECTION_FORMAT) {
    if(raw.formatVersion !== 1) fail('Unsupported Display profiles backup version.');
    const value=validateStore(raw.profiles);
    if(!value.savedProfiles.length) fail('This backup contains no saved schedules.');
    return value.savedProfiles.map(p=>p.configuration);
  }
  return [importBackup(raw)];
}
