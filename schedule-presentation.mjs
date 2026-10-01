import { dateInZone, eventTitle, isMeaningfulEvent, timelineFor } from './display-core.mjs';

export const PRE_SCHOOL_LEAD_MS = 30 * 60 * 1000;
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
  return result('complete',null,null,null,'Done for Today');
}

export function scheduleSnapshot(config, now, {date=dateInZone(now,config.school.timeZone),isLive=true}={}) {
  return resolvePresentation(timelineFor(config,date),now,{isLive,showRooms:config.preferences.showRooms});
}
