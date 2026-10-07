import { parseNativeV2 } from './native-v2.mjs';
import { normalize, defaultPreferences, timelineFor, schoolDay } from './display-core.mjs';

// Source resources stay separate from UI code. Galvin follows native loadGMS
// and gmsEvents: grade bells/lunch, early release, and calendar WIN/FLEX notes.
export function builtInConfiguration(schoolID, schedule, calendar, grade) {
  if(schoolID==='wmhs') {
    const assignments=JSON.parse(JSON.stringify(schedule.assignments));
    if(schedule.bells.flex?.some(p=>p.id==='flex')) for(const rows of Object.values(assignments)) rows.flex ??= {title:'FLEX',room:''};
    return normalize({schemaVersion:2,sourceKind:'bellsync-v1',school:{id:'wmhs',displayName:'Wakefield Memorial High School',timeZone:schedule.time_zone},profileName:'My WMHS Display',assignments,templates:schedule.bells,calendar,preferences:defaultPreferences({},'blocks')});
  }
  if(schoolID!=='gms' || ![5,6,7,8].includes(grade)) throw Error('Choose a Galvin grade from 5 through 8.');
  const period=p=>({id:p.id,label:p.id==='HR'?'Homeroom':p.id==='LUNCH'?'Lunch':`Period ${p.id.slice(1)}`,start:p.start,end:p.end,kind:p.id==='LUNCH'?'lunch':'academic',sourceTitle:p.title || p.id});
  const templates={regular:[...schedule.regular[grade],schedule.lunchByGrade[grade]].map(period),er:schedule.earlyRelease.map(period)};
  const assignments=Object.fromEntries(Array.from({length:6},(_,i)=>[String(i+1),Object.fromEntries(schedule.regular[grade].map(p=>[p.id,{title:p.title || p.id,room:''}]))]));
  // Null native notes mean no note; Web Display's optional text schema uses absence.
  const days=Object.fromEntries(Object.entries(calendar.days).map(([key,d])=>[key,Object.fromEntries(Object.entries(d).filter(([,v])=>v!==null))]));
  return normalize({schemaVersion:2,sourceKind:'builtin-gms',school:{id:'gms',displayName:'Galvin Middle School',timeZone:'America/New_York'},profileName:`My Galvin Grade ${grade} Display`,rotation:{kind:'day-1-6',labels:Array.from({length:6},(_,i)=>({id:String(i+1),label:`Day ${i+1}`})),seedDate:Object.keys(days).sort()[0],seedDayId:'1',noSchoolDates:[]},templates,assignments,calendar:{...calendar,days},preferences:defaultPreferences(),schoolMetadata:{grade,contentVersion:schedule.contentVersion,winPeriod:schedule.winPeriodByGrade[grade],specialistPeriods:schedule.specialistPeriodsByGrade[grade],source:schedule.source}});
}

// Generated with BellSync's native exporter; resolve through the same portable
// snapshot path as imports, without requiring a file or a second timing engine.
export const DOYLE_PROFILES = Object.freeze('ABCDEFGHI'.split(''));
export function doyleConfiguration(raw, code) {
  if(!DOYLE_PROFILES.includes(code) || raw.schoolProfileID!==`doyle.prek-${code.toLowerCase()}` || raw.scheduleName!==`Doyle PreK ${code}`) throw Error('Invalid Doyle classroom schedule.');
  return normalize(parseNativeV2(raw).configuration);
}
export const SNAPSHOT_SCHOOLS=Object.freeze({doyle:'Doyle School',woodville:'Woodville School',ferryway:'Ferryway School',walton:'Walton School'});
export const DOYLE_CHOICES=DOYLE_PROFILES.map(code=>({code,label:`Doyle PreK ${code}`,schoolProfileID:`doyle.prek-${code.toLowerCase()}`,file:`prek-${code.toLowerCase()}.json`}));
export function schoolLinkSelection(search) {
 const params=new URLSearchParams(search),school=params.get('school');if(!Object.hasOwn(SNAPSHOT_SCHOOLS,school))return null;
 const code=params.get('profile') || '';
 return {school,profile:school==='doyle'?(DOYLE_PROFILES.includes(code.toUpperCase())?code.toUpperCase():null):(/^[a-z0-9-]{1,30}$/i.test(code)?code.toLowerCase():null)};
}
export function snapshotChoices(school,manifest) {
 if(!Object.hasOwn(SNAPSHOT_SCHOOLS,school) || !Array.isArray(manifest) || !manifest.length)throw Error('School profiles are unavailable.');
 const seen=new Set();return manifest.map(choice=>{
  if(!/^[a-z0-9-]{1,30}$/.test(choice.code) || typeof choice.label!=='string' || !choice.label.trim() || choice.schoolProfileID!==(school==='ferryway'?'ferryway':`${school}.${choice.code}`) || seen.has(choice.code))throw Error('Invalid built-in profile catalog.');
  seen.add(choice.code);return {...choice,file:`${choice.code}.json`};
 });
}
export function snapshotConfiguration(choice,raw) {
 if(raw.schoolProfileID!==choice.schoolProfileID || raw.scheduleName!==choice.label)throw Error('Built-in school profile does not match its source.');
 return normalize(parseNativeV2(raw).configuration);
}
export function schoolSchedulePreview(config,templateID=null,referenceDate=null) {
 const d=config.portable.shared.schoolDefinitionSnapshot;
 const keys=Object.keys(d.calendarExceptions);
 if(d.calendarRule.mode!=='explicitDates') {
  const anchor=d.cycle.anchorDate;if(!anchor)throw Error('No authoritative preview date is available.');
  for(let i=0;i<40;i++){const date=new Date(`${referenceDate || anchor}T12:00Z`);date.setUTCDate(date.getUTCDate()+i);keys.push(date.toISOString().slice(0,10));}
 }
 const dates=[...new Set(keys)].sort(),ordered=referenceDate?[...dates.filter(k=>k>=referenceDate),...dates.filter(k=>k<referenceDate).reverse()]:dates;
 const key=ordered.find(k=>{const day=schoolDay(config,k);return day && (!templateID || day.schedule===templateID) && d.scheduleTemplates.some(t=>t.id===day.schedule);});
 if(!key)throw Error('No confirmed schedule preview is available.');
 const timeline=timelineFor(config,key);
 return {key,templateID:timeline.day.schedule,events:[...timeline.events,...timeline.points.map(p=>({...p,kind:'point',startAt:p.at,endAt:p.at,...(p.displayAt===undefined?{}:{displayStartAt:p.displayAt,displayEndAt:p.displayAt})}))].sort((a,b)=>a.startAt-b.startAt)};
}

export function doyleSchedulePreview(configuration) {
  const dates=configuration.portable.shared.schoolDefinitionSnapshot.calendarExceptions;
  const key=Object.keys(dates).sort().find(key=>dates[key].kind==='scheduled');
  if(!key) throw Error('No confirmed normal Doyle schedule is available.');
  const timeline=timelineFor(configuration,key);
  return [...timeline.events,...timeline.points.map(p=>({...p,kind:'point',startAt:p.at,endAt:p.at,...(p.displayAt===undefined?{}:{displayStartAt:p.displayAt,displayEndAt:p.displayAt})}))].sort((a,b)=>a.startAt-b.startAt);
}
