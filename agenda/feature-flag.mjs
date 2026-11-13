// Public release: Bell View remains the default; Classroom View is opt-in.
export const AGENDA_MODE_ENABLED = true;

export function isAgendaPreviewEnabled(location) {
  const local = location?.hostname === 'localhost' || location?.hostname === '127.0.0.1';
  const production = location?.hostname === 'display.bellsync.app';
  return (local && new URLSearchParams(location.search).get('agenda') === '1') ||
    (AGENDA_MODE_ENABLED && (local || production));
}
