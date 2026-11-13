// All official boundaries come from the live production schedule snapshot.
import { ClassroomStore, liveClass, activityIdentity, segmentIdentity, timerView, validItemDuration } from './classroom-model.mjs?v=agenda-release-1';

const MAX_TICK_GAP_MS = 2500;

export const runIsActive = run => Boolean(run && ['running', 'paused', 'recover'].includes(run.status));

export class AgendaBoundaryError extends Error {
  constructor(overrunMs) {
    const minutes = Math.ceil(overrunMs / 60000);
    super(`The remaining agenda exceeds class time by about ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
}

export function agendaPlan(agenda, startIndex = 0) {
  if (!agenda?.items.length) throw Error('Add activities before running the agenda.');
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= agenda.items.length) throw Error('Choose an agenda item to start.');
  const items = agenda.items.map((title, index) => {
    const durationMs = agenda.itemDurationsMs?.[index] ?? null;
    return { title, durationMs, excluded: index < startIndex && durationMs === null };
  });
  const included = items.slice(startIndex);
  const missingIndex = included.findIndex(item => !validItemDuration(item.durationMs));
  if (missingIndex !== -1) throw Error(`Add a duration for activity ${startIndex + missingIndex + 1}, or present the agenda manually.`);
  return { items, startIndex, totalMs: included.reduce((total, item) => total + item.durationMs, 0) };
}

export function runMatchesAgenda(run, agenda) {
  return Boolean(run && agenda && run.date === agenda.date && run.activityID === agenda.activityID &&
    run.items.length === agenda.items.length && run.items.every((item, index) =>
      item.title === agenda.items[index] && item.durationMs === (agenda.itemDurationsMs?.[index] ?? null)));
}

const scheduleIdentity = snapshot => JSON.stringify([snapshot.day?.day, snapshot.day?.schedule]);

function sameClass(run, timer, snapshot, now) {
  const event = liveClass(snapshot, now);
  return event && run.date === snapshot.key && run.activityID === activityIdentity(event) &&
    (run.scheduleID === undefined || run.scheduleID === scheduleIdentity(snapshot)) &&
    run.segmentID === segmentIdentity(event) && timer.segmentID === event.id ? event : null;
}

function ownsTimer(run, timer) {
  return timer?.agendaRunID === run.id && timer.date === run.date && timer.activityID === run.activityID;
}

function remainingPlan(run, index) {
  return run.items.slice(index).reduce((total, item) => total + item.durationMs, 0);
}

export class AgendaController {
  constructor(store, { makeID = () => globalThis.crypto.randomUUID() } = {}) {
    this.store = store;
    this.makeID = makeID;
    this.seen = new Map();
  }

  // Stage timer and run updates together. A failed write leaves both intact.
  transaction(id, apply) {
    let raw = JSON.stringify(this.store.snapshot);
    const stage = new ClassroomStore({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
    apply(stage);
    const next = stage.profile(id);
    this.store.change(id, profile => Object.assign(profile, next));
  }

  ensure(id, snapshot, now) {
    const { agendaRun: run, timer } = this.store.runState(id);
    if (!runIsActive(run)) throw Error('No active agenda.');
    const event = ownsTimer(run, timer) && sameClass(run, timer, snapshot, now);
    if (!event) throw Error('Return to the original live class to continue this agenda.');
    return { run, timer, event };
  }

  checkPlan(total, event, now, allowOverrun) {
    if (total > event.endAt - now && !allowOverrun) throw new AgendaBoundaryError(total - (event.endAt - now));
  }

  startTimer(stage, id, run, snapshot, now) {
    const item = run.items[run.index];
    stage.start(id, { name: item.title.slice(0, 200), durationMs: item.durationMs, snapshot, now, allowOverrun: true });
    stage.change(id, profile => { profile.timer.agendaRunID = run.id; });
  }

  start(id, { snapshot, now, startIndex = 0, allowOverrun = false, replaceManual = false, restartCompleted = false, transitionSound }) {
    const event = liveClass(snapshot, now);
    if (!event) throw Error('Run Agenda only while viewing the current live class.');
    const activityID = activityIdentity(event);
    const { agendaRun: previous, timer } = this.store.runState(id);
    const agenda = this.store.agenda(id, snapshot.key, activityID);
    const plan = agendaPlan(agenda, startIndex);
    if (runIsActive(previous)) throw Error('Stop the current agenda before starting another.');
    const completed = runMatchesAgenda(previous, agenda) ? previous.completed : [];
    if (completed.some(index => index >= startIndex) && !restartCompleted) throw Error('Confirm restarting completed activities.');
    const manual = !timer?.agendaRunID && timerView(timer, now);
    if (manual && manual.status !== 'complete' && !replaceManual) throw Error('Confirm replacing the active manual timer.');
    this.checkPlan(plan.totalMs, event, now, allowOverrun);
    const earlier = completed.filter(index => index < startIndex);
    const run = {
      id: this.makeID(), date: snapshot.key, activityID, segmentID: segmentIdentity(event),
      scheduleID: scheduleIdentity(snapshot), index: startIndex, items: plan.items, completed: earlier,
      skipped: Array.from({ length: startIndex }, (_, index) => index).filter(index => !earlier.includes(index)),
      status: 'running', bellAt: event.endAt, lastCheckedAt: now, lastTransitionAt: now,
    };
    this.transaction(id, stage => {
      this.startTimer(stage, id, run, snapshot, now);
      stage.change(id, profile => {
        profile.agendaRun = run;
        if (transitionSound !== undefined) profile.transitionSound = transitionSound;
      });
      stage.showAgenda(id, run.date, run.activityID, 'class', now, run.segmentID);
    });
    this.seen.set(run.id, now);
    return run;
  }

  stop(id, now, { confirmed = false, reason = 'Stopped by teacher', automatic = false } = {}) {
    const { agendaRun: run, timer } = this.store.runState(id);
    if (!runIsActive(run)) return;
    if (!confirmed && !automatic) throw Error('Confirm Stop Agenda.');
    this.transaction(id, stage => {
      if (ownsTimer(run, timer)) stage.finish(id, now);
      stage.change(id, profile => Object.assign(profile.agendaRun, { status: 'stopped', reason, lastCheckedAt: now }));
    });
    this.seen.delete(run.id);
  }

  interrupt() {
    this.seen.clear();
  }

  suspend(id, now, reason = 'Profile or date changed') {
    const { agendaRun: run, timer } = this.store.runState(id);
    if (run?.status !== 'running') return;
    if (!ownsTimer(run, timer)) {
      this.stop(id, now, { automatic: true, reason: 'The activity timer is no longer available.' });
      return;
    }
    const status = timerView(timer, now).status === 'running' ? 'paused' : 'recover';
    this.transaction(id, stage => {
      if (status === 'paused') stage.pause(id, now);
      stage.change(id, profile => Object.assign(profile.agendaRun, {
        status, reason: status === 'recover' ? 'The activity elapsed while you were away.' : reason, lastCheckedAt: now,
      }));
    });
    this.seen.delete(run.id);
  }

  reconcile(id, { snapshot, now, visible = true, selectedDate = snapshot.key }) {
    const { agendaRun: run, timer } = this.store.runState(id);
    if (!runIsActive(run)) return;
    const owns = ownsTimer(run, timer);
    const event = owns && sameClass(run, timer, snapshot, now);
    if (!event) {
      const origin = owns && snapshot.key === run.date &&
        snapshot.events.find(item => item.id === timer.segmentID && activityIdentity(item) === run.activityID);
      const ended = (origin && now >= origin.endAt) || snapshot.key > run.date;
      this.stop(id, now, {
        automatic: true, reason: ended ? 'The official class bell ended this run.' : 'The original live class or timer is no longer available.',
      });
      return;
    }
    if (selectedDate !== run.date) {
      this.suspend(id, now, 'The selected date changed. Return to the live class to resume.');
      return;
    }
    if (run.status !== 'running') return;
    if (!visible) {
      this.seen.delete(run.id);
      return;
    }
    const previous = this.seen.get(run.id);
    this.seen.set(run.id, now);
    const view = timerView(timer, now);
    if (view.status !== 'complete') return;
    const next = run.items[run.index + 1];
    const missed = previous === undefined || now < previous || now - previous > MAX_TICK_GAP_MS ||
      (next && now >= view.endAt + next.durationMs);
    if (missed) {
      this.store.change(id, profile => Object.assign(profile.agendaRun, {
        status: 'recover', reason: 'The activity elapsed while you were away.', lastCheckedAt: now, bellAt: event.endAt,
      }));
      return { kind: 'recovery' };
    }
    return this.advance(id, snapshot, now, {
      anchor: Math.max(event.startAt, view.endAt), soundEligible: now - view.endAt <= 2000,
    });
  }

  advance(id, snapshot, now, { anchor = now, skipped = false, soundEligible = false } = {}) {
    const { run, event } = this.ensure(id, snapshot, now);
    const previous = run.index;
    const next = previous + 1;
    const finished = next >= run.items.length;
    const target = skipped ? 'skipped' : 'completed';
    const other = skipped ? 'completed' : 'skipped';
    if (!run[target].includes(previous)) run[target].push(previous);
    run[other] = run[other].filter(index => index !== previous);
    Object.assign(run, { lastCheckedAt: now, lastTransitionAt: now, bellAt: event.endAt });
    delete run.reason;
    this.transaction(id, stage => {
      if (finished) {
        stage.finish(id, now);
        run.status = 'complete';
      } else {
        run.index = next;
        run.status = 'running';
        this.startTimer(stage, id, run, snapshot, anchor);
      }
      stage.change(id, profile => { profile.agendaRun = run; });
    });
    if (finished) this.seen.delete(run.id);
    else this.seen.set(run.id, now);
    return { kind: finished ? 'complete' : 'transition', id: `${run.id}:${previous}`, soundEligible };
  }

  pause(id, now) {
    const { agendaRun: run, timer } = this.store.runState(id);
    if (run?.status !== 'running' || !ownsTimer(run, timer)) throw Error('There is no running agenda to pause.');
    this.transaction(id, stage => {
      stage.pause(id, now);
      stage.change(id, profile => Object.assign(profile.agendaRun, { status: 'paused', lastCheckedAt: now }));
    });
    this.seen.delete(run.id);
  }

  resume(id, snapshot, now, allowOverrun = false) {
    const { run, timer, event } = this.ensure(id, snapshot, now);
    if (run.status !== 'paused') throw Error('Only a paused agenda can resume.');
    this.checkPlan(timer.remainingMs + remainingPlan(run, run.index + 1), event, now, allowOverrun);
    this.transaction(id, stage => {
      stage.resume(id, snapshot, now, true);
      stage.change(id, profile => {
        delete profile.agendaRun.reason;
        Object.assign(profile.agendaRun, { status: 'running', lastCheckedAt: now, bellAt: event.endAt });
      });
    });
    this.seen.set(run.id, now);
  }

  add(id, minutes, snapshot, now, allowOverrun = false) {
    const { run, event } = this.ensure(id, snapshot, now);
    if (run.status === 'recover') throw Error('Choose how to recover before adjusting time.');
    this.store.add(id, minutes, now, event.endAt, allowOverrun);
  }

  next(id, snapshot, now, allowOverrun = false, { skipped = false } = {}) {
    const { run, event } = this.ensure(id, snapshot, now);
    if (run.status === 'recover') throw Error('Choose how to recover before continuing.');
    this.checkPlan(remainingPlan(run, run.index + 1), event, now, allowOverrun);
    return this.advance(id, snapshot, now, { skipped, soundEligible: true });
  }

  recover(id, snapshot, now, choice, allowOverrun = false) {
    const { run, event } = this.ensure(id, snapshot, now);
    if (run.status !== 'recover') throw Error('No agenda needs recovery.');
    if (choice === 'next') {
      this.checkPlan(remainingPlan(run, run.index + 1), event, now, allowOverrun);
      return this.advance(id, snapshot, now, { skipped: true });
    }
    if (choice !== 'restart') throw Error('Choose Restart Current or Next Activity.');
    this.checkPlan(remainingPlan(run, run.index), event, now, allowOverrun);
    this.transaction(id, stage => {
      this.startTimer(stage, id, run, snapshot, now);
      stage.change(id, profile => {
        delete profile.agendaRun.reason;
        Object.assign(profile.agendaRun, { status: 'running', lastCheckedAt: now, lastTransitionAt: now, bellAt: event.endAt });
      });
    });
    this.seen.set(run.id, now);
  }
}
