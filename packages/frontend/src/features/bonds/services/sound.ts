// Web Audio API: dos beeps cortos para alertas.
// El AudioContext debe instanciarse desde un gesto del usuario (click);
// si no, los browsers lo bloquean.

let audioCtx: AudioContext | null = null;

export function isAudioUnlocked(): boolean {
  return audioCtx !== null && audioCtx.state !== "closed";
}

export function unlockAudio(): boolean {
  if (audioCtx && audioCtx.state !== "closed") {
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return true;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return false;
  try {
    audioCtx = new Ctor();
    return true;
  } catch {
    audioCtx = null;
    return false;
  }
}

function beep(freq: number, durationSec: number, startOffsetSec: number): void {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + startOffsetSec;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.25, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationSec);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + durationSec);
}

export function playAlertSound(): void {
  if (!isAudioUnlocked()) return;
  beep(880, 0.18, 0);
  beep(660, 0.22, 0.22);
}
