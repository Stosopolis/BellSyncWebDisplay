import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../display-core.mjs';
import * as states from '../schedule-presentation.mjs';
import * as profiles from '../profile-store.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const school=read('../public/builtins/wmhs/schedule.json'),calendar=read('../public/builtins/wmhs/calendar.json');
const fixture=read('./fixtures/native-bundle-v1.json');
const copy=v=>structuredClone(v);
const date='2026-09-01',at=t=>core.zonedTimestamp(date,t,'America/New_York');
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function bundle(lunch) {
  const raw=copy(fixture);
  for(const entry of raw.schedules) {
    entry.assignments=copy(school.assignments);
    for(const rows of Object.values(entry.assignments)) {
      rows['4'].room='204';
      if(lunch !== undefined) rows['4'].lunch=lunch;
    }
  }
  return raw;
}
// Inert DOM objects execute real app handlers without launching a browser.
function app() {
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  const nodes=new Map();
  class Node {
    constructor(tag='div') {this.tag=tag;this.children=[];this.attributes={};this.listeners={};this.innerHTML='';this.textContent='';this.value='';this.dataset={};this.classList={add(){}};this.elements={profileName:{value:''}};}
    append(...children){this.children.push(...children);for(const child of children)if(child.id)nodes.set(`#${child.id}`,child);}
    setAttribute(k,v){this.attributes[k]=v;}
    removeAttribute(k){delete this.attributes[k];}
    replaceChildren(...children){this.children=[];this.append(...children);}
    addEventListener(k,fn){this.listeners[k]=fn;}
    querySelector(k){return node(k);}
    remove(){}
    focus(){}
  }
  const node=k=>{if(!nodes.has(k))nodes.set(k,new Node());return nodes.get(k);};
  const document={body:new Node(),querySelector:node,querySelectorAll:()=>[],createElement:t=>new Node(t),addEventListener(){}};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[at('11:30')]));}static now(){return at('11:30');}}
  const sandbox={...core,...states,...profiles,esc:core.escapeHTML,Intl,Date:FixedDate,JSON,Set,crypto:globalThis.crypto,document,localStorage:storage,clearInterval(){},setInterval(){},alert:message=>{throw Error(message);},fetch:async path=>({ok:true,json:async()=>copy(path.includes('calendar')?calendar:school)})};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const run=script=>vm.runInContext(script,sandbox);
  return {storage,node,run,sandbox,
    async import(raw) {
      node('#schedule-file').files=[{text:async()=>JSON.stringify(raw)}];
      await node('#schedule-file').listeners.change();
      node('#import-review').onsubmit({preventDefault(){}});
      assert.equal(node('#form-error').textContent,'');
      return JSON.parse(storage.getItem(profiles.PROFILE_KEY));
    },
    edit(id) {
      sandbox.id=id;run('selectProfile(id);openEditor(config,id)');
      return node('#managed-classes').children.at(-1) ? node('#managed-classes').children.slice(-7) : [];
    },
    submit() {
      node('#managed-editor').onsubmit({preventDefault(){}});
      assert.equal(node('#form-error').textContent,'');
      return JSON.parse(storage.getItem(profiles.PROFILE_KEY));
    }
  };
}
const lunchLabel=section=>section.children.flatMap(n=>n.children).find(n=>n.className==='managed-lunch');
const lunchSelect=section=>lunchLabel(section)?.children.find(n=>n.tag==='select');
let passed=0;
async function test(name,fn){await fn();passed++;console.log(`PASS ${name}`);}

for(const lunch of ['NO_LUNCH',undefined]) await test(`${lunch ?? 'missing'} survives real file/review/editor/save/activation paths`,async()=>{
  const raw=bundle(lunch),original=copy(raw),a=app(),saved=await a.import(raw);
  assert.equal(saved.savedProfiles.length,2);
  for(const profile of saved.savedProfiles) {
    a.edit(profile.id);assert.equal(a.node('#managed-classes').children.length,1);const sections=a.node('#managed-days').children.map(button=>{button.onclick();return a.node('#managed-classes').children[0];});
    sections.forEach((section,i)=>{
      const select=lunchSelect(section);assert.ok(select);assert.equal(select.value,lunch ?? '');
      assert.match(select.innerHTML,/value="NO_LUNCH"/);
      assert.equal(section.children.flatMap(n=>n.children).filter(n=>n.className==='managed-lunch').length,1);
      const label=lunchLabel(section).children[0].textContent;
      assert.equal(label,'Lunch');assert.ok(select.attributes['aria-label'].includes(school.long_block_meta[String(i+1)].long));
    });
    const after=a.submit().savedProfiles.find(p=>p.id===profile.id).configuration;
    const expected=copy(profile.configuration);if(lunch===undefined)expected.lunchGuidancePrompted=true;assert.deepEqual(after,expected);
    if(lunch===undefined)assert.equal(Object.hasOwn(after.assignments['1']['4'],'lunch'),false);
    core.validate(after);profiles.validateStore(JSON.parse(a.storage.getItem(profiles.PROFILE_KEY)));
    const rows=core.timelineFor(after,date).events.filter(e=>e.periodID==='4');
    assert.equal(rows.length,1);assert.equal(rows[0].startAt,at('10:28'));assert.equal(rows[0].endAt,at('12:14'));
  }
  assert.deepEqual(raw,original);
});

await test('real editor L1 → L2 → L3 → NO_LUNCH → L1 saves, redraws, and isolates profiles',async()=>{
  const a=app(),initial=await a.import(bundle('L1')),[first,second]=initial.savedProfiles;
  const untouched=copy(second),original=copy(first.configuration);
  for(const choice of ['L1','L2','L3','NO_LUNCH','L1']) {
    const sections=a.edit(first.id),select=lunchSelect(sections[0]);select.value=choice;select.onchange();
    const after=a.submit(),updated=after.savedProfiles.find(p=>p.id===first.id).configuration;
    assert.equal(updated.assignments['1']['4'].lunch,choice);
    const expected=copy(original);expected.assignments['1']['4'].lunch=choice;
    assert.deepEqual(updated,expected);assert.deepEqual(after.savedProfiles.find(p=>p.id===second.id),untouched);
    assert.deepEqual(new profiles.ProfileStore(a.storage).activeConfiguration,updated);
    const rows=core.timelineFor(updated,date).events.filter(e=>e.periodID==='4');
    if(choice==='NO_LUNCH') {
      assert.equal(rows.length,1);assert.equal(rows[0].kind,'academic');assert.equal(rows[0].startAt,at('10:28'));assert.equal(rows[0].endAt,at('12:14'));
      assert.equal(states.scheduleSnapshot(updated,at('11:30')).current.title,'D Block');
    } else {
      const rule=school.bells.regular.find(p=>p.id==='4').lunches[choice];
      const lunch=rows.find(e=>e.kind==='lunch');assert.ok(lunch);assert.equal(lunch.startAt,at(rule.start));assert.equal(lunch.endAt,at(rule.end));
      assert.equal(states.scheduleSnapshot(updated,at(rule.start)).current.kind,'lunch');
    }
    const html=a.node('#display').innerHTML,hero=choice==='L2'?'Lunch 2':'D Block';
    assert.ok(html.includes(`<div class="event-title">${hero}</div>`));
    assert.match(html,/TODAY'S SCHEDULE/);
    assert.ok(html.includes(`>${hero}</strong>`));
    if(choice==='NO_LUNCH')assert.ok(!/>Lunch [123]<\/strong>/.test(html));
    assert.match(a.node('#display').innerHTML,/bellsync-display-icon/);
  }
  // Reimport appends independent profiles, retaining the local choice.
  const sections=a.edit(first.id),select=lunchSelect(sections[0]);select.value='L2';select.onchange();
  const locallyEdited=a.submit().savedProfiles.find(p=>p.id===first.id);
  const after=await a.import(bundle('NO_LUNCH'));
  assert.equal(after.savedProfiles.length,4);assert.deepEqual(after.savedProfiles.find(p=>p.id===first.id),locallyEdited);
  assert.deepEqual(after.savedProfiles.find(p=>p.id===second.id),untouched);
});

await test('missing lunch stays absent until explicitly changed to No Lunch',async()=>{
  const a=app(),saved=await a.import(bundle()),id=saved.savedProfiles[0].id;
  const select=lunchSelect(a.edit(id)[0]);select.value='L1';select.onchange();select.value='NO_LUNCH';select.onchange();
  const after=a.submit().savedProfiles[0].configuration;
  assert.equal(after.assignments['1']['4'].lunch,'NO_LUNCH');
  assert.equal(Object.hasOwn(after.assignments['2']['4'],'lunch'),false);
});

await test('invalid lunch and non-lunch period edits reject atomically',async()=>{
  const a=app(),saved=await a.import(bundle('L1')),profile=saved.savedProfiles[0];
  const select=lunchSelect(a.edit(profile.id)[0]);select.value='Lunch 2';select.onchange();
  a.node('#managed-editor').onsubmit({preventDefault(){}});
  assert.match(a.node('#form-error').textContent,/Invalid lunch selection/);
  assert.deepEqual(JSON.parse(a.storage.getItem(profiles.PROFILE_KEY)).savedProfiles,saved.savedProfiles);
  assert.throws(()=>core.editManagedAssignments(profile.configuration,'Profile',[{day:'1',period:'1',lunch:'L2'}]),/does not apply/);
  const bad=bundle('ARBITRARY');assert.throws(()=>profiles.inspectNativeImport(bad),/Invalid lunch selection/);
  const badConfig=copy(profile.configuration);badConfig.assignments['1']['4'].lunch='Lunch 1';
  assert.throws(()=>core.normalize(badConfig),/Invalid lunch selection/);
  assert.throws(()=>new profiles.ProfileStore(a.storage).replace(profile.id,badConfig),/Invalid lunch selection/);
});

await test('lunch controls follow source rules rather than a hardcoded period number',async()=>{
  const prepared=profiles.nativeConfigurations(profiles.inspectNativeImport(bundle('L1')),school,calendar)[0];
  assert.deepEqual(core.managedLunchPeriods(prepared),['4']);
  const alternate=copy(prepared);
  for(const template of Object.values(alternate.templates))for(const period of template)if(period.id==='4')delete period.lunches;
  assert.deepEqual(core.managedLunchPeriods(alternate),[]);
  const a=app();a.sandbox.input=alternate;a.run('save(input,null);openEditor(config,store.snapshot.activeProfileID)');
  for(const section of a.node('#managed-classes').children)assert.equal(lunchSelect(section),undefined);
});
await test('WMHS editor shows block-first locked metadata and labeled editable fields',async()=>{
  const a=app(),saved=await a.import(bundle('L2')),sections=a.edit(saved.savedProfiles[0].id);
  const copyText=a.node('#modal-root').innerHTML;
  assert.match(copyText,/Schedule timing and rotation come from BellSync/);
  assert.match(copyText,/Customize your class names, rooms, and lunch/);
  for(const [i,section] of sections.entries()) {
    const row=section.children.find(n=>n.className==='managed-assignment');
    const [source,titleLabel,roomLabel]=row.children;
    assert.equal(source.className,'managed-source');
    assert.equal(source.children[0].tag,'strong');
    assert.equal(source.children[0].textContent,school.assignments[String(i+1)]['1'].block);
    assert.equal(source.children[1].tag,'small');assert.equal(source.children[1].textContent,'Period 1');
    assert.equal(source.children.filter(n=>['input','select','button'].includes(n.tag)).length,0);
    assert.equal(titleLabel.tag,'label');assert.equal(titleLabel.children[0].textContent,'Class');
    assert.equal(roomLabel.tag,'label');assert.equal(roomLabel.children[0].textContent,'Room (optional)');
    for(const label of [titleLabel,roomLabel]) {
      const input=label.children.find(n=>n.tag==='input');assert.ok(input);
      assert.equal(input.disabled,undefined);assert.equal(input.readOnly,undefined);assert.equal(input.attributes.disabled,undefined);
    }
  }
});
await test('labeled class and room fields save alongside lunch without editing source structure',async()=>{
  const a=app(),raw=bundle('L2'),original=copy(raw),saved=await a.import(raw),profile=saved.savedProfiles[0];
  const section=a.edit(profile.id)[0],row=section.children.find(n=>n.className==='managed-assignment');
  row.children[1].children.find(n=>n.tag==='input').value='New class';
  row.children[2].children.find(n=>n.tag==='input').value='New room';
  const select=lunchSelect(section);select.value='L3';select.onchange();
  const after=a.submit().savedProfiles.find(p=>p.id===profile.id).configuration;
  const expected=copy(profile.configuration);expected.assignments['1']['1'].title='New class';expected.assignments['1']['1'].room='New room';expected.assignments['1']['4'].lunch='L3';
  assert.deepEqual(after,expected);assert.deepEqual(raw,original);
});
await test('editor fallback and responsive grid avoid presenting source fields as controls',async()=>{
  const raw=bundle('NO_LUNCH');delete raw.schedules[0].assignments['1']['1'].block;
  const a=app(),saved=await a.import(raw),section=a.edit(saved.savedProfiles[0].id)[0];
  const source=section.children.find(n=>n.className==='managed-assignment').children[0];
  assert.equal(source.children[0].textContent,'P1');assert.equal(source.children[1].textContent,'Period 1');
  const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(css,/\.managed-assignment\s*\{[^}]*grid-template-columns:minmax\(0,\.7fr\) minmax\(0,1fr\) minmax\(0,\.5fr\)/);
  assert.match(css,/@media\(max-width:850px\)\{\.managed-assignment\{grid-template-columns:1fr/);
});
console.log(`\n${passed} WMHS lunch tests passed.`);
