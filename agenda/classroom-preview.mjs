import { isAgendaPreviewEnabled } from './feature-flag.mjs?v=agenda-release-1';
import {
  CLASSROOM_KEY, ClassroomStore, classChoices, activityIdentity, segmentIdentity,
  liveClass, timerView, validItemDuration, effectiveTimerBell,
} from './classroom-model.mjs?v=agenda-release-1';
import {
  AgendaBoundaryError, AgendaController, agendaPlan, runIsActive, runMatchesAgenda,
} from './classroom-sequence.mjs?v=agenda-release-1';
import { schoolScheduleRows, advanceAgendaItem, adjacentLessonDate, equivalentClassChoice } from './classroom-presentation.mjs?v=agenda-release-1';
import { TransitionChime, isOnTimeTransition } from './classroom-sound.mjs?v=agenda-release-1';
import { formatClock, eventTitle, escapeHTML as esc } from '../display-core.mjs';
import { formatCountdown } from '../schedule-presentation.mjs';
import { classBudget, planReadiness } from './classroom-planning.mjs?v=agenda-release-1';
import { agendaBackupDialog } from './classroom-backup-ui.mjs?v=agenda-release-1';
import { fitDialog, copyDialog } from './classroom-planning-ui.mjs?v=agenda-release-1';

export function mountClassroomPreview({ getContext, actions }) {
  if (!isAgendaPreviewEnabled(globalThis.location)) return null;
  const store = new ClassroomStore(localStorage);
  const controller = new AgendaController(store);
  const chime = new TransitionChime();
  const normal = document.querySelector('#app');
  const switcher = document.createElement('div');
  switcher.className = 'agenda-mode-switch';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Display mode');
  switcher.innerHTML = '<button type="button" data-mode="normal" aria-pressed="true">Bell View</button><button type="button" data-mode="classroom" aria-pressed="false">Classroom View</button>';
  const header = document.createElement('header');
  header.className = 'agenda-shared-header';
  header.hidden = true;
  header.innerHTML = `
    <div class="identity">
      <img class="mark" src="./public/assets/bellsync-display-icon.png" alt="BellSync" width="48" height="48">
      <div><strong data-header-profile></strong><small data-header-school></small></div>
    </div>
    <nav data-header-toolbar aria-label="Display controls"></nav>`;
  let releaseToolbar = null;
  const page = document.documentElement;
  const measureHeader = () => {
    const height = `${header.getBoundingClientRect().height}px`;
    if (page.style.getPropertyValue('--agenda-toolbar-height') !== height) {
      page.style.setProperty('--agenda-toolbar-height', height);
    }
  };
  const headerObserver = new ResizeObserver(measureHeader);
  function releaseHeader() {
    releaseToolbar?.();
    releaseToolbar = null;
    header.hidden = true;
    page.classList.remove('agenda-toolbar-enabled');
    page.style.removeProperty('--agenda-toolbar-height');
  }
  const screen = document.createElement('section');
  screen.className = 'agenda-preview';
  screen.hidden = true;
  screen.innerHTML = `
    <div class="agenda-selectors">
      <div class="agenda-date-navigation">
        <label for="agenda-lesson-date">Lesson date</label>
        <div class="agenda-date-actions">
          <button type="button" class="agenda-date-chevron" data-date-step="-1" aria-label="Previous day" title="Previous day">‹</button>
          <input id="agenda-lesson-date" type="date" data-date min="2000-01-01" max="2099-12-31" required>
          <button type="button" class="agenda-date-chevron" data-date-step="1" aria-label="Next day" title="Next day">›</button>
          <button type="button" data-today>Today</button>
        </div>
      </div>
      <label>Instructional period<select data-class></select></label>
    </div>
    <p class="agenda-feedback" role="status" data-feedback></p>
    <div class="agenda-columns">
      <article class="agenda-studio">
        <header class="agenda-lesson">
          <div class="agenda-title">
            <p class="agenda-eyebrow" data-lesson-state></p>
            <h2 data-agenda-title></h2>
            <p data-class-context></p><p data-date-label></p>
          </div>
          <div class="agenda-actions agenda-lesson-actions">
            <button type="button" data-copy>Copy Agenda</button>
            <button type="button" data-edit>Create Agenda</button>
          </div>
        </header>
        <section class="agenda-current" data-current-panel hidden aria-label="Current activity">
          <div class="agenda-activity" data-activity hidden>
            <div>
              <div class="agenda-activity-meta">
                <p class="agenda-eyebrow" data-activity-label></p>
                <p class="agenda-activity-progress" data-activity-progress></p>
              </div>
              <h3 id="agenda-activity-title"><span data-activity-title role="status"></span></h3>
            </div>
            <div class="agenda-activity-timer" data-activity-timer hidden>
              <div class="agenda-timer-count" data-activity-count role="timer" aria-label="Activity time remaining"></div>
              <p data-activity-timer-label></p>
            </div>
          </div>
          <p class="agenda-instructions" data-instructions hidden></p>
          <section class="agenda-controls" data-controls hidden aria-labelledby="agenda-controls-title">
            <h3 id="agenda-controls-title" data-controls-title tabindex="-1">Activity Controls</h3>
            <p class="agenda-control-detail" data-manual-detail hidden></p>
            <div class="agenda-actions" aria-label="Timer actions" role="group">
              <button type="button" class="agenda-primary" data-run="start" aria-describedby="agenda-run-explanation">Run Full Agenda</button>
              <button type="button" data-timer="start">Single Activity Timer</button>
              <button type="button" class="agenda-primary" data-add-duration hidden>Add Duration</button>
              <button type="button" data-fit hidden>Fit to Class Time</button>
              <button type="button" data-run="pause">Pause</button>
              <button type="button" data-run="resume">Resume</button>
              <button type="button" data-run="finish">Finish &amp; Next</button>
              <button type="button" data-run="skip">Skip</button>
              <button type="button" data-run="restart">Restart Current</button>
              <button type="button" data-run="next">Next Activity</button>
              <button type="button" data-run="return">View Running Agenda</button>
              <button type="button" data-run="stop">Stop Agenda</button>
              <button type="button" data-timer="pause">Pause</button>
              <button type="button" data-timer="resume">Resume</button>
              <button type="button" data-timer="finish">Finish</button>
            </div>
            <p id="agenda-run-explanation" class="agenda-control-detail agenda-start-explanation" data-run-detail role="status" hidden></p>
            <div class="agenda-actions agenda-time-controls" role="group" aria-label="Adjust remaining activity time" data-adjustments>
              <button type="button" data-run="1" aria-label="Add 1 minute">+1 min</button>
              <button type="button" data-run="5" aria-label="Add 5 minutes">+5 min</button>
              <button type="button" data-run="-1" aria-label="Subtract 1 minute">−1 min</button>
              <button type="button" data-run="-5" aria-label="Subtract 5 minutes">−5 min</button>
            </div>
          </section>
          <p class="agenda-up-next" data-up-next hidden><span>Up Next</span><strong data-next-activity></strong></p>
        </section>
        <section class="agenda-lesson-activities" data-lesson-activities hidden aria-labelledby="agenda-list-title">
          <h3 id="agenda-list-title">Lesson Activities</h3>
          <ol class="agenda-items" aria-label="Agenda activities" data-items hidden></ol>
          <p class="agenda-control-detail" data-duration-lock hidden>Finish the activity timer or stop Run Agenda to edit planned durations.</p>
        </section>
        <div class="agenda-sound-settings" data-sound-settings>
          <label>Activity Chimes<select data-chimes><option value="off">Off</option><option value="on">On</option></select></label>
          <button type="button" data-test-sound hidden>Test Sound</button>
          <span class="agenda-sound-status" data-sound-status role="status"></span>
        </div>
        <details class="agenda-backups">
          <summary>Agenda Backups</summary>
          <p class="agenda-control-detail">Lesson plans are stored only in this browser. Save a backup to move them to another computer.</p>
          <div class="agenda-actions">
            <button type="button" data-export-agendas>Export Agendas</button>
            <button type="button" data-import-agendas>Import Agendas</button>
          </div>
        </details>
      </article>
      <aside class="agenda-official" aria-label="Official school schedule">
        <div class="agenda-official-heading">
          <h2 class="agenda-eyebrow">Official Bell · Today</h2><p data-official-date></p>
        </div>
        <div class="agenda-bell-time">
          <p data-bell-state></p><div class="agenda-bell-count" data-bell-count>—</div>
        </div>
        <div class="agenda-bell-classes">
          <p data-bell-title></p><p data-bell-next></p>
        </div>
        <details class="agenda-day" data-full-day>
          <summary>Full-Day Schedule</summary>
          <p class="agenda-day-date" data-day-date></p>
          <label class="agenda-passing-option" data-passing-option><input type="checkbox" data-passing> Show Passing Times</label>
          <ul data-day></ul>
        </details>
      </aside>
    </div>`;
  let classroom = false;
  let context = null;
  let selectionKey = '';
  let selectionProfile = null;
  let preferredClass = null;
  let selected = '';
  let highlighted = 0;
  let editor = null;
  let durationDraft = null;
  let previousProfile = null;
  let runError = '';
  let renderedRun = null;
  let soundProfile = null;
  let soundEnabled = false;
  let soundScope = '';
  let lastSoundTick = null;
  let soundMessage = '';
  const cached = new Map();
  const node = key => screen.querySelector(`[data-${key}]`);
  const setText = (key, value) => {
    const target = node(key);
    if (target.textContent !== value) target.textContent = value;
  };
  const clock = timestamp => formatClock(timestamp, context.configuration.school.timeZone, context.configuration.preferences.hour24);
  const feedback = message => {
    const detail = runError || message;
    if (node('feedback').textContent !== detail) node('feedback').textContent = detail;
  };
  const paint = (key, markup) => {
    if (cached.get(key) !== markup) { node(key).innerHTML = markup; cached.set(key, markup); }
  };
  const dateLabel = key => new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${key}T12:00:00Z`));
  const plannedDuration = ms => {
    if (!ms) return '';
    if (ms % 60000 === 0) return `${ms / 60000} min`;
    if (ms < 60000) return `${Math.round(ms / 1000)} sec`;
    return formatCountdown(ms);
  };
  const currentChoice = () => classChoices(context.selectedSnapshot).find(choice => choice.id === selected);
  const currentAgenda = () => store.agenda(context.profileID, context.selectedDate, selected);
  const liveSelection = () => {
    const event = liveClass(context.liveSnapshot, context.now);
    return context.selectedDate === context.liveDate && activityIdentity(event) === selected ? event : null;
  };
  const automaticSession = () => runIsActive(store.runState(context.profileID).agendaRun);
  const runButton = action => screen.querySelector(`[data-run="${action}"]`);
  const timerButton = action => screen.querySelector(`[data-timer="${action}"]`);
  const matchesSelection = run => run?.date === context.selectedDate && run.activityID === selected;
  const runToken = run => JSON.stringify([run?.id, run?.status, run?.index, run?.lastTransitionAt]);
  function silenceChimes() {
    chime.silence();
    lastSoundTick = null;
  }

  function syncSoundContext() {
    const id = context?.profileID || null;
    const scope = JSON.stringify([id, context?.selectedDate, selected, classroom, document.visibilityState]);
    if (scope !== soundScope) {
      soundScope = scope;
      silenceChimes();
      soundMessage = '';
    }
    if (soundProfile !== id) {
      soundProfile = id;
      soundEnabled = Boolean(id && store.profile(id).transitionSound);
    }
    chime.setEnabled(soundEnabled);
  }

  function renderSound() {
    node('chimes').value = soundEnabled ? 'on' : 'off';
    node('test-sound').hidden = !soundEnabled;
    const state = context?.profileID && store.runState(context.profileID);
    const paused = ['paused', 'recover'].includes(state?.agendaRun?.status) || state?.timer?.status === 'paused';
    node('test-sound').disabled = Boolean(runError || paused);
    const hint = paused ? 'Continue or stop the session to test sound.' : chime.ready ? '' : 'Use Test Sound to enable audio for this visit.';
    setText('sound-status', soundEnabled ? soundMessage || hint : '');
  }

  async function unlockSound(test = false) {
    if (!classroom || !soundEnabled || runError || document.visibilityState === 'hidden') return;
    const state = store.runState(context.profileID);
    if (['paused', 'recover'].includes(state.agendaRun?.status) || state.timer?.status === 'paused') return;
    const scope = soundScope, started = performance.now(), generation = chime.generation;
    const ready = await chime.unlock(true);
    // Safari may resolve resume() after navigation or a long interruption.
    // A Test click belongs to that moment, never to a later return to the tab.
    if (scope !== soundScope || generation !== chime.generation) return;
    if (!ready) soundMessage = 'Audio unavailable. Try Test Sound again.';
    else if (test && performance.now() - started <= 1000) {
      soundMessage = chime.test() ? '' : 'Sound is busy. Try again.';
    } else if (test) soundMessage = 'Audio is ready. Click Test Sound again.';
    else soundMessage = '';
    renderSound();
  }

  function reconcileRun() {
    const profileID = context?.profileID || null;
    if (runError) { silenceChimes(); return; }
    try {
      syncSoundContext();
      if (previousProfile && previousProfile !== profileID) {
        controller.suspend(previousProfile, context?.now ?? Date.now(), 'The profile changed. Reopen its live class to resume.');
      }
      previousProfile = profileID;
      if (profileID) {
        const before = store.runState(profileID);
        const event = controller.reconcile(profileID, {
          snapshot: context.liveSnapshot,
          now: context.now,
          selectedDate: context.selectedDate,
          visible: document.visibilityState !== 'hidden',
        });
        const after = store.runState(profileID);
        const audible = classroom && document.visibilityState !== 'hidden' &&
          context.selectedDate === context.liveDate && selected === after.agendaRun?.activityID &&
          after.agendaRun?.date === context.selectedDate;
        const eligible = audible && isOnTimeTransition(event, before, after, context.now, lastSoundTick);
        if (event) chime.play({ ...event, soundEligible: eligible });
        if (!audible || after.agendaRun?.status !== 'running') {
          // An explicit Test Sound may also be used before starting a run.
          if (runIsActive(before.agendaRun) || !classroom || document.visibilityState === 'hidden') chime.silence();
          lastSoundTick = null;
        } else lastSoundTick = context.now;
      }
    } catch (error) {
      silenceChimes();
      runError = `${error.message} Reload the preview to continue.`;
      feedback('');
    }
  }
  function onVisibilityChange() {
    silenceChimes();
    controller.interrupt();
    try { update(); }
    catch (error) {
      runError = error.message;
      feedback('');
    }
  }
  const onPageHide = () => { silenceChimes(); controller.interrupt(); };
  function onStorageChange(event) {
    if (event.storageArea !== localStorage || (event.key !== CLASSROOM_KEY && event.key !== null)) return;
    silenceChimes();
    runError = 'Classroom data changed in another tab. Reload the preview to continue.';
    feedback('');
  }
  const safe = action => {
    try { context = getContext(); if (!context?.profileID) throw Error('Choose a saved schedule.'); action(); feedback(''); update(); }
    catch (error) { feedback(/exceeds.*class time|exceeds the remaining class time/.test(error.message) ? 'Choose a shorter activity duration within the remaining class time.' : error.message); }
  };
  function setLessonDate(date) {
    actions.setDate(date);
    // Safari may keep focus in the date input when a navigation button is
    // clicked. Reflect this deliberate navigation even while it is focused.
    node('date').value = date;
  }
  function setMode(mode) {
    const focused = document.activeElement;
    classroom = mode === 'classroom';
    normal.hidden = classroom;
    screen.hidden = !classroom;
    for (const button of switcher.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    update();
    if (switcher.contains(focused)) focused.focus();
  }
  function update() {
    context = getContext();
    reconcileRun();
    if (!context?.profileID || context.profileID === 'demo') {
      editor?.close();
      releaseHeader();
      durationDraft = null;
      classroom = false;
      for (const button of switcher.querySelectorAll('[data-mode]')) {
        button.setAttribute('aria-pressed', String(button.dataset.mode === 'normal'));
      }
      screen.hidden = true;
      normal.hidden = false;
      return;
    }
    const profile = store.runState(context.profileID);
    const run = profile.agendaRun;
    const active = runIsActive(run);
    const key = JSON.stringify([context.profileID, context.selectedDate]);
    const choices = classChoices(context.selectedSnapshot);
    if (selectionProfile !== context.profileID) {
      selectionProfile = context.profileID;
      preferredClass = null;
    }
    if (selectionKey !== key) {
      durationDraft = null;
      editor?.close();
      selectionKey = key;
      const equivalent = equivalentClassChoice(choices, preferredClass);
      const savedClass = run?.date === context.selectedDate && choices.some(choice => choice.id === run.activityID);
      selected = equivalent?.id || (savedClass ? run.activityID : activityIdentity(liveClass(context.selectedSnapshot, context.now)) || choices[0]?.id || '');
      highlighted = 0;
      feedback('');
    }
    if (!choices.some(choice => choice.id === selected)) {
      durationDraft = null;
      editor?.close();
      selected = choices[0]?.id || '';
      highlighted = 0;
    }
    // Keep the preference across empty dates, such as weekends and holidays.
    preferredClass = choices.find(choice => choice.id === selected) || preferredClass;
    if (!releaseToolbar) {
      releaseToolbar = actions.mountToolbar(header.querySelector('[data-header-toolbar]'), switcher);
      header.hidden = false;
      page.classList.add('agenda-toolbar-enabled');
    }
    const profileName = header.querySelector('[data-header-profile]');
    const title = context.configuration.profileName || context.configuration.school.displayName;
    if (profileName.textContent !== title) profileName.textContent = title;
    const schoolName = header.querySelector('[data-header-school]');
    if (schoolName.textContent !== context.configuration.school.displayName) schoolName.textContent = context.configuration.school.displayName;
    schoolName.hidden = !context.configuration.preferences.showSchoolName;
    measureHeader();
    if (!classroom) return;
    screen.style.setProperty('--agenda-accent', context.accent);
    if (document.activeElement !== node('date')) node('date').value = context.selectedDate;
    screen.querySelector('[data-date-step="-1"]').disabled = context.selectedDate === '2000-01-01';
    screen.querySelector('[data-date-step="1"]').disabled = context.selectedDate === '2099-12-31';
    const emptyMessage = {
      weekend: 'Weekend · No instructional periods',
      'no-school': 'No School',
      unavailable: 'Bell Times Unavailable',
    }[context.selectedSnapshot.status] || 'No instructional periods';
    paint('class', choices.length ? choices.map(choice => `<option value="${esc(choice.id)}">${esc(eventTitle(choice.event))}</option>`).join('') : `<option value="">${esc(emptyMessage)}</option>`);
    node('class').value = selected;
    node('class').disabled = !choices.length;
    const focused = document.activeElement;
    const choice = choices.find(item => item.id === selected);
    const live = liveSelection();
    const agenda = currentAgenda();
    const progress = runMatchesAgenda(run, agenda) ? run : null;
    const lockSelection = Boolean(active && progress);
    const isToday = context.selectedDate === context.liveDate;
    setText('lesson-state', live ? 'Live Class' : isToday ? 'Today’s Lesson' : 'Lesson Preview');
    setText('date-label', dateLabel(context.selectedDate));
    const className = choice ? eventTitle(choice.event) : '';
    const classTimes = choice?.events.map(event =>
      `${clock(event.displayStartAt ?? event.startAt)} – ${clock(event.displayEndAt ?? event.endAt)}`).join(' · ');
    setText('agenda-title', agenda.title || className || emptyMessage);
    setText('class-context', [agenda.title && agenda.title !== className ? className : '', classTimes].filter(Boolean).join(' · '));
    node('edit').disabled = !choice || Boolean(active && matchesSelection(run));
    const hasAgenda = Boolean(agenda.items.length || agenda.title || agenda.instructions);
    node('edit').textContent = hasAgenda ? 'Edit Agenda' : 'Create Agenda';
    node('copy').disabled = !choice || !hasAgenda || Boolean(runError);
    highlighted = Math.max(0, Math.min(highlighted, agenda.items.length - 1));
    const displayedItem = lockSelection ? progress.index : highlighted;
    const manualTimer = profile.timer?.agendaRunID ? null : profile.timer;
    const manualView = timerView(manualTimer, context.now, effectiveTimerBell(manualTimer, context.configuration));
    const manualActive = Boolean(!active && manualView && manualView.status !== 'complete');
    const manualHere = Boolean(isToday && matchesSelection(manualTimer));
    const runHere = Boolean(active && matchesSelection(run) && live && live.id === profile.timer?.segmentID);
    const runView = runHere && profile.timer?.agendaRunID === run.id ? timerView(profile.timer, context.now) : null;
    renderActivity(agenda, displayedItem, progress, runHere ? run : null, runView, manualActive && manualHere ? manualView : null);
    renderRun(run, agenda, live, manualActive, runHere, runView);
    renderManual(manualTimer, manualView, live, manualHere, manualActive, active, agenda);
    node('sound-settings').hidden = !choice && !active;
    renderSound();

    const controls = node('controls');
    controls.hidden = !controls.querySelector('button:not([hidden]):not([data-test-sound])') &&
      node('run-detail').hidden && node('manual-detail').hidden;
    if (screen.contains(focused) && focused.matches('[data-run], [data-timer], [data-add-duration], [data-fit]') &&
        (focused.disabled || focused.closest('[hidden]'))) {
      (controls.hidden ? node('class') : node('controls-title')).focus({ preventScroll: true });
    }

    setText('instructions', agenda.instructions);
    node('instructions').hidden = !agenda.instructions;
    node('current-panel').hidden = node('activity').hidden && controls.hidden && node('instructions').hidden;
    node('lesson-activities').hidden = !agenda.items.length;
    renderItems(agenda, progress, displayedItem, lockSelection);
    const official = context.liveSnapshot;
    setText('official-date', dateLabel(context.liveDate));
    setText('bell-state', official.label);
    setText('bell-count', official.countdownTarget === null ? '—' : formatCountdown(official.countdownTarget - context.now));
    setText('bell-title', official.title);
    setText('bell-next', official.next ? `Next · ${eventTitle(official.next)} · ${clock(official.next.displayStartAt ?? official.next.startAt)}` : '');
    renderDay();
  }

  function renderActivity(agenda, index, progress, run, runView, manualView) {
    const recovering = run?.status === 'recover';
    const view = recovering ? null : runView || manualView;
    const title = run?.items[run.index].title || manualView?.name || agenda.items[index] || '';
    const label = recovering ? 'Activity to Recover' : view?.status === 'paused' ? 'Paused Activity' :
      view || run ? 'Current Activity' : 'Selected Activity';
    node('activity').hidden = !title;
    setText('activity-label', label);
    setText('activity-title', title);
    // Manual timers retain their own title but do not store a plan index.
    // Do not imply a different highlighted row is the running activity.
    setText('activity-progress', manualView ? 'Single Activity Timer' :
      title ? `${(run ? run.index : index) + 1} of ${run ? run.items.length : agenda.items.length}` : '');
    node('activity-timer').hidden = !view;
    setText('activity-count', view ? formatCountdown(view.remainingMs) : '');
    setText('activity-timer-label', view?.status === 'paused' ? 'Remaining · Paused' : 'Remaining');

    // The single-activity timer stores a title, not a plan index. Keep the
    // activity list selectable without implying the timer will advance it.
    const upcoming = run?.items[run.index + 1];
    const nextIndex = index + 1;
    const nextReviewed = progress?.completed.includes(nextIndex) || progress?.skipped.includes(nextIndex);
    const next = manualView ? '' : run ? upcoming?.title || '' : nextReviewed ? '' : agenda.items[nextIndex] || '';
    const duration = plannedDuration(run ? upcoming?.durationMs : agenda.itemDurationsMs?.[nextIndex]);
    node('up-next').hidden = !next;
    setText('next-activity', next && duration ? `${next} · ${duration}` : next);
  }

  function durationEditsLocked() {
    const state = store.runState(context.profileID);
    const view = timerView(state.timer, context.now, effectiveTimerBell(state.timer, context.configuration));
    return runIsActive(state.agendaRun) || Boolean(view && ['running', 'paused'].includes(view.status));
  }

  function durationWarning(duration) {
    const live = liveSelection();
    if (!live || !duration || duration <= live.endAt - context.now) return '';
    return `This duration exceeds the remaining class time by ${formatCountdown(duration - (live.endAt - context.now))}. Run Agenda stops at the official class bell.`;
  }

  function refreshDurationWarning() {
    const input = screen.querySelector('[data-duration-minutes]');
    if (!input) return;
    const duration = input.value === '' ? null : Math.round(Number(input.value) * 60000);
    const warning = input.validity.valid && (duration === null || validItemDuration(duration)) ? durationWarning(duration) : '';
    const target = screen.querySelector('[data-duration-warning]');
    target.textContent = warning;
    target.hidden = !warning;
  }

  function startDurationEdit(index) {
    if (editor) return;
    if (durationEditsLocked()) throw Error('Finish the activity timer or stop Run Agenda before editing durations.');
    const agenda = currentAgenda();
    if (!currentChoice() || !Number.isInteger(index) || !agenda.items[index]) throw Error('Choose an existing agenda activity.');
    durationDraft = {
      profileID: context.profileID, date: context.selectedDate, activityID: selected,
      index, original: JSON.stringify(agenda),
      minutes: agenda.itemDurationsMs?.[index] ? String(agenda.itemDurationsMs[index] / 60000) : '',
    };
    update();
    screen.querySelector('[data-duration-minutes]')?.focus();
  }

  function cancelDurationEdit(returnFocus = true) {
    const index = durationDraft?.index;
    durationDraft = null;
    update();
    if (returnFocus) screen.querySelector(`[data-duration-edit="${index}"]`)?.focus({ preventScroll: true });
  }

  function saveDurationEdit() {
    const draft = durationDraft;
    const input = screen.querySelector('[data-duration-minutes]');
    if (!draft || !input) return;
    try {
      context = getContext();
      if (!context?.profileID || context.profileID !== draft.profileID ||
          context.selectedDate !== draft.date || selected !== draft.activityID || !currentChoice()) {
        throw Error('The profile, date or class changed. Reopen the duration editor.');
      }
      if (durationEditsLocked()) throw Error('Finish the activity timer or stop Run Agenda before editing durations.');
      if (!input.validity.valid) throw Error(input.validationMessage);
      const duration = input.value === '' ? null : Math.round(Number(input.value) * 60000);
      if (duration !== null && !validItemDuration(duration)) throw Error('Choose a duration between one second and 24 hours.');
      const agenda = currentAgenda();
      if (JSON.stringify(agenda) !== draft.original) throw Error('The agenda changed. Cancel and reopen this duration editor.');
      const durations = agenda.items.map((_, index) => agenda.itemDurationsMs?.[index] ?? null);
      durations[draft.index] = duration;
      store.saveAgenda(draft.profileID, { ...agenda, itemDurationsMs: durations });
      durationDraft = null;
      update();
      feedback(durationWarning(duration) || 'Planned duration saved.');
      screen.querySelector(`[data-duration-edit="${draft.index}"]`)?.focus({ preventScroll: true });
    } catch (error) {
      const target = screen.querySelector('[data-duration-error]');
      if (target) target.textContent = error.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  }

  function renderItems(agenda, progress, displayedItem, lockSelection) {
    const list = node('items');
    const focused = document.activeElement;
    const focusedIndex = list.contains(focused) ? focused.dataset.item : undefined;
    const focusedDuration = list.contains(focused) ? focused.dataset.durationEdit : undefined;
    const existingForm = list.querySelector('[data-duration-form]');
    const locked = durationEditsLocked();
    if (durationDraft && locked) {
      durationDraft = null;
      feedback('Unsaved duration discarded because a timer or agenda is active.');
    }
    node('duration-lock').hidden = !locked || !agenda.items.length;
    list.hidden = !agenda.items.length;
    paint('items', agenda.items.map((title, index) => {
      const status = progress?.completed.includes(index) ? 'Completed' : progress?.skipped.includes(index) ? 'Skipped' :
        lockSelection && progress.index === index ? 'Current' : '';
      const editing = durationDraft?.index === index;
      const duration = plannedDuration(agenda.itemDurationsMs?.[index]) || 'Add duration';
      const durationControls = editing ? `
        <form class="agenda-duration-form" data-duration-form="${index}" novalidate>
          <div class="agenda-duration-fields">
            <input type="number" data-duration-minutes min="0.016666666666666666" max="1440" step="any"
              value="${esc(durationDraft.minutes)}" aria-label="Minutes for activity ${index + 1}, ${esc(title)}"
              aria-describedby="agenda-duration-error agenda-duration-warning" title="Leave blank for an untimed activity.">
            <span>min</span>
            <button type="submit">Save</button>
            <button type="button" data-duration-cancel>Cancel</button>
          </div>
          <p id="agenda-duration-error" data-duration-error role="alert"></p>
          <p id="agenda-duration-warning" data-duration-warning hidden></p>
        </form>` : `
        <div class="agenda-duration-actions">
          <button type="button" data-duration-edit="${index}" ${locked ? 'disabled' : ''} aria-label="Edit duration for ${esc(title)} · ${esc(duration)}">${esc(duration)}</button>
          <button type="button" data-duration-edit="${index}" ${locked ? 'disabled' : ''} aria-label="Edit duration for ${esc(title)}" title="Edit duration"><span aria-hidden="true">✎</span></button>
        </div>`;
      return `<li class="agenda-item-row" ${status ? `data-item-status="${status.toLowerCase()}"` : ''}>
        <button type="button" data-item="${index}" aria-pressed="${displayedItem === index}" ${lockSelection ? 'disabled' : ''} ${status === 'Current' ? 'aria-current="step"' : ''}>
          <span>${index + 1}</span><strong>${esc(title)}</strong>
        </button>
        ${status ? `<small class="agenda-item-status">${status}</small>` : ''}
        ${durationControls}
      </li>`;
    }).join(''));
    // Preserve typed input, errors and focus if highlighting another activity
    // causes the list markup to change while this row is being edited.
    const form = list.querySelector('[data-duration-form]');
    if (durationDraft && existingForm && form !== existingForm &&
        Number(existingForm.dataset.durationForm) === durationDraft.index) {
      form?.replaceWith(existingForm);
      if (existingForm.contains(focused)) focused.focus({ preventScroll: true });
    }
    if (list.contains(focused) || focused?.isConnected) {
      refreshDurationWarning();
      return;
    }
    const index = focusedIndex ?? focusedDuration;
    if (index !== undefined) {
      const target = locked ? node('controls-title') : list.querySelector(focusedDuration !== undefined ?
        `[data-duration-edit="${index}"]` : `[data-item="${index}"]`);
      target?.focus({ preventScroll: true });
    } else if (focused?.closest('[data-duration-form]')) {
      node('controls-title').focus({ preventScroll: true });
    }
    refreshDurationWarning();
  }

  function renderDay() {
    if (!node('full-day').open) return;
    const showSchedule = context.configuration.preferences.showSchedule;
    setText('day-date', `Selected day · ${dateLabel(context.selectedDate)}`);
    node('passing-option').hidden = !showSchedule;
    const showPassing = node('passing').checked;
    const rows = schoolScheduleRows(context.selectedSnapshot, context.configuration, context.now)
      .filter(row => showPassing || row.kind !== 'passing');
    paint('day', rows.length ? rows.map(row => `<li class="agenda-school-${row.status}"><span><strong>${esc(row.title)}</strong>${row.room ? `<small>${esc(row.room)}</small>` : ''}</span><time>${esc(row.start)}${row.end ? ` – ${esc(row.end)}` : ''}</time></li>`).join('') :
      `<li>${showSchedule ? 'No activities to show for this date.' : 'Enable Today’s Schedule in Display Settings to show this list.'}</li>`);
  }

  function renderRun(run, agenda, live, manualActive, here, view) {
    const active = runIsActive(run);
    const ownsSelection = matchesSelection(run);
    const controls = here && !runError;
    const recovering = run?.status === 'recover';
    const canAdjust = controls && !recovering;
    renderedRun = { profileID: context.profileID, date: context.selectedDate, activityID: selected, token: runToken(run) };

    let detail = '';
    const budget = classBudget(currentChoice(), live, context.now);
    const readiness = planReadiness(agenda, highlighted, budget?.availableMs);
    const plan = readiness.plan;
    if (active) {
      if (!ownsSelection) detail = `Run Agenda for another lesson · ${run.items[run.index].title}`;
      else if (recovering) detail = 'This activity elapsed while you were away. Next Activity skips it.';
      else if (run.status === 'paused') detail = run.reason || 'Run Agenda · Paused';
      else detail = 'Run Agenda · Automatic progression';
      if (here) {
        const overrun = view && view.remainingMs > live.endAt - context.now;
        detail += ` · ${overrun ? 'Stops at class bell' : 'Class ends'} ${clock(live.endAt)}`;
      }
    } else if (ownsSelection && !manualActive) {
      const status = run.status === 'complete' ? 'Agenda complete' : 'Agenda stopped';
      detail = [status, run.reason, `${run.completed.length} completed · ${run.skipped.length} skipped`].filter(Boolean).join(' · ');
    }
    if (!active && !manualActive) {
      const reasons = [];
      if (readiness.missing.length) reasons.push(`Add durations for ${readiness.missing.map(item => `${item.index + 1}. ${item.title}`).join(', ')}.`);
      else if (readiness.error) reasons.push(readiness.error);
      if (!live) reasons.push('Timer starts are available only during the selected live class.');
      if (readiness.overrunMs) reasons.push(`Planned times exceed ${budget.live ? 'remaining class time' : 'this class segment'} by ${formatCountdown(readiness.overrunMs)}. Review Fit to Class Time. An automatic run still requires confirmation to stop at the class bell.`);
      if (plan && live) reasons.push('Run Full Agenda starts at the selected activity and advances through the remaining activities.');
      if (readiness.missing.length && validItemDuration(agenda.itemDurationsMs?.[highlighted]) && live) reasons.push('You can time the selected activity on its own.');
      if (runError) reasons.push('Resolve the message above before starting.');
      detail = [detail, ...reasons].filter(Boolean).join(' ');
    }
    setText('run-detail', detail);
    node('run-detail').hidden = !detail;

    runButton('start').disabled = !live || !plan || Boolean(runError);
    runButton('start').hidden = active || manualActive;
    runButton('start').classList.toggle('agenda-primary', !runButton('start').disabled);
    node('fit').hidden = active || manualActive || Boolean(runError) || !budget || !readiness.overrunMs;
    runButton('pause').hidden = !controls || run.status !== 'running';
    runButton('resume').hidden = !controls || run.status !== 'paused';
    runButton('finish').hidden = runButton('skip').hidden = !canAdjust;
    runButton('restart').hidden = runButton('next').hidden = !controls || !recovering;
    runButton('return').hidden = !active || ownsSelection;
    runButton('return').disabled = Boolean(runError);
    runButton('stop').hidden = !active;
    runButton('stop').disabled = Boolean(runError);
    node('adjustments').hidden = !canAdjust;
    for (const minutes of [-5, -1, 1, 5]) {
      runButton(minutes).hidden = !canAdjust;
      runButton(minutes).disabled = !view || (minutes < 0 && view.remainingMs + minutes * 60000 <= 0);
    }
  }

  function renderManual(timer, view, live, here, active, runningAgenda, agenda) {
    const origin = timer && timer.date === context.liveDate && context.liveSnapshot.events.find(event => activityIdentity(event) === timer.activityID && segmentIdentity(event) === timer.segmentID.replace(/::primary:\d+$/, ''));
    const sameTimerClass = Boolean(here && live && segmentIdentity(live) === timer.segmentID.replace(/::primary:\d+$/, ''));
    let detail = '';
    if (active) {
      const state = view.status === 'paused' ? 'Paused' : `Ends ${clock(view.endAt)}`;
      const boundary = origin ? (context.now >= origin.endAt ? 'Class ended' : `Class ends ${clock(origin.displayEndAt ?? origin.endAt)}`) : 'Originating class unavailable';
      detail = here ? `Single Activity Timer · ${state} · ${boundary}` :
        `Single Activity Timer for another lesson · ${timer.name} · ${formatCountdown(view.remainingMs)} remaining · ${state}`;
    } else if (!runningAgenda && here && view?.status === 'complete') {
      detail = `Single Activity Timer · ${timer.name} · ${timer.status === 'finished' ? 'Finished' : 'Time’s up'}`;
    }
    setText('manual-detail', detail);
    node('manual-detail').hidden = !detail;
    const duration = agenda.itemDurationsMs?.[highlighted];
    const timed = validItemDuration(duration);
    const singleStart = timerButton('start');
    singleStart.hidden = runningAgenda || active || !live || !timed || Boolean(runError);
    const singlePrimary = !singleStart.hidden && runButton('start').disabled;
    singleStart.classList.toggle('agenda-primary', singlePrimary);
    // Use exact fractional minutes where concise, otherwise exact seconds.
    const durationLabel = timed ? duration % 6000 === 0 ? `${duration / 60000}-Minute` : `${duration / 1000}-Second` : '';
    const startLabel = singlePrimary ? `Start ${durationLabel} Timer` : 'Single Activity Timer';
    if (singleStart.textContent !== startLabel) singleStart.textContent = startLabel;
    node('add-duration').hidden = runningAgenda || active || Boolean(runError) || !currentChoice() ||
      !agenda.items[highlighted] || timed;
    timerButton('pause').hidden = !active || view.status !== 'running';
    timerButton('resume').hidden = !active || view.status !== 'paused' || !sameTimerClass;
    timerButton('finish').hidden = !active;
  }

  function handleRun(action) {
    const expected = renderedRun;
    const verify = () => {
      context = getContext();
      if (!context?.profileID || context.profileID !== expected.profileID ||
          context.selectedDate !== expected.date || selected !== expected.activityID) {
        throw Error('The profile, date or class changed. Select the activity again.');
      }
      if (runError) throw Error(runError);
      reconcileRun();
      if (runError) throw Error(runError);
      const profile = store.runState(expected.profileID);
      if (runToken(profile.agendaRun) !== expected.token) {
        update();
        throw Error('The run changed. Choose a control for the current activity.');
      }
      return profile;
    };
    const id = expected.profileID;
    const profile = verify();
    const run = profile.agendaRun;
    const withBoundaryConfirmation = apply => {
      try { apply(false); }
      catch (error) {
        if (!(error instanceof AgendaBoundaryError)) throw error;
        if (window.confirm(`${error.message} The run will stop at the official class bell. Continue?`)) {
          verify();
          apply(true);
        }
      }
    };
    if (action === 'return') {
      setLessonDate(run.date);
      selected = run.activityID;
    } else if (action === 'stop') {
      if (window.confirm('Stop this run? The saved agenda and its progress will remain available.')) {
        verify();
        controller.stop(id, context.now, { confirmed: true });
      }
    } else if (action === 'start') {
      const startIndex = highlighted;
      const agenda = currentAgenda();
      agendaPlan(agenda, startIndex);
      const manual = !profile.timer?.agendaRunID && timerView(profile.timer, context.now);
      const replaceManual = Boolean(manual && manual.status !== 'complete');
      const restartCompleted = runMatchesAgenda(run, agenda) && run.completed.some(index => index >= startIndex);
      const liveID = liveSelection()?.id;
      if (!liveID) throw Error('Run Agenda only in the selected live class.');
      if (replaceManual && !window.confirm('Replace the active manual timer with Run Agenda?')) return;
      if (restartCompleted && !window.confirm('Start a new run and repeat completed activities from this selection?')) return;
      const start = allowOverrun => {
        if (liveSelection()?.id !== liveID) throw Error('Run Agenda only in the selected live class.');
        controller.start(id, { snapshot: context.liveSnapshot, now: context.now, startIndex, replaceManual, restartCompleted, allowOverrun });
      };
      verify();
      withBoundaryConfirmation(start);
    } else {
      if (!matchesSelection(run) || !liveSelection()) throw Error('Return to the original live class to continue.');
      const withContext = apply => withBoundaryConfirmation(allow => apply(context.liveSnapshot, context.now, allow));
      if (action === 'pause') controller.pause(id, context.now);
      else if (action === 'resume') withContext((snapshot, now, allow) => controller.resume(id, snapshot, now, allow));
      else if (action === 'finish' || action === 'skip') {
        withContext((snapshot, now, allow) => controller.next(id, snapshot, now, allow, { skipped: action === 'skip' }));
      } else if (action === 'restart' || action === 'next') {
        withContext((snapshot, now, allow) => controller.recover(id, snapshot, now, action, allow));
      } else controller.add(id, Number(action), context.liveSnapshot, context.now);
    }
  }

  switcher.onclick = event => {
    const button = event.target.closest('[data-mode]');
    if (button) setMode(button.dataset.mode);
  };
  node('full-day').addEventListener('toggle', () => {
    if (context?.profileID && !screen.hidden) renderDay();
  });
  screen.addEventListener('change', event => {
    if (event.target === node('chimes')) {
      safe(() => {
        const enabled = event.target.value === 'on';
        store.change(context.profileID, profile => { profile.transitionSound = enabled; });
        soundEnabled = enabled;
        soundMessage = '';
        chime.setEnabled(enabled);
      });
      renderSound();
      if (event.isTrusted) void unlockSound();
    }
    if (event.target === node('passing')) renderDay();
    if (event.target === node('date')) safe(() => setLessonDate(event.target.value));
    if (event.target === node('class')) { durationDraft = null; selected = event.target.value; highlighted = 0; update(); }
  });
  screen.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-today')) safe(() => setLessonDate(context.liveDate));
    if (button.hasAttribute('data-date-step')) safe(() => setLessonDate(adjacentLessonDate(context.selectedDate, Number(button.dataset.dateStep))));
    if (button.hasAttribute('data-test-sound') && event.isTrusted) void unlockSound(true);
    if (button.dataset.run) {
      silenceChimes();
      safe(() => handleRun(button.dataset.run));
      if (event.isTrusted && ['start', 'resume', 'restart'].includes(button.dataset.run) &&
          store.runState(context.profileID).agendaRun?.status === 'running') void unlockSound();
    }
    if (button.hasAttribute('data-item')) { highlighted = Number(button.dataset.item); update(); }
    if (button.hasAttribute('data-add-duration')) safe(() => startDurationEdit(highlighted));
    if (button.hasAttribute('data-duration-edit')) safe(() => startDurationEdit(Number(button.dataset.durationEdit)));
    if (button.hasAttribute('data-duration-cancel')) cancelDurationEdit();
    if (button.hasAttribute('data-export-agendas')) safe(() => openBackup('export'));
    if (button.hasAttribute('data-import-agendas')) safe(() => openBackup('import'));
    if (button.hasAttribute('data-copy')) safe(() => openPlanning('copy'));
    if (button.hasAttribute('data-fit')) safe(() => openPlanning('fit'));
    if (button.hasAttribute('data-edit')) safe(openEditor);
    if (button.dataset.timer) silenceChimes();
    if (button.dataset.timer) safe(() => {
      const action = button.dataset.timer;
      if (automaticSession()) throw Error('Stop the running agenda before using the manual timer.');
      const profileID = context.profileID;
      if (action === 'start') {
        const agenda = currentAgenda();
        if (!liveSelection()) throw Error('Select the current live class to start an activity.');
        store.start(profileID, { name: agenda.items[highlighted]?.slice(0, 200) || 'Activity', durationMs: agenda.itemDurationsMs?.[highlighted], snapshot: context.liveSnapshot, now: context.now });
      }
      if (action === 'pause') store.pause(profileID, context.now, effectiveTimerBell(store.profile(profileID).timer, context.configuration));
      if (action === 'resume') {
        const timer = store.profile(profileID).timer;
        if (!liveSelection() || timer.activityID !== selected || timer.date !== context.liveDate || segmentIdentity(liveSelection()) !== timer.segmentID.replace(/::primary:\d+$/, '')) throw Error('Resume in the originating live class.');
        store.resume(profileID, context.liveSnapshot, context.now);
      }
      if (action === 'finish') store.finish(profileID, context.now);
    });
  });

  screen.addEventListener('submit', event => {
    if (!event.target.matches('[data-duration-form]')) return;
    event.preventDefault();
    saveDurationEdit();
  });
  screen.addEventListener('input', event => {
    if (!event.target.matches('[data-duration-minutes]')) return;
    event.target.removeAttribute('aria-invalid');
    screen.querySelector('[data-duration-error]').textContent = '';
    refreshDurationWarning();
  });
  screen.addEventListener('keydown', event => {
    if (!event.target.closest('[data-duration-form]') || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelDurationEdit();
    } else if (event.key === 'Enter' && event.target.matches('[data-duration-minutes]')) {
      event.preventDefault();
      saveDurationEdit();
    }
  });

  function openBackup(mode) {
    if (editor) return;
    const owner = context.profileID;
    const opener = document.activeElement;
    const assertAvailable = () => {
      const current = getContext();
      if (!current?.profileID || current.profileID !== owner) throw Error('The selected profile changed. Reopen Agenda Backups.');
      if (runError) throw Error(runError);
    };
    assertAvailable();
    const dialog = agendaBackupDialog({ mode, store, currentProfileID: owner,
      getProfiles: actions.getProfiles, assertAvailable,
      onSaved: message => { update(); feedback(message); } });
    durationDraft = null;
    editor = dialog;
    dialog.addEventListener('close', () => { dialog.remove(); editor = null; if (opener?.isConnected) opener.focus(); });
    document.body.append(dialog);
    try { dialog.showModal(); dialog.querySelector('input, select, button')?.focus(); }
    catch (error) { dialog.remove(); editor = null; throw error; }
  }

  function openPlanning(kind) {
    if (editor) return;
    durationDraft = null;
    context = getContext();
    const choice = currentChoice();
    if (!choice) throw Error('Choose an instructional period first.');
    const source = currentAgenda();
    const owner = { profileID: context.profileID, date: context.selectedDate, activityID: selected };
    const original = JSON.stringify(source);
    const assertOwner = editing => {
      context = getContext();
      if (!context?.profileID || context.profileID !== owner.profileID || context.selectedDate !== owner.date || selected !== owner.activityID || !currentChoice()) throw Error('The lesson changed. Reopen this dialog.');
      if (runError) throw Error(runError);
      if (JSON.stringify(currentAgenda()) !== original) throw Error('This agenda changed. Reopen this dialog before saving.');
      if (editing && durationEditsLocked()) throw Error('Finish the timer or stop Run Agenda before changing planned times.');
    };
    assertOwner(kind === 'fit');
    const opener = document.activeElement;
    const options = { store, owner, source, assertOwner, getContext,
      onSaved: message => { update(); feedback(message); } };
    const dialog = kind === 'fit' ? fitDialog({ ...options, index: highlighted,
      getBudget: () => { assertOwner(true); return classBudget(currentChoice(), liveSelection(), context.now); } }) :
      copyDialog({ ...options, sourceLabel: eventTitle(choice.event), dateLabel });
    editor = dialog;
    dialog.addEventListener('close', () => { dialog.remove(); editor = null; if (opener?.isConnected) opener.focus(); });
    document.body.append(dialog);
    try { dialog.showModal(); dialog.querySelector('input:not([disabled]), button')?.focus(); }
    catch (error) { dialog.remove(); editor = null; throw error; }
  }

  function openEditor() {
    if (editor) return;
    durationDraft = null;
    context = getContext();
    const choice = currentChoice();
    if (!choice) return;
    const owner = { profileID: context.profileID, date: context.selectedDate, activityID: selected };
    const agenda = currentAgenda();
    let rows = agenda.items.map((title, index) => ({ title, minutes: agenda.itemDurationsMs?.[index] ? String(agenda.itemDurationsMs[index] / 60000) : '' }));
    if (!rows.length) rows = [{ title: '', minutes: '' }];
    const opener = document.activeElement;
    const dialog = document.createElement('dialog');
    editor = dialog;
    dialog.className = 'agenda-edit-dialog';
    dialog.setAttribute('aria-labelledby', 'agenda-editor-title');
    dialog.innerHTML = `<form novalidate>
      <header><div><h2 id="agenda-editor-title">Plan Agenda</h2><p>${esc(eventTitle(choice.event))} · ${esc(dateLabel(owner.date))}</p></div><button type="button" data-cancel aria-label="Close agenda editor">×</button></header>
      <div class="agenda-edit-body"><label>Agenda title<input name="title" maxlength="200" value="${esc(agenda.title)}"></label>
      <label>Teacher instructions <small>(optional)</small><textarea name="instructions" maxlength="2000" rows="3">${esc(agenda.instructions)}</textarea></label>
      <h3>Activities</h3><div data-edit-rows></div><button type="button" data-add>Add activity</button></div>
      <p role="alert" data-error></p><footer><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Save &amp; Show</button></footer>
    </form>`;
    const form = dialog.querySelector('form');
    const area = dialog.querySelector('[data-edit-rows]');
    const error = (message, input) => {
      dialog.querySelector('[data-error]').textContent = message;
      input?.focus();
    };
    const sync = () => {
      rows = [...area.children].map(row => ({ title: row.querySelector('[data-title]').value, minutes: row.querySelector('[data-minutes]').value }));
    };
    const paintRows = focusIndex => {
      area.innerHTML = rows.map((row, index) => `<div class="agenda-edit-row">
        <label><span>Activity ${index + 1}</span><input data-title maxlength="500" value="${esc(row.title)}" aria-label="Activity ${index + 1}"></label>
        <label><span>Minutes <small>(optional)</small></span><input data-minutes type="number" min="0.016666666666666666" max="1440" step="any" value="${esc(row.minutes)}" aria-label="Minutes for activity ${index + 1}"></label>
        <div class="agenda-row-actions"><button type="button" data-move="${index}" data-direction="-1" aria-label="Move activity ${index + 1} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move="${index}" data-direction="1" aria-label="Move activity ${index + 1} down" ${index === rows.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-remove="${index}" aria-label="Remove activity ${index + 1}">Remove</button></div>
      </div>`).join('');
      dialog.querySelector('[data-add]').disabled = rows.length >= 50;
      if (Number.isInteger(focusIndex)) area.children[focusIndex]?.querySelector('[data-title]').focus();
    };
    form.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-cancel')) { dialog.close(); return; }
      if (button.hasAttribute('data-add')) {
        sync();
        if (rows.length < 50) { rows.push({ title: '', minutes: '' }); paintRows(rows.length - 1); }
      }
      if (button.hasAttribute('data-remove')) { sync(); rows.splice(Number(button.dataset.remove), 1); paintRows(); }
      if (button.hasAttribute('data-move')) {
        sync();
        const index = Number(button.dataset.move), next = index + Number(button.dataset.direction);
        if (next >= 0 && next < rows.length) { [rows[index], rows[next]] = [rows[next], rows[index]]; paintRows(next); }
      }
    });
    area.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.metaKey || event.ctrlKey || !event.target.hasAttribute('data-title')) return;
      event.preventDefault();
      sync();
      const index = [...area.children].indexOf(event.target.closest('.agenda-edit-row'));
      const planned = advanceAgendaItem(rows.map(row => row.title), index);
      if (planned.error) { error(planned.error, event.target); return; }
      if (planned.items.length > rows.length) rows.push({ title: '', minutes: '' });
      paintRows(planned.index);
    });
    form.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.onsubmit = event => {
      event.preventDefault();
      sync();
      const current = getContext();
      if (!current || current.profileID !== owner.profileID || current.selectedDate !== owner.date || !classChoices(current.selectedSnapshot).some(item => item.id === owner.activityID)) { error('The selected profile, date or class changed. Reopen this editor.'); return; }
      const invalid = [...form.elements].find(input => input.willValidate && !input.validity.valid);
      if (invalid) { error(invalid.validationMessage, invalid); return; }
      const items = [], durations = [];
      for (const [index, row] of rows.entries()) {
        if (!row.title.trim() && !row.minutes) continue;
        if (!row.title.trim()) { error('Name this activity before adding a duration.', area.children[index].querySelector('[data-title]')); return; }
        const duration = row.minutes === '' ? null : Math.round(Number(row.minutes) * 60000);
        if (duration !== null && !validItemDuration(duration)) { error('Choose a duration between one second and 24 hours.', area.children[index].querySelector('[data-minutes]')); return; }
        items.push(row.title.trim()); durations.push(duration);
      }
      try {
        store.saveAgenda(owner.profileID, { ...agenda, date: owner.date, activityID: owner.activityID, title: form.elements.title.value.trim(), instructions: form.elements.instructions.value.trim(), items, itemDurationsMs: durations });
        highlighted = 0;
        dialog.close();
        update();
      } catch (failure) { error(failure.message); }
    };
    dialog.addEventListener('close', () => { dialog.remove(); editor = null; if (opener?.isConnected) opener.focus(); });
    paintRows();
    document.body.append(dialog);
    try { dialog.showModal(); form.elements.title.focus(); }
    catch (error) { dialog.remove(); editor = null; throw error; }
  }
  function dispose() {
    chime.dispose();
    editor?.close();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onVisibilityChange);
    window.removeEventListener('storage', onStorageChange);
    releaseHeader();
    headerObserver.disconnect();
    header.remove();
    screen.remove();
    normal.hidden = false;
  }
  try {
    normal.before(header);
    headerObserver.observe(header);
    document.body.append(screen);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onVisibilityChange);
    window.addEventListener('storage', onStorageChange);
    update();
    return { update, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
