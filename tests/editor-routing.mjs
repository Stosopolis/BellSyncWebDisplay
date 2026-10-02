import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../display-core.mjs';
import * as states from '../schedule-presentation.mjs';
import * as profiles from '../profile-store.mjs';
import * as schools from '../school-setup.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const school=read('../public/builtins/wmhs/schedule.json'),calendar=read('../public/builtins/wmhs/calendar.json'),demo=read('../public/samples/classroom-demo.json');
const v2=read('./fixtures/native-v2.json'),v1=read('./fixtures/native-bundle-v1.json').schedules[0];
const native=raw=>profiles.nativeConfigurations(profiles.inspectNativeImport(raw),school,calendar)[0];
const manual=core.normalize({...structuredClone(demo),sourceKind:'browser-local',profileName:'Actual Teacher',school:{id:'local.actual',displayName:'Actual School',timeZone:'America/New_York'}});
manual.assignments.every.lunch={title:'',room:''};
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const controls=html=>[...html.matchAll(/<input\b([^>]*)>|<select\b([^>]*)>([\s\S]*?)<\/select>/g)].map(m=>({tag:m[1]!==undefined?'input':'select',attrs:m[1]??m[2],body:m[3]||''}));
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
// A small inert HTML/DOM adapter supplies named form controls and queries to the
// actual app handlers. It does not launch a browser or implement layout.
function app(storage=memory()) {
  const nodes=new Map(),alerts=[];
  class Node {
    constructor(tag='div'){this.tag=tag;this.innerHTML='';this.textContent='';this.children=[];this.attributes={};this.listeners={};this.elements={profileName:{value:''}};this.value='';this.dataset={};}
    append(...children){this.children.push(...children);for(const child of children)if(child.id){
      if(child.id==='modal-root')for(const key of ['#managed-editor','#managed-classes','#schedule-editor','#form-error'])nodes.delete(key);
      nodes.set(`#${child.id}`,child);
    }}
    remove(){if(this.id)nodes.delete(`#${this.id}`);}
    setAttribute(k,v){this.attributes[k]=v;}
    addEventListener(k,fn){this.listeners[k]=fn;}
    querySelector(k){return this.fields?.[k] || node(k);}
    focus(){}
  }
  const markup=()=>nodes.get('#modal-root')?.innerHTML || '';
  const node=k=>{
    if(!nodes.has(k))nodes.set(k,new Node());
    const result=nodes.get(k);
    if(k==='#schedule-editor' && result.markup!==markup()) {
      result.markup=markup();
      for(const {tag,attrs,body} of controls(markup())) {
        const name=attrs.match(/\bname="([^"]+)"/)?.[1];if(!name)continue;
        const field=new Node(tag);
        field.value=decode(attrs.match(/\bvalue="([^"]*)"/)?.[1] || '');
        if(tag==='select'){const options=[...body.matchAll(/<option value="([^"]*)"([^>]*)>/g)];field.value=decode((options.find(o=>o[2].includes('selected')) || options[0])?.[1] || '');}
        result[name]=field;result.elements[name]=field;
      }
    }
    return result;
  };
  const inputFrom=attrs=>{const n=new Node('input');n.value=decode(attrs.match(/\bvalue="([^"]*)"/)?.[1] || '');return n;};
  const queryAll=selector=>{
    if(selector==='[data-school]' || selector==='[data-grade]') {
      const key=selector.slice(6,-1),html=markup() || node('#app').innerHTML;
      return [...html.matchAll(new RegExp(`data-${key}="([^"\\s]+)"`,'g'))].map(m=>{const n=node(`[data-${key}="${m[1]}"]`);n.dataset[key]=m[1];return n;});
    }
    if(selector==='[data-import-index]')return [...markup().matchAll(/<input([^>]*data-import-index="(\d+)"[^>]*)>/g)].map(m=>{const n=inputFrom(m[1]);n.dataset.importIndex=m[2];return n;});
    if(selector==='[data-assignment]')return [...markup().matchAll(/<input([^>]*data-period="([^"]*)"[^>]*data-assignment="([^"]*)"[^>]*)>/g)].map(m=>{const n=inputFrom(m[1]);n.dataset={period:decode(m[2]),assignment:m[3]};n.closest=()=>({dataset:{}});return n;});
    if(selector==='.period-row')return [...markup().matchAll(/<div class="period-row" data-index="(\d+)">([\s\S]*?)<\/div>/g)].map(m=>{
      const n=new Node();n.dataset.index=m[1];n.fields={};
      for(const {tag,attrs,body} of controls(m[2])) {
        const key=attrs.match(/data-key="([^"]*)"/)?.[1];if(!key)continue;
        const control=inputFrom(attrs);if(tag==='select'){const options=[...body.matchAll(/<option value="([^"]*)"([^>]*)>/g)];control.value=(options.find(o=>o[2].includes('selected')) || options[0])[1];}
        n.fields[`[data-key="${key}"]`]=control;
      }
      return n;
    });
    return [];
  };
  const sandbox={...core,...states,...profiles,...schools,esc:core.escapeHTML,Intl,Date,JSON,Set,crypto:globalThis.crypto,document:{querySelector:node,querySelectorAll:queryAll,createElement:t=>new Node(t),body:new Node(),addEventListener(){}},localStorage:storage,clearInterval(){},setInterval(){},alert:m=>alerts.push(m),fetch:async path=>({ok:true,json:async()=>structuredClone(path.includes('/gms/')?read(`../public/builtins/gms/${path.includes('calendar')?'calendar':'schedule'}.json`):path.includes('classroom-demo')?demo:path.includes('calendar')?calendar:school)})};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),sandbox);
  const run=s=>vm.runInContext(s,sandbox);
  return {run,node,sandbox,storage,alerts,markup,snapshot:()=>JSON.parse(storage.getItem(profiles.PROFILE_KEY)),
    add(c){sandbox.input=c;run('save(input,null)');return this.snapshot().activeProfileID;},
    clickEdit(){node('#edit').onclick();assert.deepEqual(alerts,[]);return markup();},
    async import(raw){node('#schedule-file').files=[{text:async()=>JSON.stringify(raw)}];await node('#schedule-file').listeners.change();assert.deepEqual(alerts,[]);this.reviewMarkup=markup();node('#import-review').onsubmit({preventDefault(){}});assert.equal(node('#form-error').textContent,'');return this.snapshot();}
  };
}
let passed=0;async function test(name,fn){await fn();passed++;console.log(`PASS ${name}`);}

for(const [version,raw] of [[1,v1],[2,v2]])await test(`saved WMHS v${version} Edit button opens its imported data, including after reload`,()=>{
  const a=app(),input=native(raw),id=a.add(input),html=a.clickEdit();
  assert.match(html,/Edit Imported WMHS Classes/);assert.ok(!html.includes('Demo Classroom'));assert.ok(!html.includes('schedule-editor'));
  assert.equal(a.node('#managed-editor').elements.profileName.value,input.profileName);
  const rows=a.node('#managed-classes').children.flatMap(s=>s.children.filter(r=>r.className==='managed-assignment'));
  assert.equal(rows[0].children[0].children[0].textContent,`${input.assignments['1']['1'].block} Block`);
  assert.equal(rows[0].children[1].children[1].value,input.assignments['1']['1'].title);
  const restart=app(a.storage);assert.match(restart.clickEdit(),/Edit Imported WMHS Classes/);assert.equal(restart.snapshot().activeProfileID,id);
});
await test('active saved profile overrides stale Demo display globals instead of opening Add',()=>{
  const a=app(),input=native(v2);a.add(input);a.sandbox.stale=core.normalize(demo);a.run('config=stale;isDemo=true');
  a.run('openEditor(clone(config),isDemo?null:store.snapshot.activeProfileID)');
  assert.match(a.markup(),/<h2>Add Schedule<\/h2>/);assert.ok(a.markup().includes('Demo Classroom'));
  assert.match(a.clickEdit(),/Edit Imported WMHS Classes/);assert.equal(a.node('#managed-editor').elements.profileName.value,input.profileName);assert.equal(a.run('isDemo'),false);assert.equal(a.run('config.profileName'),input.profileName);
});
await test('A → B Edit and saves remain isolated',()=>{
  const a=app(),first=a.add(native(v1)),second=a.add(native(v2)),before=a.snapshot();
  a.sandbox.first=first;a.sandbox.second=second;a.run('selectProfile(first);selectProfile(second)');
  a.clickEdit();const form=a.node('#managed-editor');assert.equal(form.elements.profileName.value,v2.scheduleName);
  form.elements.profileName.value='V2 edited';form.onsubmit({preventDefault(){}});
  const after=a.snapshot();assert.equal(after.savedProfiles.find(p=>p.id===second).configuration.profileName,'V2 edited');assert.deepEqual(after.savedProfiles.find(p=>p.id===first),before.savedProfiles.find(p=>p.id===first));
});
await test('manual Edit uses actual saved school, rotation, periods, classes and exclusions',()=>{
  const a=app(),input=structuredClone(manual);input.rotation.noSchoolDates=['2026-10-02'];input.assignments.every.p1.title='Saved English';input.assignments.every.p1.room='Saved Room';
  const id=a.add(input),html=a.clickEdit();assert.match(html,/<h2>Edit Schedule<\/h2>/);
  assert.ok(html.includes('value="Actual School"'));assert.ok(html.includes('value="Actual Teacher"'));assert.ok(html.includes('value="Saved English"'));assert.ok(html.includes('value="Saved Room"'));assert.ok(html.includes('2026-10-02'));assert.ok(!html.includes('Demo Classroom'));
  const f=a.node('#schedule-editor');assert.equal(f.schoolName.value,'Actual School');assert.equal(f.profileName.value,'Actual Teacher');assert.equal(f.rotationKind.value,'same');
  f.profileName.value='Manual renamed';f.onsubmit({preventDefault(){}});assert.equal(a.node('#form-error').textContent,'');
  const after=a.snapshot().savedProfiles.find(p=>p.id===id).configuration;assert.equal(after.profileName,'Manual renamed');assert.deepEqual(after.assignments,input.assignments);assert.deepEqual(after.periods,input.periods);assert.deepEqual(after.rotation,input.rotation);const restart=app(a.storage);assert.ok(restart.clickEdit().includes('value="Manual renamed"'));
});
await test('Demo Edit applies temporary changes without implicitly creating a saved profile',async()=>{
  const a=app();a.add(manual);await a.run('loadDemo()');const before=a.snapshot();
  assert.match(a.clickEdit(),/Edit Demo Schedule/);const form=a.node('#schedule-editor');assert.equal(form.profileName.value,'Demo Classroom');
  form.profileName.value='Temporary Demo';form.onsubmit({preventDefault(){}});assert.equal(a.node('#form-error').textContent,'');assert.deepEqual(a.snapshot(),before);
  assert.equal(a.run('config.profileName'),'Temporary Demo');assert.equal(a.run('isDemo'),true);
  a.run('save(config,null)');assert.equal(a.snapshot().savedProfiles.length,2); // Explicit copy is still available.
});
await test('Add workflow creates an independent manual schedule using creation defaults',()=>{
  const a=app();a.add(native(v2));a.run('openAdd()');a.node('#new-setup').onclick();
  assert.match(a.markup(),/<h2>Add Schedule<\/h2>/);assert.ok(a.markup().includes('value="My School"'));assert.ok(!a.markup().includes('Demo Classroom'));
  const f=a.node('#schedule-editor');f.onsubmit({preventDefault(){}});assert.equal(a.node('#form-error').textContent,'');assert.equal(a.snapshot().savedProfiles.length,2);
});
await test('real file handler imports mixed v1/v2 and routes the selected v2 editor',async()=>{
  const a=app(),saved=await a.import({bundleFormatVersion:1,schedules:[v1,v2],createdAt:812000000});assert.equal(saved.savedProfiles.length,2);
  a.sandbox.id=saved.savedProfiles[1].id;a.run('selectProfile(id)');assert.match(a.clickEdit(),/Edit Imported WMHS Classes/);
  assert.equal(a.node('#managed-editor').elements.profileName.value,v2.scheduleName);
});
await test('manual time controls have full-width reflow rules for 12/24-hour formats',()=>{
  const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8'),a=app();a.add(manual);a.clickEdit();
  assert.match(a.markup(),/data-key="start" type="time" value="07:30"/);
  assert.match(css,/minmax\(155px,\.8fr\)/);assert.match(css,/@media\(max-width:1000px\)/);assert.match(css,/@media\(max-width:520px\)\{\.period-row\{grid-template-columns:minmax\(0,1fr\)/);
});
await test('v2 cosmetic compatibility notes appear in real import review without excluding the profile',async()=>{
  const raw=structuredClone(v2);raw.personalBlockColors=[{identity:{wmhsBlock:{schoolID:'wmhs',blockID:'A'}},color:'mint'}];
  const a=app(),saved=await a.import(raw);assert.equal(saved.savedProfiles.length,1);
  assert.match(a.reviewMarkup,/Import notes/);assert.match(a.reviewMarkup,/Native personal block colors/);assert.match(a.clickEdit(),/Edit Imported WMHS Classes/);
});
await test('legacy active WMHS migration routes correctly; missing source metadata does not create Demo defaults',()=>{
  const storage=memory();storage.setItem(profiles.LEGACY_KEY,JSON.stringify(native(v1)));
  const a=app(storage);assert.match(a.clickEdit(),/Edit Imported WMHS Classes/);
  const saved=a.snapshot();delete saved.savedProfiles[0].configuration.sourceKind;
  storage.setItem(profiles.PROFILE_KEY,JSON.stringify(saved));const bytes=storage.getItem(profiles.PROFILE_KEY),broken=app(storage);
  broken.run('editActiveSchedule()');assert.match(broken.alerts[0],/Saved schedules are unavailable/);
  assert.equal(storage.getItem(profiles.PROFILE_KEY),bytes);assert.equal(broken.markup(),'');
});
await test('temporary Demo editing remains available when saved storage is malformed',async()=>{
  const storage=memory();storage.setItem(profiles.PROFILE_KEY,'{broken');const a=app(storage);
  await a.run('loadDemo()');assert.match(a.clickEdit(),/Edit Demo Schedule/);
  const f=a.node('#schedule-editor');f.profileName.value='Offline Demo';f.onsubmit({preventDefault(){}});
  assert.equal(a.node('#form-error').textContent,'');assert.equal(a.run('config.profileName'),'Offline Demo');assert.equal(storage.getItem(profiles.PROFILE_KEY),'{broken');
});
for(const schoolID of ['wmhs','gms']) await test(`${schoolID} first-run quick setup edits, saves independently, reloads, and backs up`,async()=>{
  const a=app();const first=a.node('#app').innerHTML;
  assert.match(first,/Start with your school/);assert.match(first,/Wakefield Memorial High School/);assert.match(first,/Galvin Middle School/);
  assert.equal(a.snapshot(),null);
  a.node(`[data-school="${schoolID}"]`).onclick();
  if(schoolID==='gms') {assert.match(a.markup(),/Choose your grade/);await a.node('[data-grade="6"]').onclick();}
  else await new Promise(resolve=>setImmediate(resolve));
  assert.equal(a.snapshot(),null); // Opening/cancelling setup does not save a temporary profile.
  assert.match(a.markup(),/managed-editor/);assert.ok(!a.markup().includes('schedule-editor'));
  const rows=a.node('#managed-classes').children.flatMap(s=>s.children.filter(r=>r.className==='managed-assignment'));
  rows[0].children[1].children[1].value='My First Class';rows[0].children[2].children[1].value='204';
  if(schoolID==='wmhs') {const lunch=a.node('#managed-classes').children[0].children.find(r=>r.className==='managed-lunch').children[1];lunch.value='L2';lunch.onchange();}
  const f=a.node('#managed-editor');f.elements.profileName.value='Faculty Display';f.onsubmit({preventDefault(){}});
  assert.equal(a.node('#form-error').textContent,'');assert.deepEqual(a.alerts,[]);
  const saved=a.snapshot();assert.equal(saved.savedProfiles.length,1);const id=saved.activeProfileID;assert.match(id,/^[0-9a-f-]{36}$/i);
  const c=saved.savedProfiles[0].configuration;assert.equal(c.school.id,schoolID);assert.equal(c.profileName,'Faculty Display');
  const period=schoolID==='wmhs'?'1':'HR';assert.equal(c.assignments['1'][period].title,'My First Class');assert.equal(c.assignments['1'][period].room,'204');
  if(schoolID==='wmhs') assert.equal(c.assignments['1']['4'].lunch,'L2');
  const restart=app(a.storage);restart.clickEdit();assert.equal(restart.snapshot().activeProfileID,id);
  const backup=profiles.exportProfiles(new profiles.ProfileStore(a.storage).snapshot);assert.equal(profiles.importDisplayProfiles(backup)[0].school.id,schoolID);
  await a.run(`startSchoolSetup('${schoolID}'${schoolID==='gms'?',6':''})`);a.node('#managed-editor').onsubmit({preventDefault(){}});
  assert.equal(a.snapshot().savedProfiles.length,2);assert.notEqual(a.snapshot().activeProfileID,id);
  const store=new profiles.ProfileStore(a.storage);store.select(id);store.rename(id,'Renamed');assert.equal(store.activeConfiguration.profileName,'Renamed');store.remove(id);assert.equal(store.snapshot.savedProfiles.length,1);
});
console.log(`\n${passed} editor routing tests passed.`);
