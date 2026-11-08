import confirmedSource from './wshs-source.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const regularTemplates=['regular','wednesday','thursday'];
export const WSHS_SECOND_SEMESTER=confirmedSource.secondSemesterDate;
// Adapt the normalized handoff, including stable native item IDs and labels.
// This Web adapter uses the existing portable resolver, not a second engine.
export function wshsShared(source) {
  if(source.handoffSchemaVersion!==2 || source.schoolID!=='wshs' || source.schoolYear!=='2026-2027' || source.timezone!=='America/New_York' || source.lunch?.automaticSemesterSwitch!==true)throw Error('Expected WSHS handoff schema v2.');
  const scheduleTemplates=[],lunchRules=[];
  for(const [id,t] of Object.entries(source.templates)) {
    const special=!regularTemplates.includes(id);
    const alternatives=Object.entries(t.lunchChoices).map(([choice,rows])=>{
      const lunch=rows.find(r=>r[0]==='Lunch'),lesson=rows.find(r=>r[0]===t.lunchPeriod);
      return {id:choice,displayName:source.lunch.labels[choice],start:lunch[1],end:lunch[2],classTimes:{start:lesson[1],end:lesson[2]}};
    });
    const times=Object.values(t.lunchChoices).flat().flatMap(r=>[r[1],r[2]]).sort();
    const rows=[...t.commonBeforeLunch,...(t.lunchPeriod?[[t.lunchPeriod,times[0],times.at(-1)]]:[]),...t.commonAfterLunch];
    const periods=rows.map(([periodID,start,end],index)=>{
      const itemID=special?`${periodID}-${index+1}`:periodID;
      return {id:itemID,periodID,start,end,...(t.activityLabels?.[itemID]?{displayName:t.activityLabels[itemID]}:{})};
    });
    const dates=Object.entries(source.calendarExceptions).filter(([,e])=>e.templateID===id).map(([date])=>date);
    scheduleTemplates.push({id,displayName:special?`Exams · ${dates.join(' / ')}`:Object.entries(source.weekdayTemplates).filter(([,v])=>v===id).map(([day])=>day).join(', '),periods});
    if(t.lunchPeriod)lunchRules.push({id:`${id}-${t.lunchPeriod}`,periodID:t.lunchPeriod,templateID:id,selectedOptionID:source.lunch.initialVisibleChoice,options:alternatives});
  }
  const calendarExceptions={};
  for(const [start,end] of source.noSchoolRangesInclusive) {
    for(let date=new Date(`${start}T12:00Z`);date.toISOString().slice(0,10)<=end;date.setUTCDate(date.getUTCDate()+1)) {
      const key=date.toISOString().slice(0,10),number=source.conditionalMakeupDates[key];
      calendarExceptions[key]={kind:'noSchool',note:number?`Conditional make-up day #${number} · No school unless confirmed`:'Published school closure'};
    }
  }
  Object.assign(calendarExceptions,copy(source.calendarExceptions));
  calendarExceptions[source.secondSemesterDate]={kind:'scheduled',templateID:source.weekdayTemplates.Wednesday,note:'Second semester begins · Opposite lunch unless individually overridden'};
  const weekdayNumbers={Monday:'2',Tuesday:'3',Wednesday:'4',Thursday:'5',Friday:'6'};
  return {
    formatVersion:2,schoolProfileID:source.schoolID,schoolContentVersion:source.contentVersion,
    scheduleName:'Winter Springs High School 2026–27',createdAt:new Date().toISOString(),
    assignments:{all:Object.fromEntries(Object.keys(source.lunch.manualSelectionKeys).map(period=>[period,{title:`Period ${period.slice(1)}`,room:'',block:period,lunch:source.lunch.initialVisibleChoice}]))},
    personalActivities:[],calendarCorrections:[],
    schoolDefinitionSnapshot:{schemaVersion:1,id:source.schoolID,contentVersion:source.contentVersion,displayName:source.name,timeZoneIdentifier:source.timezone,
      cycle:{kind:'sameEveryDay',dayIDs:['all']},
      periodDefinitions:[...Array.from({length:7},(_,i)=>({id:`P${i+1}`,displayName:`Period ${i+1}`,kind:'academic',acceptsPersonalAssignment:true})),{id:'break',displayName:'Break',kind:'other',acceptsPersonalAssignment:false}],
      scheduleTemplates,lunchRules,
      calendarRule:{mode:'weekdayCycle',schoolWeekdays:[2,3,4,5,6],defaultTemplateID:'regular',weekdayTemplateIDs:Object.fromEntries(Object.entries(source.weekdayTemplates).map(([day,id])=>[weekdayNumbers[day],id])),personalAssignmentLayout:'sharedPeriods',startDate:source.firstStudentDate,endDate:source.lastStudentDate},
      calendarExceptions,
      scheduledPointEvents:[{id:'first-bell',title:'First Bell',time:source.firstBell,note:'Instruction begins at 7:20 AM',excludedDates:Object.entries(source.calendarExceptions).filter(([,e])=>!regularTemplates.includes(e.templateID)).map(([date])=>date)}],
      activityPresentation:{contextLabel:'WSHS',notes:['Wednesday Period 4 includes announcements.','Semester two defaults to the opposite P5/P6 lunch, with independent overrides.',...source.unresolved]},
    },
    wshsSource:source,
  };
}

export function wshsLunchPreference(raw,period) {
  const rules=raw.schoolDefinitionSnapshot.lunchRules ?? [];
  const rule=rules.find(r=>r.periodID===period && r.templateID===(period==='P6'?'wednesday':'regular')) ?? rules.find(r=>r.periodID===period);
  const saved=raw.wshsLunchPreferences?.[period],assignment=raw.assignments?.all?.[period]?.lunch;
  // Prior Web profiles saved assignments; native snapshots save canonical rules.
  const first=saved?.selectedOptionID ?? (raw.wshsSource?assignment ?? rule?.selectedOptionID:rule?.selectedOptionID ?? assignment) ?? 'L1';
  return {selectedOptionID:first,secondSemesterOptionID:saved && Object.hasOwn(saved,'secondSemesterOptionID')?saved.secondSemesterOptionID:rule?.secondSemesterOptionID ?? null};
}
export function effectiveWSHSLunch(raw,period,key) {
  const p=wshsLunchPreference(raw,period);
  return key<WSHS_SECOND_SEMESTER?p.selectedOptionID:p.secondSemesterOptionID ?? (p.selectedOptionID==='L1'?'L2':'L1');
}

// Pure compatibility overlay, also used by old backups/native snapshots. Only
// recognized v1 source versions are upgraded; custom source records win.
export function adoptWSHSUpdate(raw) {
  const d=raw?.schoolDefinitionSnapshot;
  if(raw?.schoolProfileID!=='wshs' || d?.id!=='wshs' || !['2026-2027.1','2026-2027.1-edited'].includes(d.contentVersion))return raw;
  const next=copy(raw),target=next.schoolDefinitionSnapshot,confirmed=wshsShared(confirmedSource).schoolDefinitionSnapshot;
  const conflicts=new Set(next.wshsUpdateConflicts ?? []);
  const record=(key)=>conflicts.add(key);
  for(const p of confirmed.periodDefinitions)if(!target.periodDefinitions.some(old=>old.id===p.id))target.periodDefinitions.push(p);
  for(const t of confirmed.scheduleTemplates.filter(t=>!regularTemplates.includes(t.id))) {
    const old=target.scheduleTemplates.find(old=>old.id===t.id);
    if(!old)target.scheduleTemplates.push(t);else record(`Preserved existing template: ${t.id}`);
  }
  target.lunchRules ??= [];
  for(const r of confirmed.lunchRules.filter(r=>!regularTemplates.includes(r.templateID))) {
    if(!target.lunchRules.some(old=>old.id===r.id))target.lunchRules.push(r);else record(`Preserved existing lunch rule: ${r.id}`);
  }
  for(const key of Object.keys(confirmedSource.calendarExceptions)) {
    const old=target.calendarExceptions[key];
    const pending=old?.kind==='scheduleUnavailable' && old.note==='Early dismissal · Bell times pending school confirmation' && Object.keys(old).every(k=>['kind','note'].includes(k));
    if(!old || pending)target.calendarExceptions[key]=confirmed.calendarExceptions[key];else record(`Preserved date exception: ${key}`);
  }
  if(target.calendarExceptions[WSHS_SECOND_SEMESTER]?.note==='Second semester begins · Lunch selection remains manual')target.calendarExceptions[WSHS_SECOND_SEMESTER]=confirmed.calendarExceptions[WSHS_SECOND_SEMESTER];
  target.contentVersion=d.contentVersion.endsWith('-edited')?'2026-2027.2-edited':'2026-2027.2';
  // Original source metadata and all user edits/assignments/overlays are retained.
  next.wshsUpdateConflicts=[...conflicts];
  return next;
}

// Other schools and correction kinds retain the existing import quarantine.
export function supportsWSHSCorrections(raw) {
  const rows=raw?.calendarCorrections;
  if(!Array.isArray(rows) || !rows.length)return rows==null || Array.isArray(rows);
  if(raw.schoolProfileID!=='wshs' || raw.schoolDefinitionSnapshot?.id!=='wshs')return false;
  return rows.every(r=>r && ['noSchool','schoolInSession'].includes(r.kind));
}
