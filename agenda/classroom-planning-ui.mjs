import { eventTitle, escapeHTML as esc } from '../display-core.mjs';
import { validItemDuration } from './classroom-model.mjs?v=agenda-release-1';
import { formatCountdown } from '../schedule-presentation.mjs';
import { planReadiness, classBudget, fitDurations, destinationChoices, destinationBusy, copyAgendas } from './classroom-planning.mjs?v=agenda-release-1';

const minutes = ms => ms == null ? '' : String(ms / 60000);
const duration = ms => ms == null ? 'No duration' : `${formatCountdown(ms)}`;
function dialogFrame(title, body, action) {
  const dialog = document.createElement('dialog');
  dialog.className = 'agenda-edit-dialog agenda-planning-dialog';
  dialog.setAttribute('aria-labelledby', 'agenda-planning-title');
  dialog.innerHTML = `<form novalidate>
    <header><h2 id="agenda-planning-title">${title}</h2><button type="button" data-close aria-label="Close dialog">×</button></header>
    <div class="agenda-edit-body">${body}</div>
    <p data-error role="alert"></p>
    <footer><button type="button" data-close>Cancel</button><button type="submit" class="primary">${action}</button></footer>
  </form>`;
  for (const button of dialog.querySelectorAll('[data-close]')) button.onclick = () => dialog.close();
  return dialog;
}

export function fitDialog({ store, owner, source, index, getBudget, assertOwner, onSaved }) {
  const initial = getBudget();
  if (!initial) throw Error('Choose an instructional period first.');
  const remaining = source.items.slice(index);
  const old = remaining.map((_, i) => source.itemDurationsMs?.[index + i] ?? null);
  const dialog = dialogFrame('Fit to Class Time', `
    <p class="agenda-control-detail">Review planned durations from the selected activity onward. Earlier activities stay unchanged.</p>
    <p class="agenda-control-detail" data-budget></p>
    <p class="agenda-control-detail" data-fit-help></p>
    <div class="agenda-fit-list">${remaining.map((title, i) => `<label class="agenda-fit-row">
      <span><strong>${esc(title)}</strong><small>Current: ${esc(duration(old[i]))}</small></span>
      <span>Proposed minutes<input type="number" data-fit-index="${i}" min="0.016666666666666666" max="1440" step="any" required value="${minutes(old[i])}"></span>
    </label>`).join('')}</div>
    <p class="agenda-control-detail" data-proposed role="status"></p>
    <button type="button" data-suggest>Refresh suggestion</button>`, 'Save Planned Times');
  const form = dialog.querySelector('form');
  const inputs = [...dialog.querySelectorAll('[data-fit-index]')];
  const error = text => { dialog.querySelector('[data-error]').textContent = text; };
  const values = () => inputs.map(input => input.value === '' ? null : Math.round(Number(input.value) * 60000));
  function describe() {
    const budget = getBudget();
    if (!budget || (initial.live && (!budget.live || budget.event.id !== initial.event.id))) throw Error('The original live class has ended or changed. Reopen the helper for the current lesson.');
    const total = values().reduce((sum, d) => sum + (validItemDuration(d) ? d : 0), 0);
    dialog.querySelector('[data-budget]').textContent = `${budget.live ? 'Remaining class time' : 'Preview class time (first instructional segment)'}: ${formatCountdown(budget.availableMs)}. Live time is checked again when saving.`;
    dialog.querySelector('[data-proposed]').textContent = `Proposed total: ${formatCountdown(total)}${total > budget.availableMs ? ` · ${formatCountdown(total - budget.availableMs)} too long` : ''}`;
    return budget;
  }
  function suggest() {
    assertOwner(true);
    const budget = describe();
    const current = values();
    if (current.some(d => !validItemDuration(d))) throw Error('Enter the missing durations first, then refresh the suggestion.');
    // Leave a short review window; the actual boundary is rechecked at save.
    const reserve = budget.live ? Math.min(30000, Math.floor(budget.availableMs / 10)) : 0;
    const proposed = fitDurations(current, budget.availableMs - reserve);
    inputs.forEach((input, i) => { input.value = minutes(proposed[i]); });
    dialog.querySelector('[data-fit-help]').textContent = reserve ? 'Suggested times are proportional, with a little time reserved for review. Adjust any value before saving.' : 'Suggested times are proportional. Adjust any value before saving.';
    describe();
  }
  form.oninput = () => { try { error(''); describe(); } catch (failure) { error(failure.message); } };
  dialog.querySelector('[data-suggest]').onclick = () => { try { error(''); suggest(); } catch (failure) { error(failure.message); } };
  form.onsubmit = event => {
    event.preventDefault();
    try {
      assertOwner(true);
      const invalid = inputs.find(input => !input.validity.valid);
      if (invalid) { invalid.focus(); throw Error('Give every remaining activity a duration between one second and 24 hours.'); }
      const proposed = values();
      if (proposed.some(d => !validItemDuration(d))) throw Error('Use durations between one second and 24 hours.');
      const budget = describe();
      if (proposed.reduce((sum, d) => sum + d, 0) > budget.availableMs) throw Error('These times no longer fit. Shorten them or refresh the suggestion before saving.');
      const durations = source.items.map((_, i) => i < index ? source.itemDurationsMs?.[i] ?? null : proposed[i - index]);
      store.saveAgenda(owner.profileID, { ...source, itemDurationsMs: durations });
      dialog.close();
      onSaved('Planned times saved. No timer was started or changed.');
    } catch (failure) { error(failure.message); }
  };
  describe();
  if (old.every(validItemDuration)) { try { suggest(); } catch (failure) { error(failure.message); } }
  else dialog.querySelector('[data-fit-help]').textContent = 'Activities showing “No duration” need your input. No time has been assigned to them.';
  return dialog;
}

export function copyDialog({ store, owner, source, sourceLabel, dateLabel, getContext, assertOwner, onSaved }) {
  const dialog = dialogFrame('Copy Agenda', `
    <p class="agenda-copy-source"><strong>${esc(source.title || 'Untitled Agenda')}</strong><small>${esc(sourceLabel)} · ${esc(dateLabel(source.date))}</small></p>
    <label>Destination date<input type="date" data-copy-date min="2000-01-01" max="2099-12-31" required value="${esc(source.date)}"></label>
    <p class="agenda-control-detail">Select classes below. Each copy starts fresh with its own lesson content.</p>
    <div class="agenda-copy-choices" data-destinations></div>
    <p class="agenda-control-detail" data-copy-summary role="status"></p>`, 'Copy to Selected Classes');
  const form = dialog.querySelector('form'), dateInput = dialog.querySelector('[data-copy-date]');
  const area = dialog.querySelector('[data-destinations]');
  const submit = dialog.querySelector('[type=submit]');
  const error = text => { dialog.querySelector('[data-error]').textContent = text; };
  let displayed = [];
  let displayedDate = '';
  function refresh() {
    const selected = new Set([...area.querySelectorAll('[data-copy-choice]:checked')].map(input => displayed[Number(input.dataset.copyChoice)]?.id));
    // Replacement consent never carries to another date or a refreshed list.
    displayed = [];
    displayedDate = '';
    area.replaceChildren();
    submit.disabled = true;
    if (!dateInput.validity.valid || !dateInput.value) return;
    assertOwner(false);
    const context = getContext(), profile = store.profile(owner.profileID);
    const date = dateInput.value;
    displayedDate = date;
    displayed = destinationChoices(context.configuration, date)
      .filter(c => date !== source.date || c.id !== source.activityID)
      .map(choice => ({ ...choice, existing: profile.agendas.find(a => a.date === date && a.activityID === choice.id),
        busy: destinationBusy(profile, date, choice.id, context.now, context.configuration) }));
    area.innerHTML = displayed.length ? displayed.map((choice, i) => {
      const readiness = planReadiness(source, 0, classBudget(choice, null, context.now).availableMs);
      const warnings = [choice.busy ? 'Active or paused session — cannot replace.' : choice.existing ? 'An agenda already exists.' : '',
        readiness.overrunMs ? `Plan exceeds class time by ${formatCountdown(readiness.overrunMs)}. Durations will stay unchanged.` : '',
        readiness.missing.length ? `${readiness.missing.length} activities need durations for an automatic run.` : '',
        choice.events.length > 1 ? 'Split class: duration check uses its first instructional segment.' : ''].filter(Boolean).join(' ');
      return `<div class="agenda-copy-row"><label><input type="checkbox" data-copy-choice="${i}" ${choice.busy ? 'disabled' : selected.has(choice.id) ? 'checked' : ''}><span><strong>${esc(eventTitle(choice.event))}</strong><small>${esc(warnings)}</small></span></label>
        ${choice.existing && !choice.busy ? `<label class="agenda-copy-replace"><input type="checkbox" data-replace="${i}">Replace the existing agenda for this class</label>` : ''}</div>`;
    }).join('') : '<p class="agenda-control-detail">No eligible destination classes on this date.</p>';
    submit.disabled = !displayed.some(c => !c.busy);
  }
  dateInput.onchange = () => { try { error(''); refresh(); } catch (failure) { error(failure.message); } };
  form.onsubmit = event => {
    event.preventDefault();
    try {
      assertOwner(false);
      if (!dateInput.validity.valid) throw Error('Choose a valid destination date.');
      if (dateInput.value !== displayedDate) { refresh(); throw Error('Review the destination classes for this date before copying.'); }
      const targets = [...area.querySelectorAll('[data-copy-choice]:checked')].map(input => {
        const choice = displayed[Number(input.dataset.copyChoice)];
        return { id: choice.id, label: eventTitle(choice.event), original: JSON.stringify(choice.existing ?? null),
          replace: Boolean(area.querySelector(`[data-replace="${input.dataset.copyChoice}"]`)?.checked) };
      });
      if (!targets.length) throw Error('Select at least one destination class.');
      const context = getContext();
      const result = copyAgendas({ store, profileID: owner.profileID, source, date: dateInput.value, targets, configuration: context.configuration, now: context.now });
      const copied = result.copied.map(c => `${c.label}${c.overrunMs ? ` (plan ${formatCountdown(c.overrunMs)} too long)` : ''}${c.missing ? ' (durations still needed)' : ''}`);
      const summary = [copied.length ? `Copied to ${dateLabel(dateInput.value)}: ${copied.join(', ')}.` : 'No agendas copied.', result.skipped.length ? `Skipped: ${result.skipped.join('; ')}.` : ''].filter(Boolean).join(' ');
      dialog.querySelector('[data-copy-summary]').textContent = summary;
      error('');
      submit.disabled = true;
      for (const input of dialog.querySelectorAll('input')) input.disabled = true;
      dialog.querySelector('footer [data-close]').textContent = 'Done';
      onSaved(summary);
    } catch (failure) { error(failure.message); }
  };
  refresh();
  return dialog;
}
