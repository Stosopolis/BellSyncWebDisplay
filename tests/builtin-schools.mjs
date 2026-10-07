import assert from 'node:assert/strict';
import fs from 'node:fs';
import { snapshotChoices,snapshotConfiguration,schoolSchedulePreview,schoolLinkSelection } from '../school-setup.mjs';
import { timelineFor,formatClock,zonedTimestamp,confirmedWorkdayBounds,eventTitle } from '../display-core.mjs';
import { scheduleSnapshot } from '../schedule-presentation.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const native=read('./fixtures/builtin-schools-native-days.json');
let passed=0,dates=0;function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}
for(const [school,count] of [['woodville',22],['ferryway',1],['walton',10]]) {
 const choices=snapshotChoices(school,read(`../public/builtins/${school}/profiles.json`));test(`${school} authoritative public catalog`,()=>{
  assert.equal(choices.length,count);assert.deepEqual(schoolLinkSelection(`?school=${school}`),{school,profile:null});
  for(const choice of choices){assert.deepEqual(schoolLinkSelection(`?school=${school}&profile=${choice.code.toUpperCase()}`),{school,profile:choice.code});assert.ok(choice.label===`Ferryway School` || new RegExp(`^${school[0].toUpperCase()+school.slice(1)} [A-Z0-9]+$`).test(choice.label));}
 });
 for(const choice of choices)test(`${choice.label}: native timing/calendar/point parity and preview`,()=>{
  const raw=read(`../public/builtins/${school}/${choice.file}`),c=snapshotConfiguration(choice,raw);
  assert.equal(c.profileName,choice.label);
  for(const day of native[raw.schoolProfileID]) {
   const t=timelineFor(c,day.date),rows=events=>events.map(e=>({title:e.title,room:e.room,start:formatClock(e.startAt,c.school.timeZone,true),end:formatClock(e.endAt,c.school.timeZone,true)}));
   assert.deepEqual(rows(t.events),day.rows.map(({title,room,start,end})=>({title,room,start,end})),day.date);
   assert.deepEqual(rows(t.contextualStaff),day.staff.map(({title,room,start,end})=>({title,room,start,end})),day.date);
   assert.deepEqual(t.points.map(({id,title,time})=>({id,title,time})),day.points,day.date);dates++;
  }
  const preview=schoolSchedulePreview(c);assert.ok(preview.events.length);
  for(const template of raw.schoolDefinitionSnapshot.scheduleTemplates)assert.ok(schoolSchedulePreview(c,template.id).events.length);
  if(school!=='ferryway')assert.equal(timelineFor(c,'2026-10-30').status,'unavailable');
  assert.equal(timelineFor(c,'2026-10-12').status,'no-school');assert.deepEqual(c.portable.shared,raw);
  assert.ok(preview.events.every(e=>!eventTitle(e).includes('(confirmed portion)')));
 });
}
test('Walton kindergarten unconfirmed future endings preserve known events without invented completion',()=>{
 for(const code of ['kg','kd']) {
  const choices=snapshotChoices('walton',read('../public/builtins/walton/profiles.json')),choice=choices.find(c=>c.code===code),c=snapshotConfiguration(choice,read(`../public/builtins/walton/${code}.json`));
  const key=code==='kg'?'2027-01-04':'2027-01-05';assert.ok(timelineFor(c,key).events.length);assert.equal(scheduleSnapshot(c,zonedTimestamp(key,'15:00',c.school.timeZone)).state,'unavailable');assert.equal(confirmedWorkdayBounds(c,key),null);
 }
});
console.log(`\n${passed} built-in school tests passed; ${dates} native profile/date comparisons.`);
