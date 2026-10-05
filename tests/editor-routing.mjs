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
function app(storage=memory(),fixedNow=null) {
  const nodes=new Map(),alerts=[],documentListeners={};
  class Node {
    constructor(tag='div'){this.tag=tag;this.innerHTML='';this.textContent='';this.children=[];this.attributes={};this.listeners={};this.elements={profileName:{value:''}};this.value='';this.dataset={};this.classList={add(){}};}
    append(...children){this.children.push(...children);for(const child of children)if(child.id){
      if(child.id==='modal-root')for(const key of ['#managed-editor','#managed-classes','#schedule-editor','#form-error'])nodes.delete(key);
      nodes.set(`#${child.id}`,child);
    }}
    remove(){if(this.id)nodes.delete(`#${this.id}`);}
    setAttribute(k,v){this.attributes[k]=v;}
    removeAttribute(k){delete this.attributes[k];}
    replaceWith(){}
    replaceChildren(...children){this.children=[];this.append(...children);}
    addEventListener(k,fn){this.listeners[k]=fn;}
    querySelector(k){return this.fields?.[k] || node(k);}
    focus(){sandbox.document.activeElement=this;}
    blur(){if(sandbox.document.activeElement===this)sandbox.document.activeElement=null;}
  }
  const markup=()=>nodes.get('#modal-root')?.innerHTML || '';
  const node=k=>{
    if(!nodes.has(k))nodes.set(k,new Node());
    const result=nodes.get(k);if(k.startsWith('#'))result.id=k.slice(1);
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
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[fixedNow]));}static now(){return fixedNow;}}
  const sandbox={...core,...states,...profiles,...schools,esc:core.escapeHTML,Intl,Date:fixedNow===null?Date:FixedDate,JSON,Set,crypto:globalThis.crypto,document:{querySelector:node,querySelectorAll:queryAll,createElement:t=>new Node(t),body:new Node(),addEventListener(k,fn){documentListeners[k]=fn;}},localStorage:storage,clearInterval(){},setInterval(){},alert:m=>alerts.push(m),fetch:async path=>({ok:true,json:async()=>structuredClone(path.includes('/gms/')?read(`../public/builtins/gms/${path.includes('calendar')?'calendar':'schedule'}.json`):path.includes('classroom-demo')?demo:path.includes('calendar')?calendar:school)})};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),sandbox);
  const run=s=>vm.runInContext(s,sandbox);
  return {run,node,sandbox,storage,alerts,markup,documentListeners,snapshot:()=>JSON.parse(storage.getItem(profiles.PROFILE_KEY)),
    add(c){sandbox.input=c;run('save(input,null)');return this.snapshot().activeProfileID;},
    clickEdit(){node('#edit').onclick();assert.deepEqual(alerts,[]);return markup();},
    async import(raw){node('#schedule-file').files=[{text:async()=>JSON.stringify(raw)}];await node('#schedule-file').listeners.change();assert.deepEqual(alerts,[]);this.reviewMarkup=markup();node('#import-review').onsubmit({preventDefault(){}});assert.equal(node('#form-error').textContent,'');return this.snapshot();}
  };
}
let passed=0;async function test(name,fn){await fn();passed++;console.log(`PASS ${name}`);}

for(const [version,raw] of [[1,v1],[2,v2]])await test(`saved WMHS v${version} Edit button opens its imported data, including after reload`,()=>{
  const a=app(),input=native(raw),id=a.add(input),html=a.clickEdit();
  assert.match(html,/Edit WMHS Schedule/);assert.ok(!html.includes('Demo Classroom'));assert.ok(!html.includes('schedule-editor'));
  assert.equal(a.node('#managed-editor').elements.profileName.value,input.profileName);
  const rows=a.node('#managed-classes').children.flatMap(s=>s.children.filter(r=>r.className==='managed-assignment'));
  assert.equal(rows[0].children[0].children[0].textContent,input.assignments['1']['1'].block);
  assert.equal(rows[0].children[1].children[1].value,input.assignments['1']['1'].title);
  const restart=app(a.storage);assert.match(restart.clickEdit(),/Edit WMHS Schedule/);assert.equal(restart.snapshot().activeProfileID,id);
});
await test('active saved profile overrides stale Demo display globals instead of opening Add',()=>{
  const a=app(),input=native(v2);a.add(input);a.sandbox.stale=core.normalize(demo);a.run('config=stale;isDemo=true');
  a.run('openEditor(clone(config),isDemo?null:store.snapshot.activeProfileID)');
  assert.match(a.markup(),/<h2>Add Schedule<\/h2>/);assert.ok(a.markup().includes('Demo Classroom'));
  assert.match(a.clickEdit(),/Edit WMHS Schedule/);assert.equal(a.node('#managed-editor').elements.profileName.value,input.profileName);assert.equal(a.run('isDemo'),false);assert.equal(a.run('config.profileName'),input.profileName);
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
  a.sandbox.id=saved.savedProfiles[1].id;a.run('selectProfile(id)');assert.match(a.clickEdit(),/Edit WMHS Schedule/);
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
  assert.match(a.reviewMarkup,/Import notes/);assert.match(a.reviewMarkup,/Native personal block colors/);assert.match(a.clickEdit(),/Edit WMHS Schedule/);
});
await test('legacy active WMHS migration routes correctly; missing source metadata does not create Demo defaults',()=>{
  const storage=memory();storage.setItem(profiles.LEGACY_KEY,JSON.stringify(native(v1)));
  const a=app(storage);assert.match(a.clickEdit(),/Edit WMHS Schedule/);
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
  if(schoolID==='wmhs') {const lunch=a.node('#managed-classes').children[0].children.find(r=>r.children.some(c=>c.className==='managed-lunch')).children.find(c=>c.className==='managed-lunch').children[1];lunch.value='L2';lunch.onchange();}
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
await test('Schedule menu has only three top-level controls and keyboard/click-away closing',()=>{
  const a=app();a.add(native(v2));
  const html=a.node('#display').innerHTML,toolbar=html.slice(html.indexOf('<div class="toolbar">'),html.indexOf('</header>'));
  const visible=[...toolbar.matchAll(/<button id="([^"]+)"([^>]*)>/g)].filter(m=>!m[2].includes('role="menuitem"')).map(m=>m[1]);
  assert.deepEqual(visible,['schedule-toggle','settings','full']);
  for(const label of ['Edit Schedule','Switch Schedule','Export / Backup Schedule','Remove This Schedule'])assert.ok(toolbar.includes(label));
  assert.match(toolbar,/role="menu"/);assert.match(toolbar,/aria-expanded="false"/);assert.match(toolbar,/class="destructive" role="menuitem"/);
  a.node('#schedule-toggle').onclick();assert.equal(a.run('scheduleMenuOpen'),true);assert.equal(a.sandbox.document.activeElement,a.node('#edit'));
  a.node('#edit').onkeydown({key:'ArrowDown',preventDefault(){}});assert.equal(a.sandbox.document.activeElement,a.node('#change'));
  a.run('update()');assert.equal(a.run('scheduleMenuOpen'),true);assert.equal(a.sandbox.document.activeElement,a.node('#change')); // tick retains menu/focus
  a.documentListeners.keydown({key:'Escape',preventDefault(){}});assert.equal(a.run('scheduleMenuOpen'),false);assert.equal(a.node('#schedule-toggle').attributes['aria-expanded'],'false');assert.equal(a.sandbox.document.activeElement,a.node('#schedule-toggle'));
  a.node('#schedule-toggle').onclick();a.documentListeners.click({target:{closest:()=>null}});assert.equal(a.run('scheduleMenuOpen'),false);assert.equal(a.node('#schedule-menu').attributes.hidden,'');
  const before=a.snapshot();a.sandbox.confirm=()=>false;a.node('#remove').onclick();assert.deepEqual(a.snapshot(),before);
});
await test('WMHS day selector retains drafts and focus, then saves multiple days atomically',()=>{
  const a=app(),c=schools.builtInConfiguration('wmhs',school,calendar);a.add(c);const before=a.snapshot();a.clickEdit();
  const tabs=a.node('#managed-days').children;assert.equal(tabs.length,7);assert.equal(tabs[0].attributes['aria-pressed'],'true');
  const row=()=>a.node('#managed-classes').children[0].children.find(n=>n.className==='managed-assignment');
  const lunch=()=>a.node('#managed-classes').children[0].children.flatMap(n=>n.children).find(n=>n.className==='managed-lunch').children[1];
  row().children[1].children[1].value='Day One Draft';row().children[2].children[1].value='101';lunch().value='L1';lunch().onchange();
  tabs[3].focus();tabs[3].onclick();assert.equal(a.sandbox.document.activeElement,tabs[3]);assert.equal(a.node('#managed-classes').children.length,1);assert.equal(tabs[3].attributes['aria-pressed'],'true');assert.equal(tabs[0].attributes['aria-pressed'],'false');
  row().children[1].children[1].value='Day Four Draft';row().children[2].children[1].value='404';lunch().value='L3';lunch().onchange();
  tabs[0].onclick();assert.equal(row().children[1].children[1].value,'Day One Draft');assert.equal(row().children[2].children[1].value,'101');assert.equal(lunch().value,'L1');assert.deepEqual(a.snapshot(),before);
  tabs[0].onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(tabs[1].attributes['aria-pressed'],'true');assert.equal(a.sandbox.document.activeElement,tabs[1]);
  a.node('#managed-editor').onsubmit({preventDefault(){}});assert.equal(a.node('#form-error').textContent,'');
  const saved=a.snapshot().savedProfiles[0].configuration;assert.equal(saved.assignments['1']['1'].title,'Day One Draft');assert.equal(saved.assignments['1']['1'].room,'101');assert.equal(saved.assignments['1']['4'].lunch,'L1');assert.equal(saved.assignments['4']['1'].title,'Day Four Draft');assert.equal(saved.assignments['4']['1'].room,'404');assert.equal(saved.assignments['4']['4'].lunch,'L3');
  assert.deepEqual(saved.templates,c.templates);assert.deepEqual(saved.calendar,c.calendar);assert.deepEqual(saved.rotation,c.rotation);
  for(const day of ['1','4']) assert.equal(saved.assignments[day]['1'].block,c.assignments[day]['1'].block);
  assert.deepEqual(new profiles.ProfileStore(a.storage).activeConfiguration,saved);
});
await test('Cancel discards cross-day drafts; missing lunch remains absent when tabs are visited',()=>{
  const a=app(),input=schools.builtInConfiguration('wmhs',school,calendar);delete input.assignments['2']['1'].room;a.add(input);const before=a.snapshot();a.clickEdit();
  const tabs=a.node('#managed-days').children,row=a.node('#managed-classes').children[0].children.find(n=>n.className==='managed-assignment');row.children[1].children[1].value='Discard me';tabs[3].onclick();a.node('#managed-editor').elements.profileName.value='Discard name';a.node('#cancel').onclick();assert.deepEqual(a.snapshot(),before);
  a.clickEdit();assert.equal(a.node('#managed-classes').children[0].children.find(n=>n.className==='managed-assignment').children[1].children[1].value,school.assignments['1']['1'].title);
  for(const tab of a.node('#managed-days').children)tab.onclick();a.node('#managed-editor').onsubmit({preventDefault(){}});const expected=structuredClone(before.savedProfiles);expected[0].configuration.lunchGuidancePrompted=true;assert.deepEqual(a.snapshot().savedProfiles,expected);
});
await test('compact editor preserves FLEX identity and accessible fields, shared with Galvin',()=>{
  const a=app();a.add(schools.builtInConfiguration('wmhs',school,calendar));a.clickEdit();const rows=a.node('#managed-classes').children[0].children.filter(n=>n.className==='managed-assignment');
  const flex=rows.at(-1);assert.equal(flex.children[0].children[0].textContent,'FLEX');assert.equal(flex.children[0].children[1].textContent,'');
  for(const row of rows) {assert.ok(row.children[1].children[1].attributes['aria-label'].includes('class name'));assert.ok(row.children[2].children[1].attributes['aria-label'].includes('room'));assert.equal(row.children[0].children.some(c=>['input','select'].includes(c.tag)),false);}
  assert.match(a.markup(),/Save Changes/);assert.match(a.markup(),/managed-footer/);
  a.add(schools.builtInConfiguration('gms',read('../public/builtins/gms/schedule.json'),read('../public/builtins/gms/calendar.json'),6));a.clickEdit();assert.equal(a.node('#managed-days').children.length,6);assert.equal(a.node('#managed-classes').children.length,1);assert.equal(a.node('#managed-classes').children[0].children.find(n=>n.className==='managed-assignment').children[0].children[0].textContent,'HR');
  const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');assert.match(css,/\.managed-classes[^}]*overflow-y:auto/);assert.match(css,/\.managed-footer[^}]*flex:0 0 auto/);assert.match(css,/\.managed-modal \.managed-assignment[^}]*grid-template-columns:minmax\(0,1fr\)/);
});
await test('generic native file imports without registry resources and opens safe source editor',async()=>{
  const raw=read('./fixtures/canterbury-room2-v2.json'),a=app();let fetches=0;a.sandbox.fetch=async()=>{fetches++;throw Error('No registry available');};
  const saved=await a.import(raw);assert.equal(fetches,0);assert.equal(saved.savedProfiles.length,1);assert.match(a.reviewMarkup,/Canterbury/);assert.ok(!a.reviewMarkup.includes('no supported web definition'));
  assert.match(a.clickEdit(),/Edit Imported Schedule/);assert.ok(!a.markup().includes('type="time"'));assert.ok(!a.markup().includes('schedule-editor'));
  const rows=a.node('#portable-fields').children.flatMap(s=>s.children.filter(n=>n.className==='portable-edit-row'));
  const centers=rows.find(r=>r.children[0].textContent==='Centers'),owner=rows.find(r=>r.children[0].textContent==='Ms. Christine Lunch');
  centers.children[1].children[1].value='Local Centers';centers.children[2].children[1].value='Room 2';owner.children[1].children[1].value='Owner Lunch';owner.children[2].children[1].value='Staff Room';
  const form=a.node('#portable-editor');form.elements.profileName.value='My Room 2';form.onsubmit({preventDefault(){}});assert.equal(a.node('#form-error').textContent,'');
  const c=a.snapshot().savedProfiles[0].configuration;assert.deepEqual(c.portable.shared,raw);assert.equal(c.profileName,'My Room 2');
  const at=time=>core.zonedTimestamp('2026-09-10',time,c.school.timeZone);assert.equal(states.scheduleSnapshot(c,at('09:00')).current.title,'Local Centers');assert.equal(states.scheduleSnapshot(c,at('09:00')).current.room,'Room 2');assert.equal(states.scheduleSnapshot(c,at('11:45')).current.title,'Owner Lunch');
  const reload=app(a.storage);reload.clickEdit();assert.equal(reload.node('#portable-editor').elements.profileName.value,'My Room 2');assert.deepEqual(reload.snapshot().savedProfiles[0].configuration,c);
  const restored=profiles.importDisplayProfiles(profiles.exportProfiles(new profiles.ProfileStore(a.storage).snapshot))[0];assert.deepEqual(restored,c);
});
await test('generic editor Cancel and invalid names preserve stored snapshot and local edits',async()=>{
  const raw=read('./fixtures/canterbury-room2-v2.json'),a=app();await a.import(raw);const before=a.snapshot();a.clickEdit();
  const row=a.node('#portable-fields').children[0].children.find(n=>n.className==='portable-edit-row');row.children[1].children[1].value='Discard';a.node('#cancel').onclick();assert.deepEqual(a.snapshot(),before);
  a.clickEdit();a.node('#portable-fields').children[0].children.find(n=>n.className==='portable-edit-row').children[1].children[1].value='';a.node('#portable-editor').onsubmit({preventDefault(){}});assert.match(a.node('#form-error').textContent,/Invalid snapshot local title/);assert.deepEqual(a.snapshot(),before);
});
await test('physical date-control handlers stay on frozen snapshot through Kidzfun, closure, weekend and Today',async()=>{
  const raw=read('./fixtures/canterbury-room2-v2.json'),now=core.zonedTimestamp('2026-10-01','09:45','America/New_York'),a=app(memory(),now);await a.import(raw);const before=a.snapshot();
  assert.match(a.node('#display').innerHTML,/id="view-date"/);assert.equal(a.run('state(Date.now()).current.title'),'Kidzfun');
  a.node('#tomorrow-date').onclick();assert.equal(a.run('viewedDate'),'2026-10-02');assert.equal(a.run('state(Date.now()).state'),'preview');assert.ok(a.node('#display').innerHTML.includes('Kidzfun'));
  a.node('#next-date').onclick();assert.equal(a.run('viewedDate'),'2026-10-03');assert.equal(a.run('state(Date.now()).state'),'weekend');
  a.node('#previous-date').onclick();assert.equal(a.run('viewedDate'),'2026-10-02');
  for(const [key,state] of [['2026-10-12','no-school'],['2026-09-10','preview'],['2027-01-05','preview']]) {const input=a.node('#view-date');input.value=key;input.focus();input.onchange({target:input});assert.equal(a.run('viewedDate'),key);assert.equal(a.run('state(Date.now()).state'),state);}
  a.node('#today-date').onclick();assert.equal(a.run('viewedDate'),null);assert.equal(a.run('state(Date.now()).current.title'),'Kidzfun');assert.deepEqual(a.snapshot(),before);
});
const unresolvedWMHS=()=>schools.builtInConfiguration('wmhs',school,calendar);
const resolvedWMHS=(lunch='L2')=>{const c=unresolvedWMHS();for(const rows of Object.values(c.assignments))rows['4'].lunch=lunch;return c;};
await test('WMHS lunch guidance uses source split metadata, not duration or school name alone',()=>{
  const c=unresolvedWMHS();assert.equal(core.unresolvedLunchAssignments(c).length,7);
  for(const choice of ['L1','L2','L3','NO_LUNCH'])assert.equal(core.unresolvedLunchAssignments(resolvedWMHS(choice)).length,0);
  const without=structuredClone(c);for(const rows of Object.values(without.templates))for(const p of rows)delete p.lunches;
  assert.equal(core.unresolvedLunchAssignments(without).length,0);
  assert.equal(core.unresolvedLunchAssignments(manual).length,0);
  assert.equal(core.unresolvedLunchAssignments(schools.builtInConfiguration('gms',read('../public/builtins/gms/schedule.json'),read('../public/builtins/gms/calendar.json'),6)).length,0);
});
await test('WMHS setup editor save prompts once and Not Now leaves a persistent warning',()=>{
  const a=app();a.add(unresolvedWMHS());a.clickEdit();a.node('#managed-editor').onsubmit({preventDefault(){}});
  assert.match(a.markup(),/Choose your lunch/);for(const label of ['Choose Lunch','No Lunch Assignment','Not Now'])assert.ok(a.markup().includes(label));
  const config=a.snapshot().savedProfiles[0].configuration;assert.equal(config.lunchGuidancePrompted,true);assert.equal(core.unresolvedLunchAssignments(config).length,7);
  a.node('#lunch-not-now').onclick();a.run('update()');assert.match(a.node('#display').innerHTML,/Lunch not set/);
  a.run('maybePromptLunch(store.snapshot.activeProfileID)');assert.ok(!a.markup());
  a.node('#lunch-warning').listeners.click();assert.match(a.markup(),/managed-editor/);
});
await test('Choose Lunch opens the unresolved rotation day and focuses its existing selector',()=>{
  const a=app(),c=unresolvedWMHS();c.assignments['1']['4'].lunch='L1';a.add(c);a.run('maybePromptLunch(store.snapshot.activeProfileID)');
  a.node('#choose-lunch').onclick();assert.match(a.markup(),/managed-editor/);
  assert.equal(a.node('#managed-days').children[1].attributes['aria-pressed'],'true');
  assert.equal(a.sandbox.document.activeElement.tag,'select');assert.equal(a.sandbox.document.activeElement.value,'');
});
await test('No Lunch Assignment fills only missing selections and removes warning immediately',()=>{
  const a=app(),c=unresolvedWMHS();c.assignments['1']['4'].lunch='L3';const id=a.add(c);a.run('maybePromptLunch(store.snapshot.activeProfileID)');a.node('#no-lunch-assignment').onclick();
  const saved=a.snapshot().savedProfiles.find(p=>p.id===id).configuration;assert.equal(saved.assignments['1']['4'].lunch,'L3');
  for(const day of ['2','3','4','5','6','7'])assert.equal(saved.assignments[day]['4'].lunch,'NO_LUNCH');
  assert.equal(core.unresolvedLunchAssignments(saved).length,0);assert.ok(!a.node('#display').innerHTML.includes('Lunch not set'));
  for(const day of Object.keys(c.assignments))for(const period of Object.keys(c.assignments[day])){const original=c.assignments[day][period],actual=saved.assignments[day][period];assert.equal(actual.title,original.title);assert.equal(actual.room,original.room);assert.equal(actual.block,original.block);}
  assert.deepEqual(saved.templates,c.templates);assert.deepEqual(saved.calendar,c.calendar);
  assert.deepEqual(core.timelineFor(saved,'2026-09-01').events,core.timelineFor(c,'2026-09-01').events);
  const backup=profiles.exportProfiles(a.snapshot());assert.equal(profiles.importDisplayProfiles(backup)[0].assignments['2']['4'].lunch,'NO_LUNCH');
});
await test('Profile A configured and Profile B unresolved remain independent',()=>{
  const a=app(),idA=a.add(resolvedWMHS()),first=structuredClone(a.snapshot().savedProfiles[0]),idB=a.add(unresolvedWMHS());
  assert.match(a.node('#display').innerHTML,/Lunch not set/);a.run('selectProfile('+JSON.stringify(idA)+')');assert.ok(!a.node('#display').innerHTML.includes('Lunch not set'));
  a.run('selectProfile('+JSON.stringify(idB)+')');assert.match(a.node('#display').innerHTML,/Lunch not set/);a.run('maybePromptLunch(store.snapshot.activeProfileID)');a.node('#no-lunch-assignment').onclick();
  assert.deepEqual(a.snapshot().savedProfiles.find(p=>p.id===idA),first);
});
await test('single unresolved native WMHS import warns without converting missing lunch',async()=>{
  const raw=structuredClone(v1);raw.assignments=structuredClone(school.assignments);for(const rows of Object.values(raw.assignments))delete rows['4'].lunch;
  const a=app();await a.import(raw);assert.match(a.markup(),/Choose your lunch/);const c=a.snapshot().savedProfiles[0].configuration;
  assert.equal(Object.hasOwn(c.assignments['1']['4'],'lunch'),false);assert.equal(core.unresolvedLunchAssignments(c).length,7);
  const reloaded=app(a.storage);assert.match(reloaded.node('#display').innerHTML,/Lunch not set/);assert.ok(!reloaded.markup());
});
await test('configured native import preserves choices without lunch guidance',async()=>{
  const raw=structuredClone(v1);raw.assignments=structuredClone(school.assignments);for(const rows of Object.values(raw.assignments))rows['4'].lunch='L2';
  const a=app();await a.import(raw);assert.ok(!a.markup().includes('Choose your lunch'));assert.ok(!a.node('#display').innerHTML.includes('Lunch not set'));
  assert.equal(a.snapshot().savedProfiles[0].configuration.assignments['1']['4'].lunch,'L2');
});
await test('partial WMHS import can intentionally resolve missing day assignments',()=>{
  const c=unresolvedWMHS();delete c.assignments['2']['4'];const saved=core.setProfileLunchChoices(c,core.unresolvedLunchAssignments(c).map(r=>({...r,lunch:'NO_LUNCH'})));
  assert.equal(core.unresolvedLunchAssignments(saved).length,0);assert.equal(saved.assignments['2']['4'].lunch,'NO_LUNCH');
  const a=app();a.add(c);a.run('openLunchConfiguration()');const tabs=a.node('#managed-days').children;tabs[1].onclick();const select=a.node('#managed-classes').children[0].children.flatMap(r=>r.children).find(c=>c.className==='managed-lunch').children[1];select.value='L2';select.onchange();a.node('#managed-editor').onsubmit({preventDefault(){}});assert.equal(a.node('#form-error').textContent,'');assert.equal(a.snapshot().savedProfiles[0].configuration.assignments['2']['4'].lunch,'L2');
});
await test('WMHS portable snapshot uses explicit lunch rules; unrelated portable schools never warn',()=>{
  const raw=read('./fixtures/canterbury-room2-v2.json');assert.equal(core.unresolvedLunchAssignments(profiles.nativeConfigurations(profiles.inspectNativeImport(raw))[0]).length,0);
  raw.schoolProfileID='wmhs';raw.schoolDefinitionSnapshot.id='wmhs';const d=raw.schoolDefinitionSnapshot;
  d.periodDefinitions.find(p=>p.id==='centers').acceptsPersonalAssignment=true;
  d.lunchRules=[{periodID:'centers',options:['L1','L2','L3'].map((id,i)=>({id,displayName:`Lunch ${i+1}`,start:'09:05',end:'09:10'}))}];
  const c=profiles.nativeConfigurations(profiles.inspectNativeImport(raw))[0],a=app();a.add(c);a.run('maybePromptLunch(store.snapshot.activeProfileID)');a.node('#choose-lunch').onclick();
  const section=a.node('#portable-fields').children[0];assert.equal(section.children[0].textContent,'Lunch selections');
  const select=section.children[1].children[0];select.value='L2';select.onchange();a.node('#portable-editor').onsubmit({preventDefault(){}});
  assert.equal(a.snapshot().savedProfiles[0].configuration.portable.shared.assignments['room-2'].centers.lunch,'L2');
  assert.equal(core.unresolvedLunchAssignments(a.snapshot().savedProfiles[0].configuration).length,0);
  assert.deepEqual(a.snapshot().savedProfiles[0].configuration.portable.shared.schoolDefinitionSnapshot,d);
});
await test('Display Settings progress toggles default off and persist independently per profile',()=>{
  const a=app(),id=a.add(resolvedWMHS());a.node('#settings').onclick();
  assert.match(a.markup(),/name="schoolDayProgress" type="checkbox" > School Day Progress/);assert.match(a.markup(),/name="schoolYearProgress" type="checkbox" > School Year Progress/);
  a.node('#settings-form').onsubmit({preventDefault(){},currentTarget:{accent:{value:'mint'},clock:{value:'12'},size:{value:'standard'},scheduleLabels:{value:'blocks'},rooms:{checked:true},schedule:{checked:true},school:{checked:true},schoolDayProgress:{checked:true},schoolYearProgress:{checked:true}}});
  assert.equal(a.snapshot().savedProfiles[0].configuration.preferences.schoolDayProgress,true);assert.equal(a.snapshot().savedProfiles[0].configuration.preferences.schoolYearProgress,true);
  const other=a.add(resolvedWMHS());assert.equal(a.snapshot().savedProfiles.find(p=>p.id===other).configuration.preferences.schoolDayProgress,false);
  a.run('selectProfile('+JSON.stringify(id)+')');const reloaded=app(a.storage);assert.equal(reloaded.snapshot().savedProfiles.find(p=>p.id===id).configuration.preferences.schoolYearProgress,true);
});
console.log(`\n${passed} editor routing tests passed.`);
