import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../display-core.mjs';
import * as profiles from '../profile-store.mjs';
import { scheduleSnapshot,formatCountdown,countdownFraction } from '../schedule-presentation.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const raw=read('./fixtures/canterbury-room2-v2.json'),nativeDays=read('./fixtures/canterbury-native-days.json');
const copy=v=>structuredClone(v),imported=r=>profiles.nativeConfigurations(profiles.inspectNativeImport(r))[0];
const config=imported(raw),at=(key,time)=>core.zonedTimestamp(key,time,config.school.timeZone);
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
let passed=0;function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}
test('native exported Room 2 snapshot imports with no built-in resources or source mutation',()=>{
  const original=copy(raw),plan=profiles.inspectNativeImport(raw);assert.equal(plan.supported.length,1);assert.equal(plan.unsupported.length,0);
  assert.equal(config.sourceKind,'bellsync-snapshot');assert.equal(config.profileName,raw.scheduleName);assert.equal(config.school.displayName,raw.schoolDefinitionSnapshot.displayName);assert.deepEqual(config.portable.shared,raw);assert.deepEqual(raw,original);
});
for(const day of nativeDays)test(`native primary/staff/point parity ${day.date}`,()=>{
  const timeline=core.timelineFor(config,day.date);
  const rows=events=>events.map(e=>({title:e.title,room:e.room,start:core.formatClock(e.startAt,config.school.timeZone,true),end:core.formatClock(e.endAt,config.school.timeZone,true)}));
  assert.deepEqual(rows(timeline.events),day.rows.map(({title,room,start,end})=>({title,room,start,end})));
  assert.deepEqual(rows(timeline.contextualStaff),day.staff.map(({title,room,start,end})=>({title,room,start,end})));
  assert.deepEqual(timeline.points.map(({at,...p})=>p),day.points);
});
test('all 32 dated Kidzfun mornings use exported templates; normal dates retain normal morning',()=>{
  const dates=Object.entries(raw.schoolDefinitionSnapshot.calendarExceptions).filter(([,d])=>d.templateID==='room-2-kidzfun').map(([key])=>key);assert.equal(dates.length,32);
  const expected=[['Kidzfun','09:30','10:00'],['Bathroom','10:00','10:15'],['Snack','10:15','10:30'],['Outdoor / Indoor Recess','10:30','10:55'],['Line Up / Transition to Bathroom','10:55','11:00'],['Bathroom Time','11:00','11:15'],['Circle Time','11:15','11:30']];
  for(const key of dates) {
    const rows=core.timelineFor(config,key).events.filter(e=>e.startAt>=at(key,'09:30') && e.endAt<=at(key,'11:30'));
    assert.deepEqual(rows.map(e=>[e.title,core.formatClock(e.startAt,config.school.timeZone,true),core.formatClock(e.endAt,config.school.timeZone,true)]),expected);
  }
  assert.ok(!core.timelineFor(config,'2026-09-10').events.some(e=>e.title==='Kidzfun'));
});
test('owner overlap has primary priority, while contextual staff never does; no name inference',()=>{
  const custom=copy(raw);custom.personalActivities[1].title='Not Christine';custom.schoolDefinitionSnapshot.periodDefinitions.find(p=>p.id==='donna-lunch').displayName='Ms. Christine Lunch';
  const c=imported(custom),lunch=scheduleSnapshot(c,at('2026-09-10','11:45'));assert.equal(lunch.current.title,'Not Christine');assert.equal(lunch.current.owner,true);
  const after=scheduleSnapshot(c,at('2026-09-10','12:15'));assert.equal(after.current.title,'Recess / Indoor Free Play');assert.equal(after.contextualStaff[0].title,'Ms. Christine Lunch');
  const prep=scheduleSnapshot(c,at('2026-09-10','13:15'));assert.equal(prep.current.title,'Ms. Christine Prep');
  assert.equal(scheduleSnapshot(c,at('2026-09-10','13:35')).current.title,'Rest');
});
test('missing and explicitly empty personal arrays have native-distinct ownership semantics',()=>{
  const fallback=copy(raw);delete fallback.personalActivities;assert.equal(scheduleSnapshot(imported(fallback),at('2026-09-10','11:45')).current.owner,true);
  fallback.personalActivities=[];assert.equal(scheduleSnapshot(imported(fallback),at('2026-09-10','11:45')).current.title,'Kids Lunch');
});
test('point events stay separate; departure bounds primary workday without duration rows',()=>{
  const key='2026-09-11',t=core.timelineFor(config,key);assert.ok(t.points.some(p=>p.id==='judy-arrives'));assert.ok(!t.events.some(e=>e.title==='Judy Arrives' || e.title==='Ms. Christine Leaves'));
  assert.ok(t.events.every(e=>e.startAt<e.endAt));assert.equal(t.workdayEndAt,at(key,'15:00'));assert.equal(scheduleSnapshot(config,at(key,'15:00')).state,'complete');
  assert.equal(scheduleSnapshot(config,at('2026-09-10','15:00')).state,'active');assert.equal(scheduleSnapshot(config,at('2026-09-10','15:30')).state,'complete');
});
test('gap, before-school, countdown and depleting ring reuse the presentation engine',()=>{
  const key='2026-09-10';assert.equal(scheduleSnapshot(config,at(key,'07:45')).state,'beforeSchool');
  const gap=scheduleSnapshot(config,at(key,'13:45'));assert.equal(gap.state,'gap');assert.equal(gap.next.title,'Bathroom');assert.equal(gap.countdownTarget,at(key,'13:50'));
  const start=scheduleSnapshot(config,at(key,'12:40')),middle=scheduleSnapshot(config,at(key,'12:50'));assert.ok(countdownFraction(start,at(key,'12:40'))>countdownFraction(middle,at(key,'12:50')));assert.equal(formatCountdown(4649000),'1:17:29');
});
test('weekend, closure, year bounds and unavailable dates never borrow a registry',()=>{
  assert.equal(core.timelineFor(config,'2026-09-12').status,'weekend');assert.equal(core.timelineFor(config,'2026-10-12').status,'no-school');assert.equal(core.timelineFor(config,'2027-06-07').events.length,0);
  const r=copy(raw);r.schoolDefinitionSnapshot.calendarExceptions['2026-09-10']={kind:'scheduleUnavailable',cycleDayID:'room-2',note:'Source timing unavailable'};
  assert.equal(core.timelineFor(imported(r),'2026-09-10').status,'unavailable');
});
test('unknown school ID and optional source metadata remain self-contained',()=>{
  const r=copy(raw);r.schoolProfileID='local.next-school';r.schoolDefinitionSnapshot.id=r.schoolProfileID;r.schoolDefinitionSnapshot.displayName='Future School';r.futureOptional={revision:'next',teacherID:'stable-owner'};r.schoolDefinitionSnapshot.futurePresentation={color:'mint'};
  const c=imported(r);assert.equal(c.school.id,'local.next-school');assert.deepEqual(c.portable.shared,r);assert.equal(scheduleSnapshot(c,at('2026-09-10','09:00')).current.title,'Centers');
});
test('snapshot wins even for a known WMHS/Galvin school ID',()=>{
  for(const id of ['wmhs','gms']) {const r=copy(raw);r.schoolProfileID=id;r.schoolDefinitionSnapshot.id=id;const c=imported(r);assert.equal(c.sourceKind,'bellsync-snapshot');assert.equal(core.timelineFor(c,'2026-09-10').events[0].title,'Prep, Plan & Setup Classroom');assert.equal(c.school.displayName,raw.schoolDefinitionSnapshot.displayName);}
});
test('revisions and suppressed classroom dates resolve from the frozen snapshot',()=>{
  const r=copy(raw),d=r.schoolDefinitionSnapshot,t=d.scheduleTemplates[0];const rows=copy(t.periods);rows[0].start='08:35';t.periodsByEffectiveDate={'2026-09-10':rows};d.activityLayers.suppressedClassroomDates.centers=['2026-09-11'];const c=imported(r);
  assert.equal(core.timelineFor(c,'2026-09-09').events.find(e=>e.periodID==='arrival').startAt,at('2026-09-09','08:30'));assert.equal(core.timelineFor(c,'2026-09-10').events.find(e=>e.periodID==='arrival').startAt,at('2026-09-10','08:35'));assert.ok(!core.timelineFor(c,'2026-09-11').events.some(e=>e.periodID==='centers'));
});
test('weekday rotation, anchors, fixed weekday identities and exception precedence are generic',()=>{
  const r=copy(raw),d=r.schoolDefinitionSnapshot;r.personalActivities=[];d.activityLayers={personal:[],staff:[],suppressedClassroomDates:{}};d.scheduledPointEvents=[];
  d.cycle={kind:'customRotation',dayIDs:['red','blue'],anchorDate:'2026-09-01',anchorDayID:'red'};d.calendarRule={mode:'weekdayCycle',schoolWeekdays:[2,3,4,5,6],defaultTemplateID:'room-2',weekdayTemplateIDs:{},weekdayCycleDayIDs:{},cycleDayTemplateIDs:{}};d.calendarExceptions={'2026-09-07':{kind:'noSchool'}};
  let c=imported(r);assert.equal(core.schoolDay(c,'2026-09-01').day,'red');assert.equal(core.schoolDay(c,'2026-09-02').day,'blue');assert.equal(core.schoolDay(c,'2026-09-08').day,'red');assert.equal(core.schoolDay(c,'2026-08-31').day,'red');
  d.calendarRule.weekdayCycleDayIDs={'3':'blue'};d.calendarRule.cycleDayTemplateIDs={blue:'room-2-kidzfun'};d.calendarExceptions['2026-09-08']={kind:'scheduled',templateID:'room-2-early',cycleDayID:'red'};c=imported(r);assert.equal(core.schoolDay(c,'2026-09-01').schedule,'room-2-kidzfun');assert.equal(core.schoolDay(c,'2026-09-08').schedule,'room-2-early');
});
test('explicit source passing creates Passing; arbitrary gaps remain neutral',()=>{
  const r=copy(raw);r.schoolDefinitionSnapshot.periodDefinitions.find(p=>p.id==='transition-bathroom').kind='passing';const c=imported(r);
  assert.equal(scheduleSnapshot(c,at('2026-09-10','10:57')).state,'passing');assert.equal(scheduleSnapshot(c,at('2026-09-10','13:45')).state,'gap');
});
test('assignments, rooms, native name overrides and local edits preserve source identifiers',()=>{
  const r=copy(raw),d=r.schoolDefinitionSnapshot;d.periodDefinitions.find(p=>p.id==='centers').acceptsPersonalAssignment=true;r.assignments={'room-2':{centers:{title:'Assigned Centers',block:'C',room:'Room 2'}}};r.activityNameOverrides=[{source:{schoolID:d.id,layer:'classroom',dayID:'room-2',templateID:'room-2',itemID:'centers',periodID:'centers'},title:'Custom Centers'}];
  const c=imported(r);let e=core.timelineFor(c,'2026-09-10').events.find(e=>e.periodID==='centers');assert.equal(e.title,'Custom Centers');assert.equal(e.room,'Room 2');assert.equal(e.blockID,'C');assert.deepEqual(c.portable.shared.assignments,r.assignments);
  c.portable.edits=[{type:'period',id:'centers',title:'Local Centers',room:'204'},{type:'personal',id:'personal-lunch',title:'My Lunch',room:'Staff Room'}];core.validate(c);e=core.timelineFor(c,'2026-09-10').events.find(e=>e.periodID==='centers');assert.equal(e.title,'Local Centers');assert.equal(e.room,'204');assert.equal(scheduleSnapshot(c,at('2026-09-10','11:45')).current.title,'My Lunch');assert.deepEqual(c.portable.shared,r);
});
test('native personal weekday/day restrictions and source association remain effective',()=>{
  const r=copy(raw);r.personalActivities[0].weekdays=[3];r.personalActivities[0].dayIDs=['room-2'];r.personalActivities[0].room='Room 2';const c=imported(r);
  assert.equal(core.timelineFor(c,'2026-09-08').events[0].room,'Room 2');assert.equal(core.timelineFor(c,'2026-09-09').events[0].title,'Arrival');assert.equal(c.portable.shared.personalActivities[0].sourcePeriodID,'setup');
});
test('independent UUIDs, switching, reload and both backup formats preserve every source layer',()=>{
  const storage=memory(),store=new profiles.ProfileStore(storage),second=copy(raw);second.scheduleName='Other Room';second.personalActivities[1].title='Other Lunch';const a=imported(raw),b=imported(second),ids=store.add([a,b]);assert.notEqual(ids[0],ids[1]);assert.match(ids[0],/^[0-9a-f-]{36}$/i);
  store.select(ids[1]);store.select(ids[0]);assert.deepEqual(store.activeConfiguration,a);assert.deepEqual(store.snapshot.savedProfiles[1].configuration,b);
  assert.deepEqual(new profiles.ProfileStore(storage).activeConfiguration,a);
  const backup=profiles.exportProfiles(store.snapshot);assert.equal(backup.formatVersion,1);assert.deepEqual(profiles.importDisplayProfiles(backup),[a,b]);assert.deepEqual(core.importBackup({format:core.WEB_FORMAT,formatVersion:1,configuration:a}),a);
  const restored=new profiles.ProfileStore(memory()),restoredIDs=restored.add(profiles.importDisplayProfiles(backup));assert.notEqual(restoredIDs[0],ids[0]);assert.deepEqual(restored.snapshot.savedProfiles[0].configuration.portable.shared,raw);
});
test('mixed bundles accept snapshot schools and old WMHS while skipping only required unsupported constructs',()=>{
  const wmhs=read('./fixtures/native-v2.json'),unknown=copy(raw),gms=copy(raw),bad=copy(raw);unknown.schoolProfileID='local.future';unknown.schoolDefinitionSnapshot.id=unknown.schoolProfileID;gms.schoolProfileID='gms';gms.schoolDefinitionSnapshot.id='gms';bad.schoolDefinitionSnapshot.scheduleTemplates[0].unconfirmedEndFrom='2027-01-04';bad.scheduleName='Unconfirmed School';
  const plan=profiles.inspectNativeImport({bundleFormatVersion:1,schedules:[wmhs,gms,raw,unknown,bad]});assert.equal(plan.supported.length,4);assert.equal(plan.unsupported.length,1);assert.match(plan.unsupported[0].reason,/unconfirmed workday end/);
  const configs=profiles.nativeConfigurations(plan,read('../public/builtins/wmhs/schedule.json'),read('../public/builtins/wmhs/calendar.json'));assert.equal(configs.length,4);assert.equal(configs[0].sourceKind,'bellsync-v1');assert.equal(configs[1].sourceKind,'bellsync-snapshot');
});
test('malformed snapshots and local edits reject atomically without corrupting existing profiles',()=>{
  const storage=memory(),store=new profiles.ProfileStore(storage);store.add([config]);const original=storage.getItem(profiles.PROFILE_KEY);
  for(const mutate of [r=>r.schoolDefinitionSnapshot.id='wrong',r=>r.schoolDefinitionSnapshot.scheduleTemplates[0].periods[0].end='07:00',r=>r.schoolDefinitionSnapshot.calendarExceptions['bad']={kind:'noSchool'},r=>r.schoolDefinitionSnapshot.cycle.dayIDs=[],r=>r.personalActivities[1].start='08:00',r=>r.schoolDefinitionSnapshot.calendarExceptions['2026-09-10'].templateID='missing',r=>r.schoolDefinitionSnapshot.scheduledPointEvents[0].time='24:00']) {const r=copy(raw);mutate(r);assert.throws(()=>store.add(profiles.nativeConfigurations(profiles.inspectNativeImport({bundleFormatVersion:1,schedules:[raw,r]}))));assert.equal(storage.getItem(profiles.PROFILE_KEY),original);}
  const edit=copy(config);edit.portable.edits=[{type:'period',id:'unknown',title:'Bad'}];assert.throws(()=>store.replace(store.snapshot.activeProfileID,edit),/Unknown local edit/);assert.equal(storage.getItem(profiles.PROFILE_KEY),original);
});
test('generic lunch choices preserve split identity, passing, rooms and unsplit NO_LUNCH/missing values',()=>{
  const r=copy(raw),d=r.schoolDefinitionSnapshot;r.personalActivities=[];d.periodDefinitions.find(p=>p.id==='rest').acceptsPersonalAssignment=true;
  d.lunchRules=[{id:'rest-lunch',periodID:'rest',options:[{id:'L2',displayName:'Second Lunch',start:'13:00',end:'13:10',bellStart:'12:58'}]}];
  r.assignments={'room-2':{rest:{title:'My Block',room:'204',block:'R',lunch:'L2'}}};
  const c=imported(r),rows=core.timelineFor(c,'2026-09-10').events.filter(e=>e.periodID==='rest');assert.deepEqual(rows.map(e=>e.kind),['other','passing','lunch','other']);assert.equal(rows[0].blockID,'R');assert.equal(rows[3].blockID,'R');assert.equal(rows[3].room,'204');assert.equal(rows[2].title,'Lunch 2');assert.equal(scheduleSnapshot(c,at('2026-09-10','12:59')).state,'passing');
  for(const selection of ['NO_LUNCH',undefined]) {if(selection)r.assignments['room-2'].rest.lunch=selection;else delete r.assignments['room-2'].rest.lunch;const pieces=core.timelineFor(imported(r),'2026-09-10').events.filter(e=>e.periodID==='rest');assert.equal(pieces.length,1);assert.equal(pieces[0].endAt,at('2026-09-10','13:40'));}
  r.assignments['room-2'].rest.lunch='arbitrary';assert.throws(()=>imported(r),/Invalid lunch selection/);
});
test('workday boundary after final timed row stays a point and gives a gap until completion',()=>{
  const r=copy(raw),d=r.schoolDefinitionSnapshot;r.personalActivities=[];d.scheduleTemplates[0].periods=d.scheduleTemplates[0].periods.filter(p=>p.end<='12:00');
  const c=imported(r),s=scheduleSnapshot(c,at('2026-09-10','14:00'));assert.equal(s.state,'gap');assert.equal(s.next.title,'Ms. Christine Leaves');assert.equal(s.countdownTarget,at('2026-09-10','15:30'));assert.ok(!s.events.some(e=>e.kind==='boundary'));assert.equal(scheduleSnapshot(c,at('2026-09-10','15:30')).state,'complete');
});
test('future snapshot schema is individually unsupported rather than substituted',()=>{
  const future=copy(raw);future.schoolDefinitionSnapshot.schemaVersion=2;const plan=profiles.inspectNativeImport({bundleFormatVersion:1,schedules:[raw,future]});assert.equal(plan.supported.length,1);assert.match(plan.unsupported[0].reason,/schema 2/);
});
console.log(`\n${passed} portable snapshot tests passed.`);
