import { WEB_FORMAT, normalize, validate, defaultPreferences, formatClock, eventTitle, escapeHTML as esc, isManagedWMHS, editManagedAssignments } from './display-core.mjs';
import { scheduleSnapshot } from './schedule-presentation.mjs';
import { ProfileStore, DEMO_ID, inspectNativeImport, nativeConfigurations, exportProfiles, importDisplayProfiles } from './profile-store.mjs';
const app = document.querySelector('#app');
const nativeInput = document.querySelector('#schedule-file');
const displayInput = document.querySelector('#display-file');
let storageWarning = '';
let store = null;
let config = load();
let tickHandle;
let isDemo = false;
let viewRequest = 0;

document.addEventListener('fullscreenchange', () => {
  if (config) update();
});

function load() {
  try {
    store = new ProfileStore(localStorage);
    storageWarning = '';
    return store.activeConfiguration;
  } catch (error) {
    store = null;
    storageWarning = `Saved schedules could not be loaded or migrated. Existing browser data has been kept. ${error.message} Reload after correcting the storage problem; Demo is still available.`;
    return null;
  }
}
function requireStore() {
  if(!store) throw Error('Saved schedules are unavailable. Reload after correcting the storage problem before saving or importing. Existing data has been kept.');
  return store;
}
function save(value, targetID = isDemo ? null : store?.snapshot.activeProfileID) {
  const profiles=requireStore();
  if(targetID && targetID !== DEMO_ID) profiles.replace(targetID,value);
  else profiles.add([value]);
  config=profiles.activeConfiguration;
  isDemo=false;storageWarning='';viewRequest++;
  closeModal();render();
}
function selectProfile(id) {
  try {
    requireStore().select(id);viewRequest++;
    config=store.activeConfiguration;isDemo=false;
    closeModal();render();
  } catch(error) { alert(error.message); }
}
function removeProfile(id) {
  const profile=store?.snapshot.savedProfiles.find(p=>p.id===id);
  if(!profile || !confirm(`Remove “${profile.configuration.profileName}” from this browser? Other schedules will be kept.`)) return;
  try {
    store.remove(id);viewRequest++;
    if(!isDemo) config=store.activeConfiguration;
    render();openChange('Schedule removed.');
  } catch(error) { alert(error.message); }
}
function clearSchedule() {
  if(isDemo) {
    try {
      if(store) store.leaveDemo();
      viewRequest++;isDemo=false;config=store?.activeConfiguration || null;
      render();openChange();
    } catch(error) { alert(error.message); }
  } else if(store) removeProfile(store.snapshot.activeProfileID);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function slug(value, fallback = 'period') { return String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback; }
function uniqueId(label, used) { const base = slug(label), id = base; let n = 2; while (used.has(id + (n === 2 ? '' : `-${n}`))) n++; const value = id + (n === 2 ? '' : `-${n}`); used.add(value); return value; }
function option(value, current, label = value) { return `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`; }
function dayName(now,tz){return new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'long',month:'long',day:'numeric'}).format(now)}
function duration(ms) { const s=Math.max(0,Math.floor(ms/1000)), m=Math.floor(s/60), r=s%60; return `${m}:${String(r).padStart(2,'0')}`; }
function localDate() { return new Date().toISOString().slice(0,10); }
function state(now) { return scheduleSnapshot(config,now); }

function setup() { app.innerHTML=`<section class="setup"><div class="setup-card"><img class="mark" src="./public/assets/bellsync-display-icon.png" alt="BellSync" width="48" height="48"><h1>Set Up BellSync Display</h1><p>Build a local classroom display. Your school schedule stays in this browser.</p><div class="setup-options"><button class="option-card primary" id="setup-here"><b>Enter My Schedule</b><span>Build your classroom schedule directly in this browser.</span></button><button class="option-card secondary" id="load-native"><b>Import from BellSync</b><span>The quickest option if you already use BellSync on your phone.</span></button><button class="option-card secondary" id="load-web"><b>Import Display Schedule</b><span>Restore a browser Display backup.</span></button><button class="option-card disabled" disabled><b>Upload My Schedule</b><span>PDF and photo setup is coming soon.</span></button><button class="option-card disabled" disabled><b>Pair with BellSync</b><span>Coming later</span></button></div><div class="buttons"><button class="secondary" id="demo">Try Demo</button>${store?.snapshot.savedProfiles.length?'<button class="secondary" id="saved-picker">Saved Schedules</button>':''}</div>${storageWarning ? `<p class="notice" role="alert">${esc(storageWarning)}</p>` : ''}<p class="notice">The demo is for testing only and is never saved unless you explicitly save it as a schedule.</p></div></section>`; document.querySelector('#setup-here').onclick=()=>openEditor(newWebConfig(),null); document.querySelector('#load-native').onclick=()=>nativeInput.click(); document.querySelector('#load-web').onclick=()=>displayInput.click(); document.querySelector('#demo').onclick=loadDemo; document.querySelector('#saved-picker')?.addEventListener('click',()=>openChange()); }
function newWebConfig() { const labels=[{id:'every',label:'Every Day'}]; return normalize({schemaVersion:2,sourceKind:'browser-local',school:{id:`local.${crypto.randomUUID?.() || Date.now()}`,displayName:'My School',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'},profileName:'My Classroom',rotation:{kind:'same',labels,seedDate:localDate(),seedDayId:'every',noSchoolDates:[]},periods:[{id:'period-1',label:'Period 1',start:'07:30',end:'08:20',kind:'academic'},{id:'period-2',label:'Period 2',start:'08:25',end:'09:15',kind:'academic'},{id:'lunch',label:'Lunch',start:'11:00',end:'11:30',kind:'lunch'},{id:'period-3',label:'Period 3',start:'11:35',end:'12:25',kind:'academic'}],assignments:{every:{'period-1':{title:'',room:''},'period-2':{title:'',room:''},lunch:{title:'',room:''},'period-3':{title:'',room:''}}},preferences:defaultPreferences()}); }
async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw Error('BellSync Display could not load a required built-in schedule resource.');
  return response.json();
}
async function loadDemo(){
  const request=++viewRequest;
  try {
    const demo=normalize(await fetchJSON('./public/samples/classroom-demo.json'));
    if(request !== viewRequest) return;
    if(store && store.snapshot.activeProfileID !== DEMO_ID) store.select(DEMO_ID);
    config=demo;isDemo=true;
    closeModal();render();
  } catch(error) { alert(error.message || 'The demo schedule could not be loaded.'); }
}
function reviewImport(configurations, unsupported=[]) {
  const rejected=unsupported.map(p=>`<li><b>${esc(p.name)}</b>: ${esc(p.reason)}</li>`).join('');
  modal(`<header class="modal-head"><div><h2>Import Schedules</h2><p>${configurations.length} schedule${configurations.length===1?'':'s'} ready to add. Existing schedules will be kept.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><form id="import-review">${configurations.map((c,i)=>`<label class="editor-section">Profile name<input data-import-index="${i}" value="${esc(c.profileName)}" required><small>${esc(c.school.displayName)}</small></label>`).join('')}${rejected?`<p>These schedules cannot be imported:</p><ul>${rejected}</ul>`:''}<p class="form-error" id="form-error"></p><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button>${configurations.length?'<button type="submit" class="primary">Import Schedules</button>':''}</footer></form>`);
  document.querySelector('#close').onclick=closeModal;
  document.querySelector('#cancel').onclick=closeModal;
  document.querySelector('#import-review').onsubmit=e=>{
    e.preventDefault();
    try {
      const drafts=configurations.map(clone);
      document.querySelectorAll('[data-import-index]').forEach(input=>{drafts[Number(input.dataset.importIndex)].profileName=input.value.trim();});
      const ids=requireStore().add(drafts,{activate:drafts.length===1});
      if(drafts.length===1) {isDemo=false;config=store.activeConfiguration;}
      else if(!isDemo) config=store.activeConfiguration;
      viewRequest++;closeModal();render();
      openChange(`${ids.length} schedule${ids.length===1?'':'s'} imported.${ids.length>1?' Choose a schedule to open.':''}${unsupported.length?` ${unsupported.length} unsupported schedule${unsupported.length===1?' was':'s were'} skipped as listed in the import review.`:''}`);
    } catch(error) { showEditorError(error.message); }
  };
}
nativeInput.addEventListener('change',async()=>{
  const file=nativeInput.files?.[0];nativeInput.value='';
  if(!file)return;
  try {
    requireStore();
    const plan=inspectNativeImport(JSON.parse(await file.text()));
    let configurations=[];
    if(plan.supported.length) {
      const [schedule,calendar]=await Promise.all([fetchJSON('./public/builtins/wmhs/schedule.json'),fetchJSON('./public/builtins/wmhs/calendar.json')]);
      configurations=nativeConfigurations(plan,schedule,calendar);
    }
    reviewImport(configurations,plan.unsupported);
  } catch(error) { alert(error.message || 'This schedule could not be read.'); }
});
displayInput.addEventListener('change',async()=>{
  const file=displayInput.files?.[0];displayInput.value='';
  if(!file)return;
  try { requireStore();reviewImport(importDisplayProfiles(JSON.parse(await file.text()))); }
  catch(error) { alert(error.message || 'This Display schedule could not be read.'); }
});

function render(){ clearInterval(tickHandle); if(!config){setup();return;} app.innerHTML='<div id="display"></div>'; update(); tickHandle=setInterval(update,500); }
function timeText(timestamp, tz) { return formatClock(timestamp,tz,config.preferences?.hour24); }
function update(){ if(!config)return; const now=Date.now(), tz=config.school.timeZone, s=state(now); const current=s.current, next=s.next; const target=s.countdownTarget; const modeTitle=s.label; const {title,room}=s; const remaining=target!==null?duration(target-now):'—'; const progress=current?Math.max(0,Math.min(100,100*(now-current.startAt)/(current.endAt-current.startAt))):0; const dayLabel=s.day?`${s.day.dayLabel || s.day.day} · ${(s.day.schedule||'regular').toUpperCase()}`:'No student schedule';
  const detailTime = target ?? next?.startAt;
  const detailLabel = s.state === 'active' ? current.countdownLabel || (current.kind==='lunch'?'Lunch ends':'Bell at') : 'Starts';
  const rows=s.events.map(e=>{const status=current?.id===e.id?'current':e.endAt<=now?'complete':''; const displayRoom=config.preferences.showRooms && e.room ? `<small>Room ${esc(e.room)}</small>` : ''; return `<div class="row ${status}"><span class="badge">${esc(e.label||e.id)}</span><div><strong>${esc(eventTitle(e))}</strong>${displayRoom}${status==='current'?'<span class="now">NOW</span>':''}</div><time>${timeText(e.startAt,tz)}<small>Ends ${timeText(e.endAt,tz)}</small></time></div>`}).join('')||'<p class="sub">No schedule is listed for this date.</p>';
  document.querySelector('#display').innerHTML=`<main class="dashboard size-${esc(config.preferences.displaySize)}" style="--accent:${accent()}"><section class="left"><header class="header"><div class="identity"><img class="mark" src="./public/assets/bellsync-display-icon.png" alt="BellSync" width="48" height="48"><div><strong>${esc(config.profileName||config.school.displayName)}</strong>${config.preferences.showSchoolName?`<small>${esc(config.school.displayName)}</small>`:''}</div></div><div><div class="clock">${timeText(now,tz)}</div><span class="meta">${esc(dayName(now,tz))} · ${esc(dayLabel)}</span><div class="toolbar"><button id="edit">Edit Schedule</button><button id="settings">Display Settings</button><button id="export">Export Display Schedule</button><button id="change">Change Schedule</button><button id="remove">${isDemo?'Leave Demo':'Remove Schedule'}</button><button id="full" aria-pressed="${document.fullscreenElement ? 'true' : 'false'}">${document.fullscreenElement ? 'Exit Full Screen' : 'Full Screen'}</button></div></div></header><div class="status"><article class="status-card"><div class="ring" style="--progress:${progress}"><div><div class="countdown">${target?remaining:'—'}</div><div class="state-label">${modeTitle}</div></div></div><div class="event-title">${esc(title)}</div><div class="details">${room?`Room ${esc(room)} · `:''}${detailTime != null?`${esc(detailLabel)} ${timeText(detailTime,tz)}`:s.state==='preview'?'No scheduled activities':'No active bell'}</div></article></div>${next?`<article class="next-card"><div class="next-label">NEXT</div><b>${esc(next.label||next.id)} · ${esc(eventTitle(next))}</b><div class="sub">Starts ${timeText(next.startAt,tz)}${config.preferences.showRooms && next.room?` · Room ${esc(next.room)}`:''}</div></article>`:''}</section>${config.preferences.showSchedule?`<aside class="schedule"><h2>TODAY'S SCHEDULE</h2><div class="rows">${rows}</div></aside>`:''}</main>`;
  document.querySelector('#edit').onclick=()=>openEditor(clone(config)); document.querySelector('#settings').onclick=openSettings; document.querySelector('#export').onclick=exportDisplay; document.querySelector('#change').onclick=()=>openChange(); document.querySelector('#remove').onclick=clearSchedule; document.querySelector('#full').onclick=toggleFullscreen; }
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
  viewRequest++; // Opening another task cancels an in-flight Demo switch.
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
function openChange(message='') {
  const profiles=store?.snapshot.savedProfiles || [];
  const active=isDemo ? DEMO_ID : store?.snapshot.activeProfileID;
  modal(`<header class="modal-head"><div class="identity"><img class="mark" src="./public/assets/bellsync-display-icon.png" alt="BellSync" width="48" height="48"><div><h2>Choose Schedule</h2><p>${esc(message || 'Schedules are saved only in this browser.')}</p></div></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header>${storageWarning?`<p class="notice">${esc(storageWarning)}</p>`:''}<div class="modal-actions"><section class="option-card"><b>Demo Classroom ${active===DEMO_ID?'· Active':''}</b><span>Always available. Changes are temporary unless saved as a new schedule.</span><div class="buttons"><button type="button" id="picker-demo" class="secondary">Open Demo</button>${isDemo?'<button type="button" id="copy-demo" class="secondary">Save Demo as New Schedule</button>':''}</div></section>${profiles.map(p=>`<section class="option-card"><b>${esc(p.configuration.profileName)} ${p.id===active?'· Active':''}</b><span>${esc(p.configuration.school.displayName)} · ${esc(p.configuration.rotation.kind)}</span><div class="buttons"><button type="button" class="secondary" data-open-profile="${esc(p.id)}">Open</button><button type="button" class="secondary" data-rename-profile="${esc(p.id)}">Rename</button><button type="button" class="secondary destructive" data-remove-profile="${esc(p.id)}">Remove</button></div></section>`).join('')}</div><footer class="modal-footer">${profiles.length?'<button type="button" class="secondary" id="export-all">Export All Display Schedules</button>':''}<button type="button" class="primary" id="add-profile">Add / Import Schedule</button></footer>`);
  document.querySelector('#close').onclick=closeModal;
  document.querySelector('#picker-demo').onclick=loadDemo;
  document.querySelector('#copy-demo')?.addEventListener('click',()=>openEditor(clone(config),null));
  document.querySelector('#add-profile').onclick=openAdd;
  document.querySelector('#export-all')?.addEventListener('click',exportAll);
  document.querySelectorAll('[data-open-profile]').forEach(b=>b.onclick=()=>selectProfile(b.dataset.openProfile));
  document.querySelectorAll('[data-remove-profile]').forEach(b=>b.onclick=()=>removeProfile(b.dataset.removeProfile));
  document.querySelectorAll('[data-rename-profile]').forEach(b=>b.onclick=()=>{
    const p=store.snapshot.savedProfiles.find(p=>p.id===b.dataset.renameProfile);
    const name=prompt('Profile name:',p.configuration.profileName);
    if(name===null)return;
    try {store.rename(p.id,name.trim());if(!isDemo)config=store.activeConfiguration;render();openChange('Profile renamed.');}
    catch(error){alert(error.message);}
  });
}

function openAdd(){ modal(`<header class="modal-head"><div><h2>Set Up BellSync Display</h2><p>Choose how to set up this browser.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><div class="buttons"><button id="back-picker" class="secondary">Saved Schedules</button><button id="add-demo" class="secondary">Try Demo</button></div><div class="modal-actions"><button class="option-card primary" id="new-setup"><b>Enter My Schedule</b><span>Build your classroom schedule directly in this browser.</span></button><button class="option-card secondary" id="native-import"><b>Import from BellSync</b><span>The quickest option if you already use BellSync on your phone.</span></button><button class="option-card secondary" id="web-import"><b>Import Display Schedule</b><span>Restore a browser schedule backup.</span></button><button class="option-card disabled" disabled><b>Upload My Schedule</b><span>PDF and photo setup is coming soon.</span></button><button class="option-card disabled" disabled><b>Pair with BellSync</b><span>Coming later</span></button></div>`); document.querySelector('#close').onclick=closeModal; document.querySelector('#back-picker').onclick=()=>openChange(); document.querySelector('#add-demo').onclick=loadDemo; document.querySelector('#new-setup').onclick=()=>openEditor(newWebConfig(),null); document.querySelector('#native-import').onclick=()=>{closeModal();nativeInput.click()}; document.querySelector('#web-import').onclick=()=>{closeModal();displayInput.click()}; }
function rotationChoices() { return [['same','Same Every Day'],['day-1-5','Day 1–5'],['day-1-6','Day 1–6'],['day-1-7','Day 1–7'],['ab','A/B'],['ag','A–G'],['custom','Custom Rotation']]; }
function labelsFor(kind, customText) { if(kind==='same') return [{id:'every',label:'Every Day'}]; if(kind==='ab') return ['A','B'].map(x=>({id:x.toLowerCase(),label:x})); if(kind==='ag') return 'ABCDEFG'.split('').map(x=>({id:x.toLowerCase(),label:x})); const count=Number(kind.match(/\d$/)?.[0]); if(count) return Array.from({length:count},(_,i)=>({id:`day-${i+1}`,label:`Day ${i+1}`})); return String(customText||'').split(',').map(x=>x.trim()).filter(Boolean).map((label,i)=>({id:`rotation-${i+1}-${slug(label)}`,label})); }
function periodRow(p,index) { return `<div class="period-row" data-index="${index}"><input data-key="label" value="${esc(p.label)}" aria-label="Period name"><input data-key="start" type="time" value="${esc(p.start)}" aria-label="Start time"><input data-key="end" type="time" value="${esc(p.end)}" aria-label="End time"><select data-key="kind">${option('academic',p.kind||'academic','Class')}${option('support',p.kind,'Advisory / FLEX / WIN')}${option('lunch',p.kind,'Lunch')}${option('passing',p.kind,'Passing Time')}${option('other',p.kind,'Other')}</select><button type="button" class="small-button up">↑</button><button type="button" class="small-button down">↓</button><button type="button" class="small-button destructive remove-period">Delete</button></div>`; }
function openManagedEditor(value, targetID) {
  const working=clone(value);
  modal('<header class="modal-head"><h2>Edit Imported WMHS Classes</h2><button id="close" class="icon-button" aria-label="Close dialog">×</button></header><p class="help">School timing, rotation days, lunch selections, and calendars are managed by the source schedule. Edit personal class names and rooms here; use Display Settings for presentation preferences. Reimport from BellSync to change school timing or lunch selections.</p><form id="managed-editor"><label>Display name<input name="profileName" required></label><div id="managed-classes"></div><p class="form-error" id="form-error"></p><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button><button type="submit" class="primary">Save Classes</button></footer></form>');
  const form=document.querySelector('#managed-editor');
  form.elements.profileName.value=working.profileName;
  const fields=[];
  const root=document.querySelector('#managed-classes');
  for(const [day,rows] of Object.entries(working.assignments)) {
    const section=document.createElement('section'); section.className='editor-section';
    const heading=document.createElement('h3'); heading.textContent=`Day ${day}`; section.append(heading);
    for(const [period,a] of Object.entries(rows)) {
      const row=document.createElement('div'); row.className='assignment-row';
      const label=document.createElement('span'); label.textContent=`${period === 'flex' ? 'FLEX' : `Period ${period}`}${a.block ? ` · ${a.block} Block` : ''}`;
      const title=document.createElement('input'); title.value=a.title || ''; title.setAttribute('aria-label',`Day ${day}, period ${period}, class name`);
      const room=document.createElement('input'); room.value=a.room || ''; room.setAttribute('aria-label',`Day ${day}, period ${period}, room`);
      row.append(label,title,room); section.append(row); fields.push({day,period,title,room});
    }
    root.append(section);
  }
  document.querySelector('#close').onclick=closeModal;
  document.querySelector('#cancel').onclick=closeModal;
  form.onsubmit=e=>{e.preventDefault();try{save(editManagedAssignments(working,form.elements.profileName.value.trim(),fields.map(f=>({day:f.day,period:f.period,title:f.title.value,room:f.room.value}))),targetID);}catch(error){showEditorError(error.message)}};
}

function openEditor(draft, targetID = isDemo ? null : store?.snapshot.activeProfileID) { if(isManagedWMHS(draft)){openManagedEditor(draft,targetID);return;} const working=normalize(clone(draft)); let activeDay=working.rotation.labels[0]?.id || 'every'; const renderEditor=()=>{ modal(`<header class="modal-head"><div><h2>${targetID ? 'Edit Schedule' : 'Add Schedule'}</h2><p>Start with the bell times, then add your classes. You can return later to change one class, room, or bell time.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><form id="schedule-editor"><section class="editor-section"><h3>School Details</h3><div class="form-grid"><label>School name<input name="schoolName" value="${esc(working.school.displayName)}" required></label><label>Name for this classroom display<input name="profileName" value="${esc(working.profileName)}" required></label><label>Timezone<input name="timeZone" value="${esc(working.school.timeZone)}" required></label></div></section><section class="editor-section"><h3>Rotation Days</h3><div class="form-grid"><label>Schedule type<select name="rotationKind">${rotationChoices().map(([v,l])=>option(v,working.rotation.kind,l)).join('')}</select></label><label>First date in the rotation<input name="seedDate" type="date" value="${esc(working.rotation.seedDate || localDate())}"></label><label>Day on that date<select name="seedDay">${working.rotation.labels.map(x=>option(x.id,working.rotation.seedDayId,x.label)).join('')}</select></label></div>${working.rotation.kind==='custom'?`<label>Custom rotation day labels (comma separated)<input name="customLabels" value="${esc(working.rotation.labels.map(x=>x.label).join(', '))}" placeholder="Red, Blue, Gold"></label><button type="button" class="secondary" id="apply-custom">Apply Rotation Days</button>`:''}<p class="help">BellSync starts from this date and moves through school weekdays. Dates you mark as no school are skipped.</p></section><section class="editor-section"><h3>Bell Times</h3><p class="help">Start with the example rows, then add, rename, reorder, or remove periods to match your school day.</p><div class="period-head"><span>Name</span><span>Start</span><span>End</span><span>Type</span></div><div id="period-list">${working.periods.map(periodRow).join('')}</div><button type="button" class="secondary" id="add-period">Add Period</button></section><section class="editor-section"><h3>My Classes</h3><div class="day-tabs">${working.rotation.labels.map(x=>`<button type="button" class="day-tab ${x.id===activeDay?'active':''}" data-day="${esc(x.id)}">${esc(x.label)}</button>`).join('')}</div><p class="help">Choose a rotation day, then enter the class and room you have during each period. You can leave any field blank.</p><div class="assignment-table"><div class="assignment-head"><span>Period</span><span>Class / Assignment</span><span>Room</span></div>${working.periods.map(p=>{const a=assignmentFrom(working,activeDay,p.id);return `<div class="assignment-row"><span>${esc(p.label)}</span><input data-period="${esc(p.id)}" data-assignment="title" value="${esc(a.title)}" placeholder="English"><input data-period="${esc(p.id)}" data-assignment="room" value="${esc(a.room)}" placeholder="Room 204"></div>`}).join('')}</div></section><section class="editor-section"><h3>School Calendar</h3><label>No-school dates <input id="no-school-date" type="date"></label><button type="button" class="secondary" id="add-no-school">Add No-School Date</button><div class="date-chips">${(working.rotation.noSchoolDates || []).map(d=>`<button type="button" class="date-chip" data-remove-date="${esc(d)}">${esc(d)} ×</button>`).join('') || '<span class="help">No dates marked.</span>'}</div></section><p class="form-error" id="form-error"></p><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button><button type="submit" class="primary">${targetID ? 'Save Schedule' : 'Save as New Schedule'}</button></footer></form>`); bindEditor(); };
  const syncInputs=()=>{const form=document.querySelector('#schedule-editor'); working.school.displayName=form.schoolName.value.trim(); working.profileName=form.profileName.value.trim(); working.school.timeZone=form.timeZone.value.trim(); working.rotation.seedDate=form.seedDate.value; working.rotation.seedDayId=form.seedDay.value; working.periods=[...document.querySelectorAll('.period-row')].map((row,i)=>({id:row.dataset.id || working.periods[Number(row.dataset.index)]?.id || `period-${Date.now()}-${i}`,label:row.querySelector('[data-key="label"]').value.trim(),start:row.querySelector('[data-key="start"]').value,end:row.querySelector('[data-key="end"]').value,kind:row.querySelector('[data-key="kind"]').value})); document.querySelectorAll('[data-assignment]').forEach(input=>{const day=input.closest('.assignment-table').dataset.day || activeDay; working.assignments[day] ||= {}; working.assignments[day][input.dataset.period] ||= {}; working.assignments[day][input.dataset.period][input.dataset.assignment]=input.value;}); };
  const bindEditor=()=>{const form=document.querySelector('#schedule-editor'); document.querySelector('#close').onclick=closeModal; document.querySelector('#cancel').onclick=closeModal; document.querySelector('#add-period').onclick=()=>{syncInputs(); const used=new Set(working.periods.map(x=>x.id)); working.periods.push({id:uniqueId('period',used),label:`Period ${working.periods.length+1}`,start:'08:00',end:'08:50',kind:'academic'}); working.rotation.labels.forEach(d=>{working.assignments[d.id] ||= {}; working.assignments[d.id][working.periods.at(-1).id]={title:'',room:''};}); renderEditor();}; document.querySelectorAll('.remove-period').forEach(b=>b.onclick=()=>{syncInputs(); const index=Number(b.closest('.period-row').dataset.index), removed=working.periods[index]; if(working.periods.length===1){showEditorError('At least one period is required.');return;} if(!confirm(`Delete ${removed.label}? Its personal classes will also be removed.`))return; working.periods.splice(index,1); Object.values(working.assignments).forEach(rows=>delete rows[removed.id]); renderEditor();}); document.querySelectorAll('.up,.down').forEach(b=>b.onclick=()=>{syncInputs();const index=Number(b.closest('.period-row').dataset.index), next=b.classList.contains('up')?index-1:index+1;if(next<0||next>=working.periods.length)return;[working.periods[index],working.periods[next]]=[working.periods[next],working.periods[index]];renderEditor();}); document.querySelectorAll('.day-tab').forEach(b=>b.onclick=()=>{syncInputs();activeDay=b.dataset.day;renderEditor()}); document.querySelector('#add-no-school').onclick=()=>{syncInputs();const value=document.querySelector('#no-school-date').value;if(value&&!working.rotation.noSchoolDates.includes(value)){working.rotation.noSchoolDates.push(value);renderEditor();}}; document.querySelectorAll('[data-remove-date]').forEach(b=>b.onclick=()=>{syncInputs();working.rotation.noSchoolDates=working.rotation.noSchoolDates.filter(x=>x!==b.dataset.removeDate);renderEditor()}); const applyRotation=(kind, custom)=>{syncInputs();const old=working.rotation.labels;working.rotation.kind=kind;working.rotation.labels=labelsFor(kind,custom || (kind==='custom'?'Day 1, Day 2':''));if(!working.rotation.labels.length){working.rotation.labels=old;showEditorError('Enter at least one custom rotation day.');return;}working.rotation.labels.forEach((d,i)=>{working.assignments[d.id] ||= clone(working.assignments[old[i]?.id] || {});});working.assignments=Object.fromEntries(working.rotation.labels.map(d=>[d.id,working.assignments[d.id] || {}]));working.rotation.seedDayId=working.rotation.labels[0]?.id;activeDay=working.rotation.labels[0].id;renderEditor()}; form.rotationKind.onchange=()=>applyRotation(form.rotationKind.value, form.customLabels?.value); document.querySelector('#apply-custom')?.addEventListener('click',()=>applyRotation('custom', form.customLabels.value)); form.onsubmit=e=>{e.preventDefault();syncInputs();try{working.templates={regular:working.periods.map(({id,label,start,end,kind})=>({id,label,start,end,kind}))}; validate(working); save(working,targetID);}catch(error){showEditorError(error.message)}}; };
  renderEditor();
}
function assignmentFrom(value,day,period){return value.assignments?.[day]?.[period] || value.assignments?.every?.[period] || {title:'',room:''};}
function showEditorError(message){const node=document.querySelector('#form-error');if(node)node.textContent=message;}
function openSettings(){const prefs=clone(config.preferences);modal(`<header class="modal-head"><div><h2>Display Settings</h2><p>These preferences affect only this browser Display.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><form id="settings-form"><section class="editor-section"><div class="form-grid"><label>Accent color<select name="accent">${['mint','blue','purple','pink','orange','red'].map(x=>option(x,prefs.accent,x[0].toUpperCase()+x.slice(1))).join('')}</select></label><label>Clock<select name="clock">${option('12',prefs.hour24?'24':'12','12-hour')}${option('24',prefs.hour24?'24':'12','24-hour')}</select></label><label>Display size<select name="size">${['compact','standard','large'].map(x=>option(x,prefs.displaySize,x[0].toUpperCase()+x.slice(1))).join('')}</select></label></div><label class="check"><input name="rooms" type="checkbox" ${prefs.showRooms?'checked':''}> Show rooms</label><label class="check"><input name="schedule" type="checkbox" ${prefs.showSchedule?'checked':''}> Show Today’s Schedule</label><label class="check"><input name="school" type="checkbox" ${prefs.showSchoolName?'checked':''}> Show school name</label></section><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">Save Settings</button></footer></form>`);document.querySelector('#close').onclick=closeModal;document.querySelector('#cancel').onclick=closeModal;document.querySelector('#settings-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;try{const next=clone(config);next.preferences=defaultPreferences({accent:f.accent.value,hour24:f.clock.value==='24',displaySize:f.size.value,showRooms:f.rooms.checked,showSchedule:f.schedule.checked,showSchoolName:f.school.checked});if(isDemo){config=normalize(next);closeModal();render();}else{save(next)}}catch(error){alert(error.message||'BellSync Display could not save these settings.')}}}
function exportAll(){try{downloadBackup(exportProfiles(requireStore().snapshot),'bellsync-all-schedules.bellsyncdisplay')}catch(error){alert(error.message)}}
function downloadBackup(payload,filename){const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href)}
function exportDisplay(){try{const payload={format:WEB_FORMAT,formatVersion:1,exportedAt:new Date().toISOString(),configuration:config};downloadBackup(payload,`${slug(config.profileName,'bellsync-display')}.bellsyncdisplay`)}catch(e){alert(`Could not export this Display schedule: ${e.message}`)}}
render();
if(store?.snapshot.activeProfileID === DEMO_ID) loadDemo();
else if(store?.snapshot.savedProfiles.length && !config) openChange();
