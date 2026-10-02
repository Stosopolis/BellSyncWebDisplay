import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../display-core.mjs';
import * as states from '../schedule-presentation.mjs';
import * as profiles from '../profile-store.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const school=read('../public/builtins/wmhs/schedule.json'),calendar=read('../public/builtins/wmhs/calendar.json');
const demo=core.normalize(read('../public/samples/classroom-demo.json'));
const date='2026-09-01',at=t=>core.zonedTimestamp(date,t,'America/New_York');
const copy=v=>structuredClone(v);
function imported(lunch='L2') {
  const assignments=copy(school.assignments);
  for(const rows of Object.values(assignments)){rows['4'].lunch=lunch;rows['4'].title='Algebra';rows['4'].room='204';}
  return profiles.nativeConfigurations(profiles.inspectNativeImport({formatVersion:1,schoolProfileID:'wmhs',scheduleName:'Teacher',assignments}),school,calendar)[0];
}
let passed=0;
function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}

test('A and G block names use assignment identity rather than period number',()=>{
  const c=imported();
  const a=core.timelineFor(c,date).events.find(e=>e.periodID==='1');
  assert.equal(a.blockID,'A');assert.equal(a.blockName,'A Block');assert.equal(core.scheduleRowLabel(a,'blocks'),'A Block');
  const day2=Object.keys(calendar.days).find(d=>calendar.days[d].day===2 && calendar.days[d].schedule==='regular');
  const g=core.timelineFor(c,day2).events.find(e=>e.periodID==='1');
  assert.equal(g.blockID,'G');assert.equal(core.scheduleRowLabel(g,'blocks'),'G Block');assert.equal(g.sourcePeriodLabel,'Period 1');
});
test('missing or blank metadata falls back without inferring blocks',()=>{
  for(const block of [undefined,'','  ']){
    const c=imported();c.assignments['1']['1'].block=block;
    const e=core.timelineFor(core.normalize(c),date).events.find(e=>e.periodID==='1');
    assert.equal(e.blockID,null);assert.equal(core.scheduleRowLabel(e,'blocks'),'Period 1');
  }
});
test('all three preferences change only row labels and validate canonically',()=>{
  const c=imported(),timeline=core.timelineFor(c,date),event=timeline.events.find(e=>e.periodID==='1');
  assert.equal(core.scheduleRowLabel(event,'blocks'),'A Block');assert.equal(core.scheduleRowLabel(event,'periods'),'Period 1');assert.equal(core.scheduleRowLabel(event,'hidden'),'');
  for(const mode of ['blocks','periods','hidden']) {
    c.preferences.scheduleLabels=mode;assert.deepEqual(core.timelineFor(core.normalize(c),date),timeline);
  }
  c.preferences.scheduleLabels='Block names';assert.throws(()=>core.normalize(c),/Invalid schedule label preference/);
});
test('WMHS defaults and legacy migration use blocks; manual defaults use periods',()=>{
  const c=imported();assert.equal(c.preferences.scheduleLabels,'blocks');delete c.preferences.scheduleLabels;
  assert.equal(core.normalize(c).preferences.scheduleLabels,'blocks');assert.equal(demo.preferences.scheduleLabels,'periods');
  c.preferences.scheduleLabels='periods';assert.equal(core.normalize(c).preferences.scheduleLabels,'periods');
});
for(const choice of ['L1','L2','L3'])test(`${choice} is numbered in rows, hero, next and passing`,()=>{
  const c=imported(choice),rule=school.bells.regular.find(p=>p.id==='4').lunches[choice],name=`Lunch ${choice.slice(1)}`;
  const events=core.timelineFor(c,date).events;
  const lunch=events.find(e=>e.kind==='lunch'),passing=events.find(e=>e.kind==='passing');
  assert.equal(core.eventTitle(lunch),name);assert.equal(core.scheduleRowLabel(lunch,'blocks'),name);assert.equal(core.scheduleRowLabel(lunch,'periods'),name);
  assert.equal(states.scheduleSnapshot(c,at(rule.start)).title,name);
  assert.equal(core.eventTitle(states.scheduleSnapshot(c,at(rule.bell_start)).next),name);
  assert.equal(passing.title,`Passing to ${name}`);assert.equal(states.scheduleSnapshot(c,at(rule.bell_start)).title,`Passing to ${name}`);
  assert.equal(lunch.blockID,null);assert.equal(passing.blockID,null);
});
test('split class pieces retain the same block identity and source period label',()=>{
  const rows=core.timelineFor(imported('L2'),date).events.filter(e=>e.periodID==='4' && e.kind==='academic');
  assert.equal(rows.length,2);
  for(const e of rows){assert.equal(e.blockID,'D');assert.equal(e.blockName,'D Block');assert.equal(e.sourcePeriodLabel,'Period 4');assert.equal(core.scheduleRowLabel(e,'blocks'),'D Block');assert.equal(e.title,'Algebra');assert.equal(e.room,'204');}
});
test('NO_LUNCH and missing lunch have no invented lunch rows or labels',()=>{
  for(const selection of ['NO_LUNCH',undefined]) {
    const c=imported();for(const rows of Object.values(c.assignments)){if(selection===undefined)delete rows['4'].lunch;else rows['4'].lunch=selection;}
    const events=core.timelineFor(core.normalize(c),date).events;
    assert.equal(events.filter(e=>e.kind==='lunch' || e.lunch?.selection).length,0);
    const row=events.find(e=>e.periodID==='4');assert.equal(core.scheduleRowLabel(row,'blocks'),'D Block');assert.equal(core.eventTitle(row),'Algebra');
  }
});

// Execute the actual settings submit and dashboard renderer with inert DOM nodes.
test('settings persist per profile, hide real badges, and survive restart and backups',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  const nodes=new Map(),node=k=>{if(!nodes.has(k))nodes.set(k,{innerHTML:'',textContent:'',addEventListener(){},remove(){},append(){},querySelector:node,focus(){}});return nodes.get(k);};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[at('11:30')]));}static now(){return at('11:30');}}
  const sandbox={...core,...states,...profiles,esc:core.escapeHTML,Intl,Date:FixedDate,JSON,Set,crypto:globalThis.crypto,document:{querySelector:node,querySelectorAll:()=>[],createElement:()=>node('new'),body:node('body'),addEventListener(){}},localStorage:storage,clearInterval(){},setInterval(){},alert:message=>{throw Error(message);}};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),sandbox);
  sandbox.input=imported();vm.runInContext('save(input,null);save(input,null)',sandbox);
  const initial=JSON.parse(storage.getItem(profiles.PROFILE_KEY)),id=initial.activeProfileID,other=initial.savedProfiles.find(p=>p.id!==id);
  for(const mode of ['periods','hidden','blocks']) {
    vm.runInContext('openSettings()',sandbox);assert.match(node('new').innerHTML,/Schedule-row labels/);
    const form={accent:{value:'mint'},clock:{value:'12'},size:{value:'standard'},scheduleLabels:{value:mode},rooms:{checked:true},schedule:{checked:true},school:{checked:true}};
    node('#settings-form').onsubmit({preventDefault(){},currentTarget:form});
    const saved=JSON.parse(storage.getItem(profiles.PROFILE_KEY));
    assert.deepEqual(saved.savedProfiles.find(p=>p.id===other.id),other);
    const restart=new profiles.ProfileStore(storage);assert.equal(restart.activeConfiguration.preferences.scheduleLabels,mode);
    assert.equal(profiles.importDisplayProfiles(profiles.exportProfiles(saved)).find(c=>c.preferences.scheduleLabels===mode).preferences.scheduleLabels,mode);
    const html=node('#display').innerHTML;
    if(mode==='hidden') {assert.ok(!html.includes('class="badge"'));assert.match(html,/row current no-label/);assert.match(html,/<strong[^>]*>Lunch 2<\/strong>/);assert.match(html,/<time>/);assert.match(html,/Room 204/);}
    else assert.ok(html.includes(`>${mode==='blocks'?'A':'P1'}</span>`));
    assert.match(html,/<div class="event-title">Lunch 2<\/div>/);
  }
});
console.log(`\n${passed} schedule label tests passed.`);
