"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GameSfx = "ui" | "door" | "lockpick" | "lockBreak" | "loot" | "shoot" | "enemyNormal" | "enemyDamaged" | "enemyAttack" | "enemyAggro" | "equip";
export type MusicMode = "menu" | "ambient";

export function useGameAudio() {
  const context = useRef<AudioContext | null>(null);
  const musicBus = useRef<GainNode | null>(null);
  const sfxBus = useRef<GainNode | null>(null);
  const musicNodes = useRef<AudioScheduledSourceNode[]>([]);
  const musicTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mode = useRef<MusicMode>("menu");
  const musicOnRef = useRef(true);
  const sfxOnRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);

  const makeNoise = useCallback((ctx: AudioContext, seconds = 1) => {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }, []);

  const stopMusic = useCallback(() => {
    if (musicTimer.current) clearInterval(musicTimer.current);
    musicTimer.current = null;
    musicNodes.current.forEach((node) => { try { node.stop(); } catch { /* already stopped */ } });
    musicNodes.current = [];
  }, []);

  const note = useCallback((ctx: AudioContext, destination: AudioNode, frequency: number, duration: number, volume: number, wave: OscillatorType = "triangle", delay = 0) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + delay;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }, []);

  const startMusic = useCallback((nextMode: MusicMode) => {
    const ctx = context.current;
    const bus = musicBus.current;
    if (!ctx || !bus) return;
    stopMusic();
    mode.current = nextMode;

    const drone = (frequency: number, type: OscillatorType, gainValue: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.value = gainValue;
      filter.type = "lowpass";
      filter.frequency.value = nextMode === "menu" ? 520 : 310;
      oscillator.connect(filter).connect(gain).connect(bus);
      oscillator.start();
      musicNodes.current.push(oscillator);
    };

    drone(nextMode === "menu" ? 55 : 43.65, "sawtooth", nextMode === "menu" ? 0.035 : 0.023);
    drone(nextMode === "menu" ? 82.41 : 65.41, "sine", nextMode === "menu" ? 0.05 : 0.035);

    const wind = ctx.createBufferSource();
    const windFilter = ctx.createBiquadFilter();
    const windGain = ctx.createGain();
    wind.buffer = makeNoise(ctx, 2);
    wind.loop = true;
    windFilter.type = "bandpass";
    windFilter.frequency.value = nextMode === "menu" ? 180 : 260;
    windFilter.Q.value = 0.55;
    windGain.gain.value = nextMode === "menu" ? 0.009 : 0.02;
    wind.connect(windFilter).connect(windGain).connect(bus);
    wind.start();
    musicNodes.current.push(wind);

    const sequence = nextMode === "menu" ? [110, 130.81, 164.81, 98, 123.47] : [87.31, 65.41, 73.42, 55, 82.41];
    let step = 0;
    const playStep = () => {
      const root = sequence[step++ % sequence.length];
      note(ctx, bus, root, nextMode === "menu" ? 1.7 : 3.8, nextMode === "menu" ? 0.045 : 0.026, "triangle");
      if (nextMode === "menu" && step % 2 === 0) note(ctx, bus, root * 1.5, 1.1, 0.018, "sine", 0.2);
    };
    playStep();
    musicTimer.current = setInterval(playStep, nextMode === "menu" ? 1900 : 5200);
  }, [makeNoise, note, stopMusic]);

  const activate = useCallback(async (nextMode: MusicMode = mode.current) => {
    if (!context.current) {
      const ctx = new window.AudioContext();
      const master = ctx.createGain();
      const music = ctx.createGain();
      const sfx = ctx.createGain();
      master.gain.value = 0.72;
      music.gain.value = musicOnRef.current ? 0.42 : 0.0001;
      sfx.gain.value = sfxOnRef.current ? 0.62 : 0.0001;
      music.connect(master); sfx.connect(master); master.connect(ctx.destination);
      context.current = ctx; musicBus.current = music; sfxBus.current = sfx;
      setReady(true);
    }
    await context.current.resume();
    startMusic(nextMode);
  }, [startMusic]);

  const setMusic = useCallback((nextMode: MusicMode) => {
    mode.current = nextMode;
    if (context.current) startMusic(nextMode);
  }, [startMusic]);

  const noiseBurst = useCallback((ctx: AudioContext, destination: AudioNode, duration: number, volume: number, cutoff: number) => {
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = makeNoise(ctx, Math.max(duration, 0.08));
    filter.type = "lowpass"; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(); source.stop(ctx.currentTime + duration + 0.02);
  }, [makeNoise]);

  const play = useCallback((sound: GameSfx) => {
    const ctx = context.current;
    const bus = sfxBus.current;
    if (!ctx || !bus || !sfxOnRef.current) return;
    const sweep = (from: number, to: number, duration: number, volume: number, wave: OscillatorType = "square", delay = 0) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + delay;
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(from, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(bus);
      oscillator.start(start); oscillator.stop(start + duration + 0.02);
    };
    if (sound === "ui") sweep(620, 390, 0.055, 0.045, "square");
    if (sound === "door") { noiseBurst(ctx, bus, 0.42, 0.22, 420); sweep(105, 48, 0.5, 0.14, "sawtooth"); }
    if (sound === "lockpick") { sweep(1500, 980, 0.09, 0.065, "triangle"); sweep(2100, 1250, 0.06, 0.035, "square", 0.11); }
    if (sound === "lockBreak") { sweep(2400, 310, 0.2, 0.12, "square"); noiseBurst(ctx, bus, 0.16, 0.11, 2600); }
    if (sound === "loot") { sweep(560, 920, 0.16, 0.07, "triangle"); sweep(780, 1240, 0.18, 0.055, "sine", 0.11); }
    if (sound === "shoot") { noiseBurst(ctx, bus, 0.2, 0.5, 4200); sweep(115, 44, 0.28, 0.24, "square"); }
    if (sound === "enemyNormal") sweep(175, 130, 0.26, 0.08, "sawtooth");
    if (sound === "enemyDamaged") { sweep(390, 105, 0.32, 0.16, "sawtooth"); noiseBurst(ctx, bus, 0.13, 0.08, 1600); }
    if (sound === "enemyAttack") { sweep(145, 260, 0.24, 0.15, "sawtooth"); noiseBurst(ctx, bus, 0.12, 0.1, 1900); }
    if (sound === "enemyAggro") { sweep(92, 280, 0.55, 0.14, "sawtooth"); sweep(170, 125, 0.42, 0.07, "square", 0.2); }
    if (sound === "equip") { sweep(360, 510, 0.1, 0.075, "triangle"); noiseBurst(ctx, bus, 0.09, 0.055, 1200); sweep(820, 640, 0.08, 0.04, "square", 0.1); }
  }, [noiseBurst]);

  const toggleMusic = useCallback(() => {
    const next = !musicOnRef.current;
    musicOnRef.current = next; setMusicOn(next);
    const ctx = context.current; const gain = musicBus.current;
    if (ctx && gain) gain.gain.exponentialRampToValueAtTime(next ? 0.42 : 0.0001, ctx.currentTime + 0.18);
  }, []);

  const toggleSfx = useCallback(() => {
    const next = !sfxOnRef.current;
    sfxOnRef.current = next; setSfxOn(next);
    const ctx = context.current; const gain = sfxBus.current;
    if (ctx && gain) gain.gain.exponentialRampToValueAtTime(next ? 0.62 : 0.0001, ctx.currentTime + 0.08);
  }, []);

  useEffect(() => () => {
    stopMusic();
    void context.current?.close();
  }, [stopMusic]);

  return { ready, musicOn, sfxOn, activate, setMusic, play, toggleMusic, toggleSfx };
}
