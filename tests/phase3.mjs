import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../display-core.mjs';
import * as states from '../schedule-presentation.mjs';
import * as profiles from '../profile-store.mjs';
const {ProfileStore,PROFILE_KEY,LEGACY_KEY,DEMO_ID,inspectNativeImport,nativeConfigurations,exportProfiles,importDisplayProfiles}=profiles;
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const demo=core.normalize(read('../public/samples/classroom-demo.json'));
const school=read('../public/builtins/wmhs/schedule.json');
const calendar=read('../public/builtins/wmhs/calendar.json');
const bundle=read('./fixtures/native-bundle-v1.json');
const copy=v=>structuredClone(v);
const cfg=name=>({...copy(demo),sourceKind:'browser-local',profileName:name});
function memory(entries=[]) {
  const data=new Map(entries);
  return {data,writes:0,fail:false,getItem:key=>data.get(key)??null,setItem(key,value){if(this.fail)throw Error('Quota exceeded');this.writes++;data.set(key,value);}};
}
function create(storage=memory()) {let n=0;return new ProfileStore(storage,()=>`profile-${++n}`);}
const native=raw=>nativeConfigurations(inspectNativeImport(raw),school,calendar);
let passed=0;
async function test(name,fn){try{await fn();passed++;console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name}`);throw error;}}

await test('legacy migration preserves configuration, active profile, and original key',()=>{
  const old=JSON.stringify(cfg('Legacy')),storage=memory([[LEGACY_KEY,old]]),store=create(storage);
  assert.equal(store.snapshot.savedProfiles.length,1);assert.equal(store.snapshot.activeProfileID,'profile-1');
  assert.deepEqual(store.activeConfiguration,JSON.parse(old));assert.equal(storage.getItem(LEGACY_KEY),old);
  const restored=create(storage);assert.deepEqual(restored.snapshot,store.snapshot);assert.equal(storage.writes,1);
});
await test('failed migration keeps legacy bytes and does not create new collection',()=>{
  const old=JSON.stringify(cfg('Legacy')),storage=memory([[LEGACY_KEY,old]]);storage.fail=true;
  assert.throws(()=>create(storage),/could not save/);assert.equal(storage.getItem(LEGACY_KEY),old);assert.equal(storage.getItem(PROFILE_KEY),null);
});
await test('malformed new collection is not overwritten or replaced by stale legacy',()=>{
  const storage=memory([[PROFILE_KEY,'{broken'],[LEGACY_KEY,JSON.stringify(cfg('Legacy'))]]);
  assert.throws(()=>create(storage));assert.equal(storage.getItem(PROFILE_KEY),'{broken');assert.equal(storage.writes,0);
});
await test('Demo switching and restart never persist Demo as a real profile',()=>{
  const storage=memory(),store=create(storage),[id]=store.add([cfg('Real')]);
  const real=copy(store.snapshot.savedProfiles);store.select(DEMO_ID);
  assert.equal(store.activeConfiguration,null);assert.deepEqual(store.snapshot.savedProfiles,real);
  const restart=create(storage);assert.equal(restart.snapshot.activeProfileID,DEMO_ID);restart.leaveDemo();
  assert.equal(restart.snapshot.activeProfileID,id);assert.deepEqual(restart.snapshot.savedProfiles,real);
  assert.ok(!storage.getItem(PROFILE_KEY).includes('Demo Classroom'));
});
await test('two profiles at the same school retain independent IDs and data A-B-A',()=>{
  const store=create(),[a,b]=store.add([cfg('A'),cfg('B')]);assert.notEqual(a,b);
  const original=copy(store.snapshot.savedProfiles);store.select(b);assert.equal(store.activeConfiguration.profileName,'B');
  store.select(a);assert.equal(store.activeConfiguration.profileName,'A');assert.deepEqual(store.snapshot.savedProfiles,original);
  const draft=store.activeConfiguration;draft.assignments.every.p1.room='Changed';store.replace(a,draft);
  assert.equal(store.snapshot.savedProfiles.find(p=>p.id===b).configuration.assignments.every.p1.room,'1304');
});
await test('single native import adds and selects a profile without replacing existing data',()=>{
  const store=create(),[existing]=store.add([cfg('Existing')]),before=store.activeConfiguration;
  const [id]=store.add(native(bundle.schedules[0]));assert.notEqual(existing,id);assert.equal(store.snapshot.activeProfileID,id);
  assert.deepEqual(store.snapshot.savedProfiles.find(p=>p.id===existing).configuration,before);
  assert.equal(store.activeConfiguration.profileName,'Classroom Teaching');
});
await test('native bundle preserves names, school, assignments, rooms, lunch and metadata',()=>{
  const store=create(),[old]=store.add([cfg('Existing')]);
  const prepared=native(bundle),ids=store.add(prepared,{activate:false});
  assert.equal(ids.length,2);assert.equal(store.snapshot.activeProfileID,old);
  prepared.forEach((c,i)=>{
    assert.equal(c.profileName,bundle.schedules[i].scheduleName);assert.equal(c.school.id,'wmhs');
    assert.deepEqual(c.assignments,bundle.schedules[i].assignments);assert.deepEqual(c.templates,school.bells);assert.deepEqual(c.calendar,calendar);
    assert.equal(c.nativeMetadata.schoolContentVersion,'2026-2027.1');assert.equal(c.rotation.labels[0].id,'1');
  });
  store.select(ids[1]);assert.equal(store.activeConfiguration.profileName,'Afternoon Support');
});
await test('NO_LUNCH bundle review, import, persistence and backup preserve every profile',()=>{
  const raw=copy(bundle);raw.schedules[0].assignments['1']['4'].lunch='NO_LUNCH';
  const original=copy(raw),plan=inspectNativeImport(raw);
  assert.equal(plan.supported.length,2);assert.equal(plan.unsupported.length,0);
  const storage=memory(),store=create(storage),[existing]=store.add([cfg('Existing')]),before=store.snapshot.savedProfiles[0];
  const prepared=nativeConfigurations(plan,school,calendar),ids=store.add(prepared,{activate:false});
  assert.equal(ids.length,2);assert.equal(store.snapshot.activeProfileID,existing);
  assert.deepEqual(store.snapshot.savedProfiles[0],before);
  prepared.forEach((c,i)=>{
    assert.deepEqual(c.assignments,raw.schedules[i].assignments);
    assert.equal(c.profileName,raw.schedules[i].scheduleName);assert.equal(c.school.id,'wmhs');
  });
  store.select(ids[0]);assert.equal(store.activeConfiguration.assignments['1']['4'].lunch,'NO_LUNCH');
  assert.deepEqual(create(storage).snapshot,store.snapshot);
  assert.deepEqual(importDisplayProfiles(exportProfiles(store.snapshot)),store.snapshot.savedProfiles.map(p=>p.configuration));
  assert.deepEqual(raw,original);
});
await test('multi-import into an empty collection waits for user selection',()=>{
  const store=create(),ids=store.add(native(bundle),{activate:false});
  assert.equal(store.snapshot.activeProfileID,null);assert.equal(store.activeConfiguration,null);
  store.select(ids[0]);assert.equal(store.activeConfiguration.profileName,'Classroom Teaching');
});
await test('partially unsupported bundle reports each skipped school and retains supported profiles',()=>{
  const mixed=copy(bundle);mixed.schedules.push({...copy(bundle.schedules[0]),schoolProfileID:'gms',scheduleName:'Middle School'});
  const plan=inspectNativeImport(mixed);assert.equal(plan.supported.length,2);assert.equal(plan.unsupported.length,1);
  assert.equal(plan.unsupported[0].name,'Middle School');assert.match(plan.unsupported[0].reason,/gms/);
  const store=create();store.add([cfg('Existing')]);store.add(nativeConfigurations(plan,school,calendar),{activate:false});assert.equal(store.snapshot.savedProfiles.length,3);
});
await test('unsupported native features are reported instead of discarded from a profile',()=>{
  for(const fields of [{date:'2026-10-01T12:00:00Z'},{activityNameOverrides:[{name:'Custom'}]},{personalBlockColors:[{color:'red'}]},{usesSchoolSchedule:true}]) {
    const raw={...copy(bundle.schedules[0]),...fields},plan=inspectNativeImport({bundleFormatVersion:1,schedules:[bundle.schedules[1],raw]});
    assert.equal(plan.supported.length,1);assert.equal(plan.unsupported.length,1);assert.match(plan.unsupported[0].reason,/Not yet supported/);
  }
});
await test('malformed envelopes and malformed supported entries add nothing',()=>{
  const storage=memory(),store=create(storage);store.add([cfg('Existing')]);const before=storage.getItem(PROFILE_KEY);
  for(const mutate of [b=>b.bundleFormatVersion=99,b=>b.schedules=[],b=>b.schedules={},b=>b.schedules.push(null),b=>b.schedules[1].assignments=[],b=>b.schedules[1].assignments['1']['4'].room={},b=>b.schedules[1].assignments['1']['4'].lunch='L9']) {
    const bad=copy(bundle);mutate(bad);assert.throws(()=>store.add(native(bad)));assert.equal(storage.getItem(PROFILE_KEY),before);
  }
});
await test('batch validation is atomic including failures in a later configuration',()=>{
  const storage=memory(),store=create(storage);store.add([cfg('Existing')]);const before=storage.getItem(PROFILE_KEY),bad=cfg('Invalid');bad.school.timeZone='invalid';
  assert.throws(()=>store.add([cfg('Valid'),bad]));assert.equal(storage.getItem(PROFILE_KEY),before);assert.equal(store.snapshot.savedProfiles.length,1);
});
await test('unnamed single schedules get an editable suggested name without weakening validation',()=>{
  const raw=copy(bundle.schedules[0]);delete raw.scheduleName;
  const plan=inspectNativeImport(raw);assert.equal(plan.supported[0].needsName,true);
  const [config]=nativeConfigurations(plan,school,calendar);config.profileName='Chosen name';
  const store=create();store.add([config]);assert.equal(store.activeConfiguration.profileName,'Chosen name');
});
await test('remove nonactive profile leaves active profile and all other data intact',()=>{
  const store=create(),[a,b,c]=store.add([cfg('A'),cfg('B'),cfg('C')]),before=store.activeConfiguration;
  store.remove(b);assert.equal(store.snapshot.activeProfileID,a);assert.deepEqual(store.activeConfiguration,before);
  assert.deepEqual(store.snapshot.savedProfiles.map(p=>p.id),[a,c]);
});
await test('remove active profile selects safe fallback; removing last does not remigrate legacy',()=>{
  const storage=memory([[LEGACY_KEY,JSON.stringify(cfg('Legacy'))]]),store=create(storage),a=store.snapshot.activeProfileID;
  const [b]=store.add([cfg('B')]);store.remove(b);assert.equal(store.snapshot.activeProfileID,a);
  store.remove(a);assert.equal(store.snapshot.activeProfileID,null);assert.equal(create(storage).snapshot.savedProfiles.length,0);assert.ok(storage.getItem(LEGACY_KEY));
});
await test('rename preserves ID, definitions, settings, and other profiles',()=>{
  const store=create(),[a,b]=store.add([cfg('A'),cfg('B')]),before=store.snapshot;
  store.rename(a,'Renamed');assert.equal(store.snapshot.savedProfiles[0].id,a);assert.equal(store.activeConfiguration.profileName,'Renamed');
  assert.deepEqual(store.snapshot.savedProfiles[1],before.savedProfiles[1]);assert.deepEqual(store.activeConfiguration.templates,before.savedProfiles[0].configuration.templates);
  assert.throws(()=>store.rename(b,''));assert.equal(store.snapshot.savedProfiles[1].configuration.profileName,'B');
});
await test('export-all round trip includes real profiles only and restore appends with new IDs',()=>{
  const store=create(),ids=store.add([cfg('A'),cfg('B')]);store.select(DEMO_ID);
  const backup=exportProfiles(store.snapshot),configs=importDisplayProfiles(backup);
  assert.equal(configs.length,2);assert.equal(backup.profiles.savedProfiles.length,2);
  const more=store.add(configs,{activate:false});assert.equal(new Set([...ids,...more]).size,4);assert.equal(store.snapshot.activeProfileID,DEMO_ID);
  const bad=copy(backup);bad.profiles.savedProfiles[1].configuration.schemaVersion=99;assert.throws(()=>importDisplayProfiles(bad));
  assert.deepEqual(importDisplayProfiles({format:core.WEB_FORMAT,formatVersion:1,configuration:cfg('Single')}),[cfg('Single')]);
});
await test('storage write errors leave mutation and active selection unchanged',()=>{
  const storage=memory(),store=create(storage),[id]=store.add([cfg('A')]),before=store.snapshot;storage.fail=true;
  for(const action of [()=>store.select(DEMO_ID),()=>store.rename(id,'Changed'),()=>store.remove(id),()=>store.add([cfg('B')])]) {
    assert.throws(action,/could not save/);assert.deepEqual(store.snapshot,before);
  }
});
await test('stale tab writes cannot overwrite a newer collection',()=>{
  const storage=memory(),first=create(storage);first.add([cfg('A')]);const second=create(storage);
  first.rename('profile-1','Renamed');assert.throws(()=>second.remove('profile-1'),/another tab/);
  assert.equal(create(storage).activeConfiguration.profileName,'Renamed');
});
await test('duplicate IDs and unsupported stored collection versions are rejected',()=>{
  const store=create();store.add([cfg('A')]);const value=store.snapshot;
  value.savedProfiles.push(copy(value.savedProfiles[0]));assert.throws(()=>profiles.validateStore(value),/duplicate/);
  value.schemaVersion=2;assert.throws(()=>profiles.validateStore(value),/unsupported/);
});

// Exercise app-level Demo/save routing with inert DOM objects, no browser.
await test('app switches Real-Demo-Real and explicit Demo copy adds a distinct profile',async()=>{
  const storage=memory(),nodes=new Map();
  const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',addEventListener(){},remove(){}});return nodes.get(key);};
  const sandbox={...core,...states,...profiles,esc:core.escapeHTML,Intl,Date,JSON,Set,crypto:globalThis.crypto,document:{querySelector:node,addEventListener(){}},localStorage:storage,clearInterval(){},setInterval(){},alert:message=>{throw Error(message);},fetch:async()=>({ok:true,json:async()=>copy(demo)})};
  vm.createContext(sandbox);
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,sandbox);sandbox.input=cfg('Real');vm.runInContext('save(input,null)',sandbox);
  const id=vm.runInContext('store.snapshot.activeProfileID',sandbox),real=JSON.parse(storage.getItem(PROFILE_KEY)).savedProfiles[0];
  await vm.runInContext('loadDemo()',sandbox);assert.equal(vm.runInContext('isDemo',sandbox),true);
  assert.equal(JSON.parse(storage.getItem(PROFILE_KEY)).savedProfiles.length,1);
  sandbox.id=id;vm.runInContext('selectProfile(id)',sandbox);assert.equal(vm.runInContext('config.profileName',sandbox),'Real');
  await vm.runInContext('loadDemo()',sandbox);vm.runInContext('config.profileName="Demo Copy";save(config,null)',sandbox);
  const saved=JSON.parse(storage.getItem(PROFILE_KEY));assert.equal(saved.savedProfiles.length,2);assert.deepEqual(saved.savedProfiles[0],real);assert.notEqual(saved.activeProfileID,id);
});
console.log(`\n${passed} Phase 3 tests passed.`);
