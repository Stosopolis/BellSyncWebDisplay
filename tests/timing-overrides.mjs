import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize,timelineFor,zonedTimestamp } from '../display-core.mjs';
import { timingCatalog,setTimingOverrides } from '../timing-overrides.mjs';
import { doyleConfiguration,doyleSchedulePreview,builtInConfiguration } from '../school-setup.mjs';
import { scheduleSnapshot } from '../schedule-presentation.mjs';
import { ProfileStore,exportProfiles,importDisplayProfiles } from '../profile-store.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const c=doyleConfiguration(read('../public/builtins/doyle/prek-a.json'),'A'),key='2026-10-07',at=t=>zonedTimestamp(key,t,c.school.timeZone);
const source=timingCatalog(c).find(e=>e.type==='template' && e.templateID==='wednesday' && e.label==='Arrival / Morning Work');
const descriptor=({type,templateID,id})=>({type,templateID,id});
let passed=0;function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}
test('no overrides preserve authoritative source timing',()=>assert.equal(timelineFor(c,key).events.find(e=>e.periodID==='activity-2').startAt,at('08:40')));
test('partial and full overrides drive Current, Next, countdown and state boundaries',()=>{
 const edited=setTimingOverrides(c,[{...descriptor(source),start:'08:45',end:'09:05'}]);
 assert.equal(scheduleSnapshot(edited,at('08:42')).state,'gap');assert.equal(scheduleSnapshot(edited,at('08:42')).next.title,'Arrival / Morning Work');
 assert.equal(scheduleSnapshot(edited,at('08:46')).current.startAt,at('08:45'));assert.equal(scheduleSnapshot(edited,at('08:46')).countdownTarget,at('09:05'));
 const partial=setTimingOverrides(c,[{...descriptor(source),start:'08:45'}]);assert.equal(timelineFor(partial,key).events.find(e=>e.periodID==='activity-2').endAt,at('09:00'));
 const first=timingCatalog(c).find(e=>e.templateID==='wednesday' && e.sources[0].start==='08:00');assert.equal(scheduleSnapshot(setTimingOverrides(c,[{...descriptor(first),start:'08:10'}]),at('08:05')).state,'beforeSchool');
 const last=timingCatalog(c).find(e=>e.templateID==='wednesday' && e.sources[0].end==='14:20');assert.equal(scheduleSnapshot(setTimingOverrides(c,[{...descriptor(last),end:'14:18'}]),at('14:18')).state,'complete');
});
test('point time override remains a reminder and does not split classroom activity',()=>{
 const edited=setTimingOverrides(c,[{type:'point',id:'bathroom-0920',time:'09:25'}]),t=timelineFor(edited,key);
 assert.equal(t.points.find(p=>p.id==='bathroom-0920').at,at('09:25'));assert.deepEqual(t.events,timelineFor(c,key).events);assert.equal(scheduleSnapshot(edited,at('09:25')).current.title,'Morning Meeting / Circle');
});
test('invalid timing, unknown keys and duplicate edits reject before storage',()=>{
 for(const edit of [{start:'09:00'},{end:'08:40'},{start:'25:00'},{end:'08:30'},{time:'09:00'}])assert.throws(()=>normalize({...c,timingOverrides:[{...descriptor(source),...edit}]}));
 assert.throws(()=>normalize({...c,timingOverrides:[{type:'point',id:'missing',time:'09:00'}]}));assert.throws(()=>normalize({...c,timingOverrides:[{...descriptor(source),start:'08:45'},{...descriptor(source),end:'09:05'}]}));
});
test('overrides reload, backup/restore and remain profile isolated without touching the snapshot',()=>{
 const original=structuredClone(c),map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},store=new ProfileStore(storage);
 const edited=setTimingOverrides(c,[{...descriptor(source),start:'08:45'}]);store.add([edited,c]);const reload=new ProfileStore(storage),restored=importDisplayProfiles(exportProfiles(reload.snapshot));
 assert.deepEqual(restored,[edited,c]);assert.deepEqual(edited.portable.shared,original.portable.shared);assert.deepEqual(c,original);
});
test('reset removes only timing overrides while names and rooms remain',()=>{
 const withNames=structuredClone(c);withNames.portable.edits=[{type:'period',id:'activity-2',title:'My Arrival',room:'Blue'}];
 const edited=setTimingOverrides(withNames,[{...descriptor(source),start:'08:45'}]);const reset=setTimingOverrides(edited,[{...descriptor(source),start:'',end:''}]);
 assert.deepEqual(reset,withNames);assert.equal(timelineFor(edited,key).events.find(e=>e.periodID==='activity-2').title,'My Arrival');assert.equal(timelineFor(edited,key).events.find(e=>e.periodID==='activity-2').room,'Blue');
});
test('normal-day profile preview uses effective source timing',()=>{
 const first=timingCatalog(c).find(e=>e.templateID==='wednesday');const edited=setTimingOverrides(c,[{...descriptor(first),start:'08:10'}]);
 assert.equal(new Date(doyleSchedulePreview(edited)[0].startAt).toISOString().slice(11,16),'12:10');
});
test('WMHS and Galvin source-managed profiles support validated local timing without changing bells',()=>{
 for(const school of ['wmhs','gms']) {
  const value=builtInConfiguration(school,read(`../public/builtins/${school}/schedule.json`),read(`../public/builtins/${school}/calendar.json`),6),first=timingCatalog(value).find(e=>e.templateID==='regular');
  const edited=normalize(setTimingOverrides(value,[{...descriptor(first),start:'07:20'}]));assert.deepEqual(edited.templates,value.templates);
  const key=Object.entries(value.calendar.days).find(([,day])=>day.schedule==='regular')[0];assert.equal(timelineFor(edited,key).events[0].startAt,zonedTimestamp(key,'07:20',value.school.timeZone));
 }
});
console.log(`\n${passed} timing override tests passed.`);
