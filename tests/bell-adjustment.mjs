import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalize,timelineFor,zonedTimestamp,schoolDay,schoolProgress,confirmedWorkdayBounds,formatClock} from '../display-core.mjs';
import {scheduleSnapshot,countdownFraction} from '../schedule-presentation.mjs';
import {timingCatalog,setTimingOverrides} from '../timing-overrides.mjs';
import {doyleConfiguration,schoolSchedulePreview,builtInConfiguration,snapshotConfiguration} from '../school-setup.mjs';
import {ProfileStore,exportProfiles,importDisplayProfiles} from '../profile-store.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const c=doyleConfiguration(read('../public/builtins/doyle/prek-a.json'),'A'),key='2026-10-07',at=t=>zonedTimestamp(key,t,c.school.timeZone);
const shifted=(seconds,base=c)=>normalize({...base,bellTimingAdjustmentSeconds:seconds});
const source=timelineFor(c,key);let passed=0;
function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}
test('zero gives exact existing timeline and presentation',()=>{
 assert.deepEqual(timelineFor(shifted(0),key),source);
 assert.deepEqual(scheduleSnapshot(shifted(0),at('09:00')),scheduleSnapshot(c,at('09:00')));
});
for(const seconds of [8,-8])test(`${seconds} shifts exact Current/Next, countdown and progress boundaries`,()=>{
 const adjusted=shifted(seconds),boundary=at('09:00')+seconds*1000;
 const before=scheduleSnapshot(adjusted,boundary-1),after=scheduleSnapshot(adjusted,boundary);
 assert.equal(before.current.title,'Arrival / Morning Work');assert.equal(after.current.title,'Morning Meeting / Circle');
 assert.equal(before.next.id,after.current.id);assert.equal(before.countdownTarget,boundary);
 const now=at('08:50')+seconds*1000;
 assert.equal(countdownFraction(scheduleSnapshot(adjusted,now),now),countdownFraction(scheduleSnapshot(c,at('08:50')),at('08:50')));
});
test('all events, lunch contexts, passing and points shift uniformly with unchanged visible times',()=>{
 const verify=(original,adjusted)=>{for(const field of ['startAt','endAt','at','workdayEndAt'])if(Number.isFinite(original[field])){assert.equal(adjusted[field],original[field]+8000);assert.equal(adjusted[`display${field[0].toUpperCase()}${field.slice(1)}`],original[field]);}for(const [k,v] of Object.entries(original))if(v && typeof v==='object')verify(v,adjusted[k]);};
 verify(source,timelineFor(shifted(8),key));
 const w=builtInConfiguration('wmhs',read('../public/builtins/wmhs/schedule.json'),read('../public/builtins/wmhs/calendar.json'));
 for(const rows of Object.values(w.assignments))for(const a of Object.values(rows)){a.title='Class';a.lunch='L2';}
 const date=Object.keys(w.calendar.days).find(k=>timelineFor(w,k).events.some(e=>e.kind==='lunch'));
 assert.ok(date);const original=timelineFor(w,date),adjusted=timelineFor(shifted(8,w),date);verify(original,adjusted);
 assert.ok(adjusted.events.some(e=>e.kind==='lunch'));assert.ok(adjusted.passing.length);
 const p=adjusted.passing[0];assert.equal(scheduleSnapshot(shifted(8,w),p.startAt).state,scheduleSnapshot(w,p.startAt-8000).state);
});
test('bathroom remains a point, shifts by eight seconds and does not split a class',()=>{
 const t=timelineFor(shifted(8),key),p=t.points.find(p=>p.id==='bathroom-0920');assert.equal(p.at,at('09:20')+8000);assert.equal(p.displayAt,at('09:20'));
 assert.equal(scheduleSnapshot(shifted(8),p.at).current.title,'Morning Meeting / Circle');assert.equal(t.events.length,source.events.length);
});
test('before-school and final completion follow adjusted bounds',()=>{
 for(const seconds of [8,-8]){const adjusted=shifted(seconds),start=source.events[0].startAt+seconds*1000,end=confirmedWorkdayBounds(adjusted,key).endAt;
 assert.equal(scheduleSnapshot(adjusted,start-1).state,'beforeSchool');assert.equal(scheduleSnapshot(adjusted,start).state,'active');assert.notEqual(scheduleSnapshot(adjusted,end-1).state,'complete');assert.equal(scheduleSnapshot(adjusted,end).state,'complete');}
});
test('school day/year progress uses adjusted bounds and hides at adjusted end',()=>{
 const enabled={...c,preferences:{...c.preferences,schoolDayProgress:true,schoolYearProgress:true}},adjusted=shifted(8,enabled),bounds=confirmedWorkdayBounds(enabled,key);
 for(const now of [bounds.startAt-1000,bounds.startAt+100000,bounds.endAt-1,bounds.endAt])assert.deepEqual(schoolProgress(adjusted,key,now+8000).day?.fraction,schoolProgress(enabled,key,now).day?.fraction);
 assert.equal(schoolProgress(adjusted,key,bounds.endAt+7999).year.completed+1,schoolProgress(adjusted,key,bounds.endAt+8000).year.completed);
});
test('activity overrides compose first and preview labels retain local schedule time',()=>{
 const item=timingCatalog(c).find(e=>e.templateID==='wednesday' && e.label==='Arrival / Morning Work');
 const base=setTimingOverrides(c,[{type:item.type,templateID:item.templateID,id:item.id,start:'08:45',end:'09:05'}]),adjusted=shifted(8,base),event=timelineFor(adjusted,key).events.find(e=>e.periodID==='activity-2');
 assert.equal(event.startAt,at('08:45')+8000);assert.equal(event.displayStartAt,at('08:45'));assert.equal(formatClock(event.displayStartAt,c.school.timeZone),formatClock(at('08:45'),c.school.timeZone));
 const preview=schoolSchedulePreview(adjusted,'wednesday',key);const point=preview.events.find(e=>e.kind==='point');assert.equal(point.startAt-point.displayStartAt,8000);
 assert.deepEqual(adjusted.portable.shared,c.portable.shared);
});
test('reload, backup and independent profile values; reset persists zero without duplication',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},store=new ProfileStore(storage);store.add([shifted(8),shifted(-8)]);
 const reload=new ProfileStore(storage);assert.deepEqual(importDisplayProfiles(exportProfiles(reload.snapshot)).map(c=>c.bellTimingAdjustmentSeconds),[8,-8]);
 reload.replace(reload.snapshot.savedProfiles[0].id,shifted(0));assert.deepEqual(new ProfileStore(storage).snapshot.savedProfiles.map(p=>p.configuration.bellTimingAdjustmentSeconds),[0,-8]);
});
test('calendar, rotation, closures and early-release selection remain unchanged',()=>{
 for(const date of ['2026-10-07','2026-10-10','2026-10-12','2026-11-25'])for(const seconds of [-30,30])assert.deepEqual(schoolDay(shifted(seconds),date),schoolDay(c,date));
});
test('invalid, fractional or out-of-range adjustments reject',()=>{
 for(const value of [-31,31,0.5,'8',null])assert.throws(()=>shifted(value));for(const value of [-30,0,30])assert.equal(shifted(value).bellTimingAdjustmentSeconds,value);
});
test('built-in snapshot schools default zero and never mutate source data',()=>{
 for(const [school,path,code] of [['doyle','doyle/prek-a.json','A'],['woodville','woodville/pkcj.json','PKCJ'],['ferryway','ferryway/ferryway.json','ferryway'],['walton','walton/kg.json','KG']]){
 const raw=read(`../public/builtins/${path}`),config=snapshotConfiguration({schoolProfileID:raw.schoolProfileID,label:raw.scheduleName},raw),before=structuredClone(config);assert.equal(config.bellTimingAdjustmentSeconds??0,0);timelineFor(shifted(8,config),key);assert.deepEqual(config,before);
 }
});
console.log(`\n${passed} bell adjustment tests passed.`);
