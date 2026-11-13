import { escapeHTML as esc } from '../display-core.mjs';
import { MAX_BACKUP_BYTES, exportAgendaBackup, parseAgendaBackup, backupDestinations, previewAgendaRestore, restoreAgendaBackup } from './classroom-backup.mjs?v=agenda-release-1';

export function agendaBackupDialog({ mode, store, getProfiles, currentProfileID, assertAvailable, onSaved }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'agenda-edit-dialog agenda-backup-dialog';
  dialog.setAttribute('aria-labelledby', 'agenda-backup-title');
  dialog.innerHTML = `<form novalidate>
    <header><h2 id="agenda-backup-title">${mode === 'export' ? 'Export' : 'Import'} Agendas</h2><button type="button" data-close aria-label="Close dialog">×</button></header>
    <div class="agenda-edit-body">
      <p class="agenda-control-detail">Lesson plans are stored only in this browser. Agenda backups are separate from Display schedule backups and do not resume old timers.</p>
      ${mode === 'export' ? `<label>Export scope<select data-scope><option value="all">All saved Agenda profiles</option><option value="current">Current school profile</option></select></label><p class="agenda-control-detail">Includes saved lesson content and dates. No active timers or progress.</p>` :
        `<label>Choose an Agenda backup<input type="file" data-backup-file accept=".json,application/json"></label>
         <p class="agenda-control-detail">Restore the matching Display school profile first. Newer Agenda backups can check lessons individually when personal settings differ. Your lunches and chimes here will stay unchanged.</p>
         <div data-mappings></div><div data-preview></div>`}
      <p class="agenda-backup-summary" data-summary role="status"></p>
    </div><p data-error role="alert"></p>
    <footer><button type="button" data-close>Cancel</button><button type="submit" class="primary" ${mode === 'import' ? 'disabled' : ''}>${mode === 'export' ? 'Download Backup' : 'Import Selected Agendas'}</button></footer>
  </form>`;
  const form = dialog.querySelector('form'), submit = dialog.querySelector('[type=submit]');
  const error = message => { dialog.querySelector('[data-error]').textContent = message; };
  const summary = message => { dialog.querySelector('[data-summary]').textContent = message; };
  const guard = () => { assertAvailable(); if (!dialog.open || !dialog.isConnected) throw Error('Import or export cancelled.'); };
  let backup = null, preview = [], mappings = Object.create(null), generation = 0, fileGeneration = 0, busy = false;
  for (const button of dialog.querySelectorAll('[data-close]')) button.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { generation++; });
  function lockInputs(locked) {
    for (const input of dialog.querySelectorAll('input, select')) input.disabled = locked || input.dataset.unavailable === 'true';
  }
  async function refreshPreview() {
    const request = ++generation;
    submit.disabled = true;
    const profiles = getProfiles();
    const rows = await previewAgendaRestore(backup, mappings, profiles, store, Date.now());
    if (!dialog.open || request !== generation) return;
    guard(); preview = rows;
    const area = dialog.querySelector('[data-preview]');
    area.innerHTML = backup.profiles.map((source, pi) => {
      const group = rows.filter(row => row.sourceProfileID === source.sourceProfileID);
      return `<details class="agenda-backup-group" ${pi === 0 ? 'open' : ''}><summary>${esc(source.descriptor?.profileName || 'Missing source profile')} · ${group.length} lessons</summary>
      ${group.map(row => {
        const usable = ['ready', 'conflict'].includes(row.status);
        return `<div class="agenda-backup-row"><label><input type="checkbox" data-include="${row.key}" ${usable ? 'checked' : 'disabled data-unavailable="true"'}><span><strong>${esc(row.agenda.title || 'Untitled agenda')}</strong><small>${esc(row.agenda.date)} · ${esc(row.label)} → ${esc(row.targetName || 'No destination selected')}</small><small>${esc(row.profileDifference && usable ? 'Profile settings differ; class and times match. ' : '')}${esc(row.reason || (row.profileDifference ? 'Compatible lesson.' : 'Ready to import'))}</small></span></label>
        ${row.status === 'conflict' ? `<label class="agenda-backup-replace"><input type="checkbox" data-replace="${row.key}">Replace the existing lesson</label>` : ''}</div>`;
      }).join('')}</details>`;
    }).join('');
    const counts = status => rows.filter(r => r.status === status).length;
    const different = rows.filter(r => r.profileDifference && ['ready', 'conflict', 'duplicate'].includes(r.status)).length;
    summary(`${counts('ready')} ready · ${different} compatible despite profile differences · ${counts('conflict')} conflicts requiring confirmation · ${counts('duplicate')} duplicates · ${counts('protected')} protected · ${counts('incompatible')} incompatible. ${different ? 'Personal settings differ; matching lessons can be imported safely. ' : ''}Review selections before importing.`);
    submit.disabled = !rows.some(r => ['ready', 'conflict'].includes(r.status));
  }
  if (mode === 'import') {
    dialog.querySelector('[data-backup-file]').onchange = async event => {
      const request = ++generation, fileRequest = ++fileGeneration;
      backup = null; preview = []; mappings = Object.create(null); submit.disabled = true;
      dialog.querySelector('[data-mappings]').replaceChildren();
      dialog.querySelector('[data-preview]').replaceChildren(); error(''); summary('');
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (file.size > MAX_BACKUP_BYTES) throw Error('Choose an Agenda backup no larger than 5 MB.');
        const parsed = parseAgendaBackup(await file.text());
        const destinations = await backupDestinations(parsed, getProfiles());
        if (!dialog.open || request !== generation) return;
        guard(); backup = parsed;
        dialog.querySelector('[data-mappings]').innerHTML = parsed.profiles.map((source, index) => {
          const result = destinations[index];
          mappings[source.sourceProfileID] = result.exact;
          return `<label class="agenda-backup-mapping">${esc(source.descriptor?.profileName || 'Unavailable source profile')} · ${esc(source.descriptor?.schoolName || 'Unknown school')}
            <select data-mapping="${index}"><option value="">Skip / choose a destination profile</option>${result.candidates.map(p => `<option value="${esc(p.id)}" ${p.id === result.exact ? 'selected' : ''}>${esc(p.descriptor.profileName)} · ${esc(p.descriptor.schoolName)} (${esc(p.id.slice(-8))})</option>`).join('')}</select>
            <small>${result.exact ? 'Same profile ID and compatible school definition. Lessons are checked individually if settings differ.' : result.candidates.length ? 'Choose explicitly: these profiles have a compatible school definition but different IDs.' : 'No compatible school definition. Older backups require an exact schedule match; otherwise restore the matching Display profile first.'}</small></label>`;
        }).join('');
        await refreshPreview();
      } catch (failure) { if (dialog.open && fileRequest === fileGeneration) error(failure.message); }
    };
    dialog.querySelector('[data-mappings]').onchange = async event => {
      if (!event.target.hasAttribute('data-mapping') || busy) return;
      const source = backup.profiles[Number(event.target.dataset.mapping)];
      mappings[source.sourceProfileID] = event.target.value;
      try { error(''); await refreshPreview(); } catch (failure) { if (dialog.open) error(failure.message); }
    };
  }
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; submit.disabled = true; lockInputs(true); error('');
    try {
      guard();
      if (mode === 'export') {
        const profiles = getProfiles(), signature = JSON.stringify(profiles);
        const payload = await exportAgendaBackup(store, profiles, dialog.querySelector('[data-scope]').value === 'current' ? currentProfileID : null);
        guard(); if (JSON.stringify(getProfiles()) !== signature) throw Error('School profiles changed. Try exporting again.');
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        // Pretty-printing can exceed the parser's byte bound; refuse an unusable file.
        if (blob.size > MAX_BACKUP_BYTES) throw Error('This backup is too large. Export one profile at a time.');
        const link = document.createElement('a'), url = URL.createObjectURL(blob);
        link.href = url; link.download = `bellsync-agendas-${payload.exportedAt.slice(0, 10)}.json`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        const count = payload.profiles.reduce((sum, p) => sum + p.agendas.length, 0);
        const orphaned = payload.profiles.filter(p => !p.descriptor).length;
        summary(`Backup download requested: ${count} agendas across ${payload.profiles.length} profiles.${orphaned ? ` ${orphaned} missing source profiles are preserved in the file but cannot be safely mapped during restore.` : ''} Confirm that Safari saved the file.`);
      } else {
        if (!backup || !preview.length) throw Error('Choose and preview an Agenda backup first.');
        const selections = preview.map(row => ({ key: row.key,
          include: Boolean(dialog.querySelector(`[data-include="${row.key}"]`)?.checked),
          replace: Boolean(dialog.querySelector(`[data-replace="${row.key}"]`)?.checked) }));
        const result = await restoreAgendaBackup({ backup, mappings: { ...mappings }, selections, preview, getProfiles, store, assertReady: guard });
        guard();
        const report = `${result.imported.length} imported · ${result.skipped.length} skipped · ${result.incompatible.length} incompatible.`;
        const area = dialog.querySelector('[data-preview]');
        area.innerHTML = [['Imported', result.imported], ['Skipped', result.skipped], ['Incompatible', result.incompatible]].filter(([, items]) => items.length).map(([title, items]) =>
          `<details class="agenda-backup-group"><summary>${title} (${items.length})</summary><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>`).join('');
        summary(report); onSaved(report);
        dialog.querySelector('footer [data-close]').textContent = 'Done';
        return; // Keep completed imports locked; reopen for another file.
      }
    } catch (failure) { if (dialog.open) error(failure.message); }
    finally { busy = false; }
    if (dialog.open) { lockInputs(false); submit.disabled = mode === 'import' && !preview.some(r => ['ready', 'conflict'].includes(r.status)); }
  };
  return dialog;
}
