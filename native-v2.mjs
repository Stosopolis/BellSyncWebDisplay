// BellSyncSharedSchedule v2: read-only interchange adapter. Native source remains
// authoritative; unsupported timing layers are reported instead of substituted.
import { validatePortableShared, validatePersonalActivities } from './portable-snapshot.mjs';
import { validateNative, validateActivityNameOverrides } from './display-core.mjs';
const object=v=>v !== null && typeof v==='object' && !Array.isArray(v);
const fail=message=>{throw Error(message);};
export function parseNativeV2(raw) {
  if(!object(raw) || raw.formatVersion !== 2) fail('Expected BellSync schedule version 2.');
  if(raw.schoolDefinitionSnapshot!=null) {
    validatePortableShared(raw);
    const snapshot=raw.schoolDefinitionSnapshot;
    return {shared:raw,warnings:(snapshot.scheduledPointEvents?.length || snapshot.activityLayers?.staff?.length || snapshot.staffEvents?.length)?['Contextual staff and point events are preserved; primary schedule cards show classroom and profile-owner activities.']:[],unsupportedReason:null,configuration:{schemaVersion:2,sourceKind:'bellsync-snapshot',school:{id:raw.schoolProfileID,displayName:snapshot.displayName,timeZone:snapshot.timeZoneIdentifier},profileName:raw.scheduleName,portable:{shared:JSON.parse(JSON.stringify(raw)),edits:[]},preferences:{}}};
  }
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
  if(raw.personalActivities!=null) validatePersonalActivities(raw.personalActivities,['1','2','3','4','5','6','7']);

  if(raw.personalBlockColors?.length) warnings.push('Native personal block colors are retained in the backup; Web Display uses its own display colors.');
  if(raw.activityNameOverrides?.some(o=>!supportedWMHSOverride(o.source) && !(o.source.layer==='personal' && o.source.templateID==='profile-personal' && raw.personalActivities?.some(a=>a.id===o.source.itemID && (a.sourcePeriodID || a.id)===o.source.periodID)))) warnings.push('Names for unsupported native activity sources are retained but are not displayed.');
  return {shared,warnings,unsupportedReason,nativeMetadata:{formatVersion:2,schoolContentVersion:raw.schoolContentVersion,notes:raw.notes ?? null,createdAt:raw.createdAt,activityNameOverrides:raw.activityNameOverrides ?? [],sharedSchedule:JSON.parse(JSON.stringify(raw))}};
}
export function supportedWMHSOverride(s) {
  return s.layer==='wmhs' && ['1','2','3','4','5','6','7'].includes(s.dayID) && ['regular','flex','er'].includes(s.templateID) &&
    ((['1','2','3','4','5','6','flex'].includes(s.periodID) && s.itemID===s.periodID) || (['lunch-L1','lunch-L2','lunch-L3'].includes(s.periodID) && s.itemID===`4-${s.periodID.slice(6)}`));
}
