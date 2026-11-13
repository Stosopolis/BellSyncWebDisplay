// Snapshot copies keep this optional view from mutating the official app state.
const configurations = new WeakMap();

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function copy(value) {
  return freeze(JSON.parse(JSON.stringify(value)));
}

export function readOnlyContext(raw) {
  if (!raw) return null;
  if (!configurations.has(raw.configuration)) {
    configurations.set(raw.configuration, copy(raw.configuration));
  }
  return Object.freeze({
    ...raw,
    configuration: configurations.get(raw.configuration),
    selectedSnapshot: copy(raw.selectedSnapshot),
    liveSnapshot: copy(raw.liveSnapshot),
  });
}
