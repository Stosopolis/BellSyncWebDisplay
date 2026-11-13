// Short synthesized activity cue; no school-bell sample or network request.
export function isOnTimeTransition(event, before, after, now, previousTick) {
  const prior = before?.agendaRun, next = after?.agendaRun;
  return Boolean(
    event?.kind === 'transition' && event.soundEligible &&
    prior?.status === 'running' && next?.status === 'running' &&
    prior.id === next.id && next.index === prior.index + 1 &&
    before.timer?.agendaRunID === prior.id && after.timer?.agendaRunID === next.id &&
    Number.isFinite(previousTick) && now >= previousTick && now - previousTick <= 1500 &&
    now >= before.timer.endAt && now - before.timer.endAt <= 1000
  );
}

export class TransitionChime {
  constructor({ createContext = () => {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    return Audio ? new Audio() : null;
  } } = {}) {
    this.createContext = createContext;
    this.context = null;
    this.enabled = false;
    this.seen = new Set();
    this.voices = new Set();
    this.generation = 0;
    this.disposed = false;
    this.onStateChange = () => {
      if (this.context?.state !== 'running') this.silence();
    };
  }

  get ready() {
    return this.enabled && !this.disposed && this.context?.state === 'running';
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.silence();
  }

  // Call only from an explicit teacher gesture. Playback never resumes audio.
  async unlock(enabled) {
    this.setEnabled(enabled);
    if (!this.enabled || this.disposed) return false;
    const generation = this.generation;
    try {
      if (!this.context) {
        this.context = this.createContext();
        this.context?.addEventListener('statechange', this.onStateChange);
      }
      if (!this.context) return false;
      if (this.context.state !== 'running') await this.context.resume();
      return generation === this.generation && this.ready;
    } catch {
      return false;
    }
  }

  play(event) {
    if (!event?.id || this.seen.has(event.id)) return false;
    // Consume even a muted/dropped event. It must never become a catch-up cue.
    this.seen.add(event.id);
    if (event.kind !== 'transition' || !event.soundEligible) return false;
    return this.emit();
  }

  test() {
    return this.emit();
  }

  emit() {
    if (!this.ready || this.voices.size) return false;
    try {
      const context = this.context, start = context.currentTime;
      for (const [frequency, offset] of [[659, 0], [784, .09]]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const voice = { oscillator, gain };
        this.voices.add(voice);
        oscillator.onended = () => {
          try { oscillator.disconnect(); gain.disconnect(); } catch { /* Already detached. */ }
          this.voices.delete(voice);
        };
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start + offset);
        gain.gain.linearRampToValueAtTime(.06, start + offset + .015);
        gain.gain.exponentialRampToValueAtTime(.001, start + offset + .14);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + .15);
      }
      return true;
    } catch {
      this.silence();
      return false;
    }
  }

  silence() {
    this.generation++;
    for (const { oscillator, gain } of this.voices) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* It may already have ended. */ }
      try { oscillator.disconnect(); gain.disconnect(); } catch { /* Already detached. */ }
    }
    this.voices.clear();
  }

  dispose() {
    this.disposed = true;
    this.setEnabled(false);
    this.context?.removeEventListener('statechange', this.onStateChange);
    try { this.context?.close()?.catch(() => {}); } catch { /* Audio is optional. */ }
  }
}
