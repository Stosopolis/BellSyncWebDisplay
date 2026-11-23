import assert from 'node:assert/strict';
import fs from 'node:fs';
import {snapshotChoices,snapshotConfiguration,schoolSchedulePreview} from '../school-setup.mjs';
import {timelineFor,formatClock,zonedTimestamp} from '../display-core.mjs';
import {scheduleSnapshot} from '../schedule-presentation.mjs';
import {ProfileStore} from '../profile-store.mjs';
import {classChoices} from '../agenda/classroom-model.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const choices=snapshotChoices('walton',read('../public/builtins/walton/profiles.json'));
assert.equal(choices.length,11);
const choice=choices.find(c=>c.code==='math-interventionist');assert.equal(choice.label,'Math Interventionist (Provisional Monday)');
for(const school of ['woodville','ferryway'])assert.ok(!snapshotChoices(school,read(`../public/builtins/${school}/profiles.json`)).some(c=>c.code==='math-interventionist'));
const calendar=read('../public/builtins/walton/1g.json').schoolDefinitionSnapshot.calendarExceptions;
const proposed=read('../public/builtins/walton/math-interventionist.json').schoolDefinitionSnapshot.calendarExceptions;
assert.equal(Object.values(proposed).filter(e=>e.kind==='scheduled').length,25);
for(const c of choices.filter(c=>c.code!=='math-interventionist')) {
 const other=read('../public/builtins/walton/'+c.file).schoolDefinitionSnapshot.calendarExceptions;
 for(const [key,e] of Object.entries(calendar).filter(([key,e])=>key>='2026-11-23' && (new Date(key+'T12:00Z').getUTCDay()===1 || e.kind==='noSchool')))assert.equal(other[key]?.kind,e.kind,`${c.code}: ${key}`);
}
const config=snapshotConfiguration(choice,read('../public/builtins/walton/math-interventionist.json'));
assert.match(config.profileName,/Provisional/);
assert.match(timelineFor(config,'2026-11-30').day.dayLabel,/Provisional.*Awaiting teacher confirmation.*Not official bells/);
assert.match(config.portable.shared.schoolDefinitionSnapshot.scheduleTemplates[0].displayName,/Provisional.*Awaiting teacher confirmation/);
const expected=[['Kindergarten','10:45','11:25'],['Grade 1','11:55','12:30'],['Grade 2','12:40','13:15'],['Grade 3','13:25','13:55'],['Grade 4','14:05','14:40']];
const preview=schoolSchedulePreview(config);assert.equal(preview.key,'2026-11-23');
assert.deepEqual(preview.events.map(e=>[e.title,formatClock(e.startAt,config.school.timeZone,true),formatClock(e.endAt,config.school.timeZone,true)]),expected);
assert.equal(classChoices(timelineFor(config,preview.key)).length,5);
for(let date=new Date('2026-01-01T12:00Z');date<new Date('2028-01-01T12:00Z');date.setUTCDate(date.getUTCDate()+1)){
 const key=date.toISOString().slice(0,10), source=calendar[key];
 const eligible=key>='2026-11-23' && key<='2027-06-17' && date.getUTCDay()===1 && source?.kind==='scheduled';
 const snapshot=at=>scheduleSnapshot(config,zonedTimestamp(key,at,config.school.timeZone));
 const s=snapshot('12:00');
 if(eligible){
  assert.deepEqual(s.events.map(e=>[e.title,formatClock(e.startAt,config.school.timeZone,true),formatClock(e.endAt,config.school.timeZone,true)]),expected,key);
  assert.equal(classChoices(timelineFor(config,key)).length,5);
  assert.ok(s.countdownTarget,key);
  assert.equal(snapshot('14:41').countdownTarget,null,key);
 }else{
  assert.equal(s.status,key>='2026-11-23' && key<='2027-06-18' && source?.kind==='noSchool'?'no-school':'unavailable',key);
  assert.equal(s.events.length,0,key);assert.equal(s.countdownTarget,null,key);
 }
}

const map=new Map();let n=0;const store=new ProfileStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},()=>`profile-${++n}`);
const original=snapshotConfiguration(choices[0],read('../public/builtins/walton/'+choices[0].file));store.add([original]);const saved=store.snapshot.savedProfiles[0];store.add([config]);store.select(saved.id);assert.deepEqual(store.snapshot.savedProfiles[0],saved);assert.equal(store.snapshot.savedProfiles.length,2);
console.log('PASS Walton selector, five exact blocks, 25 proposed Mondays, 730-date calendar/countdown sweep, Classroom eligibility, independent profiles');
