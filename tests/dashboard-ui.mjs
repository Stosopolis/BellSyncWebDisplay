import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../display-core.mjs';
import * as states from '../schedule-presentation.mjs';
import * as profiles from '../profile-store.mjs';
import { builtInConfiguration } from '../school-setup.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const demo=core.normalize(read('../public/samples/classroom-demo.json'));
const school=read('../public/builtins/wmhs/schedule.json'),calendar=read('../public/builtins/wmhs/calendar.json');
const date='2026-09-01',at=t=>core.zonedTimestamp(date,t,'America/New_York');
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const copy=v=>structuredClone(v);
function renderer(input,renderDate=date) {
  const fixedAt=t=>core.zonedTimestamp(renderDate,t,'America/New_York');
  let now=fixedAt('11:30'),lastMarkup='',scroller=null;
  const rowMarkup=html=>html.match(/<div class="rows [^>]*>([\s\S]*)<\/div><\/aside>/)?.[1] || '';
  function scrollNode(html) {
    let content=html;
    return {scrollTop:0,writes:0,get innerHTML(){return content.replace(/(<path\b[^>]*?)\/>/g,'$1></path>');},set innerHTML(value){content=value;this.writes++;}};
  }
  const nodes=new Map(),node=k=>{if(!nodes.has(k))nodes.set(k,{innerHTML:'',addEventListener(){},remove(){},append(){},querySelector:node,focus(){}});return nodes.get(k);};
  const display=node('#display');
  Object.defineProperty(display,'innerHTML',{configurable:true,get:()=>lastMarkup,set:html=>{lastMarkup=html;scroller=html.includes('class="rows ')?scrollNode(rowMarkup(html)):null;}});
  let header=null;
  const oldSetter=Object.getOwnPropertyDescriptor(display,'innerHTML').set;
  // Model mounted header identity separately from changing card markup.
  Object.defineProperty(display,'innerHTML',{configurable:true,get:()=>lastMarkup,set:html=>{oldSetter(html);header={logo:{src:'./public/assets/bellsync-display-icon.png'},clock:{textContent:''},meta:{textContent:''},full:{textContent:'',setAttribute(){}}};}});
  const liveLeft={querySelector(selector){
    if(selector==='.clock')return header.clock;if(selector==='.meta')return header.meta;if(selector==='#full')return header.full;
    if(selector==='.header')return {insertAdjacentElement(position,next){lastMarkup=next.markup;}};
    return lastMarkup.includes(selector.slice(1))?{replaceWith(next){lastMarkup=next.markup;},remove(){}}:null;
  },append(next){lastMarkup=next.markup;}};
  display.querySelector=selector=>selector==='.rows'?scroller:liveLeft;
  const temporary=()=>{let markup='';return {get innerHTML(){return markup;},set innerHTML(value){markup=value;},querySelector:()=>({querySelector(selector){
    if(selector==='.clock' || selector==='.meta' || selector==='#full')return {textContent:markup.match(new RegExp(`(?:class="${selector.slice(1)}"|id="${selector.slice(1)}")[^>]*>([^<]*)`))?.[1] || '',getAttribute(){return 'false';}};
    return markup.includes(selector.slice(1))?{markup}:null;
  }})};};
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const sandbox={...core,...states,...profiles,esc:core.escapeHTML,Intl,Date:FixedDate,JSON,Set,crypto:globalThis.crypto,document:{querySelector:node,querySelectorAll:()=>[],createElement:temporary,body:node('body'),addEventListener(){}},localStorage:storage,clearInterval(){},setInterval(){},alert:m=>{throw Error(m);}};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);sandbox.input=input;vm.runInContext('save(input,null)',sandbox);
  return {header:()=>header,scroller:()=>scroller,node,render(time){now=fixedAt(time);vm.runInContext('update()',sandbox);return lastMarkup;},stored:()=>JSON.parse(storage.getItem(profiles.PROFILE_KEY)),badge(event,mode){sandbox.event=event;sandbox.mode=mode;return vm.runInContext('scheduleBadge(event,mode)',sandbox);},density(count){sandbox.count=count;return vm.runInContext('scheduleDensity(count)',sandbox);}};
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
test('live long countdown uses hour typography and the rendered mint ring decreases',()=>{
  const c=imported();for(const rows of Object.values(c.assignments)) rows['4'].lunch='NO_LUNCH';
  const r=renderer(c),start=r.render('10:28'),middle=r.render('11:21'),late=r.render('12:13');
  const progress=html=>Number(html.match(/style="--progress:([^"]+)"/)[1]);
  assert.equal(progress(start),100);assert.equal(progress(middle),50);assert.ok(progress(late)<1);
  assert.match(start,/class="countdown has-hours">1:46:00/);assert.match(middle,/class="countdown">53:00/);
  assert.match(css,/conic-gradient\(var\(--mint\) calc\(var\(--progress\)\*1%\)/);
  assert.match(css,/font-variant-numeric:tabular-nums/);assert.match(css,/\.countdown.has-hours[^}]*font-size:clamp/);
});
test('schedule layout gives only rows a bounded shrinking scroll region',()=>{
  assert.match(css,/\.schedule\s*\{[^}]*min-height:0[^}]*display:flex[^}]*flex-direction:column[^}]*height:calc\(100dvh[^}]*overflow:hidden/);
  assert.match(css,/\.rows\s*\{[^}]*overflow-y:auto[^}]*overflow-x:hidden[^}]*overscroll-behavior-y:contain[^}]*flex:1 1 0[^}]*min-height:0/);
  assert.match(css,/\.schedule h2\s*\{[^}]*flex:0 0 auto/);
  assert.match(css,/\.snapshot-dates\s*\{[^}]*flex:0 0 auto/);
  assert.match(css,/@media\(max-width:850px\)[^\n]*\.schedule\{height:48vh;height:48dvh;max-height:48dvh\}/);
});
test('live countdown ticks retain the same mounted scroller and row content',()=>{
  const input=profiles.nativeConfigurations(profiles.inspectNativeImport(read('./fixtures/canterbury-room2-v2.json')))[0];
  const r=renderer(input,'2026-10-01');r.render('11:30');const region=r.scroller();region.scrollTop=640;const writes=region.writes;
  const first=r.render('11:31'),next=r.render('11:32');
  assert.strictEqual(r.scroller(),region);assert.equal(region.scrollTop,640);assert.equal(region.writes,writes);
  assert.notEqual(first.match(/class="countdown">([^<]*)/)[1],next.match(/class="countdown">([^<]*)/)[1]);
  r.render('12:01');assert.strictEqual(r.scroller(),region);assert.equal(region.scrollTop,640);assert.ok(region.writes>writes);
});
for(const showSchedule of [true,false])test(`live header/logo remain mounted with schedule visible=${showSchedule}`,()=>{
 const input=copy(demo);input.preferences.showSchedule=showSchedule;
 const r=renderer(input);const header=r.header(),logo=header.logo;
 const first=r.render('11:30'),second=r.render('11:31');
 assert.strictEqual(r.header(),header);assert.strictEqual(r.header().logo,logo);
 assert.equal(logo.src,'./public/assets/bellsync-display-icon.png');
 assert.notEqual(first.match(/class="clock">([^<]*)/)[1],second.match(/class="clock">([^<]*)/)[1]);
});
test('date changes reset the schedule region while subsequent ticks preserve it',()=>{
  const input=profiles.nativeConfigurations(profiles.inspectNativeImport(read('./fixtures/canterbury-room2-v2.json')))[0];
  const r=renderer(input,'2026-10-01');const today=r.scroller();today.scrollTop=500;r.node('#next-date').onclick();
  const tomorrow=r.scroller();assert.notStrictEqual(tomorrow,today);assert.equal(tomorrow.scrollTop,0);
  tomorrow.scrollTop=200;r.render('11:31');assert.strictEqual(r.scroller(),tomorrow);assert.equal(tomorrow.scrollTop,200);
  r.node('#today-date').onclick();assert.notStrictEqual(r.scroller(),tomorrow);assert.equal(r.scroller().scrollTop,0);
});
for(const [name,badge,title,hidden] of [
  ['identical','Arrival','Arrival',true],
  ['case-only','LUNCH','Lunch',true],
  ['punctuation-only','Ms. Christine Prep','Ms Christine Prep!',true],
  ['whitespace-only','  PM   Snack ','PM Snack',true],
  ['generic lunch category','LUNCH','Lunch 3',true],
  ['A block','A','Intro',false],
  ['B block','B','Multimedia Presentation',false],
  ['unrelated FLEX','FLEX','Academic Support',false]
])test(`${name} badge semantic comparison ${hidden?'hides':'keeps'} badge`,()=>{
  assert.equal(core.isRedundantScheduleBadge(badge,title),hidden);
  const event={id:'test',kind:'other',label:badge,title};
  assert.equal(renderer(demo).badge(event,'blocks'),hidden?'':badge);
});
test('badge-free cards reclaim the column while useful badges retain their grid',()=>{
  const input=copy(demo);input.assignments.every[input.periods[0].id].title='P1';
  const html=renderer(input).render('07:35'),row=cards(html)[0];
  assert.match(row,/no-label schedule-card/);assert.ok(!row.includes('class="badge"'));assert.match(row,/row-trailing/);assert.match(row,/class="now">NOW/);
  const useful=cards(renderer(imported()).render('07:35'))[0];assert.ok(!useful.includes('no-label'));assert.match(useful,/class="badge"/);
  assert.match(css,/\.row.no-label\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto;grid-template-areas:"activity trailing"/);
  assert.match(css,/grid-template-areas:"activity" "trailing"/);
  assert.equal(core.isRedundantScheduleBadge('Outdoor / Indoor Recess','Outdoor Indoor Recess'),true);
  assert.equal(core.isRedundantScheduleBadge('L3','Lunch 3'),false);
  assert.equal(core.isRedundantScheduleBadge('Lunch','Lunch Duty'),false);
});
test('portable Canterbury activity and owner cards omit redundant badges without losing content',()=>{
  const input=profiles.nativeConfigurations(profiles.inspectNativeImport(read('./fixtures/canterbury-room2-v2.json')))[0];
  const r=renderer(input,'2026-10-01'),before=r.stored(),html=r.render('13:15'),rows=cards(html);
  for(const title of ['Arrival','Centers','Cleanup','Kidzfun','Rest','Bathroom','PM Snack','Ms. Christine Prep']) {
    const row=rows.find(r=>r.includes(`>${title}</strong>`));assert.ok(row,title);assert.match(row,/no-label schedule-card/);assert.ok(!row.includes('class="badge"'));assert.match(row,/<time>/);assert.match(row,/Ends /);
  }
  const current=rows.find(r=>r.includes('row current'));assert.match(current,/Ms. Christine Prep/);assert.match(current,/class="now">NOW/);
  assert.ok(rows.some(r=>r.includes('row-check')));assert.deepEqual(r.stored(),before);
});
test('Galvin dashboard keeps useful period labels and source data unchanged',()=>{
  const input=builtInConfiguration('gms',read('../public/builtins/gms/schedule.json'),read('../public/builtins/gms/calendar.json'),6);
  input.assignments['1'].P1.title='Multimedia Presentation';
  const r=renderer(input,'2026-09-02'),before=r.stored(),html=r.render('08:30');
  assert.match(html,/class="badge"[^>]*>P1<\/span>/);assert.match(html,/Multimedia Presentation/);assert.deepEqual(r.stored(),before);
});
const navigationProfiles=[
  ['WMHS imported',imported(),date],
  ['WMHS built-in',builtInConfiguration('wmhs',school,calendar),date],
  ['Galvin',builtInConfiguration('gms',read('../public/builtins/gms/schedule.json'),read('../public/builtins/gms/calendar.json'),6),'2026-09-02'],
  ['portable Canterbury',profiles.nativeConfigurations(profiles.inspectNativeImport(read('./fixtures/canterbury-room2-v2.json')))[0],'2026-10-01'],
  ['manual',core.normalize({...copy(demo),sourceKind:'browser-local'}),date]
];
for(const [name,input,today] of navigationProfiles)test(`${name} date controls browse and survive ticks without replacing the scroller`,()=>{
  const r=renderer(input,today),before=r.stored(),markup=r.render('11:30');
  assert.match(markup,/<h2>TODAY'S SCHEDULE<\/h2><div class="snapshot-dates">/);
  for(const id of ['previous-date','view-date','next-date','tomorrow-date','today-date'])assert.ok(markup.includes(`id="${id}"`),id);
  assert.match(markup,/>Tomorrow<\/button>/);assert.match(markup,/>Today<\/button>/);
  const shift=(key,days)=>new Date(Date.parse(`${key}T12:00Z`)+days*86400000).toISOString().slice(0,10);
  const selected=html=>html.match(/id="view-date"[^>]*value="([^"]+)"/)[1];
  r.node('#previous-date').onclick();assert.equal(selected(r.render('11:31')),shift(today,-1));
  r.node('#next-date').onclick();assert.equal(selected(r.render('11:32')),today);
  r.node('#tomorrow-date').onclick();assert.equal(selected(r.render('11:33')),shift(today,1));
  const region=r.scroller();region.scrollTop=320;
  const tick=r.render('11:34');assert.equal(selected(tick),shift(today,1));assert.strictEqual(r.scroller(),region);assert.equal(region.scrollTop,320);
  const chosen='2026-10-01';r.node('#view-date').onchange({target:{value:chosen,blur(){}}});
  const preview=r.render('11:35');assert.equal(selected(preview),chosen);assert.equal(cards(preview).length,core.timelineFor(input,chosen).events.length);
  if(chosen!==today){assert.match(preview,/<h2>SCHEDULE<\/h2>/);assert.ok(!preview.includes('class="now">NOW'));}
  r.node('#today-date').onclick();assert.equal(selected(r.render('11:36')),today);assert.equal(r.scroller().scrollTop,0);
  assert.deepEqual(r.stored(),before);
});
test('date controls stay outside the scroll rows and wrap at every width',()=>{
  const html=renderer(imported()).render('11:30');assert.match(html,/id="today-date">Today<\/button><\/div><div class="rows /);
  assert.match(css,/\.snapshot-dates\s*\{[^}]*flex:0 0 auto[^}]*flex-wrap:wrap/);
  assert.ok(!/\.snapshot-dates[^{}]*\{[^}]*display:none/.test(css));
});
test('today unresolved lunch uses today-specific warning copy',()=>{
  const input=imported();delete input.assignments['2']['4'].lunch;
  const html=renderer(input,'2026-10-05').render('11:30');assert.equal(core.schoolDay(input,'2026-10-05').day,2);
  assert.match(html,/<strong>Lunch not set for today<\/strong>/);assert.match(html,/Today’s long-block countdown may include lunch\./);
});
test('today configured with other missing lunches shows incomplete setup, including NO_LUNCH',()=>{
  for(const todayLunch of ['L2','NO_LUNCH']){
    const input=imported();input.assignments['2']['4'].lunch=todayLunch;delete input.assignments['1']['4'].lunch;
    const r=renderer(input,'2026-10-05'),before=r.stored(),html=r.render('11:30');
    assert.match(html,/<strong>Lunch setup incomplete<\/strong>/);assert.match(html,/Some lunch assignments are still missing for this schedule\. Long-block countdowns may be incorrect on those days\./);
    assert.ok(!html.includes('Lunch not set for today'));assert.deepEqual(r.stored(),before);
  }
});
test('all lunch assignments configured omit the warning',()=>{
  for(const choice of ['L1','L2','L3','NO_LUNCH']){
    const input=imported();for(const rows of Object.values(input.assignments))rows['4'].lunch=choice;
    assert.ok(!renderer(input,'2026-10-05').render('11:30').includes('class="lunch-warning"'));
  }
});
test('header formats the effective Day 2 and Regular with readable typography',()=>{
  assert.equal(core.headerScheduleLabel({day:2,schedule:'regular'}),'Day 2 · Regular');
  const html=renderer(imported(),'2026-10-05').render('11:30');assert.match(html,/Monday, October 5 · Day 2 · Regular/);
  assert.match(css,/\.header \.meta\s*\{[^}]*font-size:clamp\(1\.1rem,1\.8vw,1\.6rem\)[^}]*font-weight:650[^}]*margin-top:12px/);
});
test('header preserves named rotations and no-day fallback without inventing numbers',()=>{
  assert.equal(core.headerScheduleLabel(null),'No student schedule');
  assert.equal(core.headerScheduleLabel({schedule:'regular'}),'Regular');
  assert.equal(core.headerScheduleLabel({day:'room-2',dayLabel:'Room 2',schedule:'regular'}),'Room 2 · Regular');
  assert.equal(core.headerScheduleLabel({day:'day-2',dayLabel:'Day 2',schedule:'regular'}),'Day 2 · Regular');
});
test('optional progress stays compact, off by default, and hides day bar at completion',()=>{
  const input=imported();assert.ok(!renderer(input).render('11:30').includes('class="school-progress"'));
  input.preferences.schoolDayProgress=true;input.preferences.schoolYearProgress=true;
  const r=renderer(input),html=r.render('11:30');assert.match(html,/SCHOOL DAY/);assert.match(html,/SCHOOL YEAR/);assert.match(html,/of \d+ school days complete/);assert.equal((html.match(/<progress /g)||[]).length,2);
  const region=r.scroller();region.scrollTop=300;r.render('11:31');assert.strictEqual(r.scroller(),region);assert.equal(region.scrollTop,300);
  const end=r.render('14:10');assert.ok(!end.includes('SCHOOL DAY'));assert.match(end,/SCHOOL YEAR/);assert.match(end,/Done for today/);
  assert.match(css,/\.school-progress progress\s*\{[^}]*height:5px/);
});
const doyleRaw=()=>read('../public/builtins/doyle/prek-a.json');
const importedDoyle=raw=>profiles.nativeConfigurations(profiles.inspectNativeImport(raw))[0];
const visibleText=html=>html.replace(/<[^>]*>/g,'');
test('source activity with no override appears once within its schedule row',()=>{
 const c=importedDoyle(doyleRaw()),html=renderer(c,'2026-10-07').render('11:35');
 const row=cards(html).find(r=>r.includes('Fundations / Heggarty'));
 assert.equal(visibleText(row).split('Fundations / Heggarty').length-1,1);assert.ok(!row.includes('class="badge"'));
});
test('local activity display overrides replace source activity badges in every label mode',()=>{
 const c=importedDoyle(doyleRaw());c.portable.edits=[{type:'period',id:'activity-7',title:'Foundations / H'},{type:'period',id:'activity-4',title:'Recess3454'},{type:'period',id:'activity-10',title:'Rest (confirm...)'}];
 for(const mode of ['blocks','periods','hidden']) {
  const input=copy(c);input.preferences.scheduleLabels=mode;const html=renderer(input,'2026-10-07').render('11:35');
  for(const title of ['Foundations / H','Recess3454','Rest (confirm...)']) {
   const row=cards(html).find(r=>r.includes(`>${title}</strong>`));assert.ok(row,title);assert.equal(visibleText(row).split(title).length-1,1);assert.ok(!row.includes('class="badge"'));
  }
  assert.ok(!html.includes('Fundations / Heggarty'));assert.ok(!html.includes('Rest (confirmed portion)'));
 }
});
test('active and next cards use only the effective activity title while current highlighting remains',()=>{
 const c=importedDoyle(doyleRaw());c.portable.edits=[{type:'period',id:'activity-7',title:'Foundations / H'}];
 const active=renderer(c,'2026-10-07').render('11:35'),row=cards(active).find(r=>r.includes('Foundations / H'));
 assert.match(row,/row current/);assert.match(row,/class="now">NOW/);assert.match(active,/class="event-title">Foundations \/ H</);assert.ok(!active.includes('Fundations / Heggarty'));
 const before=renderer(c,'2026-10-07').render('11:25'),next=before.match(/<article class="next-card">([\s\S]*?)<\/article>/)[1];
 assert.match(next,/<b>Foundations \/ H<\/b>/);assert.ok(!next.includes('Fundations / Heggarty'));assert.equal(visibleText(next).split('Foundations / H').length-1,1);
});
test('native name overrides and owner-activity overrides also suppress source-name badges',()=>{
 const raw=doyleRaw(),base=importedDoyle(raw),event=core.timelineFor(base,'2026-10-07').events.find(e=>e.periodID==='activity-7');
 raw.activityNameOverrides=[{source:event.activitySource,title:'Native custom name'}];
 const html=renderer(importedDoyle(raw),'2026-10-07').render('11:35');assert.ok(!html.includes('Fundations / Heggarty'));assert.match(html,/Native custom name/);
 const owner=profiles.nativeConfigurations(profiles.inspectNativeImport(read('./fixtures/canterbury-room2-v2.json')))[0];
 const ownerEvent=core.timelineFor(owner,'2026-10-01').events.find(e=>e.owner);
 owner.portable.edits=[{type:'personal',id:ownerEvent.sourceID,title:'Owner custom name'}];
 const row=cards(renderer(owner,'2026-10-01').render('11:35')).find(r=>r.includes('Owner custom name'));assert.ok(row);assert.ok(!row.includes('class="badge"'));
});
test('bathroom point reminders show one title with their semantic subtitle',()=>{
 const html=renderer(importedDoyle(doyleRaw()),'2026-10-07').render('09:20');
 const points=cards(html).filter(r=>r.includes('Point reminder'));
 assert.equal(points.length,3);for(const row of points){assert.equal(visibleText(row).split('Bathroom').length-1,1);assert.match(row,/Point reminder · classroom activity continues/);assert.ok(!row.includes('class="badge"'));}
});
test('effective room overrides replace the original room in schedule and hero',()=>{
 const raw=read('./fixtures/canterbury-room2-v2.json');raw.personalActivities[0].room='OriginalRoom';
 const c=profiles.nativeConfigurations(profiles.inspectNativeImport(raw))[0];c.portable.edits=[{type:'personal',id:raw.personalActivities[0].id,title:'Custom activity',room:'EffectiveRoom'}];
 const html=renderer(c,'2026-10-01').render(raw.personalActivities[0].start);assert.ok(!html.includes('OriginalRoom'));assert.match(html,/<small>Room EffectiveRoom<\/small>/);assert.match(html,/class="details">Room EffectiveRoom/);
});
console.log(`\n${passed} dashboard UI tests passed.`);
