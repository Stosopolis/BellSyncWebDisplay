import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../display-core.mjs';
import * as profiles from '../profile-store.mjs';
import {builtInConfiguration} from '../school-setup.mjs';
import {scheduleSnapshot} from '../schedule-presentation.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const school=read('../public/builtins/wmhs/schedule.json'),calendar=read('../public/builtins/wmhs/calendar.json');
const enabled=c=>core.normalize({...c,preferences:{...c.preferences,schoolDayProgress:true,schoolYearProgress:true}});
const wmhs=enabled(builtInConfiguration('wmhs',school,calendar));
const portable=enabled(profiles.nativeConfigurations(profiles.inspectNativeImport(read('./fixtures/canterbury-room2-v2.json')))[0]);
const at=(c,key,time)=>core.zonedTimestamp(key,time,c.school.timeZone);
const progress=(c,key,time)=>core.schoolProgress(c,key,at(c,key,time));
const copy=structuredClone;
let passed=0;function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}
test('both settings default off and reject non-boolean values',()=>{
 const c=builtInConfiguration('wmhs',school,calendar);assert.equal(c.preferences.schoolDayProgress,false);assert.equal(c.preferences.schoolYearProgress,false);
 assert.deepEqual(progress(c,'2026-09-01','10:00'),{day:null,year:null});assert.throws(()=>core.defaultPreferences({schoolDayProgress:'true'}),/Invalid preference/);
});
test('before school zero and midpoint use canonical bells even with blank assignments',()=>{
 const key='2026-09-01',c=copy(wmhs);c.assignments={};const bounds=core.confirmedWorkdayBounds(c,key);
 assert.equal(bounds.startAt,at(c,key,'07:30'));assert.equal(bounds.endAt,at(c,key,'14:10'));
 assert.equal(progress(c,key,'07:00').day.fraction,0);
 assert.equal(core.schoolProgress(c,key,(bounds.startAt+bounds.endAt)/2).day.fraction,.5);
});
test('early release uses its effective confirmed ending and hides at exact end',()=>{
 const key=Object.keys(calendar.days).find(key=>calendar.days[key].schedule==='er'),bounds=core.confirmedWorkdayBounds(wmhs,key);
 assert.equal(bounds.endAt,at(wmhs,key,school.bells.er.at(-1).end));
 assert.ok(core.schoolProgress(wmhs,key,bounds.endAt-1).day);assert.equal(core.schoolProgress(wmhs,key,bounds.endAt).day,null);
});
test('special schedules and owner departure use frozen effective timing',()=>{
 const key='2026-10-01',bounds=core.confirmedWorkdayBounds(portable,key);
 assert.equal(bounds.startAt,at(portable,key,'08:00'));assert.equal(bounds.endAt,at(portable,key,'15:30'));
 const friday=core.confirmedWorkdayBounds(portable,'2026-10-02');assert.equal(friday.endAt,at(portable,'2026-10-02','15:00'));
 assert.equal(progress(portable,'2026-10-02','15:00').day,null);
 const early=core.confirmedWorkdayBounds(portable,'2026-11-25');assert.equal(early.endAt,at(portable,'2026-11-25','14:30'));
});
test('normal weekends and closures hide day progress; authoritative weekends qualify',()=>{
 assert.equal(progress(wmhs,'2026-10-03','09:00').day,null);assert.equal(progress(wmhs,'2026-10-12','09:00').day,null);
 const c=copy(wmhs);c.calendar.days['2026-10-03']={day:2,schedule:'regular'};
 assert.ok(progress(c,'2026-10-03','09:00').day);
});
test('unavailable and unconfirmed source timing hide day progress',()=>{
 const c=copy(wmhs);c.calendar.days['2026-10-05']={day:2,schedule:'delayed'};assert.equal(progress(c,'2026-10-05','09:00').day,null);
 const p=copy(portable);p.portable.shared.schoolDefinitionSnapshot.scheduleTemplates.find(t=>t.id==='room-2-kidzfun').unconfirmedEndFrom='2026-10-01';
 assert.equal(progress(p,'2026-10-01','09:00').day,null);
});
test('year totals reuse calendar classification including modified days and explicit weekends',()=>{
 const c=copy(wmhs);c.calendar.days['2026-10-03']={day:2,schedule:'regular'};
 const expected=Object.keys(c.calendar.days).filter(key=>core.schoolDay(c,key));const p=progress(c,'2026-10-05','09:00');
 assert.equal(p.year.total,expected.length);assert.ok(expected.some(key=>c.calendar.days[key].schedule==='er'));assert.ok(expected.includes('2026-10-03'));assert.ok(!expected.includes('2026-10-12'));
 assert.equal(p.year.completed,expected.filter(key=>key<'2026-10-05').length);
 const g=enabled(builtInConfiguration('gms',read('../public/builtins/gms/schedule.json'),read('../public/builtins/gms/calendar.json'),6));assert.equal(progress(g,'2026-10-05','09:00').year.total,Object.keys(g.calendar.days).filter(key=>core.schoolDay(g,key)).length);
});
test('today only contributes to year completion at confirmed effective end',()=>{
 const key='2026-10-05',bounds=core.confirmedWorkdayBounds(wmhs,key);
 const before=core.schoolProgress(wmhs,key,bounds.endAt-1),after=core.schoolProgress(wmhs,key,bounds.endAt);
 assert.equal(after.year.completed,before.year.completed+1);assert.equal(after.day,null);
});
test('unavailable today never contributes an invented completion',()=>{
 const c=copy(wmhs),key='2026-10-05';c.calendar.days[key]={day:2,schedule:'delayed'};
 const expected=Object.keys(c.calendar.days).filter(date=>date<key && core.schoolDay(c,date)).length;
 assert.equal(progress(c,key,'23:59').year.completed,expected);
});
test('portable explicit calendar totals exclude closures and include all dated specials',()=>{
 const d=portable.portable.shared.schoolDefinitionSnapshot,keys=Object.keys(d.calendarExceptions).filter(key=>core.schoolDay(portable,key));
 assert.equal(progress(portable,'2026-10-01','09:00').year.total,keys.length);
 assert.equal(keys.filter(key=>d.calendarExceptions[key].templateID==='room-2-kidzfun').length,32);
});
test('unbounded manual and repeating snapshot calendars hide year progress',()=>{
 const manual=enabled(core.normalize(read('../public/samples/classroom-demo.json')));assert.equal(progress(manual,'2026-10-05','09:00').year,null);
 const p=copy(portable);p.portable.shared.schoolDefinitionSnapshot.calendarRule.mode='weekdayCycle';assert.equal(progress(p,'2026-10-01','09:00').year,null);
});
test('selected dates recompute day bounds without counting future days complete',()=>{
 const now=at(portable,'2026-10-01','10:00');
 assert.equal(core.schoolProgress(portable,'2026-10-02',now).day.fraction,0);
 assert.equal(core.schoolProgress(portable,'2026-09-10',now).day,null);
 assert.equal(core.schoolProgress(portable,'2026-10-02',now).year.completed,core.schoolProgress(portable,'2026-10-01',now).year.completed);
 assert.ok(core.schoolProgress(portable,'2026-09-10',now).year.completed<core.schoolProgress(portable,'2026-10-01',now).year.completed);
});
test('profiles remain independent, persist settings, and recalculate on switch',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},store=new profiles.ProfileStore(storage),ids=store.add([wmhs,portable]);
 store.select(ids[0]);const first=core.schoolProgress(store.activeConfiguration,'2026-10-02',at(wmhs,'2026-10-02','10:00'));
 store.select(ids[1]);const second=core.schoolProgress(store.activeConfiguration,'2026-10-02',at(portable,'2026-10-02','10:00'));
 assert.notEqual(first.day.endAt,second.day.endAt);assert.notEqual(first.year.total,second.year.total);
 const restored=new profiles.ProfileStore(storage);assert.equal(restored.activeConfiguration.preferences.schoolDayProgress,true);assert.equal(restored.activeConfiguration.preferences.schoolYearProgress,true);
 const backup=profiles.importDisplayProfiles(profiles.exportProfiles(store.snapshot));assert.equal(backup[0].preferences.schoolYearProgress,true);
});
test('enabling progress never changes countdown events, lunch, or calendar',()=>{
 const c=builtInConfiguration('wmhs',school,calendar),before=copy(c),now=at(c,'2026-10-05','11:00');
 const old=scheduleSnapshot(c,now),active=enabled(c);core.schoolProgress(active,'2026-10-05',now);
 assert.deepEqual(scheduleSnapshot(active,now),old);assert.deepEqual(c,before);
});
console.log(`\n${passed} school progress tests passed.`);
