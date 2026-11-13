import { validDate, dateInZone, timelineFor } from '../display-core.mjs';
export const CLASSROOM_KEY='bellsync.webDisplay.agenda.v1';
export const AGENDA_DURATIONS=['5','10','15','class','manual'];
const copy=v=>JSON.parse(JSON.stringify(v));
const fail=message=>{throw Error(message);};
const text=(v,max)=>typeof v==='string' && v.length<=max;
const object=v=>v && typeof v==='object' && !Array.isArray(v);
// Only resolved instructional duration events are eligible.
// Other activity kinds need reviewed metadata or an explicit teacher choice.
export function isAgendaClass(event) {
  return Boolean(
    event &&
    event.kind === 'academic' &&
    event.periodID !== 'break' &&
    !/^(?:break|advisory|flex|support)$/i.test(event.sourcePeriodLabel || '') &&
    // Galvin's calendar can put FLEX or WIN inside a nominal academic slot.
    !(event.sourceTitle && /^(?:FLEX|WIN(?: · .+)?)$/.test(event.title)) &&
    !event.contextual &&
    !event.owner &&
    Number.isFinite(event.startAt) &&
    Number.isFinite(event.endAt) &&
    event.startAt < event.endAt
  );
}
// Native source identity survives title/room/time overrides and split segments.
export function activityIdentity(event) {
 if(!isAgendaClass(event))return null;
 const source=event.activitySource;
 return source?JSON.stringify(['source',...['schoolID','layer','dayID','templateID','itemID','periodID'].map(k=>source[k] ?? '')]):JSON.stringify(['period',event.periodID || event.id]);
}
export function segmentIdentity(event) {return event.id.replace(/::primary:\d+$/, '');}
export function classChoices(snapshot) {
 const choices=[];
 for(const event of snapshot.events.filter(isAgendaClass)) {
  const id=activityIdentity(event),existing=choices.find(c=>c.id===id);
  if(existing)existing.events.push(event);else choices.push({id,event,events:[event]});
 }
 return choices;
}
export function liveClass(snapshot,now) {
 return snapshot.state==='active' && snapshot.key===dateInZone(now,snapshot.timeZone) && isAgendaClass(snapshot.current) && now>=snapshot.current.startAt && now<snapshot.current.endAt?snapshot.current:null;
}
export function agendaIsVisible(presentation,snapshot,now) {
 const event=liveClass(snapshot,now);
 if(!presentation || !event || (presentation.segmentID && presentation.segmentID!==segmentIdentity(event)) || presentation.date!==snapshot.key || presentation.activityID!==activityIdentity(event))return false;
 if(presentation.duration==='manual')return true;
 if(presentation.duration==='class')return now<event.endAt;
 return now<Math.min(event.endAt,presentation.shownAt+Number(presentation.duration)*60000);
}
export function effectiveTimerBell(timer,config) {
 if(!timer?.bellLinked)return null;
 const events=timelineFor(config,timer.date).events.filter(e=>activityIdentity(e)===timer.activityID);
 return (events.find(e=>e.id===timer.segmentID) || events.sort((a,b)=>Math.abs(a.endAt-timer.endAt)-Math.abs(b.endAt-timer.endAt))[0])?.endAt ?? null;
}
export function timerView(timer,now,effectiveBell=null) {
 if(!timer)return null;
 const endAt=timer.status==='running' && timer.bellLinked && Number.isFinite(effectiveBell)?effectiveBell:timer.endAt;
 const remainingMs=timer.status==='paused'?timer.remainingMs:timer.status==='finished'?0:Math.max(0,endAt-now);
 return {...timer,endAt,remainingMs,status:timer.status==='finished' || (timer.status==='running' && remainingMs===0)?'complete':timer.status};
}
export function overrunMs(endAt,bellAt){return Number.isFinite(bellAt)?Math.max(0,endAt-bellAt):0;}
export function validItemDuration(value){return Number.isInteger(value) && value>=1000 && value<=86400000;}
function validateAgenda(a) {
 if(!object(a) || !validDate(a.date) || !text(a.activityID,2000) || !a.activityID || !text(a.title,200) || !text(a.instructions,2000) || !Array.isArray(a.items) || a.items.length>50 || a.items.some(item=>!text(item,500) || !item.trim()))fail('Use a valid date, title, instructions and up to 50 short agenda items.');
 if(a.itemDurationsMs!==undefined && (!Array.isArray(a.itemDurationsMs) || a.itemDurationsMs.length!==a.items.length || a.itemDurationsMs.some(d=>d!==null && !validItemDuration(d))))fail('Use optional item durations between one second and 24 hours.');
}
function validateTimer(timer) {
 if(timer===null)return;
 if(!object(timer) || !['running','paused','finished'].includes(timer.status) || !text(timer.name,200) || !validDate(timer.date) || !text(timer.activityID,2000) || !text(timer.segmentID,2000) || typeof timer.bellLinked!=='boolean' || !Number.isFinite(timer.endAt) || !Number.isFinite(timer.remainingMs) || timer.remainingMs<0 || !Number.isFinite(timer.durationMs) || timer.durationMs<=0 || timer.durationMs>86400000)fail('Invalid saved classroom timer. Existing data was kept.');
}
function validateAgendaRun(run) {
 if(run===undefined || run===null)return;
 if(!object(run) || !text(run.id,128) || !run.id || !validDate(run.date) || !text(run.activityID,2000) || !run.activityID || !text(run.segmentID,2000) || !['running','paused','recover','complete','stopped'].includes(run.status) || !Array.isArray(run.items) || !run.items.length || run.items.length>50 || run.items.some(i=>!object(i) || !text(i.title,500) || !i.title.trim() || !(validItemDuration(i.durationMs) || (i.excluded===true && i.durationMs===null))) || !Number.isInteger(run.index) || run.index<0 || run.index>=run.items.length || !Number.isFinite(run.bellAt) || !Number.isFinite(run.lastCheckedAt) || !Number.isFinite(run.lastTransitionAt))fail('Invalid saved agenda run. Existing data was kept.');
 if(run.items.some((item,i)=>i>=run.index && !validItemDuration(item.durationMs)))fail('Invalid upcoming agenda duration.');
 for(const list of [run.completed,run.skipped])if(!Array.isArray(list) || new Set(list).size!==list.length || list.some(i=>!Number.isInteger(i) || i<0 || i>=run.items.length))fail('Invalid saved agenda progress.');
 if(run.completed.some(i=>run.skipped.includes(i)))fail('Invalid overlapping agenda progress.');
 if(run.scheduleID!==undefined && !text(run.scheduleID,2000))fail('Invalid saved agenda schedule identity.');
 if(run.reason!==undefined && !text(run.reason,300))fail('Invalid agenda recovery reason.');
}
function validateStore(value) {
 if(!object(value) || value.version!==1 || !Array.isArray(value.profiles) || value.profiles.length>200)fail('Unsupported classroom storage. Existing data was kept.');
 const seen=new Set();
 for(const p of value.profiles) {
  if(!object(p) || !text(p.id,128) || !p.id || seen.has(p.id) || !['balanced','focus'].includes(p.layout) || !Array.isArray(p.agendas) || p.agendas.length>3650)fail('Invalid classroom profile. Existing data was kept.');seen.add(p.id);
  if(p.scheduleView!==undefined && !['full','remaining'].includes(p.scheduleView))fail('Invalid classroom schedule view.');
  const keys=new Set();for(const a of p.agendas){validateAgenda(a);const k=JSON.stringify([a.date,a.activityID]);if(keys.has(k))fail('Duplicate saved agenda.');keys.add(k);}
  validateTimer(p.timer);validateAgendaRun(p.agendaRun);if(p.transitionSound!==undefined && typeof p.transitionSound!=='boolean')fail('Invalid transition sound preference.');
  if(p.presentation!==null){const a=p.presentation;if(!object(a) || !validDate(a.date) || !text(a.activityID,2000) || !AGENDA_DURATIONS.includes(a.duration) || !Number.isFinite(a.shownAt) || (a.segmentID!==undefined && !text(a.segmentID,2000)))fail('Invalid agenda presentation.');}
 }
 return value;
}
export class ClassroomStore {
 constructor(storage) {
  this.storage=storage;this.raw=storage.getItem(CLASSROOM_KEY);
  this.value=this.raw===null?{version:1,profiles:[]}:validateStore(JSON.parse(this.raw));
 }
 get snapshot(){return copy(this.value);}
 profile(id){return copy({scheduleView:'full',...(this.value.profiles.find(p=>p.id===id) || {id,layout:'focus',agendas:[],timer:null,presentation:null})});}
 runState(id) {
  const {agendaRun=null,timer=null}=this.value.profiles.find(profile=>profile.id===id) || {};
  return copy({agendaRun,timer});
 }
 changeAll(update) {
  if(this.storage.getItem(CLASSROOM_KEY)!==this.raw)fail('Classroom data changed in another tab. Reload before saving.');
  const next=this.snapshot;update(next);validateStore(next);
  const raw=JSON.stringify(next);this.storage.setItem(CLASSROOM_KEY,raw);this.raw=raw;this.value=next;
 }
 change(id,update) {
  this.changeAll(next=>{let profile=next.profiles.find(p=>p.id===id);
   if(!profile){profile=this.profile(id);next.profiles.push(profile);}update(profile);
  });
 }

 scheduleView(id,view){if(!['full','remaining'].includes(view))fail('Choose Full Day or Remaining.');this.change(id,p=>{p.scheduleView=view;});}
 agenda(id,date,activityID){
  const saved=this.value.profiles.find(profile=>profile.id===id)?.agendas.find(a=>a.date===date && a.activityID===activityID);
  return saved?copy(saved):{date,activityID,title:'',instructions:'',items:[]};
 }
 saveAgenda(id,agenda){validateAgenda(agenda);this.change(id,p=>{if(p.agendaRun?.date===agenda.date && p.agendaRun?.activityID===agenda.activityID){if(['running','paused','recover'].includes(p.agendaRun.status))fail('Stop Agenda before editing its activities.');p.agendaRun=null;}p.agendas=p.agendas.filter(a=>a.date!==agenda.date || a.activityID!==agenda.activityID);p.agendas.push(copy(agenda));});}
 clearAgenda(id,date,activityID){this.change(id,p=>{if(p.agendaRun?.date===date && p.agendaRun?.activityID===activityID){if(['running','paused','recover'].includes(p.agendaRun.status))fail('Stop Agenda before clearing its activities.');p.agendaRun=null;}p.agendas=p.agendas.filter(a=>a.date!==date || a.activityID!==activityID);if(p.presentation?.date===date && p.presentation?.activityID===activityID)p.presentation=null;});}
 showAgenda(id,date,activityID,duration,now,segmentID){if(!AGENDA_DURATIONS.includes(duration))fail('Choose an agenda duration.');this.change(id,p=>{p.presentation={date,activityID,duration,shownAt:now,...(segmentID?{segmentID}:{})};});}
 dismissAgenda(id){this.change(id,p=>{p.presentation=null;});}
 layout(id,layout){this.change(id,p=>{p.layout=layout;});}
 start(id,{name,durationMs,snapshot,now,bellLinked=false,allowOverrun=false}) {
  const event=liveClass(snapshot,now);if(!event)fail('Start an activity only while viewing a current live class.');
  const endAt=bellLinked?event.endAt:now+durationMs;
  if(!Number.isFinite(durationMs) || durationMs<=0 || durationMs>86400000 || endAt<=now)fail('Choose a duration between one second and 24 hours.');
  if(overrunMs(endAt,event.endAt)>0 && !allowOverrun)fail('This activity exceeds the remaining class time. Choose Continue Anyway or End at Class Bell.');
  this.change(id,p=>{p.timer={name,status:'running',date:snapshot.key,activityID:activityIdentity(event),segmentID:event.id,endAt,remainingMs:endAt-now,durationMs:endAt-now,bellLinked};});
 }
 pause(id,now,bell=null){this.change(id,p=>{const v=timerView(p.timer,now,bell);if(v?.status!=='running')fail('There is no running activity to pause.');p.timer={...p.timer,status:'paused',remainingMs:v.remainingMs,endAt:v.endAt};});}
 resume(id,snapshot,now,allowOverrun=false){
  const event=liveClass(snapshot,now),timer=this.profile(id).timer;
  if(!event || timer?.status!=='paused')fail('Resume only on the current live date and class.');
  const endAt=timer.bellLinked?event.endAt:now+timer.remainingMs;
  if(endAt<=now || (overrunMs(endAt,event.endAt)>0 && !allowOverrun))fail('The resumed activity exceeds class time. Choose Continue Anyway or End at Class Bell.');
  this.change(id,p=>{p.timer={...timer,status:'running',endAt,activityID:activityIdentity(event),segmentID:event.id,date:snapshot.key,remainingMs:endAt-now};});
 }
 add(id,minutes,now,bell=null,allowOverrun=false){
  if(![-5,-1,1,5].includes(minutes))fail('Adjust the activity by one or five minutes.');
  const v=timerView(this.profile(id).timer,now,bell);if(!v || !['running','paused'].includes(v.status))fail('Start or resume an activity first.');
  const remainingMs=v.remainingMs+minutes*60000;
  if(remainingMs<=0)fail('Keep some time remaining, or choose Finish Current & Next.');
  if(remainingMs>86400000)fail('An activity can have up to 24 hours remaining.');
  const endAt=now+remainingMs;
  if(minutes>0 && overrunMs(endAt,bell)>0 && !allowOverrun)fail('The extra time would extend past the official class bell.');
  this.change(id,p=>{p.timer={...p.timer,bellLinked:false,endAt,remainingMs};});
 }
 endAtBell(id,snapshot,now){const event=liveClass(snapshot,now);if(!event)fail('Choose a current live class.');this.change(id,p=>{if(!p.timer)fail('Start an activity first.');p.timer={...p.timer,bellLinked:true,endAt:event.endAt,remainingMs:event.endAt-now,activityID:activityIdentity(event),segmentID:event.id,date:snapshot.key};});}
 finish(id,now){this.change(id,p=>{if(p.timer)p.timer={...p.timer,status:'finished',endAt:now,remainingMs:0};});}
 reset(id){this.change(id,p=>{p.timer=null;});}
}
