import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, timelineFor, zonedTimestamp, dateInZone, importBackup, WEB_FORMAT, editManagedAssignments } from '../display-core.mjs';
import { resolvePresentation, scheduleSnapshot } from '../schedule-presentation.mjs';

const read = p => JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const demo = normalize(read('../public/samples/classroom-demo.json'));
const bells = read('../public/builtins/wmhs/schedule.json').bells;
const calendar = read('../public/builtins/wmhs/calendar.json');
const regularDate = '2026-10-01';
const flexDate = '2026-09-02';
const at = (time,date=regularDate) => zonedTimestamp(date,time,'America/New_York');
const copy = v => structuredClone(v);
const wmhs = lunch => normalize({
  schemaVersion:2,sourceKind:'bellsync-v1',school:{id:'wmhs',displayName:'WMHS',timeZone:'America/New_York'},
  profileName:'Classroom',templates:bells,calendar,
  assignments:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),Object.fromEntries(Array.from({length:6},(_,j)=>[String(j+1),{title:`Class ${j+1}`,room:`20${j+1}`,block:'A',...(j===3 && lunch ? {lunch} : {})}]))]))
});
let passed=0;
function test(name,fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch(error) { console.error(`FAIL ${name}`); throw error; }
}

test('31, 30, and 1 minute lead plus exact first-event boundary',()=>{
  const timeline=timelineFor(demo,regularDate);
  const preview=resolvePresentation(timeline,at('06:59'));
  assert.equal(preview.state,'preview');assert.equal(preview.countdownTarget,null);assert.equal(preview.next.id,'p1');
  for(const time of ['07:00','07:29']) {
    const s=resolvePresentation(timeline,at(time));assert.equal(s.state,'beforeSchool');
    assert.equal(s.label,'BEFORE SCHOOL');assert.equal(s.countdownTarget,at('07:30'));assert.equal(s.room,'1304');assert.equal(s.current,null);
  }
  const s=resolvePresentation(timeline,at('07:30'));
  assert.equal(s.state,'active');assert.equal(s.current.id,'p1');assert.equal(s.countdownTarget,at('08:20'));
});

test('active countdown uses current end and skips future transitions for Next',()=>{
  const s=scheduleSnapshot(wmhs('L2'),at('08:00'));
  assert.equal(s.state,'active');assert.equal(s.title,'Class 1');assert.equal(s.room,'201');
  assert.equal(s.countdownTarget,at('08:28'));assert.equal(s.next.id,'2');
});

test('published adjacent WMHS bells are passing with correct destination room',()=>{
  const s=scheduleSnapshot(wmhs(),at('08:28'));
  assert.equal(s.state,'passing');assert.equal(s.label,'PASSING TIME');assert.equal(s.current,null);
  assert.equal(s.next.id,'2');assert.equal(s.title,'Class 2');assert.equal(s.room,'202');assert.equal(s.countdownTarget,at('08:32'));
  assert.equal(scheduleSnapshot(wmhs(),at('08:32')).state,'active');
});

test('manual short and long gaps are neutral, not threshold-based passing',()=>{
  for(const time of ['08:20','08:24','10:00']) {
    const s=scheduleSnapshot(demo,at(time));assert.equal(s.state,'gap');assert.equal(s.label,'UP NEXT');assert.equal(s.current,null);assert.equal(s.transition,'gap');
  }
  assert.equal(scheduleSnapshot(demo,at('08:20')).countdownTarget,at('08:25'));
});

test('missing and blank WMHS assignments cannot stretch published passing',()=>{
  for(const blank of [false,true]) {
    const c=wmhs(),day=String(calendar.days[regularDate].day);
    if(blank)c.assignments[day]['2'].title='';else delete c.assignments[day]['2'];
    for(const time of ['08:28','08:40','09:26']) {
      const s=scheduleSnapshot(c,at(time));assert.equal(s.state,'gap');assert.equal(s.current,null);
      assert.equal(s.next.id,'3');assert.equal(s.countdownTarget,at('09:30'));
    }
    assert.ok(!timelineFor(c,regularDate).events.some(e=>e.id==='2'));
  }
});

test('missing manual assignment becomes open time rather than placeholder class',()=>{
  const c=copy(demo);delete c.assignments.every.p2;
  const s=scheduleSnapshot(c,at('08:30'));assert.equal(s.state,'gap');assert.equal(s.next.kind,'lunch');assert.equal(s.current,null);
});

test('explicit passing rows are authoritative, with no inference from adjacency',()=>{
  const c=copy(demo);
  const transition={id:'pass',label:'Passing Time',kind:'passing',start:'08:20',end:'08:25'};
  c.periods.push(transition);c.templates.regular.push(copy(transition));
  const valid=normalize(c),s=scheduleSnapshot(valid,at('08:22'));
  assert.equal(s.state,'passing');assert.equal(s.current.id,'pass');assert.equal(s.next.id,'p2');
  assert.equal(s.countdownTarget,at('08:25'));assert.equal(s.room,'1304');
  delete valid.assignments.every.p2;
  const hole=scheduleSnapshot(valid,at('08:22'));assert.equal(hole.state,'gap');
  assert.ok(!hole.events.some(e=>e.id==='pass'));
});

test('standalone lunch retains title, boundaries, metadata, and no classroom room',()=>{
  const c=copy(demo);c.assignments.every.lunch={title:'Staff Lunch',room:''};
  const s=scheduleSnapshot(c,at('11:00'));assert.equal(s.state,'active');assert.equal(s.title,'Staff Lunch');
  assert.equal(s.current.kind,'lunch');assert.equal(s.current.startAt,at('11:00'));assert.equal(s.countdownTarget,at('11:30'));assert.equal(s.room,'');assert.ok(s.lunch);
  assert.equal(scheduleSnapshot(c,at('11:30')).state,'gap');
});

test('WMHS L2 splits class/passing/lunch/class at published boundaries',()=>{
  const c=wmhs('L2'),timeline=timelineFor(c,regularDate);
  const split=timeline.events.filter(e=>e.periodID==='4');
  assert.deepEqual(split.map(e=>[e.kind,e.startAt,e.endAt]),[
    ['academic',at('10:28'),at('11:07')],['passing',at('11:07'),at('11:10')],
    ['lunch',at('11:10'),at('11:34')],['academic',at('11:34'),at('12:14')]
  ]);
  const before=scheduleSnapshot(c,at('11:06'));assert.equal(before.countdownTarget,at('11:07'));assert.equal(before.next.kind,'lunch');
  const pass=scheduleSnapshot(c,at('11:07'));assert.equal(pass.state,'passing');assert.equal(pass.title,'Lunch');assert.equal(pass.room,'');assert.equal(pass.countdownTarget,at('11:10'));
  const lunch=scheduleSnapshot(c,at('11:10'));assert.equal(lunch.state,'active');assert.equal(lunch.title,'Lunch');assert.equal(lunch.countdownTarget,at('11:34'));assert.equal(lunch.lunch.selection,'L2');
  const after=scheduleSnapshot(c,at('11:34'));assert.equal(after.title,'Class 4');assert.equal(after.room,'204');assert.equal(after.countdownTarget,at('12:14'));
});

test('all WMHS lunch selections on regular and FLEX have no overlap or zero rows',()=>{
  for(const lunch of ['L1','L2','L3']) for(const date of [regularDate,flexDate]) {
    const c=wmhs(lunch),timeline=timelineFor(c,date),rule=c.templates[calendar.days[date].schedule].find(p=>p.id==='4').lunches[lunch];
    for(let i=1;i<timeline.events.length;i++)assert.ok(timeline.events[i-1].endAt<=timeline.events[i].startAt);
    assert.ok(timeline.events.every(e=>e.endAt>e.startAt));
    const s=scheduleSnapshot(c,at(rule.start,date));assert.equal(s.current.kind,'lunch');
    assert.equal(s.countdownTarget,at(rule.end,date));assert.equal(s.lunch.selection,lunch);
  }
});

test('L1 transition before block and L3 final lunch end respect exact edges',()=>{
  const l1=scheduleSnapshot(wmhs('L1'),at('10:24'));assert.equal(l1.state,'passing');assert.equal(l1.next.kind,'lunch');assert.equal(l1.countdownTarget,at('10:28'));
  const l3=scheduleSnapshot(wmhs('L3'),at('12:14'));assert.equal(l3.state,'passing');assert.equal(l3.next.id,'5');assert.equal(l3.current,null);
});

test('missing lunch selection and early-release templates do not invent lunches',()=>{
  assert.equal(timelineFor(wmhs(),regularDate).events.filter(e=>e.kind==='lunch').length,0);
  const c=wmhs('L2'),date='2027-06-17',timeline=timelineFor(c,date);
  assert.equal(timeline.day.schedule,'er');assert.equal(timeline.events.filter(e=>e.kind==='lunch').length,0);
  assert.equal(timeline.events.at(-1).endAt,at('10:54',date));
});

for (const selection of ['L1','L2','L3','NO_LUNCH',undefined]) {
  test(`native lunch ${selection ?? 'absent'} validates and uses only published splits`,()=>{
    const c=wmhs(selection),original=copy(c);
    for (const date of [regularDate,flexDate,'2027-06-17']) {
      const timeline=timelineFor(c,date),period=c.templates[timeline.day.schedule].find(p=>p.id==='4');
      const rows=timeline.events.filter(e=>e.periodID==='4');
      const rule=period.lunches?.[selection];
      if (rule) {
        const lunch=rows.filter(e=>e.kind==='lunch');
        assert.equal(lunch.length,1);assert.equal(lunch[0].startAt,at(rule.start,date));assert.equal(lunch[0].endAt,at(rule.end,date));
        assert.ok(rows.some(e=>e.kind==='academic'));assert.ok(rows.length>1);
      } else {
        assert.equal(rows.length,1);assert.equal(rows[0].kind,'academic');
        assert.equal(rows[0].startAt,at(period.start,date));assert.equal(rows[0].endAt,at(period.end,date));
        assert.equal(rows[0].title,'Class 4');assert.equal(rows[0].room,'204');assert.equal(rows[0].block,'A');
        assert.equal(timeline.events.filter(e=>e.kind==='lunch').length,0);
      }
    }
    assert.deepEqual(c,original);
  });
}
test('arbitrary native lunch selection remains invalid',()=>{
  assert.throws(()=>wmhs('NOT_A_LUNCH'),/Invalid lunch selection/);
});

test('completion at exact final meaningful end clears current/Next/countdown',()=>{
  for(const time of ['14:10','15:00']) {
    const s=scheduleSnapshot(wmhs('L2'),at(time));assert.equal(s.state,'complete');assert.equal(s.label,'DONE FOR TODAY');
    assert.equal(s.current,null);assert.equal(s.next,null);assert.equal(s.countdownTarget,null);assert.equal(s.room,'');
  }
});

test('no-school, exclusions, weekends, expired calendars, and delayed start are safe',()=>{
  const c=copy(demo);c.rotation.noSchoolDates=[regularDate];
  for(const time of ['07:00','08:00','08:22','12:30']) {
    const s=scheduleSnapshot(c,at(time));assert.equal(s.state,'no-school');assert.equal(s.events.length,0);assert.equal(s.countdownTarget,null);
  }
  assert.equal(scheduleSnapshot(demo,at('08:00','2026-10-03')).state,'weekend');
  assert.equal(scheduleSnapshot(wmhs(),at('08:00','2026-10-12')).state,'no-school');
  assert.equal(scheduleSnapshot(wmhs(),at('08:00','2027-01-05')).state,'unavailable');
  assert.equal(scheduleSnapshot(wmhs(),at('08:00','2027-09-01')).state,'no-school');
});

test('past/future day selection and explicit non-live preview never count down',()=>{
  const timeline=timelineFor(demo,'2026-10-02');
  const s=resolvePresentation(timeline,at('08:00'));assert.equal(s.state,'preview');assert.equal(s.countdownTarget,null);assert.equal(s.current,null);
  assert.equal(resolvePresentation(timelineFor(demo,regularDate),at('08:00'),{isLive:false}).state,'preview');
});

test('hero and full-day list reference the same generated event objects',()=>{
  const timeline=timelineFor(wmhs('L2'),regularDate);
  for(const time of ['06:59','07:00','08:00','08:29','11:08','11:20','11:40','14:10']) {
    const s=resolvePresentation(timeline,at(time));assert.equal(s.events,timeline.events);
    if(s.current)assert.ok(s.events.includes(s.current));if(s.next)assert.ok(s.events.includes(s.next));
  }
  assert.equal(new Set(timeline.events.map(e=>e.id)).size,timeline.events.length);
});

test('school timezone, DST offset, and midnight use school date rather than host',()=>{
  assert.equal(dateInZone(Date.parse('2026-10-02T02:00:00Z'),'America/New_York'),regularDate);
  assert.equal(zonedTimestamp('2026-11-02','07:30','America/New_York'),Date.parse('2026-11-02T12:30:00Z'));
  assert.equal(scheduleSnapshot(demo,Date.parse('2026-10-02T02:00:00Z')).state,'complete');
  assert.equal(scheduleSnapshot(demo,at('00:00')).state,'preview');
});

test('empty personal day is static without invented academic activities',()=>{
  const c=wmhs();c.assignments={};
  const s=scheduleSnapshot(c,at('08:00'));assert.equal(s.state,'preview');assert.equal(s.title,'No Scheduled Activities');assert.equal(s.events.length,0);assert.equal(s.countdownTarget,null);
});

test('Phase 1 backup and WMHS editor remain lossless after generating lunches',()=>{
  const c=wmhs('L2'),original=copy(c);
  scheduleSnapshot(c,at('11:20'));assert.deepEqual(c,original);
  const restored=importBackup({format:WEB_FORMAT,formatVersion:1,configuration:c});assert.deepEqual(restored,c);
  const edited=editManagedAssignments(restored,'Renamed',[{day:'1',period:'4',title:'Renamed class',room:'303'}]);
  assert.deepEqual(edited.templates,c.templates);assert.deepEqual(edited.calendar,c.calendar);assert.equal(edited.assignments['1']['4'].lunch,'L2');
  assert.equal(edited.schemaVersion,2);
});

console.log(`\n${passed} Phase 2 tests passed.`);
