import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { builtInConfiguration } from '../school-setup.mjs';
import { timelineFor, schoolDay, zonedTimestamp, editManagedAssignments, normalize } from '../display-core.mjs';
import { formatCountdown, remainingFraction, countdownFraction, resolvePresentation } from '../schedule-presentation.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const gms=read('../public/builtins/gms/schedule.json'),calendar=read('../public/builtins/gms/calendar.json');
const swift=fs.readFileSync(new URL('./fixtures/gms-native-definition.swift',import.meta.url),'utf8');
const sourceRows=s=>[...s.matchAll(/p\("([^"]+)","([^"]+)","([^"]+)"(?:,"([^"]*)")?\)/g)].map(m=>({id:m[1],start:m[2],end:m[3],title:m[4]||''}));
let passed=0;const test=(name,fn)=>{fn();passed++;console.log(`PASS ${name}`);};
for(const [seconds,expected] of [[3599,'59:59'],[3600,'1:00:00'],[3665,'1:01:05'],[4649,'1:17:29'],[11245,'3:07:25'],[-10,'0:00']]) test(`countdown ${seconds} seconds → ${expected}`,()=>assert.equal(formatCountdown(seconds*1000),expected));
test('100-minute ring depletes monotonically and clamps invalid/overflow values',()=>{
  const end=100*60000;
  assert.deepEqual([0,25,50,75,100].map(m=>remainingFraction(m*60000,0,end)),[1,.75,.5,.25,0]);
  assert.equal(remainingFraction(99*60000,0,end),.01);
  assert.equal(remainingFraction(-1,0,end),1);assert.equal(remainingFraction(end+1,0,end),0);
  for(const args of [[0,0,0],[NaN,0,end],[0,0,Infinity]]) assert.equal(remainingFraction(...args),0);
});
test('before-school, published passing, explicit passing and gap rings shrink without changing states',()=>{
  const key='2026-10-02',timeZone='America/New_York',at=t=>zonedTimestamp(key,t,timeZone);
  const event=(id,start,end,kind='academic')=>({id,title:id,kind,startAt:at(start),endAt:at(end)});
  const timeline={key,timeZone,status:'scheduled',events:[event('first','07:30','08:20'),event('second','08:25','09:00')],passing:[{startAt:at('08:20'),endAt:at('08:25')}]};
  for(const [time,state,fraction] of [['07:00','beforeSchool',1],['07:15','beforeSchool',.5],['08:20','passing',1],['08:22','passing',.6]]) {
    const now=at(time),s=resolvePresentation(timeline,now);assert.equal(s.state,state);assert.equal(countdownFraction(s,now),fraction);
  }
  const explicit={...timeline,events:[timeline.events[0],event('passing','08:20','08:25','passing'),timeline.events[1]]};
  assert.equal(countdownFraction(resolvePresentation(explicit,at('08:22')),at('08:22')),.6);
  const gap={...timeline,passing:[]};assert.equal(resolvePresentation(gap,at('08:22')).state,'gap');assert.equal(countdownFraction(resolvePresentation(gap,at('08:22')),at('08:22')),.6);
  assert.equal(countdownFraction(resolvePresentation(timeline,at('06:00')),at('06:00')),0);
});
test('WMHS quick setup reuses authoritative bells/calendar/block assignments, including FLEX editing',()=>{
  const source=read('../public/builtins/wmhs/schedule.json'),dates=read('../public/builtins/wmhs/calendar.json');
  const c=builtInConfiguration('wmhs',source,dates);assert.deepEqual(c.templates,source.bells);assert.deepEqual(c.calendar,dates);
  for(const [day,rows] of Object.entries(source.assignments)) for(const [id,a] of Object.entries(rows)) assert.deepEqual(c.assignments[day][id],a);
  assert.ok(c.assignments['1'].flex);const edited=editManagedAssignments(c,'Teacher',[{day:'1',period:'4',title:'Math',room:'204',lunch:'L3'},{day:'1',period:'flex',title:'Advisory',room:'100'}]);
  assert.equal(edited.assignments['1']['4'].lunch,'L3');assert.deepEqual(edited.templates,c.templates);assert.equal(edited.assignments['1'].flex.title,'Advisory');
});
test('Galvin resource matches the captured authoritative native definition and calendar byte-for-byte',()=>{
  const hr=sourceRows(swift.match(/let hr = (.*)/)[1])[0],common=sourceRows(swift.match(/let common1 = (.*)/)[1])[0];
  for(const grade of [5,6,7,8]) {
    assert.deepEqual(gms.regular[grade],[hr,common,...sourceRows(swift.match(new RegExp(`${grade}:\\[hr,common1,(.*?)\\]`))[1])]);
    assert.deepEqual(gms.lunchByGrade[grade],sourceRows(swift.match(new RegExp(`${grade}:(p\\("LUNCH"[^)]*\\))`))[1])[0]);
  }
  assert.deepEqual(gms.earlyRelease,sourceRows(swift.match(/let early = \[(.*?)\]/)[1]));
  assert.deepEqual(gms.winPeriodByGrade,{5:'P1',6:'P7',7:'P1',8:'P1'});
  assert.deepEqual(gms.specialistPeriodsByGrade,{5:['P4','P7'],6:['P1','P5'],7:['P3','P6'],8:['P2','P6']});
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../public/builtins/gms/calendar.json',import.meta.url))).digest('hex'),'137eb16907f09c8056217e93661950ce62cd6bec2204c133c35f916575e5154e');
});
for(const grade of [5,6,7,8]) test(`Galvin grade ${grade} preserves regular/early-release bells, calendar rotation, WIN/FLEX and rooms`,()=>{
  const c=builtInConfiguration('gms',gms,calendar,grade);
  const first=Object.keys(calendar.days).find(k=>calendar.days[k].schedule==='regular' && !calendar.days[k].note);
  const edited=editManagedAssignments(c,'Teacher',[{day:String(calendar.days[first].day),period:c.schoolMetadata.winPeriod,title:'Science',room:'204'}]);
  const regular=timelineFor(edited,first);assert.equal(regular.events.length,9);
  for(const p of [...gms.regular[grade],gms.lunchByGrade[grade]]) {const e=regular.events.find(e=>e.periodID===p.id);assert.equal(e.startAt,zonedTimestamp(first,p.start,c.school.timeZone));assert.equal(e.endAt,zonedTimestamp(first,p.end,c.school.timeZone));}
  assert.equal(regular.events.find(e=>e.periodID===c.schoolMetadata.winPeriod).room,'204');
  for(const word of ['FLEX','WIN']) {
    const key=Object.keys(calendar.days).find(k=>calendar.days[k].note?.includes(word));assert.ok(key);
    const day=String(calendar.days[key].day),changed=editManagedAssignments(c,'Teacher',[{day,period:c.schoolMetadata.winPeriod,title:'Science',room:'204'}]);
    const e=timelineFor(changed,key).events.find(e=>e.periodID===c.schoolMetadata.winPeriod);assert.equal(e.title,word==='WIN'?'WIN · Science':'FLEX');assert.equal(e.room,'');
  }
  const er=Object.keys(calendar.days).find(k=>calendar.days[k].schedule==='er');const early=timelineFor(c,er);
  assert.equal(early.events.length,8);assert.ok(!early.events.some(e=>e.kind==='lunch'));
  for(const p of gms.earlyRelease) assert.equal(early.events.find(e=>e.periodID===p.id).endAt,zonedTimestamp(er,p.end,c.school.timeZone));
  for(const [key,d] of Object.entries(calendar.days)) assert.equal(String(schoolDay(c,key).day),String(d.day));
  assert.equal(schoolDay(c,'2026-09-07'),null);assert.equal(schoolDay(c,'2026-09-05'),null);
  assert.deepEqual(normalize(c).schoolMetadata,c.schoolMetadata);
});
test('Galvin rejects missing/invalid grade instead of guessing lunch or bell times',()=>{
  for(const grade of [undefined,4,9,'6']) assert.throws(()=>builtInConfiguration('gms',gms,calendar,grade),/Choose a Galvin grade/);
});
console.log(`\n${passed} countdown/school setup tests passed.`);
