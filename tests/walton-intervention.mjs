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
const choice=choices.find(c=>c.code==='math-interventionist');assert.equal(choice.label,'Math Interventionist (Monday Preview)');
for(const school of ['woodville','ferryway'])assert.ok(!snapshotChoices(school,read(`../public/builtins/${school}/profiles.json`)).some(c=>c.code==='math-interventionist'));
assert.deepEqual(Object.keys(read('../public/builtins/walton/math-interventionist.json').schoolDefinitionSnapshot.calendarExceptions),['2026-11-23']);
const config=snapshotConfiguration(choice,read('../public/builtins/walton/math-interventionist.json'));
const expected=[['Kindergarten','10:45','11:25'],['Grade 1','11:55','12:30'],['Grade 2','12:40','13:15'],['Grade 3','13:25','13:55'],['Grade 4','14:05','14:40']];
const preview=schoolSchedulePreview(config);assert.equal(preview.key,'2026-11-23');
assert.deepEqual(preview.events.map(e=>[e.title,formatClock(e.startAt,config.school.timeZone,true),formatClock(e.endAt,config.school.timeZone,true)]),expected);
assert.equal(classChoices(timelineFor(config,preview.key)).length,5);
for(let date=new Date('2026-01-01T12:00Z');date<new Date('2028-01-01T12:00Z');date.setUTCDate(date.getUTCDate()+1)){
 const key=date.toISOString().slice(0,10);if(key===preview.key)continue;
 const s=scheduleSnapshot(config,zonedTimestamp(key,'12:00',config.school.timeZone));assert.equal(s.status,'unavailable',key);assert.equal(s.events.length,0);assert.equal(s.countdownTarget,null);
}
const map=new Map();let n=0;const store=new ProfileStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},()=>`profile-${++n}`);
const original=snapshotConfiguration(choices[0],read('../public/builtins/walton/'+choices[0].file));store.add([original]);const saved=store.snapshot.savedProfiles[0];store.add([config]);store.select(saved.id);assert.deepEqual(store.snapshot.savedProfiles[0],saved);assert.equal(store.snapshot.savedProfiles.length,2);
console.log('PASS Walton selector, five exact blocks, preview date, Classroom eligibility, 729 unavailable dates, independent profiles');
