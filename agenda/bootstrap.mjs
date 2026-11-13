import { isAgendaPreviewEnabled } from './feature-flag.mjs?v=agenda-release-1';
import { readOnlyContext } from './context.mjs?v=agenda-release-1';
import { mountClassroomPreview } from './classroom-preview.mjs?v=agenda-release-1';

export async function mountAgendaPreview(options) {
  if (!isAgendaPreviewEnabled(globalThis.location)) return null;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./classroom-preview.css?v=agenda-release-1', import.meta.url).href;
  try {
    await new Promise((resolve, reject) => {
      stylesheet.onload = resolve;
      stylesheet.onerror = () => reject(Error('Classroom preview styles could not load.'));
      document.head.append(stylesheet);
    });
    const view = mountClassroomPreview({
      ...options,
      getContext: () => readOnlyContext(options.getContext()),
    });
    if (!view) stylesheet.remove();
    return view;
  } catch (error) {
    stylesheet.remove();
    throw error;
  }
}
