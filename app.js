const KEY = 'bellsync.webDisplay.config.v1';
const WEB_FORMAT = 'bellsync-display-web';
const app = document.querySelector('#app');
const nativeInput = document.querySelector('#schedule-file');
const displayInput = document.querySelector('#display-file');
let storageWarning = '';
let config = load();
let tickHandle;
let isDemo = false;

function load() {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return null;
    const value = normalize(JSON.parse(stored));
    validate(value);
    return value;
  } catch {
    storageWarning = 'A saved Display schedule could not be read. It has not been removed. Import a Display backup or create a new schedule when you are ready.';
    return null;
  }
}
function save(value) {
  const normalized = normalize(value);
  validate(normalized);
  try {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  } catch {
    throw Error('BellSync Display could not save this schedule in this browser.');
  }
  storageWarning = '';
  isDemo = false;
  config = normalized;
  closeModal();
  render();
}
function clearSchedule() {
  if (isDemo) {
    isDemo = false;
    config = load();
  } else {
    localStorage.removeItem(KEY);
    config = null;
  }
  render();
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function esc(value = '') { const d = document.createElement('div'); d.textContent = value; return d.innerHTML; }
function slug(value, fallback = 'period') { return String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback; }
function uniqueId(label, used) { const base = slug(label), id = base; let n = 2; while (used.has(id + (n === 2 ? '' : `-${n}`))) n++; const value = id + (n === 2 ? '' : `-${n}`); used.add(value); return value; }
function option(value, current, label = value) { return `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`; }
function parts(now, tz) { return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(x=>x.type !== 'literal').map(x=>[x.type,x.value])); }
function dateKey(p) { return `${p.year}-${p.month}-${p.day}`; }
function zonedTimestamp(key, time, tz) { const [y,m,d] = key.split('-').map(Number), [h,min] = String(time || '00:00').split(':').map(Number); const desired = Date.UTC(y,m-1,d,h,min); let guess = desired; for (let i=0;i<2;i++) { const p=parts(new Date(guess),tz); const seen=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute); guess += desired-seen; } return guess; }
function clock(timestamp, tz, withMeridiem = false) { const value = new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit'}).format(new Date(timestamp)); return withMeridiem ? value : value.replace(/\s?[AP]M/,''); }
function dayName(now,tz){return new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'long',month:'long',day:'numeric'}).format(now)}
function duration(ms) { const s=Math.max(0,Math.floor(ms/1000)), m=Math.floor(s/60), r=s%60; return `${m}:${String(r).padStart(2,'0')}`; }
function defaultPreferences(p = {}) { return { accent: p.accent || 'mint', hour24: !!p.hour24, showRooms: p.showRooms !== false, showSchedule: p.showSchedule !== false, showSchoolName: p.showSchoolName !== false, displaySize: p.displaySize || 'standard' }; }
function normalize(raw) {
  if (!raw || !raw.school) return raw;
  const result = clone(raw);
  result.schemaVersion = Math.max(2, Number(result.schemaVersion) || 1);
  result.preferences = defaultPreferences(result.preferences);
  if (!result.rotation) result.rotation = { kind: result.assignments?.every ? 'same' : 'day-1-7', labels: result.assignments?.every ? [{id:'every',label:'Every Day'}] : Array.from({length:7},(_,i)=>({id:`day-${i+1}`,label:`Day ${i+1}`})), seedDate: localDate(), seedDayId: 'day-1', noSchoolDates: [] };
  result.rotation.labels ||= [{id:'every',label:'Every Day'}];
  result.rotation.noSchoolDates ||= [];
  if (!result.periods) { const template = result.templates?.regular || Object.values(result.templates || {})[0] || []; result.periods = template.map((p,i)=>({id:p.id || `period-${i+1}`,label:p.label || p.id || `Period ${i+1}`,start:p.start,end:p.end,kind:p.kind || 'academic'})); }
  if (!result.assignments) result.assignments = {};
  if (!result.templates) result.templates = { regular: result.periods.map(({id,label,start,end,kind})=>({id,label,start,end,kind})) };
  return result;
}
function localDate() { return new Date().toISOString().slice(0,10); }
function isWebConfig(value) { return value?.format === WEB_FORMAT && value?.configuration; }
function rotationFor(key) {
  const rotation = config.rotation || {};
  if (rotation.kind === 'same' || rotation.labels?.length === 1) return rotation.labels?.[0] || {id:'every',label:'Every Day'};
  if (rotation.noSchoolDates?.includes(key)) return null;
  const seed = rotation.seedDate || key, labels = rotation.labels || [];
  const start = Date.parse(`${seed}T12:00:00Z`), end = Date.parse(`${key}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !labels.length) return labels[0] || null;
  let direction = end >= start ? 1 : -1, cursor = new Date(start), count = 0;
  while ((direction > 0 && cursor.getTime() < end) || (direction < 0 && cursor.getTime() > end)) { cursor.setUTCDate(cursor.getUTCDate() + direction); const day = cursor.getUTCDay(); const ckey = cursor.toISOString().slice(0,10); if (day !== 0 && day !== 6 && !rotation.noSchoolDates?.includes(ckey)) count += direction; }
  const seedIndex = Math.max(0, labels.findIndex(x=>x.id === rotation.seedDayId));
  return labels[((seedIndex + count) % labels.length + labels.length) % labels.length];
}
function schoolDay(key) { if (config.calendar?.days && Object.keys(config.calendar.days).length) return config.calendar.days[key] || null; const weekday = new Date(`${key}T12:00:00Z`).getUTCDay(); const r = rotationFor(key); return weekday === 0 || weekday === 6 || !r ? null : { day:r.id, dayLabel:r.label, schedule:'regular' }; }
function assignment(day, period) { const rows=config.assignments?.[String(day)] || config.assignments?.every || {}; return rows[period] || {}; }
function eventsFor(key, day) { const isBrowserSchedule = config.sourceKind === 'browser-local' || config.sourceKind === 'development-sample'; const template = isBrowserSchedule ? (config.periods || []) : (config.templates?.[day?.schedule || 'regular'] || config.templates?.regular || config.periods || []); const dayId = day?.day || day?.dayLabel || day?.id || 'every'; return template.map(p=>({ ...p, ...assignment(dayId,p.id), startAt:zonedTimestamp(key,p.start,config.school.timeZone), endAt:zonedTimestamp(key,p.end,config.school.timeZone) })); }
function state(now) { const tz=config.school.timeZone, p=parts(now,tz), key=dateKey(p), weekday=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short'}).format(now); const day=schoolDay(key); if (!day) return {mode:['Sat','Sun'].includes(weekday)?'weekend':'no-school',key,day,events:[]}; const events=eventsFor(key,day); if (!events.length) return {mode:'no-school',key,day,events:[]}; const current=events.find(e=>now>=e.startAt&&now<e.endAt); const next=events.find(e=>e.startAt>now); if(current) return {mode:'current',key,day,events,current,next}; if(next) return {mode:'before',key,day,events,next,previous:events.filter(e=>e.endAt<=now).at(-1)}; return {mode:'after',key,day,events,previous:events.at(-1)}; }

function setup() { app.innerHTML=`<section class="setup"><div class="setup-card"><span class="mark">♢</span><h1>Set Up BellSync Display</h1><p>Build a local classroom display. Your school schedule stays in this browser.</p><div class="setup-options"><button class="option-card primary" id="setup-here"><b>Enter My Schedule</b><span>Build your classroom schedule directly in this browser.</span></button><button class="option-card secondary" id="load-native"><b>Import from BellSync</b><span>The quickest option if you already use BellSync on your phone.</span></button><button class="option-card secondary" id="load-web"><b>Import Display Schedule</b><span>Restore a browser Display backup.</span></button><button class="option-card disabled" disabled><b>Upload My Schedule</b><span>PDF and photo setup is coming soon.</span></button><button class="option-card disabled" disabled><b>Pair with BellSync</b><span>Coming later</span></button></div><div class="buttons"><button class="secondary" id="demo">Try Demo</button></div>${storageWarning ? `<p class="notice" role="alert">${storageWarning}</p>` : ''}<p class="notice">The demo is for testing only and is never saved unless you explicitly save it as a schedule.</p></div></section>`; document.querySelector('#setup-here').onclick=()=>openEditor(newWebConfig()); document.querySelector('#load-native').onclick=()=>nativeInput.click(); document.querySelector('#load-web').onclick=()=>displayInput.click(); document.querySelector('#demo').onclick=loadDemo; }
function newWebConfig() { const labels=[{id:'every',label:'Every Day'}]; return normalize({schemaVersion:2,sourceKind:'browser-local',school:{id:`local.${crypto.randomUUID?.() || Date.now()}`,displayName:'My School',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'},profileName:'My Classroom',rotation:{kind:'same',labels,seedDate:localDate(),seedDayId:'every',noSchoolDates:[]},periods:[{id:'period-1',label:'Period 1',start:'07:30',end:'08:20',kind:'academic'},{id:'period-2',label:'Period 2',start:'08:25',end:'09:15',kind:'academic'},{id:'lunch',label:'Lunch',start:'11:00',end:'11:30',kind:'lunch'},{id:'period-3',label:'Period 3',start:'11:35',end:'12:25',kind:'academic'}],templates:{regular:[]},assignments:{every:{'period-1':{title:'',room:''},'period-2':{title:'',room:''},lunch:{title:'',room:''},'period-3':{title:'',room:''}}},preferences:defaultPreferences()}); }
async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw Error('BellSync Display could not load a required built-in schedule resource.');
  return response.json();
}
async function loadDemo(){
  try {
    config = normalize(await fetchJSON('./public/samples/classroom-demo.json'));
    validate(config);
    isDemo = true;
    render();
  } catch (error) {
    alert(error.message || 'The demo schedule could not be loaded.');
  }
}
async function builtInWMHS(shared) {
  const [schedule,calendar] = await Promise.all([
    fetchJSON('./public/builtins/wmhs/schedule.json'),
    fetchJSON('./public/builtins/wmhs/calendar.json')
  ]);
  return normalize({schemaVersion:2,sourceKind:'bellsync-v1',school:{id:'wmhs',displayName:'Wakefield Memorial High School',timeZone:schedule.time_zone},calendar,templates:schedule.bells,assignments:shared.assignments,profileName:shared.scheduleName,preferences:defaultPreferences()});
}
function confirmReplacement(description) {
  return !config || confirm(`${description} will replace the schedule currently shown on this Display. Continue?`);
}
nativeInput.addEventListener('change',async()=>{
  const file=nativeInput.files?.[0];
  nativeInput.value='';
  if(!file)return;
  try {
    const shared=JSON.parse(await file.text());
    if(shared.formatVersion!==1) throw Error('This BellSync file uses an unsupported version.');
    if(shared.schoolProfileID!=='wmhs') throw Error('This browser import currently supports WMHS .bellsync files only. Use Import Display Schedule for browser backups.');
    const imported = await builtInWMHS(shared);
    validate(imported);
    if (confirmReplacement('Importing this BellSync schedule')) save(imported);
  } catch(e) {
    alert(e.message||'This schedule could not be read.');
  }
});
displayInput.addEventListener('change',async()=>{
  const file=displayInput.files?.[0];
  displayInput.value='';
  if(!file)return;
  try {
    const backup=JSON.parse(await file.text());
    if(!isWebConfig(backup)) throw Error('This is not a BellSync Display schedule backup.');
    validate(backup.configuration);
    if (confirmReplacement('Importing this Display schedule')) save(backup.configuration);
  } catch(e) {
    alert(e.message||'This Display schedule could not be read.');
  }
});

function render(){ clearInterval(tickHandle); if(!config){setup();return;} app.innerHTML='<div id="display"></div>'; update(); tickHandle=setInterval(update,500); }
function timeText(timestamp, tz) { return clock(timestamp,tz,config.preferences?.hour24); }
function update(){ if(!config)return; const now=Date.now(), tz=config.school.timeZone, s=state(now); const current=s.current, next=s.next; const target=current?.endAt||next?.startAt; const modeTitle={current:'NOW',before:'UP NEXT',after:'DONE FOR TODAY',weekend:'WEEKEND', 'no-school':'NO SCHOOL'}[s.mode]; const title=current?.title||next?.title||(s.mode==='after'?'Done for Today':s.mode==='weekend'?'Weekend':'No School'); const room=config.preferences.showRooms ? (current?.room||next?.room||'') : ''; const remaining=target?duration(target-now):'—'; const progress=current?Math.max(0,Math.min(100,100*(now-current.startAt)/(current.endAt-current.startAt))):0; const dayLabel=s.day?`${s.day.dayLabel || s.day.day} · ${(s.day.schedule||'regular').toUpperCase()}`:'No student schedule';
  const rows=s.events.map(e=>{const status=current?.id===e.id?'current':e.endAt<=now?'complete':''; const displayRoom=config.preferences.showRooms && e.room ? `<small>Room ${esc(e.room)}</small>` : ''; return `<div class="row ${status}"><span class="badge">${esc(e.label||e.id)}</span><div><strong>${esc(e.title||e.label||e.id)}</strong>${displayRoom}${status==='current'?'<span class="now">NOW</span>':''}</div><time>${timeText(e.startAt,tz)}</time></div>`}).join('')||'<p class="sub">No schedule is listed for this date.</p>';
  document.querySelector('#display').innerHTML=`<main class="dashboard size-${esc(config.preferences.displaySize)}" style="--accent:${accent()}"><section class="left"><header class="header"><div class="identity"><span class="mark">♢</span><div><strong>${esc(config.profileName||config.school.displayName)}</strong>${config.preferences.showSchoolName?`<small>${esc(config.school.displayName)}</small>`:''}</div></div><div><div class="clock">${config.preferences.hour24 ? new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now) : new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit'}).format(now).replace(/\s?[AP]M/,'')}</div><span class="meta">${dayName(now,tz)} · ${dayLabel}</span><div class="toolbar"><button id="edit">Edit Schedule</button><button id="settings">Display Settings</button><button id="export">Export Display Schedule</button><button id="change">Change Schedule</button><button id="remove">Remove Schedule</button><button id="full">Full Screen</button></div></div></header><div class="status"><article class="status-card"><div class="ring" style="--progress:${progress}"><div><div class="countdown">${target?remaining:'—'}</div><div class="state-label">${modeTitle}</div></div></div><div class="event-title">${esc(title)}</div><div class="details">${room?`Room ${esc(room)} · `:''}${target?`${current?'Bell at':'Starts'} ${timeText(target,tz)}`:'No active bell'}</div></article></div>${next?`<article class="next-card"><div class="next-label">NEXT</div><b>${esc(next.label||next.id)} · ${esc(next.title||next.label||next.id)}</b><div class="sub">Starts ${timeText(next.startAt,tz)}${config.preferences.showRooms && next.room?` · Room ${esc(next.room)}`:''}</div></article>`:''}</section>${config.preferences.showSchedule?`<aside class="schedule"><h2>TODAY'S SCHEDULE</h2><div class="rows">${rows}</div></aside>`:''}</main>`;
  document.querySelector('#edit').onclick=()=>openEditor(clone(config)); document.querySelector('#settings').onclick=openSettings; document.querySelector('#export').onclick=exportDisplay; document.querySelector('#change').onclick=openChange; document.querySelector('#remove').onclick=()=>{if(confirm(isDemo ? 'Leave the demo and return to your saved Display schedule?' : 'Remove this locally stored schedule? You can restore it later from an exported Display Schedule.'))clearSchedule()}; document.querySelector('#full').onclick=toggleFullscreen; }
function accent(){ return ({mint:'#7cf0c1',blue:'#84c7ff',purple:'#c3a2ff',pink:'#ff9ac8',orange:'#ffbd75',red:'#ff8e8e'})[config.preferences?.accent] || '#7cf0c1'; }
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else {
      alert('Fullscreen is not available in this browser.');
    }
  } catch {
    alert('Fullscreen could not be started in this browser.');
  }
}
function modal(content) {
  closeModal();
  const root=document.createElement('div');
  root.id='modal-root';
  root.innerHTML=`<div class="modal-backdrop"></div><section class="modal" role="dialog" aria-modal="true" aria-label="BellSync Display dialog">${content}</section>`;
  document.body.append(root);
  root.querySelector('.modal-backdrop').onclick=closeModal;
  root.addEventListener('keydown', event=>{ if(event.key==='Escape') closeModal(); });
  root.querySelector('button, input, select')?.focus();
}
function closeModal(){ document.querySelector('#modal-root')?.remove(); }
function openChange(){ modal(`<header class="modal-head"><div><h2>Set Up BellSync Display</h2><p>Choose how to set up this browser.</p></div><button class="icon-button" id="close">×</button></header><div class="modal-actions"><button class="option-card primary" id="new-setup"><b>Enter My Schedule</b><span>Build your classroom schedule directly in this browser.</span></button><button class="option-card secondary" id="native-import"><b>Import from BellSync</b><span>The quickest option if you already use BellSync on your phone.</span></button><button class="option-card secondary" id="web-import"><b>Import Display Schedule</b><span>Restore a browser schedule backup.</span></button><button class="option-card disabled" disabled><b>Upload My Schedule</b><span>PDF and photo setup is coming soon.</span></button><button class="option-card disabled" disabled><b>Pair with BellSync</b><span>Coming later</span></button></div>`); document.querySelector('#close').onclick=closeModal; document.querySelector('#new-setup').onclick=()=>openEditor(newWebConfig()); document.querySelector('#native-import').onclick=()=>{closeModal();nativeInput.click()}; document.querySelector('#web-import').onclick=()=>{closeModal();displayInput.click()}; }
function rotationChoices() { return [['same','Same Every Day'],['day-1-5','Day 1–5'],['day-1-6','Day 1–6'],['day-1-7','Day 1–7'],['ab','A/B'],['ag','A–G'],['custom','Custom Rotation']]; }
function labelsFor(kind, customText) { if(kind==='same') return [{id:'every',label:'Every Day'}]; if(kind==='ab') return ['A','B'].map(x=>({id:x.toLowerCase(),label:x})); if(kind==='ag') return 'ABCDEFG'.split('').map(x=>({id:x.toLowerCase(),label:x})); const count=Number(kind.match(/\d$/)?.[0]); if(count) return Array.from({length:count},(_,i)=>({id:`day-${i+1}`,label:`Day ${i+1}`})); return String(customText||'').split(',').map(x=>x.trim()).filter(Boolean).map((label,i)=>({id:`rotation-${i+1}-${slug(label)}`,label})); }
function periodRow(p,index) { return `<div class="period-row" data-index="${index}"><input data-key="label" value="${esc(p.label)}" aria-label="Period name"><input data-key="start" type="time" value="${esc(p.start)}" aria-label="Start time"><input data-key="end" type="time" value="${esc(p.end)}" aria-label="End time"><select data-key="kind">${option('academic',p.kind||'academic','Class')}${option('support',p.kind,'Advisory / FLEX / WIN')}${option('lunch',p.kind,'Lunch')}${option('other',p.kind,'Other')}</select><button type="button" class="small-button up">↑</button><button type="button" class="small-button down">↓</button><button type="button" class="small-button destructive remove-period">Delete</button></div>`; }
function openEditor(draft) { const working=normalize(clone(draft)); let activeDay=working.rotation.labels[0]?.id || 'every'; const renderEditor=()=>{ modal(`<header class="modal-head"><div><h2>${config ? 'Edit Schedule' : 'Set Up BellSync Display'}</h2><p>Start with the bell times, then add your classes. You can return later to change one class, room, or bell time.</p></div><button class="icon-button" id="close">×</button></header><form id="schedule-editor"><section class="editor-section"><h3>School Details</h3><div class="form-grid"><label>School name<input name="schoolName" value="${esc(working.school.displayName)}" required></label><label>Name for this classroom display<input name="profileName" value="${esc(working.profileName)}" required></label><label>Timezone<input name="timeZone" value="${esc(working.school.timeZone)}" required></label></div></section><section class="editor-section"><h3>Rotation Days</h3><div class="form-grid"><label>Schedule type<select name="rotationKind">${rotationChoices().map(([v,l])=>option(v,working.rotation.kind,l)).join('')}</select></label><label>First date in the rotation<input name="seedDate" type="date" value="${esc(working.rotation.seedDate || localDate())}"></label><label>Day on that date<select name="seedDay">${working.rotation.labels.map(x=>option(x.id,working.rotation.seedDayId,x.label)).join('')}</select></label></div>${working.rotation.kind==='custom'?`<label>Custom rotation day labels (comma separated)<input name="customLabels" value="${esc(working.rotation.labels.map(x=>x.label).join(', '))}" placeholder="Red, Blue, Gold"></label><button type="button" class="secondary" id="apply-custom">Apply Rotation Days</button>`:''}<p class="help">BellSync starts from this date and moves through school weekdays. Dates you mark as no school are skipped.</p></section><section class="editor-section"><h3>Bell Times</h3><p class="help">Start with the example rows, then add, rename, reorder, or remove periods to match your school day.</p><div class="period-head"><span>Name</span><span>Start</span><span>End</span><span>Type</span></div><div id="period-list">${working.periods.map(periodRow).join('')}</div><button type="button" class="secondary" id="add-period">Add Period</button></section><section class="editor-section"><h3>My Classes</h3><div class="day-tabs">${working.rotation.labels.map(x=>`<button type="button" class="day-tab ${x.id===activeDay?'active':''}" data-day="${esc(x.id)}">${esc(x.label)}</button>`).join('')}</div><p class="help">Choose a rotation day, then enter the class and room you have during each period. You can leave any field blank.</p><div class="assignment-table"><div class="assignment-head"><span>Period</span><span>Class / Assignment</span><span>Room</span></div>${working.periods.map(p=>{const a=assignmentFrom(working,activeDay,p.id);return `<div class="assignment-row"><span>${esc(p.label)}</span><input data-period="${esc(p.id)}" data-assignment="title" value="${esc(a.title)}" placeholder="English"><input data-period="${esc(p.id)}" data-assignment="room" value="${esc(a.room)}" placeholder="Room 204"></div>`}).join('')}</div></section><section class="editor-section"><h3>School Calendar</h3><label>No-school dates <input id="no-school-date" type="date"></label><button type="button" class="secondary" id="add-no-school">Add No-School Date</button><div class="date-chips">${(working.rotation.noSchoolDates || []).map(d=>`<button type="button" class="date-chip" data-remove-date="${d}">${d} ×</button>`).join('') || '<span class="help">No dates marked.</span>'}</div></section><p class="form-error" id="form-error"></p><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button><button type="submit" class="primary">Save Schedule</button></footer></form>`); bindEditor(); };
  const syncInputs=()=>{const form=document.querySelector('#schedule-editor'); working.school.displayName=form.schoolName.value.trim(); working.profileName=form.profileName.value.trim(); working.school.timeZone=form.timeZone.value.trim(); working.rotation.seedDate=form.seedDate.value; working.rotation.seedDayId=form.seedDay.value; working.periods=[...document.querySelectorAll('.period-row')].map((row,i)=>({id:row.dataset.id || working.periods[Number(row.dataset.index)]?.id || `period-${Date.now()}-${i}`,label:row.querySelector('[data-key="label"]').value.trim(),start:row.querySelector('[data-key="start"]').value,end:row.querySelector('[data-key="end"]').value,kind:row.querySelector('[data-key="kind"]').value})); document.querySelectorAll('[data-assignment]').forEach(input=>{const day=input.closest('.assignment-table').dataset.day || activeDay; working.assignments[day] ||= {}; working.assignments[day][input.dataset.period] ||= {}; working.assignments[day][input.dataset.period][input.dataset.assignment]=input.value;}); };
  const bindEditor=()=>{const form=document.querySelector('#schedule-editor'); document.querySelector('#close').onclick=closeModal; document.querySelector('#cancel').onclick=closeModal; document.querySelector('#add-period').onclick=()=>{syncInputs(); const used=new Set(working.periods.map(x=>x.id)); working.periods.push({id:uniqueId('period',used),label:`Period ${working.periods.length+1}`,start:'08:00',end:'08:50',kind:'academic'}); working.rotation.labels.forEach(d=>{working.assignments[d.id] ||= {}; working.assignments[d.id][working.periods.at(-1).id]={title:'',room:''};}); renderEditor();}; document.querySelectorAll('.remove-period').forEach(b=>b.onclick=()=>{syncInputs(); const index=Number(b.closest('.period-row').dataset.index), removed=working.periods[index]; if(working.periods.length===1){showEditorError('At least one period is required.');return;} if(!confirm(`Delete ${removed.label}? Its personal classes will also be removed.`))return; working.periods.splice(index,1); Object.values(working.assignments).forEach(rows=>delete rows[removed.id]); renderEditor();}); document.querySelectorAll('.up,.down').forEach(b=>b.onclick=()=>{syncInputs();const index=Number(b.closest('.period-row').dataset.index), next=b.classList.contains('up')?index-1:index+1;if(next<0||next>=working.periods.length)return;[working.periods[index],working.periods[next]]=[working.periods[next],working.periods[index]];renderEditor();}); document.querySelectorAll('.day-tab').forEach(b=>b.onclick=()=>{syncInputs();activeDay=b.dataset.day;renderEditor()}); document.querySelector('#add-no-school').onclick=()=>{syncInputs();const value=document.querySelector('#no-school-date').value;if(value&&!working.rotation.noSchoolDates.includes(value)){working.rotation.noSchoolDates.push(value);renderEditor();}}; document.querySelectorAll('[data-remove-date]').forEach(b=>b.onclick=()=>{syncInputs();working.rotation.noSchoolDates=working.rotation.noSchoolDates.filter(x=>x!==b.dataset.removeDate);renderEditor()}); const applyRotation=(kind, custom)=>{syncInputs();const old=working.rotation.labels;working.rotation.kind=kind;working.rotation.labels=labelsFor(kind,custom || (kind==='custom'?'Day 1, Day 2':''));if(!working.rotation.labels.length){showEditorError('Enter at least one custom rotation day.');return;}working.rotation.labels.forEach((d,i)=>{working.assignments[d.id] ||= clone(working.assignments[old[i]?.id] || {});});working.rotation.seedDayId=working.rotation.labels[0]?.id;activeDay=working.rotation.labels[0].id;renderEditor()}; form.rotationKind.onchange=()=>applyRotation(form.rotationKind.value, form.customLabels?.value); document.querySelector('#apply-custom')?.addEventListener('click',()=>applyRotation('custom', form.customLabels.value)); form.onsubmit=e=>{e.preventDefault();syncInputs();try{validate(working);working.templates={regular:working.periods.map(({id,label,start,end,kind})=>({id,label,start,end,kind}))}; save(working);}catch(error){showEditorError(error.message)}}; };
  renderEditor();
}
function assignmentFrom(value,day,period){return value.assignments?.[day]?.[period] || value.assignments?.every?.[period] || {title:'',room:''};}
function showEditorError(message){const node=document.querySelector('#form-error');if(node)node.textContent=message;}
function validate(value){if(!value.school?.displayName?.trim())throw Error('Enter a school name.');if(!value.profileName?.trim())throw Error('Enter a display name.');try{new Intl.DateTimeFormat('en-US',{timeZone:value.school.timeZone}).format()}catch{throw Error('Enter a valid IANA timezone, such as America/New_York.')}if(!value.rotation?.labels?.length)throw Error('Add at least one rotation day.');if(!value.periods?.length)throw Error('Add at least one period.');const ids=new Set();value.periods.forEach(p=>{if(!p.id||ids.has(p.id))throw Error('Each period must have a unique internal ID.');ids.add(p.id);if(!p.label?.trim()||!p.start||!p.end)throw Error('Each period needs a name, start time, and end time.');if(p.end<=p.start)throw Error(`${p.label} must end after it starts.`)});}
function openSettings(){const prefs=clone(config.preferences);modal(`<header class="modal-head"><div><h2>Display Settings</h2><p>These preferences affect only this browser Display.</p></div><button class="icon-button" id="close">×</button></header><form id="settings-form"><section class="editor-section"><div class="form-grid"><label>Accent color<select name="accent">${['mint','blue','purple','pink','orange','red'].map(x=>option(x,prefs.accent,x[0].toUpperCase()+x.slice(1))).join('')}</select></label><label>Clock<select name="clock">${option('12',prefs.hour24?'24':'12','12-hour')}${option('24',prefs.hour24?'24':'12','24-hour')}</select></label><label>Display size<select name="size">${['compact','standard','large'].map(x=>option(x,prefs.displaySize,x[0].toUpperCase()+x.slice(1))).join('')}</select></label></div><label class="check"><input name="rooms" type="checkbox" ${prefs.showRooms?'checked':''}> Show rooms</label><label class="check"><input name="schedule" type="checkbox" ${prefs.showSchedule?'checked':''}> Show Today’s Schedule</label><label class="check"><input name="school" type="checkbox" ${prefs.showSchoolName?'checked':''}> Show school name</label></section><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">Save Settings</button></footer></form>`);document.querySelector('#close').onclick=closeModal;document.querySelector('#cancel').onclick=closeModal;document.querySelector('#settings-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;config.preferences=defaultPreferences({accent:f.accent.value,hour24:f.clock.value==='24',displaySize:f.size.value,showRooms:f.rooms.checked,showSchedule:f.schedule.checked,showSchoolName:f.school.checked});save(config)}}
function exportDisplay(){try{const payload={format:WEB_FORMAT,formatVersion:1,exportedAt:new Date().toISOString(),configuration:config};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${slug(config.profileName,'bellsync-display')}.bellsyncdisplay`;a.click();URL.revokeObjectURL(a.href)}catch(e){alert(`Could not export this Display schedule: ${e.message}`)}}
render();
