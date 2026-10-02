import { dateInZone, eventTitle, isMeaningfulEvent, timelineFor } from './display-core.mjs';

export const PRE_SCHOOL_LEAD_MS = 30 * 60 * 1000;
export function formatCountdown(ms) {
  const seconds=Math.max(0,Math.floor(Number.isFinite(ms)?ms/1000:0));
  const minutes=Math.floor(seconds/60), remainder=String(seconds%60).padStart(2,'0');
  return minutes>=60 ? `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}:${remainder}` : `${minutes}:${remainder}`;
}
export function remainingFraction(now,start,end) {
  return Number.isFinite(now) && Number.isFinite(start) && Number.isFinite(end) && end>start ? Math.max(0,Math.min(1,(end-now)/(end-start))) : 0;
}
export function countdownFraction(snapshot,now) {
  if(snapshot.countdownTarget===null) return 0;
  if(snapshot.current) return remainingFraction(now,snapshot.current.startAt,snapshot.countdownTarget);
  if(snapshot.state==='beforeSchool') return remainingFraction(now,snapshot.countdownTarget-PRE_SCHOOL_LEAD_MS,snapshot.countdownTarget);
  const transition=snapshot.passing.find(p=>p.startAt<=now && now<p.endAt && p.endAt===snapshot.countdownTarget);
  const previous=snapshot.events.filter(e=>e.endAt<=now).at(-1);
  return remainingFraction(now,transition?.startAt ?? previous?.endAt,snapshot.countdownTarget);
}
const labels = {
  preview:'UPCOMING', beforeSchool:'BEFORE SCHOOL', active:'NOW',
  passing:'PASSING TIME', gap:'UP NEXT', complete:'DONE FOR TODAY',
  weekend:'WEEKEND', 'no-school':'NO SCHOOL', unavailable:'TIMES UNAVAILABLE'
};

// The timeline contains only effective activities and valid explicit transitions.
// Published passing requires both effective edges; a removed class leaves a gap.
export function resolvePresentation(timeline, now, {isLive=true,showRooms=true}={}) {
  const {events,passing,status,key,timeZone} = timeline;
  const meaningful = events.filter(isMeaningfulEvent);
  const first = meaningful[0];
  const next = meaningful.find(e=>e.startAt > now) || null;
  const result = (state,current=null,upcoming=next,countdownTarget=null,title=null) => {
    const focus = state === 'active' ? current : upcoming;
    return {
      ...timeline,state,current,next:upcoming,countdownTarget,label:labels[state],
      title:title || (focus ? eventTitle(focus) : 'No Scheduled Activities'),
      room:showRooms && focus ? focus.room || '' : '',
      transition:state === 'passing' ? 'passing' : state === 'gap' ? 'gap' : null,
      lunch:current?.lunch || (current?.kind === 'lunch' ? {startAt:current.startAt,endAt:current.endAt} : null)
    };
  };
  if(status !== 'scheduled') {
    const title={weekend:'Weekend','no-school':'No School',unavailable:'Bell Times Unavailable'}[status];
    return result(status,null,null,null,title);
  }
  if(!first) return result('preview',null,null);
  // A selected future/past date is static even if its clock time matches now.
  if(!isLive || key !== dateInZone(now,timeZone)) return result('preview',null,first);
  const current = events.find(e=>e.startAt <= now && now < e.endAt) || null;
  if(current) {
    if(current.kind === 'passing') return result('passing',current,next,next?.startAt ?? null,current.lunch ? eventTitle(current) : null);
    return result('active',current,next,current.endAt);
  }
  if(now < first.startAt) {
    return result(first.startAt-now <= PRE_SCHOOL_LEAD_MS ? 'beforeSchool' : 'preview',null,first,
      first.startAt-now <= PRE_SCHOOL_LEAD_MS ? first.startAt : null);
  }
  if(next) {
    const authoritative = passing.some(p=>p.startAt <= now && now < p.endAt && next.startAt === p.endAt &&
      meaningful.some(e=>e.endAt === p.startAt && e.startAt < e.endAt));
    return result(authoritative ? 'passing' : 'gap',null,next,next.startAt);
  }
  if(timeline.workdayBoundary && now<timeline.workdayEndAt) {
    const point=timeline.workdayBoundary,boundary={...point,startAt:point.at,endAt:point.at,kind:'boundary'};
    return result('gap',null,boundary,point.at);
  }
  return result('complete',null,null,null,'Done for Today');
}

export function scheduleSnapshot(config, now, {date=dateInZone(now,config.school.timeZone),isLive=true}={}) {
  return resolvePresentation(timelineFor(config,date),now,{isLive,showRooms:config.preferences.showRooms});
}
