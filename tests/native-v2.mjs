import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../display-core.mjs';
import * as profiles from '../profile-store.mjs';
import {parseNativeV2} from '../native-v2.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const v2=read('./fixtures/native-v2.json'),v1=read('./fixtures/native-bundle-v1.json').schedules[0];
const school=read('../public/builtins/wmhs/schedule.json'),calendar=read('../public/builtins/wmhs/calendar.json');
const copy=v=>structuredClone(v);
const imported=raw=>profiles.nativeConfigurations(profiles.inspectNativeImport(raw),school,calendar);
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
let passed=0;function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}

test('explicit v1 and v2 adapters preserve native assignments and source type',()=>{
  const original=copy(v2),[old]=imported(v1),[current]=imported(v2);
  assert.deepEqual(old.assignments,v1.assignments);assert.deepEqual(current.assignments,v2.assignments);
  assert.equal(current.profileName,v2.scheduleName);assert.equal(current.school.id,'wmhs');assert.ok(core.isManagedWMHS(current));
  assert.equal(current.nativeMetadata.formatVersion,2);assert.deepEqual(current.nativeMetadata.sharedSchedule,v2);
  for(const [day,lunch] of [['1','L1'],['2','L2'],['3','L3'],['4','NO_LUNCH'],['5',undefined]])assert.equal(current.assignments[day]['4'].lunch,lunch);
  assert.deepEqual(v2,original);assert.deepEqual(current.templates,school.bells);assert.deepEqual(current.calendar,calendar);
});
test('v2 activity overrides apply only at exact day/template/item/period addresses',()=>{
  const [c]=imported(v2),e=core.timelineFor(c,'2026-09-01').events.find(e=>e.periodID==='1');
  assert.equal(e.title,'Honors English');assert.equal(e.originalTitle,'Class A');assert.equal(e.room,'Room 11');assert.equal(e.blockID,'A');
  assert.deepEqual(c.nativeMetadata.activityNameOverrides,v2.activityNameOverrides);
  const another=Object.keys(calendar.days).find(d=>calendar.days[d].day===2 && calendar.days[d].schedule==='regular');
  assert.notEqual(core.timelineFor(c,another).events.find(e=>e.periodID==='1').title,'Honors English');
  const edit=core.editManagedAssignments(c,c.profileName,[{day:'1',period:'1',title:'Local name',room:'Local room'}]);
  assert.equal(core.timelineFor(edit,'2026-09-01').events.find(e=>e.periodID==='1').title,'Local name');
  assert.equal(c.nativeMetadata.activityNameOverrides.length,1);
});
test('v2 lunch and FLEX name overrides keep timing, identities and lunch numbers',()=>{
  const raw=copy(v2);raw.assignments['1']['4'].lunch='L2';raw.activityNameOverrides=[{source:{schoolID:'wmhs',layer:'wmhs',dayID:'1',templateID:'regular',itemID:'4-L2',periodID:'lunch-L2'},title:'Lunch Duty'}];
  const [c]=imported(raw),lunch=core.timelineFor(c,'2026-09-01').events.find(e=>e.kind==='lunch');
  assert.equal(lunch.title,'Lunch Duty');assert.equal(lunch.label,'Lunch 2');assert.equal(lunch.lunch.selection,'L2');
  raw.activityNameOverrides=[{source:{schoolID:'wmhs',layer:'wmhs',dayID:'2',templateID:'flex',itemID:'flex',periodID:'flex'},title:'Mentoring'}];
  const date=Object.keys(calendar.days).find(d=>calendar.days[d].day===2 && calendar.days[d].schedule==='flex');
  assert.equal(core.timelineFor(imported(raw)[0],date).events.find(e=>e.periodID==='flex').title,'Mentoring');
});
test('mixed v1/v2 bundle imports independent profiles and survives reload/export',()=>{
  const storage=memory();let n=0;const store=new profiles.ProfileStore(storage,()=>`profile-${++n}`);
  const configs=imported({bundleFormatVersion:1,createdAt:812000000,schedules:[v1,v2]}),ids=store.add(configs,{activate:false});
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);store.select(ids[1]);
  const restart=new profiles.ProfileStore(storage);assert.deepEqual(restart.activeConfiguration,configs[1]);
  assert.deepEqual(profiles.importDisplayProfiles(profiles.exportProfiles(restart.snapshot)),configs);
  store.replace(ids[1],core.editManagedAssignments(configs[1],'Edited',[{day:'1',period:'4',lunch:'NO_LUNCH'}]));
  assert.deepEqual(store.snapshot.savedProfiles[0].configuration,configs[0]);
});
test('malformed v2 entries reject atomically without touching profiles',()=>{
  const storage=memory(),store=new profiles.ProfileStore(storage,()=> 'existing');store.add(imported(v1));const before=storage.getItem(profiles.PROFILE_KEY);
  for(const mutate of [r=>r.assignments['1']['1'].block={},r=>delete r.assignments['1']['1'].title,r=>r.assignments['1']['4'].lunch='L9',r=>r.assignments['99']={},r=>r.assignments['1']['unknown']={},r=>r.schoolProfileID='bad id',r=>delete r.scheduleName,r=>r.scheduleName='',r=>delete r.createdAt,r=>delete r.schoolContentVersion,r=>r.activityNameOverrides[0].source.schoolID='gms',r=>r.activityNameOverrides[0].source.itemID='bad id',r=>r.activityNameOverrides.push(copy(r.activityNameOverrides[0])),r=>r.schoolDefinitionSnapshot={id:'gms'},r=>r.personalActivities=[{id:'bad'}]]) {
    const raw=copy(v2);mutate(raw);assert.throws(()=>store.add(imported({bundleFormatVersion:1,schedules:[v1,raw]})));assert.equal(storage.getItem(profiles.PROFILE_KEY),before);
  }
});
test('unknown future versions produce a clear unsupported-version result',()=>{
  const future={...copy(v2),formatVersion:3},plan=profiles.inspectNativeImport(future);
  assert.equal(plan.supported.length,0);assert.match(plan.unsupported[0].reason,/Schedule version 3 is not supported/);
  assert.throws(()=>parseNativeV2(future),/version 2/);
});
test('display-only native additions are preserved and reported without rejecting v2',()=>{
  const raw=copy(v2);raw.date='2026-10-01T12:00:00Z';raw.personalActivities=[];
  raw.personalBlockColors=[{identity:{wmhsBlock:{schoolID:'wmhs',blockID:'A'}},color:'mint'}];
  raw.activityNameOverrides.push({source:{schoolID:'wmhs',layer:'personal',dayID:'1',templateID:'regular',itemID:'unused',periodID:'unused'},title:'Private note'});
  const plan=profiles.inspectNativeImport(raw);assert.equal(plan.supported.length,1);assert.equal(plan.supported[0].warnings.length,2);
  const [c]=profiles.nativeConfigurations(plan,school,calendar);assert.deepEqual(c.nativeMetadata.sharedSchedule,raw);
  assert.equal(core.timelineFor(c,'2026-09-01').events.find(e=>e.periodID==='1').title,'Honors English');
});
test('unsupported timing layers are clearly excluded rather than replaced with invented timing',()=>{
  const raw=copy(v2);raw.personalActivities=[{id:'private',title:'Duty',room:'Office',start:'07:00',end:'07:20',weekdays:[2],dayIDs:['1']}];
  let plan=profiles.inspectNativeImport(raw);assert.equal(plan.supported.length,0);assert.match(plan.unsupported[0].reason,/Personal Activities change/);
  delete raw.personalActivities;raw.schoolDefinitionSnapshot={schemaVersion:1,id:'wmhs',cycle:{dayIDs:['1']},periodDefinitions:[],scheduleTemplates:[],calendarRule:{},calendarExceptions:{}};
  plan=profiles.inspectNativeImport(raw);assert.equal(plan.supported.length,0);assert.match(plan.unsupported[0].reason,/snapshot/);
});
test('explicit v2 school-wide mode uses published source data plus native profile overlays',()=>{
  const raw=copy(v2);raw.usesSchoolSchedule=true;raw.assignments={'1':{'1':{block:'A',title:'Local A',room:'201',lunch:'NO_LUNCH'}}};
  const [c]=imported(raw);assert.equal(c.assignments['1']['1'].title,'Local A');
  assert.deepEqual(c.assignments['2'],school.assignments['2']);assert.deepEqual(c.nativeMetadata.sharedSchedule.assignments,raw.assignments);
});
console.log(`\n${passed} native v2 tests passed.`);
