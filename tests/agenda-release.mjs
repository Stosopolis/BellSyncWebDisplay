// Release source/dependency checks only. No browser, UI, audio or live storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { AGENDA_MODE_ENABLED, isAgendaPreviewEnabled } from '../agenda/feature-flag.mjs?v=agenda-release-1';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
assert.equal(AGENDA_MODE_ENABLED,true);
for(const hostname of ['display.bellsync.app','localhost','127.0.0.1'])assert(isAgendaPreviewEnabled({hostname,search:''}));
for(const hostname of ['example.com','display.bellsync.app.example.com','other.vercel.app'])assert(!isAgendaPreviewEnabled({hostname,search:'?agenda=1'}));
const preview=read('agenda/classroom-preview.mjs');
assert.match(preview,/let classroom = false;/);
assert.match(preview,/data-mode="normal" aria-pressed="true">Bell View/);
assert.match(preview,/data-mode="classroom" aria-pressed="false">Classroom View/);
assert.match(read('app.js'),/AGENDA_MODE_ENABLED \|\|/);
assert.match(read('index.html'),/styles\.css\?v=agenda-release-1/);
assert.match(read('index.html'),/app\.js\?v=agenda-release-1/);
const seen=new Set(),queue=['app.js'];
while(queue.length){
 const file=queue.shift();if(seen.has(file))continue;seen.add(file);
 const source=read(file);
 const references=[...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)].map(m=>m[1]);
 for(const ref of references){
  const target=path.normalize(path.join(path.dirname(file),ref.split('?')[0]));
  assert(fs.existsSync(path.join(root,target)),`${file}: missing ${ref}`);
  if(target.startsWith('agenda/'))assert(ref.endsWith('?v=agenda-release-1'),`${file}: unversioned Agenda import`);
  assert.notEqual(target,'agenda/classroom-ui.mjs','Unused prototype must not be reachable');
  if(/\.(mjs|js)$/.test(target))queue.push(target);
 }
}
for(const file of fs.readdirSync(path.join(root,'agenda')).filter(f=>f.endsWith('.mjs')&&f!=='classroom-ui.mjs')){
 assert(seen.has('agenda/'+file),`Agenda module missing from release graph: ${file}`);
 await import(pathToFileURL(path.join(root,'agenda',file)));
}
for(const file of ['styles.css','agenda/classroom-preview.css','public/assets/bellsync-display-icon.png'])assert(fs.existsSync(path.join(root,file)));
console.log(`PASS public host gate, Bell View default, labels, asset revisions, prototype exclusion and ${seen.size} reachable module references`);
