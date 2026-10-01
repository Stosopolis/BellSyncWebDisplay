// BellSyncSharedSchedule v2: read-only interchange adapter. Native source remains
// authoritative; unsupported timing layers are reported instead of substituted.
import { validateNative, validateActivityNameOverrides } from './display-core.mjs';
const object=v=>v !== null && typeof v==='object' && !Array.isArray(v);
const fail=message=>{throw Error(message);};
export function parseNativeV2(raw) {
  if(!object(raw) || raw.formatVersion !== 2) fail('Expected BellSync schedule version 2.');
  // Assignments and common scalar fields keep their v1 contract. This detached
  // adapter does not mutate or rewrite the original native file.
  const shared={...raw,formatVersion:1};
  validateNative(shared);
  if(typeof raw.schoolContentVersion !== 'string' || !raw.schoolContentVersion.trim() || raw.createdAt === undefined) fail('Version 2 requires schoolContentVersion and createdAt.');
  if(raw.scheduleName.length>100 || (raw.notes?.length ?? 0)>1000) fail('Invalid version 2 schedule name or notes.');
  for(const rows of Object.values(raw.assignments)) for(const a of Object.values(rows)) {
    if(['title','room','block'].some(key=>typeof a[key]!=='string') || a.title.length>100 || a.room.length>100) fail('Invalid version 2 assignment fields.');
  }
  validateActivityNameOverrides(raw.activityNameOverrides,raw.schoolProfileID);
  const warnings=[];
  let unsupportedReason=null;
  if(raw.schoolDefinitionSnapshot != null) {
    const snapshot=raw.schoolDefinitionSnapshot;
    if(!object(snapshot) || snapshot.id !== raw.schoolProfileID || snapshot.schemaVersion !== 1 || !object(snapshot.cycle) || !Array.isArray(snapshot.cycle.dayIDs) || !Array.isArray(snapshot.periodDefinitions) || !Array.isArray(snapshot.scheduleTemplates) || !object(snapshot.calendarRule) || !object(snapshot.calendarExceptions)) fail('Invalid version 2 school definition snapshot.');
    unsupportedReason='This profile contains a school-definition snapshot. Web Display cannot safely substitute its bundled WMHS timing for that source structure.';
  }
  if(raw.personalActivities != null) {
    if(!Array.isArray(raw.personalActivities) || raw.personalActivities.length>500) fail('Invalid version 2 Personal Activities.');
    const ids=new Set();
    for(const a of raw.personalActivities) {
      if(!object(a) || typeof a.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(a.id) || ids.has(a.id) || typeof a.title !== 'string' || !a.title.trim() || a.title.length>100 || typeof a.room !== 'string' || a.room.length>100 || ![a.start,a.end].every(t=>typeof t==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) || a.start>=a.end || !Array.isArray(a.weekdays) || !a.weekdays.length || !a.weekdays.every(n=>Number.isInteger(n)&&n>=1&&n<=7) || !Array.isArray(a.dayIDs) || !a.dayIDs.every(d=>['1','2','3','4','5','6','7'].includes(d))) fail('Invalid version 2 Personal Activity.');
      ids.add(a.id);
    }
    if(raw.personalActivities.length) unsupportedReason='Personal Activities change the effective timeline and are not yet supported by Web Display. Nothing from this profile was imported.';
  }

  if(raw.personalBlockColors?.length) warnings.push('Native personal block colors are retained in the backup; Web Display uses its own display colors.');
  if(raw.activityNameOverrides?.some(o=>!supportedWMHSOverride(o.source))) warnings.push('Names for unsupported native activity sources are retained but are not displayed.');
  return {shared,warnings,unsupportedReason,nativeMetadata:{formatVersion:2,schoolContentVersion:raw.schoolContentVersion,notes:raw.notes ?? null,createdAt:raw.createdAt,activityNameOverrides:raw.activityNameOverrides ?? [],sharedSchedule:JSON.parse(JSON.stringify(raw))}};
}
export function supportedWMHSOverride(s) {
  return s.layer==='wmhs' && ['1','2','3','4','5','6','7'].includes(s.dayID) && ['regular','flex','er'].includes(s.templateID) &&
    ((['1','2','3','4','5','6','flex'].includes(s.periodID) && s.itemID===s.periodID) || (['lunch-L1','lunch-L2','lunch-L3'].includes(s.periodID) && s.itemID===`4-${s.periodID.slice(6)}`));
}
