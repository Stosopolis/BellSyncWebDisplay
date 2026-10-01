import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../display-core.mjs';
import * as states from '../schedule-presentation.mjs';
import * as profiles from '../profile-store.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const demo=core.normalize(read('../public/samples/classroom-demo.json'));
const school=read('../public/builtins/wmhs/schedule.json'),calendar=read('../public/builtins/wmhs/calendar.json');
const date='2026-09-01',at=t=>core.zonedTimestamp(date,t,'America/New_York');
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const copy=v=>structuredClone(v);
function renderer(input) {
  let now=at('11:30');
  const nodes=new Map(),node=k=>{if(!nodes.has(k))nodes.set(k,{innerHTML:'',addEventListener(){},remove(){},append(){},querySelector:node,focus(){}});return nodes.get(k);};
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const sandbox={...core,...states,...profiles,esc:core.escapeHTML,Intl,Date:FixedDate,JSON,Set,crypto:globalThis.crypto,document:{querySelector:node,querySelectorAll:()=>[],createElement:()=>node('new'),body:node('body'),addEventListener(){}},localStorage:storage,clearInterval(){},setInterval(){},alert:m=>{throw Error(m);}};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);sandbox.input=input;vm.runInContext('save(input,null)',sandbox);
  return {render(time){now=at(time);vm.runInContext('update()',sandbox);return node('#display').innerHTML;},stored:()=>JSON.parse(storage.getItem(profiles.PROFILE_KEY))};
}
function imported() {
  const assignments=copy(school.assignments);
  for(const rows of Object.values(assignments)){rows['4'].lunch='L2';rows['4'].title='Algebra';rows['4'].room='204';}
  return profiles.nativeConfigurations(profiles.inspectNativeImport({formatVersion:1,schoolProfileID:'wmhs',scheduleName:'Teacher',assignments}),school,calendar)[0];
}
const cards=html=>html.match(/<div class="row [^"]*schedule-card">[\s\S]*?<\/time>[\s\S]*?<\/div><\/div>/g) || [];
let passed=0;
function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}

test('completion check replaces countdown with one completion title',()=>{
  const r=renderer(imported()),before=r.stored(),html=r.render('14:10');
  assert.match(html,/<svg class="completion-check"/);assert.match(html,/ring is-complete/);
  assert.match(html,/<div class="state-label">COMPLETE<\/div>/);
  assert.equal((html.match(/Done for today/gi)||[]).length,1);
  assert.match(html,/<div class="event-title">Done for today<\/div>/);
  assert.ok(!html.includes('class="countdown"'));assert.ok(!html.includes('—'));assert.ok(!html.includes('No active bell'));
  assert.ok(!html.includes('class="details"'));assert.deepEqual(r.stored(),before);
});
test('all completed events stay as individual cards with trailing checks and times',()=>{
  const input=imported(),html=renderer(input).render('14:10'),rows=cards(html),events=core.timelineFor(input,date).events;
  assert.equal(rows.length,events.length);
  for(const row of rows){assert.match(row,/row complete/);assert.match(row,/<div class="row-trailing">/);assert.match(row,/class="row-check"/);assert.match(row,/<time>/);}
  assert.ok(html.includes('<span class="badge">A Block</span>'));assert.ok(html.includes('<strong>Lunch 2</strong>'));
});
test('active card has NOW; only completed cards show completion checks',()=>{
  const html=renderer(imported()).render('11:30'),rows=cards(html),current=rows.filter(row=>row.includes('row current'));
  assert.equal(current.length,1);assert.match(current[0],/<strong>Lunch 2<\/strong>/);assert.match(current[0],/class="now">NOW/);assert.ok(!current[0].includes('row-check'));
  for(const row of rows)assert.equal(row.includes('row-check'),row.includes('row complete'));
  assert.match(html,/<div class="event-title">Lunch 2<\/div>/);assert.match(html,/class="countdown"/);
});
test('block, period and hidden label settings survive card presentation',()=>{
  for(const mode of ['blocks','periods','hidden']) {
    const input=imported();input.preferences.scheduleLabels=mode;
    const html=renderer(input).render('11:30');
    if(mode==='hidden'){assert.ok(!html.includes('class="badge"'));assert.match(html,/no-label schedule-card/);}
    else assert.ok(html.includes(`<span class="badge">${mode==='blocks'?'A Block':'Period 1'}</span>`));
    assert.match(html,/<strong>Algebra<\/strong>/);assert.match(html,/Room 204/);assert.match(html,/<strong>Lunch 2<\/strong>/);assert.match(html,/<strong>Passing to Lunch 2<\/strong>/);
  }
});
test('before-school, active, gap, and passing retain live countdowns',()=>{
  const manual=renderer(demo);
  for(const [time,label] of [['07:00','BEFORE SCHOOL'],['07:35','NOW'],['08:22','UP NEXT']]) {
    const html=manual.render(time);assert.match(html,/class="countdown">\d+:\d{2}/);assert.ok(html.includes(`<div class="state-label">${label}</div>`));assert.ok(!html.includes('completion-check'));
  }
  const html=renderer(imported()).render('11:07');assert.match(html,/class="countdown">3:00/);assert.match(html,/<div class="event-title">Passing to Lunch 2<\/div>/);
});
test('12/24-hour times, fullscreen button, and branding remain visible',()=>{
  const input=imported(),twelve=renderer(input).render('11:30');input.preferences.hour24=true;
  const twentyFour=renderer(input).render('11:30');
  assert.match(twelve,/<time>7:30 AM/);assert.match(twentyFour,/<time>07:30/);
  for(const html of [twelve,twentyFour]){assert.match(html,/id="full" aria-pressed="false">Full Screen/);assert.match(html,/bellsync-display-icon.png/);}
});
test('card CSS retains responsive layout and readable completed/active styling',()=>{
  assert.match(css,/\.row\s*\{[^}]*border:1px solid var\(--line\)/);
  assert.match(css,/\.row.complete\s*\{[^}]*opacity:\.78/);
  assert.match(css,/\.row.current\s*\{[^}]*box-shadow:inset 3px 0 0 var\(--mint\)/);
  assert.match(css,/@media\(max-width:850px\)\{\.dashboard\{grid-template-columns:1fr\}/);
  assert.match(css,/@media\(max-width:520px\)\{\.row/);
  assert.match(css,/\.row.no-label\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
});
console.log(`\n${passed} dashboard UI tests passed.`);
