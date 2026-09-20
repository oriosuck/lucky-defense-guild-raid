const STORAGE_KEY = 'lucky-defense-guild-raid:audio-muted';

export function createGameAudio() {
  let context = null;
  let masterGain = null;
  let muted = localStorage.getItem(STORAGE_KEY) === 'true';

  function ensureContext() {
    if (context || typeof AudioContext === 'undefined') return context;
    context = new AudioContext();
    masterGain = context.createGain();
    masterGain.gain.value = muted ? 0 : 0.18;
    masterGain.connect(context.destination);
    return context;
  }

  async function unlock() {
    const audioContext = ensureContext();
    if (audioContext?.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {
        // 브라우저가 사용자 제스처로 인정하지 않은 경우 다음 조작 때 다시 시도한다.
      }
    }
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    localStorage.setItem(STORAGE_KEY, String(muted));
    if (masterGain && context) {
      masterGain.gain.cancelScheduledValues(context.currentTime);
      masterGain.gain.setTargetAtTime(muted ? 0 : 0.18, context.currentTime, 0.015);
    }
    return muted;
  }

  function toggle() {
    unlock();
    return setMuted(!muted);
  }

  function impact(intensity = 1) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state !== 'running') return;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(150 + Math.random() * 35, now);
    oscillator.frequency.exponentialRampToValueAtTime(72, now + 0.085);
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.17 * Math.min(1, intensity), now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + 0.12);
  }

  function destroy() {
    if (context && context.state !== 'closed') context.close();
    context = null;
    masterGain = null;
  }

  return {
    unlock,
    toggle,
    impact,
    destroy,
    get muted() {
      return muted;
    },
  };
}
