import { WEB_FORMAT, normalize, validate, defaultPreferences, formatClock, eventTitle, scheduleRowLabel, isRedundantScheduleBadge, escapeHTML as esc, isManagedWMHS, isManagedSchool, editManagedAssignments, managedLunchPeriods, requiredLunchAssignments, unresolvedLunchAssignments, setProfileLunchChoices, LUNCH_CHOICES, dateInZone, zonedTimestamp, schoolDay, headerScheduleLabel, schoolProgress } from './display-core.mjs';
import { builtInConfiguration, DOYLE_PROFILES, doyleConfiguration, doyleSchedulePreview, schoolLinkSelection } from './school-setup.mjs';
import { scheduleSnapshot, formatCountdown, countdownFraction } from './schedule-presentation.mjs';
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
let viewedDate = null;
let dashboardViewKey = null;
let dashboardRowsMarkup = null;
let scheduleMenuOpen = false;
const scheduleActionIDs=['schedule-toggle','edit','change','export','remove','settings','full','lunch-warning','previous-date','next-date','tomorrow-date','today-date'];
function closeScheduleMenu(returnFocus=false) {
  scheduleMenuOpen=false;
  document.querySelector('#schedule-menu')?.setAttribute('hidden','');
  document.querySelector('#schedule-toggle')?.setAttribute('aria-expanded','false');
  if(returnFocus) document.querySelector('#schedule-toggle')?.focus();
}
document.addEventListener('click',event=>{
  if(scheduleMenuOpen && !event.target.closest('#schedule-actions')) closeScheduleMenu();
});
document.addEventListener('keydown',event=>{
  if(scheduleMenuOpen && event.key==='Escape') {event.preventDefault();closeScheduleMenu(true);}
});
function bindScheduleMenu() {
  const toggle=document.querySelector('#schedule-toggle'),menu=document.querySelector('#schedule-menu');
  const items=['edit','change','export','remove'].map(id=>document.querySelector(`#${id}`));
  const open=()=>{scheduleMenuOpen=true;menu.removeAttribute('hidden');toggle.setAttribute('aria-expanded','true');};
  toggle.onclick=()=>{if(scheduleMenuOpen)closeScheduleMenu();else{open();items[0].focus();}};
  toggle.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();items[event.key==='ArrowUp'?3:0].focus();}};
  items.forEach((item,index)=>{
    item.onkeydown=event=>{
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();items[event.key==='Home'?0:event.key==='End'?3:(index+(event.key==='ArrowDown'?1:3))%4].focus();
      } else if(event.key==='Tab') closeScheduleMenu(true);
    };
  });
  document.querySelector('#edit').onclick=()=>{closeScheduleMenu();editActiveSchedule();};
  document.querySelector('#change').onclick=()=>{closeScheduleMenu();openChange();};
  document.querySelector('#export').onclick=()=>{closeScheduleMenu(true);exportDisplay();};
  document.querySelector('#remove').onclick=()=>{closeScheduleMenu();if(!isDemo || confirm('Leave Demo? Temporary edits will be discarded.')) clearSchedule();};
}

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
  else {profiles.add([value]);viewedDate=null;}
  config=profiles.activeConfiguration;
  isDemo=false;storageWarning='';viewRequest++;
  closeModal();render();
}
function editActiveSchedule() {
  try {
    const profiles=store,activeID=profiles?.snapshot.activeProfileID;
    if(activeID===DEMO_ID || (!profiles && isDemo)) {
      if(!isDemo || config?.sourceKind!=='development-sample') throw Error('Demo is still loading. Try Edit Schedule again when it is ready.');
      openEditor(clone(config),null,'demo');return;
    }
    requireStore();
    const active=profiles.activeConfiguration;
    if(!activeID || !active) throw Error('There is no active saved schedule to edit. Choose a saved schedule first.');
    if(active.school.id==='wmhs' && !isManagedWMHS(active) && active.sourceKind!=='bellsync-snapshot') throw Error('This WMHS profile is missing its imported source metadata. Reimport it from BellSync; its source timing cannot be edited as a manual schedule.');
    // Resolve both the data and save target from the same authoritative profile.
    config=active;isDemo=false;
    openEditor(active,activeID,'edit');
  } catch(error) {alert(error.message);}
}
function saveEditor(value,targetID,mode) {
  if(mode==='demo') {config=normalize(value);viewRequest++;closeModal();render();return;}
  save(value,targetID);maybePromptLunch(targetID || store.snapshot.activeProfileID);
}
function lunchWarning(value,id='lunch-warning',day=schoolDay(value,dateInZone(Date.now(),value.school.timeZone))) {
  const unresolved=unresolvedLunchAssignments(value);
  if(!unresolved.length)return '';
  const missingToday=day && unresolved.some(row=>row.day===String(day.day));
  const title=missingToday?'Lunch not set for today':'Lunch setup incomplete';
  const body=missingToday?'Today’s long-block countdown may include lunch.':'Some lunch assignments are still missing for this schedule. Long-block countdowns may be incorrect on those days.';
  return `<button type="button" id="${id}" class="lunch-warning"><strong>${title}</strong><span>${body}</span></button>`;
}
function openLunchConfiguration(id=store?.snapshot.activeProfileID) {
  const profile=requireStore().snapshot.savedProfiles.find(p=>p.id===id);if(!profile)return;
  if(profile.configuration.sourceKind==='bellsync-snapshot')openPortableEditor(profile.configuration,id,true);
  else openManagedEditor(profile.configuration,id,true);
}
function maybePromptLunch(id) {
  const profile=requireStore().snapshot.savedProfiles.find(p=>p.id===id);
  if(!profile || profile.configuration.lunchGuidancePrompted || !unresolvedLunchAssignments(profile.configuration).length)return;
  try {
    const marked={...profile.configuration,lunchGuidancePrompted:true};store.replace(id,marked);
    if(!isDemo && store.snapshot.activeProfileID===id){config=store.activeConfiguration;}
    modal(`<header class="modal-head"><div><h2>Choose your lunch</h2><p>It looks like you haven’t selected a lunch period. Without one, BellSync may treat the entire long block as one class and your countdown can run through lunch.</p></div><button id="close" class="icon-button" aria-label="Close dialog">×</button></header><div class="buttons"><button id="choose-lunch" class="primary">Choose Lunch</button><button id="no-lunch-assignment" class="secondary">No Lunch Assignment</button><button id="lunch-not-now" class="secondary">Not Now</button></div>`);
    document.querySelector('#close').onclick=closeModal;document.querySelector('#lunch-not-now').onclick=closeModal;
    document.querySelector('#choose-lunch').onclick=()=>openLunchConfiguration(id);
    document.querySelector('#no-lunch-assignment').onclick=()=>{try{const current=store.snapshot.savedProfiles.find(p=>p.id===id).configuration;save(setProfileLunchChoices(current,unresolvedLunchAssignments(current).map(r=>({...r,lunch:'NO_LUNCH'}))),id);}catch(error){alert(error.message);}};
  }catch(error){alert(error.message);}
}
function selectProfile(id) {
  try {
    requireStore().select(id);viewedDate=null;viewRequest++;
    config=store.activeConfiguration;isDemo=false;
    closeModal();render();
  } catch(error) { alert(error.message); }
}
function removeProfile(id) {
  const profile=store?.snapshot.savedProfiles.find(p=>p.id===id);
  if(!profile || !confirm(`Remove “${profile.configuration.profileName}” from this browser? Other schedules will be kept.`)) return;
  try {
    store.remove(id);viewRequest++;
    if(!isDemo) {config=store.activeConfiguration;viewedDate=null;}
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
function duration(ms) { return formatCountdown(ms); }
function localDate() { return new Date().toISOString().slice(0,10); }
function state(now) { return viewedDate ? scheduleSnapshot(config,now,{date:viewedDate,isLive:viewedDate===dateInZone(now,config.school.timeZone)}) : scheduleSnapshot(config,now); }

function schoolChoices() { return `<h2 class="setup-heading">Start with your school</h2><div class="setup-options school-options"><button class="option-card primary" data-school="wmhs"><b>Wakefield Memorial High School</b><span>School bells, rotation, calendar, and lunch rules built in.</span></button><button class="option-card primary" data-school="gms"><b>Galvin Middle School</b><span>Choose your grade, then enter your classes and rooms.</span></button><button class="option-card primary" data-school="doyle"><b>Doyle School</b><span>Choose PreK A–I. Classroom activities and bathroom reminders built in.</span></button></div><h2 class="setup-heading">Other ways to set up</h2>`; }
function bindSchoolChoices() { document.querySelectorAll('[data-school]').forEach(button=>button.onclick=()=>button.dataset.school==='doyle'?chooseDoyleProfile():button.dataset.school==='gms'?chooseGalvinGrade():startSchoolSetup('wmhs')); }
function chooseGalvinGrade() {
  modal(`<header class="modal-head"><div><h2>Galvin Middle School</h2><p>Choose your grade to load the correct bells and lunch time.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><div class="modal-actions">${[5,6,7,8].map(grade=>`<button class="option-card primary" data-grade="${grade}"><b>Grade ${grade}</b></button>`).join('')}</div>`);
  document.querySelector('#close').onclick=closeModal;
  document.querySelectorAll('[data-grade]').forEach(button=>button.onclick=()=>startSchoolSetup('gms',Number(button.dataset.grade)));
}
function chooseDoyleProfile() {
  modal(`<header class="modal-head"><div><h2>Doyle School</h2><p>Choose your PreK schedule. A–I identify source schedule columns, not official room numbers. No import is needed.</p><p class="notice">Early-release activity times are not confirmed and remain unavailable.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><div class="setup-options">${DOYLE_PROFILES.map(code=>`<button class="option-card primary" data-doyle="${code}"><b>Doyle PreK ${code}</b></button>`).join('')}</div>`);
  document.querySelector('#close').onclick=()=>{viewRequest++;closeModal();};
  document.querySelectorAll('[data-doyle]').forEach(button=>button.onclick=()=>previewDoyleSetup(button.dataset.doyle));
}
async function previewDoyleSetup(code) {
  const request=++viewRequest;
  try {
    const profiles=requireStore();
    if(!DOYLE_PROFILES.includes(code)) throw Error('Choose a Doyle PreK schedule from A through I.');
    const existing=profiles.snapshot.savedProfiles.find(p=>p.configuration.school.id===`doyle.prek-${code.toLowerCase()}` && p.configuration.sourceKind==='bellsync-snapshot');
    const candidate=existing?.configuration || doyleConfiguration(await fetchJSON(`./public/builtins/doyle/prek-${code.toLowerCase()}.json`),code);
    if(request!==viewRequest)return;
    const rows=doyleSchedulePreview(candidate),tz=candidate.school.timeZone;
    modal(`<header class="modal-head"><div><h2>Doyle PreK ${code}</h2><p>Preview the normal daily sequence to recognize your schedule. A–I are source-column identifiers.${existing?' Your saved changes will be kept.':''}</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><div class="doyle-preview">${rows.map(e=>`<div class="doyle-preview-row"><div><strong>${esc(eventTitle(e))}</strong>${candidate.preferences.showRooms && e.room?`<small>Room ${esc(e.room)}</small>`:''}${e.kind==='point'?'<small>Point reminder · classroom activity continues</small>':''}</div><time>${formatClock(e.startAt,tz,candidate.preferences.hour24)}${e.kind==='point'?'':` – ${formatClock(e.endAt,tz,candidate.preferences.hour24)}`}</time></div>`).join('')}</div><p class="notice">Early-release activity times remain unavailable. Only confirmed activities and reminders are shown.</p><footer class="modal-footer"><button class="secondary" id="doyle-back">Back to Doyle Schedules</button><button class="primary" id="doyle-use">Use This Schedule</button></footer>`);
    document.querySelector('#close').onclick=()=>{viewRequest++;closeModal();};
    document.querySelector('#doyle-back').onclick=()=>{viewRequest++;chooseDoyleProfile();};
    document.querySelector('#doyle-use').onclick=()=>{try{if(existing)selectProfile(existing.id);else save(candidate,null);}catch(error){alert(error.message);}};
  } catch(error) {if(request===viewRequest)alert(error.message || 'The Doyle preview could not be loaded.');}
}
async function startDoyleSetup(code) {
  const request=++viewRequest;
  try {
    const profiles=requireStore();
    if(!DOYLE_PROFILES.includes(code)) throw Error('Choose a Doyle PreK schedule from A through I.');
    const existing=profiles.snapshot.savedProfiles.find(p=>p.configuration.school.id===`doyle.prek-${code.toLowerCase()}` && p.configuration.sourceKind==='bellsync-snapshot');
    if(existing) {selectProfile(existing.id);return;}
    const raw=await fetchJSON(`./public/builtins/doyle/prek-${code.toLowerCase()}.json`);
    if(request!==viewRequest)return;
    save(doyleConfiguration(raw,code),null);
  } catch(error) {alert(error.message || 'The Doyle schedule could not be loaded.');}
}
async function startSchoolSetup(schoolID,grade) {
  const request=++viewRequest;
  try {
    requireStore();
    const [schedule,calendar]=await Promise.all([fetchJSON(`./public/builtins/${schoolID}/schedule.json`),fetchJSON(`./public/builtins/${schoolID}/calendar.json`)]);
    if(request!==viewRequest) return;
    openEditor(builtInConfiguration(schoolID,schedule,calendar,grade),null);
  } catch(error) { alert(error.message || 'The school schedule could not be loaded.'); }
}
function setup() { app.innerHTML=`<section class="setup"><div class="setup-card"><img class="mark" src="./public/assets/bellsync-display-icon.png" alt="BellSync" width="48" height="48"><h1>Set Up BellSync Display</h1><p>Choose your school and customize your classroom display. Schedules stay in this browser.</p>${schoolChoices()}<div class="setup-options"><button class="option-card secondary" id="setup-here"><b>Enter My Schedule</b><span>Build your classroom schedule directly in this browser.</span></button><button class="option-card secondary" id="load-native"><b>Import from BellSync</b><span>Use a schedule exported from the BellSync app.</span></button><button class="option-card secondary" id="load-web"><b>Import Display Schedule</b><span>Restore a browser Display backup.</span></button></div><div class="buttons"><button class="secondary" id="demo">Try Demo</button>${store?.snapshot.savedProfiles.length?'<button class="secondary" id="saved-picker">Saved Schedules</button>':''}</div>${storageWarning ? `<p class="notice" role="alert">${esc(storageWarning)}</p>` : ''}<p class="notice">Demo is for testing and is never saved unless you explicitly save it as a schedule.</p></div></section>`; bindSchoolChoices();document.querySelector('#setup-here').onclick=()=>openEditor(newWebConfig(),null); document.querySelector('#load-native').onclick=()=>nativeInput.click(); document.querySelector('#load-web').onclick=()=>displayInput.click(); document.querySelector('#demo').onclick=loadDemo; document.querySelector('#saved-picker')?.addEventListener('click',()=>openChange()); }
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
    config=demo;isDemo=true;viewedDate=null;
    closeModal();render();
  } catch(error) { alert(error.message || 'The demo schedule could not be loaded.'); }
}
function reviewImport(configurations, unsupported=[], warnings=[]) {
  const notices=warnings.map(w=>`<li>${esc(w)}</li>`).join('');
  const rejected=unsupported.map(p=>`<li><b>${esc(p.name)}</b>: ${esc(p.reason)}</li>`).join('');
  modal(`<header class="modal-head"><div><h2>Import Schedules</h2><p>${configurations.length} schedule${configurations.length===1?'':'s'} ready to add. Existing schedules will be kept.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><form id="import-review">${configurations.map((c,i)=>`<label class="editor-section">Profile name<input data-import-index="${i}" value="${esc(c.profileName)}" required><small>${esc(c.school.displayName)}</small></label>`).join('')}${notices?`<p>Import notes:</p><ul>${notices}</ul>`:''}${rejected?`<p>These schedules cannot be imported:</p><ul>${rejected}</ul>`:''}<p class="form-error" id="form-error"></p><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button>${configurations.length?'<button type="submit" class="primary">Import Schedules</button>':''}</footer></form>`);
  document.querySelector('#close').onclick=closeModal;
  document.querySelector('#cancel').onclick=closeModal;
  document.querySelector('#import-review').onsubmit=e=>{
    e.preventDefault();
    try {
      const drafts=configurations.map(clone);
      document.querySelectorAll('[data-import-index]').forEach(input=>{drafts[Number(input.dataset.importIndex)].profileName=input.value.trim();});
      const ids=requireStore().add(drafts,{activate:drafts.length===1});
      if(drafts.length===1) {isDemo=false;config=store.activeConfiguration;viewedDate=null;}
      else if(!isDemo) config=store.activeConfiguration;
      viewRequest++;closeModal();render();
      openChange(`${ids.length} schedule${ids.length===1?'':'s'} imported.${ids.length>1?' Choose a schedule to open.':''}${unsupported.length?` ${unsupported.length} unsupported schedule${unsupported.length===1?' was':'s were'} skipped as listed in the import review.`:''}`);
      const pendingID=ids.find(id=>unresolvedLunchAssignments(store.snapshot.savedProfiles.find(p=>p.id===id).configuration).length);if(pendingID)maybePromptLunch(pendingID);
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
      const needsBuiltIn=plan.supported.some(p=>!p.configuration);
      const [schedule,calendar]=needsBuiltIn ? await Promise.all([fetchJSON('./public/builtins/wmhs/schedule.json'),fetchJSON('./public/builtins/wmhs/calendar.json')]) : [];
      configurations=nativeConfigurations(plan,schedule,calendar);
    }
    reviewImport(configurations,plan.unsupported,plan.supported.flatMap(p=>(p.warnings || []).map(w=>`${p.name}: ${w}`)));
  } catch(error) { alert(error.message || 'This schedule could not be read.'); }
});
displayInput.addEventListener('change',async()=>{
  const file=displayInput.files?.[0];displayInput.value='';
  if(!file)return;
  try { requireStore();reviewImport(importDisplayProfiles(JSON.parse(await file.text()))); }
  catch(error) { alert(error.message || 'This Display schedule could not be read.'); }
});

function render(){ dashboardViewKey=null;scheduleMenuOpen=false;clearInterval(tickHandle); if(!config){setup();return;} app.innerHTML='<div id="display"></div>'; update(); tickHandle=setInterval(update,500); }
function timeText(timestamp, tz) { return formatClock(timestamp,tz,config.preferences?.hour24); }
function completionCheck(className) { return `<svg class="${className}" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M14 33L26 45L51 20" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function scheduleBadge(event,mode) {
  const label=scheduleRowLabel(event,mode);
  if(!label) return '';
  const badge=event.kind==='lunch' && ['L1','L2','L3'].includes(event.lunch?.selection) ? event.lunch.selection
    : mode==='blocks' && event.kind!=='lunch' && event.kind!=='passing' && event.blockID ? event.blockID.replace(/^([A-G]) Block$/i,'$1')
    : label.replace(/^Period (\d+)$/,'P$1');
  return isRedundantScheduleBadge(badge,eventTitle(event)) ? '' : badge;
}
function progressIndicators(now,key) {
  if(!config.preferences.schoolDayProgress && !config.preferences.schoolYearProgress)return '';
  const progress=schoolProgress(config,key,now);
  const bar=(kind,value,detail)=>`<section class="school-progress" aria-label="${kind} progress"><div class="progress-heading"><strong>SCHOOL ${kind.toUpperCase()}</strong>${kind==='Day'?`<span>${Math.min(99,Math.floor(value.fraction*100))}%</span>`:''}</div>${detail?`<div class="progress-detail">${detail}</div>`:''}<progress max="1" value="${value.fraction}" aria-label="School ${kind.toLowerCase()} progress"></progress></section>`;
  return `${progress.day?bar('Day',progress.day,''):''}${progress.year?bar('Year',progress.year,`${progress.year.completed} of ${progress.year.total} school days complete`):''}`;
}
function scheduleDensity(count) { return count<=8 ? 'relaxed' : count<=11 ? 'balanced' : 'busy'; }
function update(){ if(!config || document.activeElement?.id==='view-date')return; const focusedAction=scheduleActionIDs.includes(document.activeElement?.id)?document.activeElement.id:null; const now=Date.now(), tz=config.school.timeZone, s=state(now); const current=s.current, next=s.next; const target=s.countdownTarget; const modeTitle=s.label; const {title,room}=s; const remaining=target!==null?duration(target-now):'—'; const progress=100*countdownFraction(s,now); const dayLabel=headerScheduleLabel(s.day);
  const isComplete=s.state==='complete';
  const detailTime = target ?? next?.startAt;
  const detailLabel = s.state === 'active' ? current.countdownLabel || (current.kind==='lunch'?'Lunch ends':'Bell at') : 'Starts';
  const displayEvents=config.school.id.startsWith('doyle.prek-') ? [...s.events,...(s.points || []).map(p=>({...p,kind:'point',startAt:p.at,endAt:p.at}))].sort((a,b)=>a.startAt-b.startAt) : s.events;
  const rows=displayEvents.map(e=>{const status=s.state==='preview' && viewedDate?'future':current?.id===e.id?'current':e.endAt<=now?'complete':'future'; const displayRoom=config.preferences.showRooms && e.room ? `<small>Room ${esc(e.room)}</small>` : ''; const fullLabel=scheduleRowLabel(e,config.preferences.scheduleLabels),rowLabel=e.kind==='point'?'':scheduleBadge(e,config.preferences.scheduleLabels); return `<div class="row ${status} ${rowLabel?'':'no-label'} schedule-card">${rowLabel?`<span class="badge" title="${esc(fullLabel)}" aria-label="${esc(fullLabel)}">${esc(rowLabel)}</span>`:''}<div class="row-activity"><strong title="${esc(eventTitle(e))}">${esc(eventTitle(e))}</strong>${displayRoom}${e.kind==='point'?'<small>Point reminder · classroom activity continues</small>':''}<span class="row-state">${status==='current'?'<span class="now">NOW</span>':''}</span></div><div class="row-trailing"><time>${timeText(e.startAt,tz)}${e.kind==='point'?'':`<small>Ends ${timeText(e.endAt,tz)}</small>`}</time><span class="row-completion">${status==='complete'?completionCheck('row-check'):''}</span></div></div>`}).join('')||'<p class="sub">No schedule is listed for this date.</p>';
  const markup=`<main class="dashboard size-${esc(config.preferences.displaySize)}" style="--accent:${accent()}"><section class="left"><header class="header"><div class="identity"><img class="mark" src="./public/assets/bellsync-display-icon.png" alt="BellSync" width="48" height="48"><div><strong>${esc(config.profileName||config.school.displayName)}</strong>${config.preferences.showSchoolName?`<small>${esc(config.school.displayName)}</small>`:''}</div></div><div><div class="clock">${timeText(now,tz)}</div><span class="meta">${esc(dayName(viewedDate?zonedTimestamp(viewedDate,'12:00',tz):now,tz))} · ${esc(dayLabel)}</span><div class="toolbar"><div class="schedule-actions" id="schedule-actions"><button id="schedule-toggle" aria-haspopup="menu" aria-expanded="${scheduleMenuOpen}" aria-controls="schedule-menu">Schedule ▾</button><div class="schedule-menu" id="schedule-menu" role="menu" aria-label="Schedule" ${scheduleMenuOpen?'':'hidden'}><button id="edit" role="menuitem" tabindex="-1">Edit Schedule</button><button id="change" role="menuitem" tabindex="-1">Switch Schedule</button><button id="export" role="menuitem" tabindex="-1">Export / Backup Schedule</button><hr role="separator"><button id="remove" class="destructive" role="menuitem" tabindex="-1">Remove This Schedule</button></div></div><button id="settings">Display Settings</button><button id="full" aria-pressed="${document.fullscreenElement ? 'true' : 'false'}">${document.fullscreenElement ? 'Exit Full Screen' : 'Full Screen'}</button></div></div></header>${lunchWarning(config,'lunch-warning',s.day)}<div class="status"><article class="status-card"><div class="ring ${isComplete?'is-complete':''}" style="--progress:${isComplete?100:progress}"><div>${isComplete?completionCheck('completion-check'):`<div class="countdown${remaining.split(':').length===3?' has-hours':''}">${target?remaining:'—'}</div>`}<div class="state-label">${isComplete?'COMPLETE':modeTitle}</div></div></div><div class="event-title">${esc(isComplete?'Done for today':title)}</div>${isComplete?'':`<div class="details">${room?`Room ${esc(room)} · `:''}${detailTime != null?`${esc(detailLabel)} ${timeText(detailTime,tz)}`:s.state==='preview'?'No scheduled activities':'No active bell'}</div>`}${progressIndicators(now,s.key)}</article></div>${next?`<article class="next-card"><div class="next-label">NEXT</div><b>${!scheduleRowLabel(next,'blocks') || isRedundantScheduleBadge(scheduleRowLabel(next,'blocks'),eventTitle(next))?'':`${esc(scheduleRowLabel(next,'blocks'))} · `}${esc(eventTitle(next))}</b><div class="sub">Starts ${timeText(next.startAt,tz)}${config.preferences.showRooms && next.room?` · Room ${esc(next.room)}`:''}</div></article>`:''}</section>${config.preferences.showSchedule?`<aside class="schedule"><h2>${viewedDate && viewedDate!==dateInZone(now,tz)?'SCHEDULE':"TODAY'S SCHEDULE"}</h2>${scheduleDateControls(now)}<div class="rows ${scheduleDensity(displayEvents.length)}" data-row-count="${displayEvents.length}">${rows}</div></aside>`:''}</main>`;
  paintDashboard(markup,rows,JSON.stringify([isDemo?DEMO_ID:store?.snapshot.activeProfileID,s.key,config.preferences.showSchedule]));
  bindScheduleMenu();if(config.preferences.showSchedule)bindScheduleDates(now);document.querySelector('#lunch-warning')?.addEventListener('click',()=>openLunchConfiguration());document.querySelector('#settings').onclick=openSettings;document.querySelector('#full').onclick=toggleFullscreen;if(focusedAction)document.querySelector(`#${focusedAction}`)?.focus(); }
// Keep the native scroll container mounted during clock/countdown ticks, so
// wheel momentum and scrollbar dragging survive ordinary live updates.
function paintDashboard(markup,rows,viewKey) {
  const display=document.querySelector('#display');
  const left=dashboardViewKey===viewKey ? display.querySelector('.left') : null;
  const scroller=left ? display.querySelector('.rows') : null;
  if(left) {
    const next=document.createElement('div');next.innerHTML=markup;
    refreshDashboardLeft(left,next.querySelector('.left'));
    if(scroller && dashboardRowsMarkup!==rows) {
      const scrollTop=scroller.scrollTop;
      scroller.innerHTML=rows;
      scroller.scrollTop=scrollTop;
    }
  } else display.innerHTML=markup;
  dashboardViewKey=viewKey;dashboardRowsMarkup=rows;
}
// The header and branding image stay attached. Only changing text and dynamic
// cards update on ticks; the image src is never reassigned by the live renderer.
function refreshDashboardLeft(left,next) {
  for(const selector of ['.clock','.meta','#full']) {
    const current=left.querySelector(selector),incoming=next.querySelector(selector);
    if(current.textContent!==incoming.textContent)current.textContent=incoming.textContent;
    if(selector==='#full')current.setAttribute('aria-pressed',incoming.getAttribute('aria-pressed'));
  }
  for(const selector of ['.lunch-warning','.status','.next-card']) {
    const current=left.querySelector(selector),incoming=next.querySelector(selector);
    if(current && incoming)current.replaceWith(incoming);
    else if(current)current.remove();
    else if(incoming) {
      if(selector==='.lunch-warning')left.querySelector('.header').insertAdjacentElement('afterend',incoming);
      else left.append(incoming);
    }
  }
}
function scheduleDateControls(now) {
  const date=viewedDate || dateInZone(now,config.school.timeZone);
  return `<div class="snapshot-dates"><button id="previous-date" aria-label="Previous date">‹</button><input id="view-date" type="date" aria-label="View schedule date" value="${esc(date)}"><button id="next-date" aria-label="Next date">›</button><button id="tomorrow-date">Tomorrow</button><button id="today-date">Today</button></div>`;
}
function bindScheduleDates(now) {
  const shift=(key,days)=>{const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  const set=key=>{viewedDate=key;update();};
  const current=viewedDate || dateInZone(now,config.school.timeZone);
  document.querySelector('#previous-date').onclick=()=>set(shift(current,-1));
  document.querySelector('#next-date').onclick=()=>set(shift(current,1));
  document.querySelector('#tomorrow-date').onclick=()=>set(shift(dateInZone(Date.now(),config.school.timeZone),1));
  document.querySelector('#today-date').onclick=()=>set(null);
  document.querySelector('#view-date').onchange=event=>{if(event.target.value){event.target.blur();set(event.target.value);}};
}
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
  modal(`<header class="modal-head"><div class="identity"><img class="mark" src="./public/assets/bellsync-display-icon.png" alt="BellSync" width="48" height="48"><div><h2>Choose Schedule</h2><p>${esc(message || 'Schedules are saved only in this browser.')}</p></div></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header>${storageWarning?`<p class="notice">${esc(storageWarning)}</p>`:''}<div class="modal-actions"><section class="option-card"><b>Demo Classroom ${active===DEMO_ID?'· Active':''}</b><span>Always available. Changes are temporary unless saved as a new schedule.</span><div class="buttons"><button type="button" id="picker-demo" class="secondary">Open Demo</button>${isDemo?'<button type="button" id="copy-demo" class="secondary">Save Demo as New Schedule</button>':''}</div></section>${profiles.map(p=>`<section class="option-card"><b>${esc(p.configuration.profileName)} ${p.id===active?'· Active':''}</b><span>${esc(p.configuration.school.displayName)} · ${esc(p.configuration.rotation?.kind || 'Imported school snapshot')}</span>${lunchWarning(p.configuration,`profile-lunch-${p.id}`)}<div class="buttons"><button type="button" class="secondary" data-open-profile="${esc(p.id)}">Open</button><button type="button" class="secondary" data-rename-profile="${esc(p.id)}">Rename</button><button type="button" class="secondary destructive" data-remove-profile="${esc(p.id)}">Remove</button></div></section>`).join('')}</div><footer class="modal-footer">${config?.school.id.startsWith('doyle.prek-')?'<button type="button" class="secondary" id="change-doyle">Change Doyle Schedule</button>':''}${profiles.length?'<button type="button" class="secondary" id="export-all">Export All Display Schedules</button>':''}<button type="button" class="primary" id="add-profile">Add / Import Schedule</button></footer>`);
  document.querySelector('#close').onclick=closeModal;
  document.querySelector('#picker-demo').onclick=loadDemo;
  for(const p of profiles)document.querySelector(`#profile-lunch-${p.id}`)?.addEventListener('click',()=>openLunchConfiguration(p.id));
  document.querySelector('#copy-demo')?.addEventListener('click',()=>openEditor(clone(config),null));
  document.querySelector('#add-profile').onclick=openAdd;
  if(config?.school.id.startsWith('doyle.prek-'))document.querySelector('#change-doyle').onclick=chooseDoyleProfile;
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

function openAdd(){ modal(`<header class="modal-head"><div><h2>Set Up BellSync Display</h2><p>Choose how to set up this browser.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><div class="buttons"><button id="back-picker" class="secondary">Saved Schedules</button><button id="add-demo" class="secondary">Try Demo</button></div>${schoolChoices()}<div class="modal-actions"><button class="option-card secondary" id="new-setup"><b>Enter My Schedule</b><span>Build your classroom schedule directly in this browser.</span></button><button class="option-card secondary" id="native-import"><b>Import from BellSync</b><span>The quickest option if you already use BellSync on your phone.</span></button><button class="option-card secondary" id="web-import"><b>Import Display Schedule</b><span>Restore a browser schedule backup.</span></button></div>`); document.querySelector('#close').onclick=closeModal; document.querySelector('#back-picker').onclick=()=>openChange(); document.querySelector('#add-demo').onclick=loadDemo; bindSchoolChoices();document.querySelector('#new-setup').onclick=()=>openEditor(newWebConfig(),null); document.querySelector('#native-import').onclick=()=>{closeModal();nativeInput.click()}; document.querySelector('#web-import').onclick=()=>{closeModal();displayInput.click()}; }
function rotationChoices() { return [['same','Same Every Day'],['day-1-5','Day 1–5'],['day-1-6','Day 1–6'],['day-1-7','Day 1–7'],['ab','A/B'],['ag','A–G'],['custom','Custom Rotation']]; }
function labelsFor(kind, customText) { if(kind==='same') return [{id:'every',label:'Every Day'}]; if(kind==='ab') return ['A','B'].map(x=>({id:x.toLowerCase(),label:x})); if(kind==='ag') return 'ABCDEFG'.split('').map(x=>({id:x.toLowerCase(),label:x})); const count=Number(kind.match(/\d$/)?.[0]); if(count) return Array.from({length:count},(_,i)=>({id:`day-${i+1}`,label:`Day ${i+1}`})); return String(customText||'').split(',').map(x=>x.trim()).filter(Boolean).map((label,i)=>({id:`rotation-${i+1}-${slug(label)}`,label})); }
function periodRow(p,index) { return `<div class="period-row" data-index="${index}"><input data-key="label" value="${esc(p.label)}" aria-label="Period name"><input data-key="start" type="time" value="${esc(p.start)}" aria-label="Start time"><input data-key="end" type="time" value="${esc(p.end)}" aria-label="End time"><select data-key="kind">${option('academic',p.kind||'academic','Class')}${option('support',p.kind,'Advisory / FLEX / WIN')}${option('lunch',p.kind,'Lunch')}${option('passing',p.kind,'Passing Time')}${option('other',p.kind,'Other')}</select><button type="button" class="small-button up">↑</button><button type="button" class="small-button down">↓</button><button type="button" class="small-button destructive remove-period">Delete</button></div>`; }
function openPortableEditor(value,targetID,focusLunch=false) {
  const working=clone(value),raw=working.portable.shared,d=raw.schoolDefinitionSnapshot;
  modal(`<header class="modal-head"><div><h2>Edit Imported Schedule</h2><p>BellSync manages timing, rotation, calendar, and lunch rules. Display names and rooms apply across this Web Display profile.</p></div><button id="close" class="icon-button" aria-label="Close dialog">×</button></header><form id="portable-editor" class="managed-editor"><div class="managed-editor-top"><label>Display name<input name="profileName" required></label></div><div id="portable-fields" class="managed-classes"></div><p class="form-error" id="form-error" role="alert"></p><footer class="modal-footer managed-footer"><button id="cancel" type="button" class="secondary">Cancel</button><button type="submit" class="primary">Save Changes</button></footer></form>`);
  document.querySelector('#modal-root .modal')?.classList.add('managed-modal');
  const form=document.querySelector('#portable-editor'),root=document.querySelector('#portable-fields');form.elements.profileName.value=working.profileName;root.replaceChildren();
  const fields=[],lunchFields=[];
  const lunchRows=requiredLunchAssignments(working);
  if(lunchRows.length){const section=document.createElement('section');section.className='editor-section';const heading=document.createElement('h3');heading.textContent='Lunch selections';section.append(heading);for(const r of lunchRows){const label=document.createElement('label');label.textContent=`Day ${r.day} · ${r.period} · Lunch`;const select=document.createElement('select');select.setAttribute('aria-label',`Day ${r.day}, ${r.period}, lunch selection`);select.innerHTML=option('',raw.assignments[r.day]?.[r.period]?.lunch || '', 'Choose lunch')+r.choices.map(choice=>option(choice,raw.assignments[r.day]?.[r.period]?.lunch,choice==='NO_LUNCH'?'No Lunch':choice.replace('L','Lunch '))).join('');select.value=raw.assignments[r.day]?.[r.period]?.lunch || '';const field={...r,select,changed:false};select.onchange=()=>{field.changed=true;};label.append(select);section.append(label);lunchFields.push(field);}root.append(section);}
  const personalPeriods=new Set((raw.personalActivities ?? []).map(p=>p.sourcePeriodID));
  for(const [type,items] of [['period',d.periodDefinitions.filter(p=>!personalPeriods.has(p.id))],['personal',raw.personalActivities ?? []]]) {
    if(!items.length)continue;
    const section=document.createElement('section');section.className='editor-section';const heading=document.createElement('h3');heading.textContent=type==='period'?'Source activities':'Profile owner activities';section.append(heading);
    for(const item of items) {
      const edit=working.portable.edits.find(e=>e.type===type && e.id===item.id),baseTitle=item.displayName || item.title;
      const row=document.createElement('div');row.className='portable-edit-row';
      const source=document.createElement('strong');source.textContent=baseTitle;
      const titleLabel=document.createElement('label'),caption=document.createElement('span');caption.textContent='Display name';
      const title=document.createElement('input');title.value=edit?.title || baseTitle;title.setAttribute('aria-label',`${baseTitle}, display name`);titleLabel.append(caption,title);
      const roomLabel=document.createElement('label'),roomCaption=document.createElement('span');roomCaption.textContent='Room override (optional)';
      const room=document.createElement('input');room.value=edit?.room ?? item.room ?? '';room.setAttribute('aria-label',`${baseTitle}, room override`);roomLabel.append(roomCaption,room);
      row.append(source,titleLabel,roomLabel);section.append(row);fields.push({type,id:item.id,title,room,baseTitle,baseRoom:item.room ?? '',initialTitle:title.value,initialRoom:room.value});
    }
    root.append(section);
  }
  document.querySelector('#close').onclick=closeModal;document.querySelector('#cancel').onclick=closeModal;
  if(focusLunch)(lunchFields.find(f=>!f.select.value) || lunchFields[0])?.select.focus();
  form.onsubmit=event=>{event.preventDefault();try{
    working.profileName=form.elements.profileName.value.trim();
    for(const f of fields) {
      if(f.title.value===f.initialTitle && f.room.value===f.initialRoom)continue;
      let edit=working.portable.edits.find(e=>e.type===f.type && e.id===f.id);
      if(!edit){edit={type:f.type,id:f.id};working.portable.edits.push(edit);}
      if(f.title.value!==f.initialTitle)edit.title=f.title.value.trim();
      if(f.room.value!==f.initialRoom)edit.room=f.room.value.trim();
    }
    save(setProfileLunchChoices(working,lunchFields.filter(f=>f.changed).map(f=>({...f,lunch:f.select.value}))),targetID);maybePromptLunch(targetID || store.snapshot.activeProfileID);
  }catch(error){showEditorError(error.message)}};
}
function openManagedEditor(value, targetID,focusLunch=false) {
  const working=clone(value),wmhs=working.school.id==='wmhs';
  const days=[...new Set([...Array.from({length:wmhs?7:6},(_,i)=>String(i+1)),...Object.keys(working.assignments)])];
  for(const day of days) working.assignments[day] ??= {};
  for(const {day,period} of requiredLunchAssignments(value))working.assignments[day][period] ??= {title:'',room:''};
  let activeDay=(focusLunch?unresolvedLunchAssignments(value)[0]?.day:null) || days[0],fields=[],lunchFields=[];
  const changes=new Map(),draftLunch=new Map();
  const lunchPeriods=new Set(managedLunchPeriods(working));
  modal(`<header class="modal-head"><div><h2>${wmhs?'Edit WMHS Schedule':'Edit Galvin Schedule'}</h2><p>Schedule timing and rotation come from BellSync. ${wmhs?'Customize your class names, rooms, and lunch.':'Customize your class names and rooms. Lunch follows your grade schedule.'}</p></div><button id="close" class="icon-button" aria-label="Close dialog">×</button></header><form id="managed-editor" class="managed-editor"><div class="managed-editor-top"><label>Display name<input name="profileName" required></label><div id="managed-days" class="managed-days" role="group" aria-label="Rotation day"></div><div class="managed-columns" aria-hidden="true"><span>${wmhs?'Block':'Period'}</span><span>Class</span><span>Room <small>(optional)</small></span></div></div><div id="managed-classes" class="managed-classes" role="region" aria-label="Selected rotation day"></div><p class="form-error" id="form-error" role="alert"></p><footer class="modal-footer managed-footer"><button type="button" class="secondary" id="cancel">Cancel</button><button type="submit" class="primary">Save Changes</button></footer></form>`);
  document.querySelector('#modal-root .modal')?.classList.add('managed-modal');
  const form=document.querySelector('#managed-editor'),root=document.querySelector('#managed-classes'),tabs=document.querySelector('#managed-days');
  form.elements.profileName.value=working.profileName;
  const key=(day,period)=>`${day}:${period}`;
  const syncDraft=()=>{
    for(const f of fields) {
      working.assignments[f.day][f.period].title=f.title.value;
      working.assignments[f.day][f.period].room=f.room.value;
      const original=value.assignments[f.day]?.[f.period] || {},change={day:f.day,period:f.period};
      if(f.title.value!==(original.title || '')) change.title=f.title.value;
      if(f.room.value!==(original.room || '')) change.room=f.room.value;
      if(draftLunch.has(key(f.day,f.period))) change.lunch=draftLunch.get(key(f.day,f.period));
      if(Object.keys(change).length>2) changes.set(key(f.day,f.period),change);
      else changes.delete(key(f.day,f.period));
    }
    for(const f of lunchFields) if(f.changed) {
      draftLunch.set(key(f.day,f.period),f.select.value);
      changes.set(key(f.day,f.period),{...changes.get(key(f.day,f.period)),day:f.day,period:f.period,lunch:f.select.value});
    }
  };
  const buttons=[];tabs.replaceChildren();
  const renderDay=()=>{
    fields=[];lunchFields=[];root.replaceChildren();
    root.setAttribute('aria-label',`Day ${activeDay} classes`);
    for(const button of buttons) {const selected=button.dataset.day===activeDay;button.setAttribute('aria-pressed',String(selected));button.className=`day-tab${selected?' active':''}`;}
    const section=document.createElement('section');section.className='managed-day';
    section.setAttribute('data-day',activeDay);
    const heading=document.createElement('h3');heading.className='sr-only';heading.textContent=`Day ${activeDay}`;section.append(heading);
    for(const [period,a] of Object.entries(working.assignments[activeDay])) {
      const row=document.createElement('div');row.className='managed-assignment';
      const periodName=wmhs?(period==='flex'?'FLEX':`Period ${period}`):(period==='HR'?'Homeroom':`Period ${period.slice(1)}`);
      const blockID=a.block?.trim();
      const badgeText=wmhs ? (period==='flex'?'FLEX':blockID?.replace(/^([A-G])(?: Block)?$/i,'$1') || `P${period}`) : period;
      const source=document.createElement('div');source.className='managed-source';
      const badge=document.createElement('strong');badge.className='managed-badge';badge.textContent=badgeText;
      const detail=document.createElement('small');detail.textContent=period==='flex'?'':periodName;
      source.append(badge,detail);
      const titleLabel=document.createElement('label'),titleCaption=document.createElement('span');titleCaption.className='managed-field-caption';titleCaption.textContent='Class';
      const title=document.createElement('input');title.value=a.title || '';title.setAttribute('aria-label',`Day ${activeDay}, ${periodName}, class name`);titleLabel.append(titleCaption,title);
      const roomLabel=document.createElement('label'),roomCaption=document.createElement('span');roomCaption.className='managed-field-caption';roomCaption.textContent='Room (optional)';
      const room=document.createElement('input');room.value=a.room || '';room.setAttribute('aria-label',`Day ${activeDay}, ${periodName}, room (optional)`);roomLabel.append(roomCaption,room);
      row.append(source,titleLabel,roomLabel);fields.push({day:activeDay,period,title,room});
      if(lunchPeriods.has(period)) {
        const lunchLabel=document.createElement('label');lunchLabel.className='managed-lunch';
        const caption=document.createElement('span');caption.textContent='Lunch';
        const select=document.createElement('select');select.setAttribute('aria-label',`Day ${activeDay}, ${badgeText}, ${periodName}, lunch selection`);
        const selected=draftLunch.get(key(activeDay,period)) ?? a.lunch ?? '';
        select.innerHTML=option('',selected,'Choose lunch')+LUNCH_CHOICES.map((choice,i)=>option(choice,selected,i===3?'No Lunch':`Lunch ${i+1}`)).join('');select.value=selected;
        const field={day:activeDay,period,select,changed:draftLunch.has(key(activeDay,period))};select.onchange=()=>{field.changed=true;};lunchFields.push(field);
        lunchLabel.append(caption,select);row.append(lunchLabel);
      }
      section.append(row);
    }
    root.append(section);
  };
  for(const day of days) {
    const button=document.createElement('button');button.type='button';button.dataset.day=day;button.textContent=`Day ${day}`;
    button.onclick=()=>{syncDraft();activeDay=day;renderDay();};
    button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const i=days.indexOf(activeDay),next=event.key==='Home'?0:event.key==='End'?days.length-1:(i+(event.key==='ArrowRight'?1:days.length-1))%days.length;buttons[next].onclick();buttons[next].focus();}};
    buttons.push(button);tabs.append(button);
  }
  renderDay();if(focusLunch)lunchFields[0]?.select.focus();
  document.querySelector('#close').onclick=closeModal;document.querySelector('#cancel').onclick=closeModal;
  form.onsubmit=e=>{e.preventDefault();syncDraft();try{save(editManagedAssignments(value,form.elements.profileName.value.trim(),[...changes.values()]),targetID);maybePromptLunch(targetID || store.snapshot.activeProfileID);}catch(error){showEditorError(error.message)}};
}

function openEditor(draft, targetID = null, mode = targetID ? 'edit' : 'create') { if(draft.sourceKind==='bellsync-snapshot'){openPortableEditor(draft,targetID);return;} if(isManagedSchool(draft)){openManagedEditor(draft,targetID);return;} const working=normalize(clone(draft)); let activeDay=working.rotation.labels[0]?.id || 'every'; const renderEditor=()=>{ modal(`<header class="modal-head"><div><h2>${mode==='demo' ? 'Edit Demo Schedule' : targetID ? 'Edit Schedule' : 'Add Schedule'}</h2><p>Start with the bell times, then add your classes. You can return later to change one class, room, or bell time.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><form id="schedule-editor"><section class="editor-section"><h3>School Details</h3><div class="form-grid"><label>School name<input name="schoolName" value="${esc(working.school.displayName)}" required></label><label>Name for this classroom display<input name="profileName" value="${esc(working.profileName)}" required></label><label>Timezone<input name="timeZone" value="${esc(working.school.timeZone)}" required></label></div></section><section class="editor-section"><h3>Rotation Days</h3><div class="form-grid"><label>Schedule type<select name="rotationKind">${rotationChoices().map(([v,l])=>option(v,working.rotation.kind,l)).join('')}</select></label><label>First date in the rotation<input name="seedDate" type="date" value="${esc(working.rotation.seedDate || localDate())}"></label><label>Day on that date<select name="seedDay">${working.rotation.labels.map(x=>option(x.id,working.rotation.seedDayId,x.label)).join('')}</select></label></div>${working.rotation.kind==='custom'?`<label>Custom rotation day labels (comma separated)<input name="customLabels" value="${esc(working.rotation.labels.map(x=>x.label).join(', '))}" placeholder="Red, Blue, Gold"></label><button type="button" class="secondary" id="apply-custom">Apply Rotation Days</button>`:''}<p class="help">BellSync starts from this date and moves through school weekdays. Dates you mark as no school are skipped.</p></section><section class="editor-section"><h3>Bell Times</h3><p class="help">Start with the example rows, then add, rename, reorder, or remove periods to match your school day.</p><div class="period-head"><span>Name</span><span>Start</span><span>End</span><span>Type</span></div><div id="period-list">${working.periods.map(periodRow).join('')}</div><button type="button" class="secondary" id="add-period">Add Period</button></section><section class="editor-section"><h3>My Classes</h3><div class="day-tabs">${working.rotation.labels.map(x=>`<button type="button" class="day-tab ${x.id===activeDay?'active':''}" data-day="${esc(x.id)}">${esc(x.label)}</button>`).join('')}</div><p class="help">Choose a rotation day, then enter the class and room you have during each period. You can leave any field blank.</p><div class="assignment-table"><div class="assignment-head"><span>Period</span><span>Class / Assignment</span><span>Room</span></div>${working.periods.map(p=>{const a=assignmentFrom(working,activeDay,p.id);return `<div class="assignment-row"><span>${esc(p.label)}</span><input data-period="${esc(p.id)}" data-assignment="title" value="${esc(a.title)}" placeholder="English"><input data-period="${esc(p.id)}" data-assignment="room" value="${esc(a.room)}" placeholder="Room 204"></div>`}).join('')}</div></section><section class="editor-section"><h3>School Calendar</h3><label>No-school dates <input id="no-school-date" type="date"></label><button type="button" class="secondary" id="add-no-school">Add No-School Date</button><div class="date-chips">${(working.rotation.noSchoolDates || []).map(d=>`<button type="button" class="date-chip" data-remove-date="${esc(d)}">${esc(d)} ×</button>`).join('') || '<span class="help">No dates marked.</span>'}</div></section><p class="form-error" id="form-error"></p><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button><button type="submit" class="primary">${mode==='demo' ? 'Apply Demo Changes' : targetID ? 'Save Schedule' : 'Save as New Schedule'}</button></footer></form>`); bindEditor(); };
  const syncInputs=()=>{const form=document.querySelector('#schedule-editor'); working.school.displayName=form.schoolName.value.trim(); working.profileName=form.profileName.value.trim(); working.school.timeZone=form.timeZone.value.trim(); working.rotation.seedDate=form.seedDate.value; working.rotation.seedDayId=form.seedDay.value; working.periods=[...document.querySelectorAll('.period-row')].map((row,i)=>({id:row.dataset.id || working.periods[Number(row.dataset.index)]?.id || `period-${Date.now()}-${i}`,label:row.querySelector('[data-key="label"]').value.trim(),start:row.querySelector('[data-key="start"]').value,end:row.querySelector('[data-key="end"]').value,kind:row.querySelector('[data-key="kind"]').value})); document.querySelectorAll('[data-assignment]').forEach(input=>{const day=input.closest('.assignment-table').dataset.day || activeDay; working.assignments[day] ||= {}; working.assignments[day][input.dataset.period] ||= {}; working.assignments[day][input.dataset.period][input.dataset.assignment]=input.value;}); };
  const bindEditor=()=>{const form=document.querySelector('#schedule-editor'); document.querySelector('#close').onclick=closeModal; document.querySelector('#cancel').onclick=closeModal; document.querySelector('#add-period').onclick=()=>{syncInputs(); const used=new Set(working.periods.map(x=>x.id)); working.periods.push({id:uniqueId('period',used),label:`Period ${working.periods.length+1}`,start:'08:00',end:'08:50',kind:'academic'}); working.rotation.labels.forEach(d=>{working.assignments[d.id] ||= {}; working.assignments[d.id][working.periods.at(-1).id]={title:'',room:''};}); renderEditor();}; document.querySelectorAll('.remove-period').forEach(b=>b.onclick=()=>{syncInputs(); const index=Number(b.closest('.period-row').dataset.index), removed=working.periods[index]; if(working.periods.length===1){showEditorError('At least one period is required.');return;} if(!confirm(`Delete ${removed.label}? Its personal classes will also be removed.`))return; working.periods.splice(index,1); Object.values(working.assignments).forEach(rows=>delete rows[removed.id]); renderEditor();}); document.querySelectorAll('.up,.down').forEach(b=>b.onclick=()=>{syncInputs();const index=Number(b.closest('.period-row').dataset.index), next=b.classList.contains('up')?index-1:index+1;if(next<0||next>=working.periods.length)return;[working.periods[index],working.periods[next]]=[working.periods[next],working.periods[index]];renderEditor();}); document.querySelectorAll('.day-tab').forEach(b=>b.onclick=()=>{syncInputs();activeDay=b.dataset.day;renderEditor()}); document.querySelector('#add-no-school').onclick=()=>{syncInputs();const value=document.querySelector('#no-school-date').value;if(value&&!working.rotation.noSchoolDates.includes(value)){working.rotation.noSchoolDates.push(value);renderEditor();}}; document.querySelectorAll('[data-remove-date]').forEach(b=>b.onclick=()=>{syncInputs();working.rotation.noSchoolDates=working.rotation.noSchoolDates.filter(x=>x!==b.dataset.removeDate);renderEditor()}); const applyRotation=(kind, custom)=>{syncInputs();const old=working.rotation.labels;working.rotation.kind=kind;working.rotation.labels=labelsFor(kind,custom || (kind==='custom'?'Day 1, Day 2':''));if(!working.rotation.labels.length){working.rotation.labels=old;showEditorError('Enter at least one custom rotation day.');return;}working.rotation.labels.forEach((d,i)=>{working.assignments[d.id] ||= clone(working.assignments[old[i]?.id] || {});});working.assignments=Object.fromEntries(working.rotation.labels.map(d=>[d.id,working.assignments[d.id] || {}]));working.rotation.seedDayId=working.rotation.labels[0]?.id;activeDay=working.rotation.labels[0].id;renderEditor()}; form.rotationKind.onchange=()=>applyRotation(form.rotationKind.value, form.customLabels?.value); document.querySelector('#apply-custom')?.addEventListener('click',()=>applyRotation('custom', form.customLabels.value)); form.onsubmit=e=>{e.preventDefault();syncInputs();try{working.templates={regular:working.periods.map(({id,label,start,end,kind})=>({id,label,start,end,kind}))}; validate(working); saveEditor(working,targetID,mode);}catch(error){showEditorError(error.message)}}; };
  renderEditor();
}
function assignmentFrom(value,day,period){return value.assignments?.[day]?.[period] || value.assignments?.every?.[period] || {title:'',room:''};}
function showEditorError(message){const node=document.querySelector('#form-error');if(node)node.textContent=message;}
function openSettings(){const prefs=clone(config.preferences);modal(`<header class="modal-head"><div><h2>Display Settings</h2><p>These preferences affect only this browser Display.</p></div><button class="icon-button" id="close" aria-label="Close dialog">×</button></header><form id="settings-form"><section class="editor-section"><div class="form-grid"><label>Accent color<select name="accent">${['mint','blue','purple','pink','orange','red'].map(x=>option(x,prefs.accent,x[0].toUpperCase()+x.slice(1))).join('')}</select></label><label>Clock<select name="clock">${option('12',prefs.hour24?'24':'12','12-hour')}${option('24',prefs.hour24?'24':'12','24-hour')}</select></label><label>Display size<select name="size">${['compact','standard','large'].map(x=>option(x,prefs.displaySize,x[0].toUpperCase()+x.slice(1))).join('')}</select></label></div><label>Schedule-row labels<select name="scheduleLabels">${option('blocks',prefs.scheduleLabels,'Block names')}${option('periods',prefs.scheduleLabels,'Period numbers')}${option('hidden',prefs.scheduleLabels,'Hide labels')}</select></label><label class="check"><input name="schoolDayProgress" type="checkbox" ${prefs.schoolDayProgress?'checked':''}> School Day Progress</label><label class="check"><input name="schoolYearProgress" type="checkbox" ${prefs.schoolYearProgress?'checked':''}> School Year Progress</label><label class="check"><input name="rooms" type="checkbox" ${prefs.showRooms?'checked':''}> Show rooms</label><label class="check"><input name="schedule" type="checkbox" ${prefs.showSchedule?'checked':''}> Show Today’s Schedule</label><label class="check"><input name="school" type="checkbox" ${prefs.showSchoolName?'checked':''}> Show school name</label></section><footer class="modal-footer"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">Save Settings</button></footer></form>`);document.querySelector('#close').onclick=closeModal;document.querySelector('#cancel').onclick=closeModal;document.querySelector('#settings-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;try{const next=clone(config);next.preferences=defaultPreferences({accent:f.accent.value,hour24:f.clock.value==='24',displaySize:f.size.value,scheduleLabels:f.scheduleLabels.value,showRooms:f.rooms.checked,showSchedule:f.schedule.checked,showSchoolName:f.school.checked,schoolDayProgress:f.schoolDayProgress?.checked ?? false,schoolYearProgress:f.schoolYearProgress?.checked ?? false});if(isDemo){config=normalize(next);closeModal();render();}else{save(next)}}catch(error){alert(error.message||'BellSync Display could not save these settings.')}}}
function exportAll(){try{downloadBackup(exportProfiles(requireStore().snapshot),'bellsync-all-schedules.bellsyncdisplay')}catch(error){alert(error.message)}}
function downloadBackup(payload,filename){const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href)}
function exportDisplay(){try{const payload={format:WEB_FORMAT,formatVersion:1,exportedAt:new Date().toISOString(),configuration:config};downloadBackup(payload,`${slug(config.profileName,'bellsync-display')}.bellsyncdisplay`)}catch(e){alert(`Could not export this Display schedule: ${e.message}`)}}
render();
const schoolLink=globalThis.location?.search ? schoolLinkSelection(globalThis.location.search) : null;
if(schoolLink) {if(schoolLink.profile) startDoyleSetup(schoolLink.profile);else chooseDoyleProfile();}
else if(store?.snapshot.activeProfileID === DEMO_ID) loadDemo();
else if(store?.snapshot.savedProfiles.length && !config) openChange();
