const STORAGE_KEY = 'lucky-defense-guild-raid:audio-muted';

export function createGameAudio() {
  let context = null;
  let masterGain = null;
  let muted = localStorage.getItem(STORAGE_KEY) === 'true';

  function ensureContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
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

  function playTone({ type, from, to, duration, volume, startAt = 0 }) {
    if (!context || !masterGain) return;
    const now = context.currentTime + startAt;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    filter.type = 'lowpass';
    filter.frequency.value = type === 'sine' ? 1800 : 1100;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }

  function impact(style = 'melee', intensity = 1) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state !== 'running') return;
    const strength = Math.min(1, intensity);
    if (style === 'ranged') {
      playTone({ type: 'square', from: 620 + Math.random() * 80, to: 310, duration: 0.075, volume: 0.075 * strength });
      return;
    }
    if (style === 'magic') {
      playTone({ type: 'sine', from: 430, to: 690, duration: 0.14, volume: 0.07 * strength });
      playTone({ type: 'sine', from: 650, to: 920, duration: 0.12, volume: 0.045 * strength, startAt: 0.018 });
      return;
    }
    playTone({ type: 'triangle', from: 165 + Math.random() * 30, to: 68, duration: 0.105, volume: 0.15 * strength });
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
