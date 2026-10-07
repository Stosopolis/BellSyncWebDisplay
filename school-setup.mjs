import { parseNativeV2 } from './native-v2.mjs';
import { normalize, defaultPreferences } from './display-core.mjs';

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
export function schoolLinkSelection(search) {
  const params=new URLSearchParams(search);
  if(params.get('school')!=='doyle') return null;
  const code=(params.get('profile') || '').toUpperCase();
  return {school:'doyle',profile:DOYLE_PROFILES.includes(code)?code:null};
}
