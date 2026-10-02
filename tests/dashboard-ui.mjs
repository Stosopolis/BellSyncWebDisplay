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
  return {render(time){now=at(time);vm.runInContext('update()',sandbox);return node('#display').innerHTML;},stored:()=>JSON.parse(storage.getItem(profiles.PROFILE_KEY)),badge(event,mode){sandbox.event=event;sandbox.mode=mode;return vm.runInContext('scheduleBadge(event,mode)',sandbox);},density(count){sandbox.count=count;return vm.runInContext('scheduleDensity(count)',sandbox);}};
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
  assert.match(html,/<span class="badge"[^>]*>A<\/span>/);assert.match(html,/<strong[^>]*>Lunch 2<\/strong>/);
});
test('active card has NOW; only completed cards show completion checks',()=>{
  const html=renderer(imported()).render('11:30'),rows=cards(html),current=rows.filter(row=>row.includes('row current'));
  assert.equal(current.length,1);assert.match(current[0],/<strong[^>]*>Lunch 2<\/strong>/);assert.match(current[0],/class="now">NOW/);assert.ok(!current[0].includes('row-check'));
  for(const row of rows)assert.equal(row.includes('row-check'),row.includes('row complete'));
  assert.match(html,/<div class="event-title">Lunch 2<\/div>/);assert.match(html,/class="countdown"/);
});
test('block, period and hidden label settings survive card presentation',()=>{
  for(const mode of ['blocks','periods','hidden']) {
    const input=imported();input.preferences.scheduleLabels=mode;
    const html=renderer(input).render('11:30');
    if(mode==='hidden'){assert.ok(!html.includes('class="badge"'));assert.match(html,/no-label schedule-card/);}
    else assert.ok(html.includes(`>${mode==='blocks'?'A':'P1'}</span>`));
    assert.match(html,/<strong[^>]*>Algebra<\/strong>/);assert.match(html,/Room 204/);assert.match(html,/<strong[^>]*>Lunch 2<\/strong>/);assert.match(html,/<strong[^>]*>Passing to Lunch 2<\/strong>/);
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
test('compact block/period badges preserve full labels and longer source identities',()=>{
  const input=imported(),r=renderer(input),event=core.timelineFor(input,date).events.find(e=>e.periodID==='1');
  assert.equal(r.badge(event,'blocks'),'A');assert.equal(r.badge(event,'periods'),'P1');assert.equal(r.badge(event,'hidden'),'');
  assert.equal(r.badge({...event,blockID:'Design Studio',blockName:'Design Studio Block'},'blocks'),'Design Studio');
  assert.equal(r.badge({...event,blockID:null,blockName:null},'blocks'),'P1');
  input.assignments['1']['1'].block='Design Studio';input.assignments['1']['1'].title='A long class name that should wrap safely next to the time';
  const html=renderer(input).render('11:30');assert.match(html,/<span class="badge"[^>]*>Design Studio<\/span>/);
  assert.ok(html.includes('title="Design Studio Block"'));assert.ok(html.includes('aria-label="Design Studio Block"'));
  assert.match(html,/class="row-activity"/);assert.ok(html.includes(input.assignments['1']['1'].title));
});
test('lunch badges use only supplied L1/L2/L3 identities and retain full activity titles',()=>{
  for(const choice of ['L1','L2','L3']) {
    const input=imported();for(const rows of Object.values(input.assignments))rows['4'].lunch=choice;
    const html=renderer(input).render('11:30');assert.ok(html.includes(`>${choice}</span>`));assert.match(html,new RegExp(`<strong[^>]*>Lunch ${choice.slice(1)}<\\/strong>`));
  }
  const input=imported();for(const rows of Object.values(input.assignments))rows['4'].lunch='NO_LUNCH';
  const html=renderer(input).render('11:30');assert.ok(!/>L[123]<\/span>/.test(html));assert.ok(!/>Lunch [123]<\/strong>/.test(html));
});
test('adaptive row density follows visible event count and stays stable after completion',()=>{
  const r=renderer(imported());
  for(const [count,density] of [[0,'relaxed'],[6,'relaxed'],[8,'relaxed'],[9,'balanced'],[11,'balanced'],[12,'busy'],[18,'busy']])assert.equal(r.density(count),density);
  for(const count of [6,8,9,11,12,18]) {
    const input=copy(demo),clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
    input.periods=Array.from({length:count},(_,i)=>({id:`p${i+1}`,label:`Period ${i+1}`,start:clock(450+i*20),end:clock(465+i*20),kind:'academic'}));
    input.templates={regular:copy(input.periods)};input.assignments={every:Object.fromEntries(input.periods.map(p=>[p.id,{title:`Activity ${p.id}`,room:'204'}]))};
    const render=renderer(core.normalize(input));
    for(const time of ['07:35','18:00']) {
      const html=render.render(time);assert.equal(cards(html).length,count);assert.ok(html.includes(`class="rows ${r.density(count)}" data-row-count="${count}"`));
    }
  }
});
test('card states are explicit without changing event inclusion or reserving oversized current cards',()=>{
  const input=imported(),html=renderer(input).render('11:30'),rows=cards(html);
  assert.equal(rows.length,core.timelineFor(input,date).events.length);
  assert.ok(rows.some(row=>row.includes('row complete')));assert.ok(rows.some(row=>row.includes('row current')));assert.ok(rows.some(row=>row.includes('row future')));
  for(const row of rows){assert.match(row,/class="row-state"/);assert.match(row,/class="row-completion"/);}
  assert.match(css,/\.rows\s*\{[^}]*display:flex[^}]*flex:1[^}]*min-height:0/);
  assert.match(css,/--card-max:\d+px/);assert.match(css,/\.rows.busy \.row\s*\{[^}]*flex:0 0 auto/);
  assert.match(css,/@container schedule-panel \(max-width:430px\)/);
  assert.match(css,/grid-template-areas:"activity" "trailing"/);
});
console.log(`\n${passed} dashboard UI tests passed.`);
