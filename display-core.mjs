// Data validation and small shared helpers; no browser globals or dependencies.
export const WEB_FORMAT = 'bellsync-display-web';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = message => { throw Error(message); };
const text = (v, name, required = false) => {
  if (typeof v !== 'string' || v.length > 2000 || (required && !v.trim())) fail(`Invalid ${name}.`);
};
const id = (v, name) => { text(v, name, true); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(v)) fail(`Invalid ${name}.`); };
export function validDate(v) {
  return typeof v === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0,10) === v;
}
function date(v) { if (!validDate(v)) fail('Invalid calendar date; use YYYY-MM-DD in years 2000–2099.'); }
function safeTree(v, depth = 0) {
  if (depth > 24) fail('Schedule data is nested too deeply.');
  if (v && typeof v === 'object') {
    for (const [k, child] of Object.entries(v)) {
      if (['__proto__','prototype','constructor'].includes(k)) fail('Schedule contains an unsafe object key.');
      safeTree(child, depth + 1);
    }
  }
}
export function chronological(rows) { return [...rows].sort((a,b)=>a.start.localeCompare(b.start)); }
function timedRows(rows, name, requireLabels = false) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) fail(`${name} must contain 1–200 periods.`);
  const ids = new Set();
  for (const p of rows) {
    if (!object(p)) fail(`Invalid period in ${name}.`);
    id(p.id, 'period ID');
    if (ids.has(p.id)) fail(`Duplicate period ID in ${name}.`);
    ids.add(p.id);
    if (requireLabels || p.label !== undefined) text(p.label, 'period name', true);
    if (![p.start,p.end].every(t=>typeof t === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))) fail(`Invalid time in ${name}; use HH:MM.`);
    if (p.start >= p.end) fail(`${p.label || p.id} must end after it starts.`);
    if (p.kind !== undefined && !['academic','support','lunch','other','advisory','flex','passing'].includes(p.kind)) fail('Invalid period type.');
    if (p.lunches !== undefined) {
      if (!object(p.lunches)) fail('Invalid lunch rules.');
      for (const [key,lunch] of Object.entries(p.lunches)) {
        if (!['L1','L2','L3'].includes(key) || !object(lunch)) fail('Invalid lunch rule.');
        timedRows([{id:key,start:lunch.start,end:lunch.end}], 'Lunch');
        if (lunch.start < p.start || lunch.end > p.end) fail('Lunch must be inside its period.');
        if (lunch.bell_start !== undefined && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(lunch.bell_start) || lunch.bell_start > lunch.start)) fail('Invalid lunch passing time.');
      }
    }
  }
  const sorted = chronological(rows);
  for (let i=1;i<sorted.length;i++) if (sorted[i].start < sorted[i-1].end) fail(`Overlapping periods in ${name}: ${sorted[i-1].label || sorted[i-1].id} and ${sorted[i].label || sorted[i].id}.`);
  return ids;
}
function assignments(value, days, periods) {
  if (!object(value)) fail('Assignments must be an object.');
  for (const [day,rows] of Object.entries(value)) {
    if (!days.has(day) || !object(rows)) fail(`Invalid assignment day: ${day}.`);
    for (const [period,a] of Object.entries(rows)) {
      if (!periods.has(period) || !object(a)) fail(`Invalid assignment period: ${period}.`);
      for (const key of Object.keys(a)) if (!['title','room','block','lunch'].includes(key)) fail(`Unsupported assignment field: ${key}.`);
      for (const key of ['title','room','block']) if (a[key] !== undefined) text(a[key], `assignment ${key}`);
      if (a.lunch !== undefined && a.lunch !== null && !['L1','L2','L3','NO_LUNCH'].includes(a.lunch)) fail('Invalid lunch selection.');
    }
  }
}
function preferences(p) {
  if (!object(p)) fail('Invalid display preferences.');
  if (p.accent !== undefined && !['mint','blue','purple','pink','orange','red'].includes(p.accent)) fail('Invalid accent color.');
  if (p.displaySize !== undefined && !['compact','standard','large'].includes(p.displaySize)) fail('Invalid display size.');
  for (const k of ['hour24','showRooms','showSchedule','showSchoolName']) if (p[k] !== undefined && typeof p[k] !== 'boolean') fail(`Invalid preference: ${k}.`);
}
export function defaultPreferences(p = {}) {
  preferences(p);
  return {accent:p.accent ?? 'mint',hour24:p.hour24 ?? false,showRooms:p.showRooms ?? true,showSchedule:p.showSchedule ?? true,showSchoolName:p.showSchoolName ?? true,displaySize:p.displaySize ?? 'standard'};
}
export function isManagedWMHS(v) { return v.school?.id === 'wmhs' && v.sourceKind === 'bellsync-v1'; }
export function normalize(raw) {
  if (!object(raw)) fail('Schedule configuration must be an object.');
  safeTree(raw);
  if (![1,2].includes(raw.schemaVersion)) fail('Unsupported Display configuration version.');
  const v = JSON.parse(JSON.stringify(raw));
  if (!object(v.school)) fail('Invalid school details.');
  id(v.school.id, 'school ID'); text(v.school.displayName,'school name',true); text(v.school.timeZone,'timezone',true); text(v.profileName,'display name',true);
  try { new Intl.DateTimeFormat('en-US',{timeZone:v.school.timeZone}).format(0); } catch { fail('Enter a valid IANA timezone, such as America/New_York.'); }
  if (!['browser-local','development-sample','bellsync-v1'].includes(v.sourceKind)) fail('Unsupported schedule source.');
  if (v.sourceKind === 'bellsync-v1' && v.school.id !== 'wmhs') fail('Native imports currently support WMHS only.');
  if (!object(v.assignments)) fail('Assignments must be an object.');
  // Explicit migration of the original template-only format and old WMHS rotations.
  if (v.rotation === undefined) {
    if (v.schemaVersion !== 1 && !isManagedWMHS(v)) fail('Missing rotation configuration.');
    const same = Object.hasOwn(v.assignments,'every');
    const labels = same ? [{id:'every',label:'Every Day'}] : Array.from({length:7},(_,i)=>({id:String(i+1),label:`Day ${i+1}`}));
    v.rotation = {kind:same?'same':'day-1-7',labels,seedDate:'2026-09-01',seedDayId:labels[0].id,noSchoolDates:[]};
  }
  if (!object(v.rotation) || !['same','day-1-5','day-1-6','day-1-7','ab','ag','custom'].includes(v.rotation.kind)) fail('Invalid rotation configuration.');
  const r = v.rotation;
  if (!Array.isArray(r.labels) || !r.labels.length || r.labels.length > 100) fail('Invalid rotation days.');
  const dayIDs = new Set();
  for (const d of r.labels) { if (!object(d)) fail('Invalid rotation day.'); id(d.id,'rotation ID'); text(d.label,'rotation label',true); if (dayIDs.has(d.id)) fail('Duplicate rotation ID.'); dayIDs.add(d.id); }
  const expected = {same:1,'day-1-5':5,'day-1-6':6,'day-1-7':7,ab:2,ag:7}[r.kind];
  if (expected && r.labels.length !== expected) fail('Rotation day count does not match its type.');
  date(r.seedDate); if (!dayIDs.has(r.seedDayId)) fail('Invalid rotation seed day.');
  if (!Array.isArray(r.noSchoolDates)) fail('No-school dates must be an array.');
  r.noSchoolDates.forEach(date);
  if (v.templates === undefined) {
    if (!Array.isArray(v.periods)) fail('Missing bell templates.');
    v.templates = {regular:JSON.parse(JSON.stringify(v.periods))};
  }
  if (!object(v.templates) || !Object.hasOwn(v.templates,'regular')) fail('A regular bell template is required.');
  const periodIDs = new Set();
  for (const [name,rows] of Object.entries(v.templates)) { id(name,'template name'); for (const k of timedRows(rows,`Template ${name}`)) periodIDs.add(k); }
  if (v.periods === undefined) v.periods = v.templates.regular.map(p=>({id:p.id,label:p.label || p.id,start:p.start,end:p.end,kind:p.kind || 'academic'}));
  timedRows(v.periods,'Bell times',true).forEach(k=>periodIDs.add(k));
  if (!isManagedWMHS(v)) {
    if (Object.keys(v.templates).length !== 1) fail('Browser schedules currently support only a regular bell template.');
    const signature = rows => JSON.stringify(chronological(rows).map(p=>[p.id,p.start,p.end]));
    if (signature(v.periods) !== signature(v.templates.regular)) fail('Bell times and regular template must match.');
  }
  if (isManagedWMHS(v)) for (let i=1;i<=7;i++) dayIDs.add(String(i)); // old saved generated labels used day-N IDs
  assignments(v.assignments,dayIDs,periodIDs);
  if (v.calendar !== undefined) {
    if (!object(v.calendar) || !object(v.calendar.days)) fail('Invalid calendar.');
    for (const [key,d] of Object.entries(v.calendar.days)) {
      date(key); if (!object(d) || !(typeof d.day === 'string' || Number.isInteger(d.day)) || typeof d.schedule !== 'string' || !dayIDs.has(String(d.day)) || !(Object.hasOwn(v.templates,d.schedule) || (isManagedWMHS(v) && d.schedule === 'delayed'))) fail(`Invalid scheduled date: ${key}.`);
      if (d.date !== undefined && d.date !== key) fail('Calendar date does not match its key.');
      for (const field of ['dayLabel','note','weekday']) if (d[field] !== undefined) text(d[field],`calendar ${field}`);
    }
    for (const field of ['nonStudentDays','studentDayStatusLabels']) if (v.calendar[field] !== undefined) {
      if (!object(v.calendar[field])) fail(`Invalid calendar ${field}.`);
      for (const [key,item] of Object.entries(v.calendar[field])) { date(key); if (field === 'studentDayStatusLabels') text(item,'day status'); else { if (!object(item)) fail('Invalid nonstudent day.'); text(item.title,'nonstudent title',true); text(item.kind,'nonstudent kind',true); } }
    }
  }
  v.preferences = defaultPreferences(v.preferences);
  v.schemaVersion = 2;
  return v;
}
export function validate(v) { normalize(v); }
export function importBackup(raw) {
  if (!object(raw) || raw.format !== WEB_FORMAT || raw.formatVersion !== 1) fail('Unsupported BellSync Display backup format or version.');
  return normalize(raw.configuration);
}
export function validateNative(raw) {
  if (!object(raw)) fail('Invalid BellSync file.'); safeTree(raw);
  if (raw.formatVersion !== 1) fail('This BellSync file uses an unsupported version.');
  if (raw.schoolProfileID !== 'wmhs') fail('This browser import currently supports WMHS .bellsync files only.');
  text(raw.scheduleName,'schedule name',true);
  assignments(raw.assignments,new Set(['1','2','3','4','5','6','7']),new Set(['1','2','3','4','5','6','flex']));
  if (raw.schoolContentVersion !== undefined) text(raw.schoolContentVersion,'school content version',true);
  if (raw.sharedSchool != null || raw.gmsGrade != null) fail('Unsupported school data in WMHS import.');
  if (raw.notes != null) text(raw.notes,'notes');
  if (raw.usesSchoolSchedule !== undefined && typeof raw.usesSchoolSchedule !== 'boolean') fail('Invalid school schedule setting.');
  if (raw.date != null && (typeof raw.date !== 'string' || !Number.isFinite(Date.parse(raw.date)))) fail('Invalid shared schedule date.');
  if (raw.createdAt !== undefined && !(typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)) && !(typeof raw.createdAt === 'string' && Number.isFinite(Date.parse(raw.createdAt)))) fail('Invalid export date.');
  for (const key of ['activityNameOverrides','personalBlockColors']) if (raw[key] != null && (!Array.isArray(raw[key]) || raw[key].some(x=>!object(x)))) fail(`Invalid ${key}.`);
  return raw;
}
export function rotationFor(v,key) {
  const r=v.rotation;
  if (r.noSchoolDates.includes(key) || v.calendar?.nonStudentDays?.[key]) return null;
  if (r.kind==='same' || r.labels.length===1) return r.labels[0];
  let cursor=new Date(`${r.seedDate}T12:00:00Z`), end=Date.parse(`${key}T12:00:00Z`), count=0;
  const eligible=d=>![0,6].includes(d.getUTCDay()) && !r.noSchoolDates.includes(d.toISOString().slice(0,10)) && !v.calendar?.nonStudentDays?.[d.toISOString().slice(0,10)];
  while (cursor.getTime()<end) { cursor.setUTCDate(cursor.getUTCDate()+1); if(eligible(cursor)) count++; }
  while (cursor.getTime()>end) { if(eligible(cursor)) count--; cursor.setUTCDate(cursor.getUTCDate()-1); }
  return r.labels[((r.labels.findIndex(d=>d.id===r.seedDayId)+count)%r.labels.length+r.labels.length)%r.labels.length];
}
export function schoolDay(v,key) {
  if(v.rotation.noSchoolDates.includes(key) || v.calendar?.nonStudentDays?.[key]) return null;
  if (v.calendar?.days && Object.keys(v.calendar.days).length) return v.calendar.days[key] || null;
  if ([0,6].includes(new Date(`${key}T12:00:00Z`).getUTCDay())) return null;
  const r=rotationFor(v,key); return r ? {day:r.id,dayLabel:r.label,schedule:'regular'} : null;
}
export function formatClock(timestamp,tz,hour24=false) {
  return new Intl.DateTimeFormat(hour24?'en-GB':'en-US',{timeZone:tz,hour:hour24?'2-digit':'numeric',minute:'2-digit',hourCycle:hour24?'h23':'h12'}).format(timestamp);
}
export function eventTitle(e) { return e.title?.trim() || (e.kind==='lunch'?'Lunch':e.label?.trim() || e.id); }
export function presentation(s,showRooms=true) {
  const e=s.current || s.next;
  return {title:e?eventTitle(e):({after:'Done for Today',weekend:'Weekend','no-school':'No School',unavailable:'Bell Times Unavailable'}[s.mode] || 'Schedule'),room:showRooms && e ? e.room || '' : ''};
}
// One encoder is safe for both text and quoted attribute contexts.
export function escapeHTML(value='') { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function editManagedAssignments(value,profileName,changes) {
  if(!isManagedWMHS(value)) fail('This editor requires a WMHS import.');
  const draft=JSON.parse(JSON.stringify(value)); draft.profileName=profileName;
  for(const {day,period,title,room} of changes) {
    if(!Object.hasOwn(draft.assignments,day) || !Object.hasOwn(draft.assignments[day],period)) fail('Unknown imported assignment.');
    Object.assign(draft.assignments[day][period],{title,room});
  }
  return normalize(draft);
}

// Resolve canonical local times in the school's timezone, independent of the host.
export function dateInZone(now, timeZone) {
  const p = zoneParts(now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}
function zoneParts(now, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(now).filter(p=>p.type !== 'literal').map(p=>[p.type,p.value]));
}
export function zonedTimestamp(key, time, timeZone) {
  const [y,m,d] = key.split('-').map(Number), [h,min] = time.split(':').map(Number);
  const desired = Date.UTC(y,m-1,d,h,min);
  let guess = desired;
  for (let i=0;i<3;i++) {
    const p = zoneParts(guess,timeZone);
    const seen = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
    guess += desired-seen;
  }
  return guess;
}
export const isMeaningfulEvent = e => e.kind !== 'passing';

// Returns one effective timeline for the hero and full-day list. Missing/blank
// academic assignments are open time; automatic lunch/support rows remain.
export function timelineFor(config, key) {
  date(key);
  const timeZone = config.school.timeZone;
  const day = schoolDay(config,key);
  const result = {key,timeZone,day,status:'scheduled',events:[],passing:[]};
  if (!day) {
    result.status = [0,6].includes(new Date(`${key}T12:00:00Z`).getUTCDay()) ? 'weekend' : 'no-school';
    return result;
  }
  const managed = isManagedWMHS(config);
  const rows = managed ? config.templates[day.schedule] : config.periods;
  if (!rows) return {...result,status:'unavailable'};
  const bells = chronological(rows);
  const assignments = config.assignments[String(day.day)] || config.assignments.every || {};
  const at = time => zonedTimestamp(key,time,timeZone);
  const events = [];
  const add = (p, a, start, end, suffix='', extras={}) => {
    if (start >= end) return;
    events.push({...p,...a,id:`${p.id}${suffix}`,periodID:p.id,label:p.label || (managed ? `Period ${p.id}` : p.id),startAt:start,endAt:end,...extras});
  };
  for (const p of bells) {
    const a = assignments[p.id] || {};
    const kind = p.kind || (managed && p.id === 'flex' ? 'flex' : 'academic');
    const start = at(p.start), end = at(p.end);
    if (kind === 'passing') {
      add(p,{},start,end,'',{kind,title:p.label || 'Passing Time',room:''});
      continue;
    }
    const hasClass = !!a.title?.trim();
    // Only published lunch selections split a block; NO_LUNCH and absent values keep it intact.
    const lunch = managed && ['L1','L2','L3'].includes(a.lunch) ? p.lunches?.[a.lunch] : null;
    if (lunch) {
      const lunchStart=at(lunch.start), lunchEnd=at(lunch.end);
      const lunchBell=at(lunch.bell_start || lunch.start);
      const context={selection:a.lunch,periodID:p.id,startAt:lunchStart,endAt:lunchEnd};
      if(hasClass) add(p,a,start,Math.min(end,lunchBell),'::before',{kind,lunch:context,countdownLabel:lunchBell < lunchStart ? 'Passing begins' : 'Lunch starts'});
      // An L1 bell may precede the lunch block. Include only the published
      // preceding bell boundary, never overlap an unrelated earlier class.
      const safeLead = lunchBell >= start || bells.some(previous=>previous.id !== p.id && at(previous.end) === lunchBell);
      if(safeLead && lunchBell < lunchStart) add(p,{},lunchBell,lunchStart,'::passing',{kind:'passing',title:'Passing to lunch',label:'PASSING',room:'',lunch:context});
      add(p,{},lunchStart,lunchEnd,'::lunch',{kind:'lunch',title:'Lunch',label:'LUNCH',room:'',lunch:context,countdownLabel:'Lunch ends'});
      if(hasClass) add(p,a,lunchEnd,end,'::after',{kind,lunch:context,countdownLabel:'Block ends'});
      continue;
    }
    const automatic = ['lunch','support','advisory','flex','other'].includes(kind);
    if (!hasClass && !automatic) continue;
    add(p,a,start,end,'',{kind,title:a.title?.trim() || (kind==='lunch'?'Lunch':p.label || p.id),room:a.room || ''});
  }
  events.sort((a,b)=>a.startAt-b.startAt);
  // An explicit transition cannot stretch across a missing destination.
  result.events = events.filter(e=>e.kind !== 'passing' || events.some(next=>isMeaningfulEvent(next) && next.startAt === e.endAt));
  if (managed) {
    for(let i=1;i<bells.length;i++) {
      const startAt=at(bells[i-1].end), endAt=at(bells[i].start);
      if(startAt < endAt) result.passing.push({startAt,endAt,source:'published-bells'});
    }
  }
  return result;
}
