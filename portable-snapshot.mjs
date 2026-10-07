// Native BellSyncSchoolDefinition schema 1 / BellSyncSharedSchedule version 2.
// Pure source adapter: no registry lookups, browser globals, or school-name rules.
const object=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const fail=message=>{throw Error(message);};
const requireValue=(ok,message)=>{if(!ok)fail(message);};
const text=(v,name,max=2000,required=true)=>requireValue(typeof v==='string' && v.length<=max && (!required || v.trim()),`Invalid snapshot ${name}.`);
const time=v=>typeof v==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const date=v=>typeof v==='string' && /^20\d{2}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00Z`)) && new Date(`${v}T12:00Z`).toISOString().slice(0,10)===v;
const weekdays=v=>Array.isArray(v) && v.every(n=>Number.isInteger(n) && n>=1 && n<=7);
const list=(v,name,max=10000)=>requireValue(Array.isArray(v) && v.length<=max,`Invalid snapshot ${name}.`);
const unique=(rows,name)=>requireValue(new Set(rows.map(r=>r.id)).size===rows.length,`Duplicate snapshot ${name} IDs.`);
export class UnsupportedSnapshot extends Error {}
function tree(value,depth=0) {
  requireValue(depth<=24,'Snapshot is nested too deeply.');
  if(value && typeof value==='object') for(const [key,child] of Object.entries(value)) {requireValue(!['__proto__','constructor','prototype'].includes(key),'Unsafe snapshot key.');tree(child,depth+1);}
}
export function validatePersonalActivities(items,days) {
  list(items,'personal activities',500);unique(items,'personal activity');
  for(const a of items) {
    requireValue(object(a),'Invalid personal activity.');text(a.id,'personal activity ID',200);text(a.title,'personal activity title',100);text(a.room ?? '','personal activity room',100,false);
    requireValue(time(a.start) && time(a.end) && a.start<a.end,'Invalid personal activity timing.');
    requireValue(weekdays(a.weekdays ?? [2,3,4,5,6]) && (a.weekdays ?? [2,3,4,5,6]).length>0 && Array.isArray(a.dayIDs ?? []) && (a.dayIDs ?? []).every(d=>days.includes(d)),'Invalid personal activity weekdays/rotation restrictions.');
    if(a.sourcePeriodID!=null) text(a.sourcePeriodID,'personal source period ID',200);
  }
  for(let i=0;i<items.length;i++) for(const b of items.slice(i+1)) {
    const a=items[i],ad=a.dayIDs ?? [],bd=b.dayIDs ?? [];
    const sameDay=!ad.length || !bd.length || ad.some(d=>bd.includes(d));
    if(a.start<b.end && b.start<a.end && sameDay && (a.weekdays ?? [2,3,4,5,6]).some(d=>(b.weekdays ?? [2,3,4,5,6]).includes(d))) fail('Personal activities overlap on an applicable day.');
  }
}
export function validatePortableShared(raw) {
  tree(raw);requireValue(object(raw) && raw.formatVersion===2,'Expected BellSync schedule version 2.');
  text(raw.schoolProfileID,'school ID',128);text(raw.schoolContentVersion,'school content version',100);text(raw.scheduleName,'schedule name',100);
  requireValue((typeof raw.createdAt==='number' && Number.isFinite(raw.createdAt)) || (typeof raw.createdAt==='string' && Number.isFinite(Date.parse(raw.createdAt))),'Invalid native export creation date.');
  if(raw.date!=null) requireValue(typeof raw.date==='string' && Number.isFinite(Date.parse(raw.date)),'Invalid shared schedule date.');
  if(raw.notes!=null) text(raw.notes,'notes',1000,false);
  if(raw.usesSchoolSchedule!=null) requireValue(typeof raw.usesSchoolSchedule==='boolean','Invalid school schedule mode.');
  const d=raw.schoolDefinitionSnapshot;
  requireValue(object(d) && d.id===raw.schoolProfileID,'School snapshot identity does not match this schedule.');
  if(d.schemaVersion!==1) throw new UnsupportedSnapshot(`School snapshot schema ${d.schemaVersion} is not supported.`);
  text(d.displayName,'school name',120);text(d.contentVersion,'content version',100);text(d.timeZoneIdentifier,'timezone');
  try {new Intl.DateTimeFormat('en',{timeZone:d.timeZoneIdentifier});}catch{fail('Invalid snapshot timezone.');}
  const c=d.cycle;
  if(object(c) && typeof c.kind==='string' && !['sameEveryDay','dayRotation','blockRotation','customRotation'].includes(c.kind))throw new UnsupportedSnapshot(`Snapshot cycle kind “${c.kind}” is not supported.`);
  requireValue(object(c) && ['sameEveryDay','dayRotation','blockRotation','customRotation'].includes(c.kind) && Array.isArray(c.dayIDs) && c.dayIDs.length>0 && new Set(c.dayIDs).size===c.dayIDs.length,'Invalid snapshot rotation.');
  c.dayIDs.forEach(id=>text(id,'rotation ID',64));
  if(c.kind!=='sameEveryDay')requireValue(date(c.anchorDate) && c.dayIDs.includes(c.anchorDayID),'Invalid snapshot rotation anchor.');
  if(c.dayDisplayNames!=null) {requireValue(object(c.dayDisplayNames),'Invalid rotation names.');for(const [id,name] of Object.entries(c.dayDisplayNames)){requireValue(c.dayIDs.includes(id),'Unknown rotation name ID.');text(name,'rotation name',80);}}
  list(d.periodDefinitions,'period definitions');unique(d.periodDefinitions,'period');requireValue(d.periodDefinitions.length>0,'Snapshot needs periods.');
  const periods=new Map();
  for(const p of d.periodDefinitions) {if(typeof p.kind==='string' && !['academic','lunch','advisory','flex','passing','other'].includes(p.kind))throw new UnsupportedSnapshot(`Snapshot period kind “${p.kind}” is not supported.`);text(p.id,'period ID',200);text(p.displayName,'period name');requireValue(['academic','lunch','advisory','flex','passing','other'].includes(p.kind) && typeof p.acceptsPersonalAssignment==='boolean','Invalid snapshot period definition.');periods.set(p.id,p);}
  const validateRows=rows=>{
    list(rows,'template periods');unique(rows,'template item');requireValue(rows.length>0,'A snapshot template is empty.');
    for(const p of rows) {text(p.id,'template item ID',200);requireValue(periods.has(p.periodID) && time(p.start) && time(p.end) && p.start<p.end,'Invalid snapshot template period or timing.');}
  };
  list(d.scheduleTemplates,'templates');unique(d.scheduleTemplates,'template');requireValue(d.scheduleTemplates.length>0,'Snapshot needs templates.');
  const templates=new Set(d.scheduleTemplates.map(t=>t.id));
  for(const t of d.scheduleTemplates) {
    text(t.id,'template ID',200);text(t.displayName,'template name');validateRows(t.periods);
    if(t.periodsByEffectiveDate!=null) {requireValue(object(t.periodsByEffectiveDate),'Invalid template revisions.');for(const [key,rows] of Object.entries(t.periodsByEffectiveDate)){requireValue(date(key),'Invalid template revision date.');validateRows(rows);}}
    if(t.unconfirmedEndFrom!=null) {requireValue(date(t.unconfirmedEndFrom),'Invalid unconfirmed-end date.');throw new UnsupportedSnapshot(`Template “${t.displayName}” has an unconfirmed workday end from ${t.unconfirmedEndFrom}; Web Display cannot yet represent that completion policy.`);}
  }
  const r=d.calendarRule;if(object(r) && r.mode!=null && !['weekdayCycle','explicitDates'].includes(r.mode))throw new UnsupportedSnapshot(`Snapshot calendar mode “${r.mode}” is not supported.`);requireValue(object(r) && ['weekdayCycle','explicitDates'].includes(r.mode ?? 'weekdayCycle'),'Invalid snapshot calendar rule.');
  requireValue(weekdays(r.schoolWeekdays ?? [2,3,4,5,6]) && ((r.schoolWeekdays ?? [2,3,4,5,6]).length>0 || r.mode==='explicitDates'),'Invalid school weekdays.');
  if(r.personalAssignmentLayout!=null) requireValue(['sharedPeriods','perCycleDay'].includes(r.personalAssignmentLayout),'Invalid personal assignment layout.');
  for(const field of ['weekdayTemplateIDs','weekdayCycleDayIDs','cycleDayTemplateIDs']) {
    requireValue(object(r[field] ?? {}),`Invalid calendar ${field}.`);
    for(const [key,value] of Object.entries(r[field] ?? {})) {
      requireValue(field==='cycleDayTemplateIDs'?c.dayIDs.includes(key):/^[1-7]$/.test(key),'Invalid calendar mapping key.');
      requireValue(field==='weekdayCycleDayIDs'?c.dayIDs.includes(value):templates.has(value),'Unknown calendar mapping reference.');
    }
  }
  if(r.defaultTemplateID!=null)requireValue(templates.has(r.defaultTemplateID),'Unknown default template.');
  requireValue(r.mode==='explicitDates' || r.defaultTemplateID || Object.keys(r.weekdayTemplateIDs ?? {}).length,'Weekday calendar needs a template.');
  requireValue(object(d.calendarExceptions),'Invalid snapshot calendar exceptions.');
  for(const [key,e] of Object.entries(d.calendarExceptions)) {
    if(object(e) && typeof e.kind==='string' && !['scheduled','noSchool','scheduleUnavailable'].includes(e.kind))throw new UnsupportedSnapshot(`Snapshot calendar exception “${e.kind}” is not supported.`);
    requireValue(date(key) && object(e) && ['scheduled','noSchool','scheduleUnavailable'].includes(e.kind),'Invalid snapshot calendar exception.');
    if(e.kind==='scheduled')requireValue(templates.has(e.templateID),'Unknown exception template.');
    if(e.cycleDayID!=null)requireValue(c.dayIDs.includes(e.cycleDayID),'Unknown exception rotation day.');
    if(e.note!=null)text(e.note,'calendar note');
  }
  list(d.lunchRules ?? [],'lunch rules');
  const lunches=new Set(['NO_LUNCH']);
  for(const rule of d.lunchRules ?? []) {
    requireValue(periods.has(rule.periodID) && (rule.templateID==null || templates.has(rule.templateID)),'Unknown lunch rule reference.');
    list(rule.options,'lunch options');unique(rule.options,'lunch option');requireValue(rule.options.length>0,'Empty lunch options.');
    for(const option of rule.options) {text(option.id,'lunch option ID',200);text(option.displayName,'lunch name');requireValue(time(option.start) && time(option.end) && option.start<option.end && (option.bellStart==null || time(option.bellStart)),'Invalid lunch option timing.');lunches.add(option.id);}
  }
  requireValue(object(raw.assignments),'Invalid snapshot assignments.');
  for(const [day,rows] of Object.entries(raw.assignments)) {
    requireValue(c.dayIDs.includes(day) && object(rows),'Unknown assignment day.');
    for(const [period,a] of Object.entries(rows)) {
      requireValue(periods.get(period)?.acceptsPersonalAssignment && object(a),'Unknown or nonassignable snapshot period.');
      text(a.title,'assignment title',100);text(a.room,'assignment room',100,false);text(a.block,'assignment block',200);
      if(a.lunch!=null)requireValue(lunches.has(a.lunch),'Invalid lunch selection.');
    }
  }
  if(d.activityLayers!=null) {
    const layers=d.activityLayers;requireValue(object(layers) && object(layers.suppressedClassroomDates),'Invalid activity layers.');
    const items=[];for(const layer of ['personal','staff']) {list(layers[layer],'activity layer');for(const p of layers[layer]){text(p.id,'layer item ID',200);requireValue(periods.has(p.periodID) && time(p.start) && time(p.end) && p.start<p.end,'Invalid activity layer timing/reference.');items.push(p);}}
    unique(items,'activity layer');const personal=[...layers.personal].sort((a,b)=>a.start.localeCompare(b.start));for(let i=1;i<personal.length;i++)requireValue(personal[i-1].end<=personal[i].start,'Personal countdown layers overlap.');
    for(const [period,dates] of Object.entries(layers.suppressedClassroomDates))requireValue(periods.has(period) && Array.isArray(dates) && dates.every(date),'Invalid suppressed classroom dates.');
  }
  if(raw.personalActivities!=null)validatePersonalActivities(raw.personalActivities,c.dayIDs);
  list(d.scheduledPointEvents ?? [],'point events');unique(d.scheduledPointEvents ?? [],'point event');
  for(const p of d.scheduledPointEvents ?? []) {
    text(p.id,'point event ID',200);text(p.title,'point event title');requireValue(time(p.time),'Invalid point time.');
    for(const field of ['dates','excludedDates'])if(p[field]!=null)requireValue(Array.isArray(p[field]) && p[field].every(date),'Invalid point dates.');
    if(p.weekdays!=null)requireValue(weekdays(p.weekdays),'Invalid point weekdays.');
    if(p.endsWorkday!=null)requireValue(typeof p.endsWorkday==='boolean','Invalid point workday boundary.');
  }
  for(const s of d.specialSchedules ?? [])requireValue(templates.has(s.templateID),'Unknown special schedule template.');
  list(d.staffEvents ?? [],'staff events');for(const s of d.staffEvents ?? []){text(s.title,'staff event title');requireValue(date(s.date) && time(s.start) && time(s.end) && s.start<s.end,'Invalid dated staff event.');if(s.location!=null)text(s.location,'staff location');}
  if(raw.activityNameOverrides!=null) {
    list(raw.activityNameOverrides,'activity-name overrides',5000);const seen=new Set();
    for(const o of raw.activityNameOverrides){text(o.title,'activity override title',100);const s=o.source;requireValue(object(s) && s.schoolID===d.id && ['classroom','personal','wmhs','gms'].includes(s.layer),'Invalid activity override source.');for(const field of ['dayID','templateID','itemID','periodID'])text(s[field],'activity source ID',200);const key=JSON.stringify([s.schoolID,s.layer,s.dayID,s.templateID,s.itemID,s.periodID]);requireValue(!seen.has(key),'Duplicate activity override.');seen.add(key);}
  }
  return raw;
}
export function validatePortableConfig(config) {
  validatePortableShared(config.portable?.shared);
  requireValue(config.school.id===config.portable.shared.schoolDefinitionSnapshot.id && config.school.timeZone===config.portable.shared.schoolDefinitionSnapshot.timeZoneIdentifier,'Portable profile school does not match snapshot.');
  list(config.portable.edits ?? [],'local display edits');const seen=new Set();
  const d=config.portable.shared.schoolDefinitionSnapshot;
  for(const edit of config.portable.edits ?? []) {
    requireValue(object(edit) && ['period','personal'].includes(edit.type) && !seen.has(JSON.stringify([edit.type,edit.id])),'Invalid local display edit.');seen.add(JSON.stringify([edit.type,edit.id]));
    requireValue((edit.type==='period'?d.periodDefinitions:config.portable.shared.personalActivities ?? []).some(p=>p.id===edit.id),'Unknown local edit source.');
    for(const field of ['title','room'])if(edit[field]!=null)text(edit[field],`local ${field}`,2000,field==='title');
  }
}
const weekday=key=>new Date(`${key}T12:00Z`).getUTCDay()+1;
export function portableDay(d,key) {
  const r=d.calendarRule,c=d.cycle,e=d.calendarExceptions[key],wd=weekday(key);
  if(e?.kind==='noSchool')return null;
  if(!e && ((r.mode ?? 'weekdayCycle')==='explicitDates' || !(r.schoolWeekdays ?? [2,3,4,5,6]).includes(wd)))return null;
  let day=(r.weekdayCycleDayIDs ?? {})[wd] || c.dayIDs[0];
  if(!(r.weekdayCycleDayIDs ?? {})[wd] && c.kind!=='sameEveryDay') {
    let count=0,cursor=Date.parse(`${c.anchorDate}T12:00Z`),target=Date.parse(`${key}T12:00Z`);
    while(cursor<target) {cursor+=86400000;const k=new Date(cursor).toISOString().slice(0,10);if((r.schoolWeekdays ?? [2,3,4,5,6]).includes(weekday(k)) && d.calendarExceptions[k]?.kind!=='noSchool')count++;}
    day=c.dayIDs[(c.dayIDs.indexOf(c.anchorDayID)+count)%c.dayIDs.length];
  }
  day=e?.cycleDayID || day;
  const template=e?.kind==='scheduleUnavailable'?'':e?.templateID || (r.cycleDayTemplateIDs ?? {})[day] || (r.weekdayTemplateIDs ?? {})[wd] || r.defaultTemplateID;
  return {day,dayLabel:c.dayDisplayNames?.[day] || day,schedule:template,note:e?.note};
}
// Subtract owner windows from classroom events, retaining source identity and
// all original classroom rows separately. This is the native primary projection.
export function projectOwners(classroom,owners,endAt=Infinity) {
  const events=[...owners];
  for(const event of classroom) {
    let windows=[[event.startAt,Math.min(event.endAt,endAt)]];
    for(const owner of owners) windows=windows.flatMap(([start,end])=>owner.startAt<end && start<owner.endAt ? [[start,Math.min(end,owner.startAt)],[Math.max(start,owner.endAt),end]].filter(([a,b])=>a<b):[[start,end]]);
    for(const [startAt,end] of windows)if(startAt<end)events.push({...event,id:`${event.id}::primary:${startAt}`,startAt,endAt:end});
  }
  return events.sort((a,b)=>a.startAt-b.startAt || a.id.localeCompare(b.id));
}
export function profileOwnerEvents(raw,key,day,at,templateID='profile-personal',endAt=Infinity,edit=()=>null) {
  return (raw.personalActivities ?? []).filter(a=>(a.weekdays ?? [2,3,4,5,6]).includes(weekday(key)) && (!(a.dayIDs ?? []).length || a.dayIDs.includes(day))).map(a=>{
    const source={schoolID:raw.schoolProfileID,layer:'personal',dayID:day,templateID,itemID:a.id,periodID:a.sourcePeriodID ?? a.id};
    const o=raw.activityNameOverrides?.find(o=>Object.entries(source).every(([k,v])=>o.source[k]===v));
    const local=edit('personal',a.id);
    return {id:`personal:${a.id}`,sourceID:a.id,periodID:a.sourcePeriodID ?? a.id,kind:'other',title:local?.title || o?.title || a.title,room:local?.room ?? a.room ?? '',label:a.title,sourcePeriodLabel:a.title,labelRole:'activity',startAt:at(a.start),endAt:a.sourcePeriodID?Math.min(at(a.end),endAt):at(a.end),activitySource:source,owner:true};
  }).filter(e=>e.startAt<e.endAt).sort((a,b)=>a.startAt-b.startAt);
}
export function portableTimeline(config,key,at) {
  const raw=config.portable.shared,d=raw.schoolDefinitionSnapshot,day=portableDay(d,key);
  const result={key,timeZone:d.timeZoneIdentifier,day,status:'scheduled',events:[],passing:[],classroom:[],contextualStaff:[],points:[]};
  if(!day)return {...result,status:d.calendarExceptions[key]?.kind==='noSchool'?'no-school':[1,7].includes(weekday(key))?'weekend':'no-school'};
  const template=d.scheduleTemplates.find(t=>t.id===day.schedule);if(!template)return {...result,status:'unavailable'};
  const edits=(type,id)=>config.portable.edits?.find(e=>e.type===type && e.id===id);
  const points=(d.scheduledPointEvents ?? []).filter(p=>(p.dates==null || p.dates.includes(key)) && !(p.excludedDates ?? []).includes(key) && (p.weekdays==null || p.weekdays.includes(weekday(key))));
  const endAt=Math.min(...points.filter(p=>p.endsWorkday).map(p=>at(p.time)));
  result.workdayEndAt=Number.isFinite(endAt)?endAt:null;
  result.points=points.filter(p=>at(p.time)<=endAt).map(p=>({...p,at:at(p.time)})).sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id));
  result.workdayBoundary=result.points.find(p=>p.endsWorkday && p.at===endAt) || null;
  const period=id=>d.periodDefinitions.find(p=>p.id===id);
  const event=(item,layer,a={},suffix='',extra={})=>{
    const p=period(item.periodID),local=edits('period',p.id),source={schoolID:d.id,layer,dayID:day.day,templateID:template.id,itemID:item.id,periodID:item.periodID};
    const o=raw.activityNameOverrides?.find(o=>Object.entries(source).every(([k,v])=>o.source[k]===v));
    const title=local?.title || o?.title || a.title?.trim() || p.displayName;
    return {id:`${layer}:${item.id}${suffix}`,sourceID:item.id,periodID:p.id,kind:p.kind,label:p.displayName,sourcePeriodLabel:p.displayName,labelRole:p.acceptsPersonalAssignment?'structure':'activity',blockID:a.block || null,blockName:a.block || null,title,room:local?.room ?? a.room ?? '',startAt:at(item.start),endAt:at(item.end),activitySource:source,...extra};
  };
  const revision=Object.keys(template.periodsByEffectiveDate ?? {}).filter(date=>date<=key).sort().at(-1);
  const items=revision?template.periodsByEffectiveDate[revision]:template.periods;
  const classroom=[];
  for(const item of items) {
    if(d.activityLayers?.suppressedClassroomDates[item.periodID]?.includes(key))continue;
    const p=period(item.periodID),a=raw.assignments[day.day]?.[p.id] || {};
    if(p.kind==='passing') {result.passing.push({startAt:at(item.start),endAt:at(item.end),source:'snapshot-passing'});continue;}
    const rule=(d.lunchRules ?? []).find(r=>r.periodID===p.id);
    const lunch=a.lunch==='NO_LUNCH'?null:rule?.options.find(o=>o.id===a.lunch);
    if(lunch && !['lunch','flex'].includes(p.kind)) {
      const base=event(item,'classroom',a),bell=at(lunch.bellStart || lunch.start),start=at(lunch.start),end=at(lunch.end),context={selection:lunch.id,periodID:p.id,startAt:start,endAt:end};
      const segment=e=>{const custom=config.timingOverrides?.some(x=>x.type==='template' && x.templateID===template.id && x.id===item.id);const next=custom?{...e,startAt:Math.max(e.startAt,base.startAt),endAt:Math.min(e.endAt,base.endAt)}:e;if(next.startAt<next.endAt)classroom.push(next);};
      if(base.startAt<bell)segment({...base,id:`${base.id}:before`,endAt:bell,lunch:context});
      if(bell<start)segment({...base,id:`${base.id}:passing`,kind:'passing',label:'PASSING',title:`Passing to ${lunch.displayName}`,room:'',startAt:bell,endAt:start,lunch:context});
      segment({...base,id:`${base.id}:lunch`,kind:'lunch',label:['L1','L2','L3'].includes(lunch.id)?`Lunch ${lunch.id.slice(1)}`:lunch.displayName,title:['L1','L2','L3'].includes(lunch.id)?`Lunch ${lunch.id.slice(1)}`:lunch.displayName,room:'',startAt:start,endAt:end,lunch:context});
      if(end<base.endAt)segment({...base,id:`${base.id}:after`,startAt:end,lunch:context});
    } else classroom.push(event(item,'classroom',['lunch','flex'].includes(p.kind)?{}:a));
  }
  let owners;
  if(raw.personalActivities!=null)owners=profileOwnerEvents(raw,key,day.day,at,template.id,endAt,edits);
  else owners=(d.activityLayers?.personal ?? []).map(p=>event(p,'personal',{},'',{owner:true,endAt:Math.min(at(p.end),endAt)})).filter(e=>e.startAt<e.endAt);
  result.classroom=classroom;
  result.events=projectOwners(classroom,owners,endAt);
  result.contextualStaff=(d.activityLayers?.staff ?? []).map(p=>event(p,'staff',{},'',{contextual:true,endAt:Math.min(at(p.end),endAt)})).filter(e=>e.startAt<e.endAt);
  result.contextualStaff.push(...(d.staffEvents ?? []).filter(p=>p.date===key).map((p,i)=>({...p,id:`dated-staff:${i}`,contextual:true,title:p.title,room:p.location || '',startAt:at(p.start),endAt:at(p.end)})));
  return result;
}
