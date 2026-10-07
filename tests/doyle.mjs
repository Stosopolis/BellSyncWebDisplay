import assert from 'node:assert/strict';
import fs from 'node:fs';
import { doyleConfiguration, DOYLE_PROFILES, schoolLinkSelection } from '../school-setup.mjs';
import { timelineFor, formatClock, zonedTimestamp } from '../display-core.mjs';
import { scheduleSnapshot } from '../schedule-presentation.mjs';
import { inspectNativeImport, nativeConfigurations, ProfileStore, exportProfiles, importDisplayProfiles } from '../profile-store.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const expected=read('./fixtures/doyle-native-days.json');
let passed=0;function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}
for(const code of DOYLE_PROFILES) test(`Doyle PreK ${code}: native parity for every calendar date, neutral names and portable round trip`,()=>{
 const raw=read(`../public/builtins/doyle/prek-${code.toLowerCase()}.json`),c=doyleConfiguration(raw,code);
 assert.equal(c.profileName,`Doyle PreK ${code}`);assert.equal(raw.schoolDefinitionSnapshot.activityPresentation.sharedScheduleName,c.profileName);
 assert.equal(inspectNativeImport(raw).unsupported.length,0);assert.deepEqual(nativeConfigurations(inspectNativeImport(raw))[0],c);
 assert.ok(!raw.schoolDefinitionSnapshot.scheduleTemplates.some(t=>/kidzfun/i.test(t.id)));
 for(const day of expected[code.toLowerCase()]) {
  const t=timelineFor(c,day.date),rows=t.events.map(e=>({id:e.id,title:e.title,room:e.room,start:formatClock(e.startAt,c.school.timeZone,true),end:formatClock(e.endAt,c.school.timeZone,true)}));
  // Native/Web stable event IDs differ; authoritative titles/timing do not.
  assert.deepEqual(rows.map(({id,...r})=>r),day.rows.map(({id,...r})=>r),day.date);
  assert.deepEqual(t.points?.map(({id,title,time})=>({id,title,time})) || [],day.points,day.date);
  assert.ok(t.events.every(e=>e.startAt<e.endAt));
 }
 assert.equal(timelineFor(c,'2026-10-12').status,'no-school');assert.equal(timelineFor(c,'2026-10-30').status,'unavailable');assert.equal(timelineFor(c,'2026-10-10').status,'weekend');
 assert.equal(timelineFor(c,'2027-06-16').events.length,0);
 const active=scheduleSnapshot(c,zonedTimestamp('2026-10-07',code==='A'?'09:20':'09:10',c.school.timeZone));assert.equal(active.state,'active');assert.equal(active.current.title,code==='E'||code==='F'?'Recess':'Morning Meeting / Circle');
 const map=new Map(),store=new ProfileStore({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)});store.add([c]);assert.deepEqual(importDisplayProfiles(exportProfiles(store.snapshot))[0],c);
});
test('school links open only the explicit Doyle picker or valid neutral A–I profile',()=>{
 assert.deepEqual(schoolLinkSelection('?school=doyle'),{school:'doyle',profile:null});
 for(const profile of DOYLE_PROFILES) assert.deepEqual(schoolLinkSelection(`?school=doyle&profile=${profile.toLowerCase()}`),{school:'doyle',profile});
 assert.deepEqual(schoolLinkSelection('?school=doyle&profile=teacher'),{school:'doyle',profile:null});assert.equal(schoolLinkSelection('?school=other'),null);
 assert.throws(()=>doyleConfiguration(read('../public/builtins/doyle/prek-a.json'),'B'));
});
console.log(`\n${passed} Doyle tests passed (all nine native calendars compared).`);
