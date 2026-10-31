/**
 * Jam Audio Synthesis Engine (Web Audio API)
 *
 * Provides real-time sound generation for 10 soundboard voices:
 * Kick, Snare, Hat, Clap, 808 Bass, Lead Synth, Pad, Bell, Pluck, and Chord Stabs.
 *
 * Environment safe:
 * Works in Web / React Native Web. Gracefully no-ops in headless Node / native environments.
 */

export type Voice =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'clap'
  | 'bass'
  | 'lead'
  | 'pad'
  | 'bell'
  | 'pluck'
  | 'stab';

export const VOICES: Voice[] = [
  'kick',
  'snare',
  'hat',
  'clap',
  'bass',
  'pluck',
  'stab',
  'bell',
  'lead',
  'pad',
];

export interface JamPadDef {
  voice: Voice;
  midi: number;
  label: string;
  hint: string;
  color: string;
}

export const JAM_PADS: JamPadDef[] = [
  { voice: 'kick', midi: 0, label: 'Kick', hint: 'Q', color: '#EF4444' },
  { voice: 'snare', midi: 0, label: 'Snare', hint: 'W', color: '#F97316' },
  { voice: 'hat', midi: 0, label: 'Hat', hint: 'E', color: '#FBBF24' },
  { voice: 'clap', midi: 0, label: 'Clap', hint: 'R', color: '#10B981' },
  { voice: 'bass', midi: 36, label: '808 Bass', hint: 'A', color: '#6366F1' },
  { voice: 'pluck', midi: 60, label: 'Pluck', hint: 'S', color: '#A855F7' },
  { voice: 'stab', midi: 64, label: 'Stab', hint: 'D', color: '#EC4899' },
  { voice: 'bell', midi: 79, label: 'Bell', hint: 'F', color: '#06B6D4' },
  { voice: 'lead', midi: 72, label: 'Lead', hint: 'Z', color: '#3B82F6' },
  { voice: 'pad', midi: 57, label: 'Warm Pad', hint: 'X', color: '#14B8A6' },
];

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class JamAudio {
  private ctx: any = null;
  private master: any = null;
  private delaySend: any = null;
  private noiseBuf: any = null;
  private volume = 0.85;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  async unlock(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    if (!this.ctx) {
      const win = window as any;
      const Ctor = win.AudioContext || win.webkitAudioContext;
      if (!Ctor) return false;

      try {
        const ctx = new Ctor({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.buildGraph(ctx);
      } catch {
        return false;
      }
    }

    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }

    return this.ready;
  }

  private buildGraph(ctx: any): void {
    try {
      const master = ctx.createGain();
      master.gain.value = this.volume;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 20;
      comp.ratio.value = 5;
      comp.attack.value = 0.005;
      comp.release.value = 0.15;

      const delay = ctx.createDelay(1.2);
      delay.delayTime.value = 0.25;
      const fb = ctx.createGain();
      fb.gain.value = 0.25;
      const wet = ctx.createGain();
      wet.gain.value = 0.28;
      const send = ctx.createGain();
      send.gain.value = 1;

      send.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(master);
      master.connect(comp);
      comp.connect(ctx.destination);

      this.master = master;
      this.delaySend = send;

      const len = Math.floor(ctx.sampleRate * 1.0);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuf = buf;
    } catch {
      // safe fallback on audio graph build errors
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      try {
        this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
      } catch {
        /* noop */
      }
    }
  }

  playPad(voice: Voice, midi: number, gain = 0.8, durationMs = 240): void {
    if (!this.ctx || !this.master) {
      void this.unlock().then((ok) => {
        if (ok) this.renderVoice(voice, midi, gain, durationMs);
      });
      return;
    }
    this.renderVoice(voice, midi, gain, durationMs);
  }

  previewPad(voice: Voice, midi = 0): void {
    this.playPad(voice, midi, 0.85, 240);
  }

  private renderVoice(voice: Voice, midi: number, vel: number, durationMs: number): void {
    if (!this.ctx || !this.master) return;

    try {
      const ctx = this.ctx;
      const out = this.master;
      const t = ctx.currentTime + 0.005;
      const dur = Math.max(0.06, durationMs / 1000);
      const freq = midi > 0 ? midiToFreq(midi) : 440;

      const env = (peak: number, attack: number, decay: number, hold = 0) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + attack);
        if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
        return g;
      };

      const osc = (
        type: OscillatorType,
        f: number,
        stopTime: number,
        detune = 0
      ) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        o.detune.value = detune;
        o.start(t);
        o.stop(stopTime);
        return o;
      };

      const noise = (stopTime: number) => {
        if (!this.noiseBuf) return null;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        src.start(t);
        src.stop(stopTime);
        return src;
      };

      switch (voice) {
        case 'kick': {
          const o = osc('sine', 160, t + 0.38);
          o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
          const g = env(1.15 * vel, 0.003, 0.28);
          o.connect(g);
          g.connect(out);
          break;
        }
        case 'snare': {
          const n = noise(t + 0.28);
          if (n) {
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 1900;
            bp.Q.value = 0.8;
            const g = env(0.55 * vel, 0.002, 0.16);
            n.connect(bp);
            bp.connect(g);
            g.connect(out);
          }
          const body = osc('triangle', 185, t + 0.18);
          const bg = env(0.32 * vel, 0.002, 0.09);
          body.connect(bg);
          bg.connect(out);
          break;
        }
        case 'hat': {
          const n = noise(t + 0.12);
          if (n) {
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 7500;
            const g = env(0.28 * vel, 0.001, 0.055);
            n.connect(hp);
            hp.connect(g);
            g.connect(out);
          }
          break;
        }
        case 'clap': {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 1300;
          bp.Q.value = 1.1;
          const g = env(0.5 * vel, 0.001, 0.14);
          bp.connect(g);
          g.connect(out);

          const n = noise(t + 0.22);
          if (n) {
            n.connect(bp);
            for (const off of [0, 0.012, 0.024]) {
              const gg = ctx.createGain();
              gg.gain.setValueAtTime(0.0001, t + off);
              gg.gain.linearRampToValueAtTime(vel * 0.45, t + off + 0.001);
              gg.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.05);
              n.connect(gg);
              gg.connect(out);
            }
          }
          break;
        }
        case 'bass': {
          const stop = t + dur + 0.25;
          const o = osc('sawtooth', freq, stop);
          const sub = osc('sine', freq / 2, stop);
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(1200, t);
          lp.frequency.exponentialRampToValueAtTime(260, t + Math.min(0.3, dur));
          lp.Q.value = 5;
          const g = env(0.45 * vel, 0.006, 0.18, dur * 0.7);
          o.connect(lp);
          sub.connect(lp);
          lp.connect(g);
          g.connect(out);
          break;
        }
        case 'lead':
        case 'pluck': {
          const stop = t + dur + 0.4;
          const g = env(0.28 * vel, voice === 'pluck' ? 0.004 : 0.02, voice === 'pluck' ? 0.22 : 0.3, dur * 0.5);
          for (const [type, det] of [
            ['square', -6],
            ['triangle', 7],
          ] as [OscillatorType, number][]) {
            const o = osc(type, freq, stop, det);
            o.connect(g);
          }
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 4000;
          g.connect(lp);
          lp.connect(out);
          if (this.delaySend) lp.connect(this.delaySend);
          break;
        }
        case 'pad': {
          const stop = t + dur + 0.6;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.14 * vel, t + Math.min(0.25, dur * 0.4));
          g.gain.setValueAtTime(0.14 * vel, t + dur * 0.8);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 1600;
          for (const det of [-8, 8]) {
            const o = osc('sawtooth', freq, stop, det);
            o.connect(lp);
          }
          lp.connect(g);
          g.connect(out);
          break;
        }
        case 'bell': {
          const stop = t + 1.2;
          const g = env(0.22 * vel, 0.004, 1.0);
          for (const mult of [1, 2.01, 3.02]) {
            const o = osc('sine', freq * mult, stop);
            const pg = ctx.createGain();
            pg.gain.value = 1 / mult;
            o.connect(pg);
            pg.connect(g);
          }
          g.connect(out);
          if (this.delaySend) g.connect(this.delaySend);
          break;
        }
        case 'stab': {
          const stop = t + dur + 0.3;
          const g = env(0.18 * vel, 0.006, 0.22, dur * 0.6);
          for (const iv of [0, 3, 7]) {
            const o = osc('sawtooth', freq * Math.pow(2, iv / 12), stop);
            o.connect(g);
          }
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 2600;
          g.connect(lp);
          lp.connect(out);
          if (this.delaySend) lp.connect(this.delaySend);
          break;
        }
      }
    } catch {
      // Safe fallback on render
    }
  }
}

let audioSingleton: JamAudio | null = null;

export function getAudio(): JamAudio {
  if (!audioSingleton) {
    audioSingleton = new JamAudio();
  }
  return audioSingleton;
}

