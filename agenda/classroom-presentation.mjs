// Presentation adapters only: all event bounds/states come from the shared engine.
import { validDate, dateInZone, eventTitle, formatClock, scheduleRowLabel, isRedundantScheduleBadge } from '../display-core.mjs';
import { resolvePresentation } from '../schedule-presentation.mjs';
export function agendaDensity(agenda) {
 const items=agenda?.items || [],instructions=agenda?.instructions || '';
 const total=items.reduce((n,item)=>n+item.length,0)+instructions.length;
 return {compact:items.length>=4 || total>450,long:items.length>6 || instructions.length>700 || total>1500};
}
export function schoolScheduleRows(snapshot,config,now,view='full') {
 if(!config.preferences.showSchedule)return [];
 const preview=snapshot.key!==dateInZone(now,config.school.timeZone);
 const events=[...snapshot.events];
 // Published transitions are retained only when the existing presentation
 // resolver confirms both effective edges. No gap is inferred as passing.
 for(const interval of snapshot.passing || []) {
  const resolved=resolvePresentation(snapshot,interval.startAt);
  if(resolved.state!=='passing' || resolved.countdownTarget!==interval.endAt || events.some(e=>e.kind==='passing' && e.startAt===interval.startAt && e.endAt===interval.endAt))continue;
  events.push({...interval,id:`published-passing:${interval.startAt}:${interval.endAt}`,kind:'passing',label:'PASSING',title:'Passing Time',room:''});
 }
 for(const point of snapshot.points || [])events.push({...point,kind:'point',startAt:point.at,endAt:point.at});
 const clock=at=>formatClock(at-(config.bellTimingAdjustmentSeconds || 0)*1000,config.school.timeZone,config.preferences.hour24);
 return events.filter(e=>view==='full' || preview || (e.kind==='point'?e.startAt>=now:e.endAt>now)).sort((a,b)=>a.startAt-b.startAt || a.endAt-b.endAt).map(e=>{
  const title=eventTitle(e),fullLabel=e.kind==='point'?'':scheduleRowLabel(e,config.preferences.scheduleLabels);
  const badge=e.kind==='lunch' && ['L1','L2','L3'].includes(e.lunch?.selection)?e.lunch.selection
   : config.preferences.scheduleLabels==='blocks' && e.kind!=='lunch' && e.kind!=='passing' && e.blockID?e.blockID.replace(/^([A-G]) Block$/i,'$1')
   : fullLabel.replace(/^Period (\d+)$/,'P$1');
  const current=!preview && (snapshot.current?.id===e.id || (snapshot.state==='passing' && e.kind==='passing' && e.startAt<=now && now<e.endAt));
  const complete=!preview && !current && (e.kind==='point'?e.startAt<now:e.endAt<=now);
  return {id:e.id,kind:e.kind,title,status:current?'current':complete?'complete':'future',badge:fullLabel && !isRedundantScheduleBadge(badge,title)?badge:'',fullLabel,room:config.preferences.showRooms?e.room || '':'',point:e.kind==='point',current,start:clock(e.startAt),end:e.kind==='point'?'':clock(e.endAt)};
 });
}

// Preserve the previous Remaining presentation for callers and regressions.
export function remainingSchoolRows(snapshot,config,now){return schoolScheduleRows(snapshot,config,now,'remaining');}

// Editor-only keyboard planning; saved agenda schema remains unchanged.
export function advanceAgendaItem(items,index) {
 const next=[...items];
 if(!Number.isInteger(index) || index<0 || index>=next.length)return {items:next,index:null};
 if(!next[index].trim())return {items:next,index};
 if(index+1<next.length)return {items:next,index:index+1};
 if(next.length>=50)return {items:next,index,error:'Use up to 50 items.'};
 next.push('');return {items:next,index:index+1};
}

// Treat the school's selected date as a calendar value, independent of elapsed
// hours or the browser's time zone. The shared resolver validates the result.
export function adjacentLessonDate(date, direction) {
  if (!validDate(date) || ![-1, 1].includes(direction)) throw Error('Choose a valid lesson date.');
  const calendar = new Date(`${date}T12:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + direction);
  const result = calendar.toISOString().slice(0, 10);
  if (!validDate(result)) throw Error('Choose a lesson date between 2000 and 2099.');
  return result;
}

// Match a source period only for choosing the new date's resolved activity.
// Its full identity is retained for agenda lookup. Display names never match.
export function equivalentClassChoice(choices, previous) {
  if (!previous) return null;
  const exact = choices.find(choice => choice.id === previous.id);
  if (exact) return exact;
  const source = previous.event.activitySource;
  const matches = choices.filter(choice => {
    const candidate = choice.event.activitySource;
    if (source && candidate) {
      return Boolean(source.periodID && source.schoolID && source.layer &&
        source.schoolID === candidate.schoolID && source.layer === candidate.layer &&
        source.periodID === candidate.periodID);
    }
    return !source && !candidate && previous.event.periodID &&
      choice.event.periodID === previous.event.periodID;
  });
  return matches.length === 1 ? matches[0] : null;
}
