// Profile-local timing overlays. The frozen native source is never rewritten.
const time=v=>typeof v==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const timingKey=e=>JSON.stringify([e.type,e.templateID || '',e.id]);
export function timingCatalog(config) {
 const entries=new Map(),raw=config.portable?.shared,d=raw?.schoolDefinitionSnapshot;
 const add=(entry,start,end)=>{const key=timingKey(entry),existing=entries.get(key);if(existing)existing.sources.push({start,end});else entries.set(key,{...entry,sources:[{start,end}]});};
 if(d) {
  for(const t of d.scheduleTemplates) {
   const dayID=Object.entries(d.calendarRule.cycleDayTemplateIDs || {}).find(([,id])=>id===t.id)?.[0];
   const group=(dayID && d.cycle.dayDisplayNames?.[dayID]) || t.displayName || t.id;
   for(const rows of [t.periods,...Object.values(t.periodsByEffectiveDate || {})])for(const p of rows)add({type:'template',templateID:t.id,id:p.id,label:d.periodDefinitions.find(x=>x.id===p.periodID).displayName,group},p.start,p.end);
  }
  for(const type of ['personal','staff'])for(const p of d.activityLayers?.[type] || [])add({type:`${type}-layer`,id:p.id,label:d.periodDefinitions.find(x=>x.id===p.periodID).displayName,group:type==='personal'?'Profile activities':'Staff activities'},p.start,p.end);
  for(const p of d.scheduledPointEvents || [])add({type:'point',id:p.id,label:p.title,group:'Point reminders'},p.time,null);
 } else for(const [templateID,rows] of Object.entries(config.templates || {})) for(const p of rows)add({type:'template',templateID,id:p.id,label:p.label || p.id,group:templateID},p.start,p.end);
 for(const p of (raw || config.nativeMetadata?.sharedSchedule)?.personalActivities || [])add({type:'personal',id:p.id,label:p.title,group:'Profile activities'},p.start,p.end);
 return [...entries.values()];
}
export function validateTimingOverrides(config) {
 const edits=config.timingOverrides;if(edits===undefined)return;
 if(!Array.isArray(edits) || edits.length>5000)throw Error('Invalid timing overrides.');
 const catalog=timingCatalog(config),seen=new Set();
 for(const edit of edits) {
  if(!edit || typeof edit!=='object' || Array.isArray(edit))throw Error('Invalid timing override.');
  const source=catalog.find(s=>timingKey(s)===timingKey(edit));
  if(!source || seen.has(timingKey(edit)))throw Error('Unknown or duplicate timing override.');seen.add(timingKey(edit));
  const fields=source.type==='point'?['time']:['start','end'];
  if(Object.keys(edit).some(k=>!['type','templateID','id',...fields].includes(k)) || !fields.some(k=>edit[k]!==undefined))throw Error('Invalid timing override fields.');
  for(const field of fields)if(edit[field]!==undefined && !time(edit[field]))throw Error('Enter a valid override time. Leave it blank to use the source.');
  if(source.type!=='point')for(const s of source.sources)if((edit.end ?? s.end)<=(edit.start ?? s.start))throw Error(`${source.label}: effective end must be after effective start.`);
 }
}
export function effectiveTimingConfiguration(config) {
 if(!config.timingOverrides?.length)return config;
 const next=JSON.parse(JSON.stringify(config)),raw=next.portable?.shared,d=raw?.schoolDefinitionSnapshot;
 const apply=(item,type,templateID)=>{const edit=config.timingOverrides.find(e=>timingKey(e)===timingKey({type,templateID,id:item.id}));if(edit)for(const field of ['start','end','time'])if(edit[field]!==undefined)item[field]=edit[field];};
 if(d) {
  for(const t of d.scheduleTemplates)for(const rows of [t.periods,...Object.values(t.periodsByEffectiveDate || {})])for(const p of rows)apply(p,'template',t.id);
  for(const type of ['personal','staff'])for(const p of d.activityLayers?.[type] || [])apply(p,`${type}-layer`);
  for(const p of d.scheduledPointEvents || [])apply(p,'point');
 } else {
  for(const [templateID,rows] of Object.entries(next.templates || {}))for(const p of rows)apply(p,'template',templateID);
  for(const p of next.periods || [])apply(p,'template','regular');
 }
 for(const p of (raw || next.nativeMetadata?.sharedSchedule)?.personalActivities || [])apply(p,'personal');
 return next;
}
export function setTimingOverrides(config,inputs) {
 const next=JSON.parse(JSON.stringify(config));next.timingOverrides=inputs.map(({type,templateID,id,start,end,time})=>Object.fromEntries(Object.entries({type,templateID,id,start,end,time}).filter(([,v])=>v!==undefined && v!==''))).filter(e=>['start','end','time'].some(k=>e[k]!==undefined));
 if(!next.timingOverrides.length)delete next.timingOverrides;
 validateTimingOverrides(next);return next;
}
