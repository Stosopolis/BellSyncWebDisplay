// Agenda planning only. Official times come from the production resolver.
import { timelineFor, eventTitle } from '../display-core.mjs';
import { classChoices, validItemDuration, timerView, effectiveTimerBell } from './classroom-model.mjs?v=agenda-release-1';
import { agendaPlan, runIsActive } from './classroom-sequence.mjs?v=agenda-release-1';

export function planReadiness(agenda, index, availableMs) {
  let plan = null, error = '';
  try { plan = agendaPlan(agenda, index); } catch (failure) { error = failure.message; }
  const missing = agenda.items.flatMap((title, i) => i >= index && !validItemDuration(agenda.itemDurationsMs?.[i]) ? [{ index: i, title }] : []);
  const totalMs = agenda.items.reduce((sum, _, i) => sum + (i >= index && validItemDuration(agenda.itemDurationsMs?.[i]) ? agenda.itemDurationsMs[i] : 0), 0);
  return { plan, error, missing, totalMs, overrunMs: Number.isFinite(availableMs) ? Math.max(0, totalMs - availableMs) : 0 };
}

export function classBudget(choice, live, now) {
  // A split class cannot run across lunch/passing. Preview its first segment.
  const event = live || choice?.events[0];
  return event ? { availableMs: Math.max(0, event.endAt - (live ? now : event.startAt)), event, live: Boolean(live) } : null;
}

export function fitDurations(durations, availableMs) {
  if (!durations.length || durations.some(d => !validItemDuration(d))) throw Error('Enter a duration for every remaining activity first.');
  const seconds = Math.floor(availableMs / 1000);
  if (seconds < durations.length) throw Error('There is not enough class time for every activity. Shorten the agenda manually.');
  const total = durations.reduce((a, b) => a + b, 0);
  if (total <= availableMs) return [...durations];
  // Reserve one second per item, then distribute the rest proportionally.
  const extra = seconds - durations.length;
  const weights = durations.map(d => d / total * extra);
  const result = weights.map(w => Math.floor(w) + 1);
  let remainder = seconds - result.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => ({ i, fraction: w - Math.floor(w) })).sort((a, b) => b.fraction - a.fraction);
  for (const { i } of order) { if (remainder-- <= 0) break; result[i]++; }
  return result.map(s => s * 1000);
}

export function destinationChoices(configuration, date) {
  const timeline = timelineFor(configuration, date);
  return timeline.status === 'scheduled' ? classChoices(timeline) : [];
}

export function copyAgendaContent(source, date, activityID) {
  // Deliberate content allowlist. No presentation, selection or run fields.
  return { date, activityID, title: source.title, instructions: source.instructions, items: [...source.items],
    ...(source.itemDurationsMs ? { itemDurationsMs: [...source.itemDurationsMs] } : {}) };
}

export function destinationBusy(profile, date, activityID, now, configuration) {
  const matches = value => value?.date === date && value.activityID === activityID;
  if (matches(profile.agendaRun) && runIsActive(profile.agendaRun)) return true;
  const timer = timerView(profile.timer, now, effectiveTimerBell(profile.timer, configuration));
  return Boolean(matches(timer) && ['running', 'paused'].includes(timer.status));
}

export function copyAgendas({ store, profileID, source, date, targets, configuration, now }) {
  const choices = destinationChoices(configuration, date);
  const copied = [], skipped = [];
  // One checked write makes the batch atomic, including clearing old terminal
  // progress for replaced destinations. The original active run is untouched.
  store.change(profileID, profile => {
    const seen = new Set();
    for (const target of targets) {
      if (seen.has(target.id)) continue;
      seen.add(target.id);
      const choice = choices.find(c => c.id === target.id);
      const label = choice ? eventTitle(choice.event) : target.label || 'Unavailable class';
      const skip = reason => skipped.push(`${label}: ${reason}`);
      if (!choice || (date === source.date && target.id === source.activityID)) { skip('not an eligible destination'); continue; }
      if (destinationBusy(profile, date, target.id, now, configuration)) { skip('has an active or paused session'); continue; }
      const existing = profile.agendas.find(a => a.date === date && a.activityID === target.id);
      if (JSON.stringify(existing ?? null) !== target.original) { skip('agenda changed; review it again'); continue; }
      if (existing && !target.replace) { skip('existing agenda kept'); continue; }
      const agenda = copyAgendaContent(source, date, target.id);
      profile.agendas = profile.agendas.filter(a => a.date !== date || a.activityID !== target.id);
      profile.agendas.push(agenda);
      const matches = v => v?.date === date && v.activityID === target.id;
      if (matches(profile.agendaRun)) profile.agendaRun = null;
      if (matches(profile.timer)) profile.timer = null;
      if (matches(profile.presentation)) profile.presentation = null;
      const budget = classBudget(choice, null, now);
      const readiness = planReadiness(agenda, 0, budget.availableMs);
      copied.push({ label, overrunMs: readiness.overrunMs, missing: readiness.missing.length, split: choice.events.length > 1 });
    }
  });
  return { copied, skipped };
}
