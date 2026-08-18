"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GameSfx = "ui" | "door" | "lockpick" | "lockBreak" | "loot" | "shoot" | "shootPistol" | "shootRifle" | "shootShotgun" | "enemyNormal" | "enemyDamaged" | "enemyAttack" | "enemyAggro" | "equip" | "slotSpin" | "slotWin" | "slotLose" | "slotJackpot";
export type MusicMode = "menu" | "ambient" | "combat" | "dialogue" | "interior";
type MusicManifest = { tracks: Record<MusicMode, string[]> };

const emptyManifest: MusicManifest = { tracks: { menu: [], ambient: [], combat: [], dialogue: [], interior: [] } };

export function useGameAudio() {
  const context = useRef<AudioContext | null>(null);
  const sfxBus = useRef<GainNode | null>(null);
  const musicElement = useRef<HTMLAudioElement | null>(null);
  const musicManifest = useRef<MusicManifest | null>(null);
  const musicRequest = useRef(0);
  const mode = useRef<MusicMode>("menu");
  const playingMode = useRef<MusicMode | null>(null);
  const lastTrack = useRef<string | null>(null);
  const musicOnRef = useRef(true);
  const sfxOnRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicStatus, setMusicStatus] = useState("Soundtrack not started");

  const makeNoise = useCallback((ctx: AudioContext, seconds = 1) => {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }, []);

  const loadManifest = useCallback(async () => {
    if (musicManifest.current) return musicManifest.current;
    try {
      const response = await fetch("/music/manifest.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Music manifest unavailable");
      const manifest = await response.json() as MusicManifest;
      musicManifest.current = manifest;
    } catch {
      musicManifest.current = emptyManifest;
    }
    return musicManifest.current;
  }, []);

  const stopMusicElement = useCallback(() => {
    const audio = musicElement.current;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    musicElement.current = null;
    playingMode.current = null;
  }, []);

  const startMusic = useCallback(async (nextMode: MusicMode) => {
    mode.current = nextMode;
    const request = ++musicRequest.current;
    stopMusicElement();
    const manifest = await loadManifest();
    if (request !== musicRequest.current) return;
    const exactTracks = manifest.tracks[nextMode] || [];
    const tracks = exactTracks.length ? exactTracks : nextMode !== "ambient" ? manifest.tracks.ambient || [] : [];
    if (!tracks.length) {
      setMusicStatus(`No ${nextMode} tracks found`);
      return;
    }
    const choices = tracks.length > 1 ? tracks.filter((track) => track !== lastTrack.current) : tracks;
    const track = choices[Math.floor(Math.random() * choices.length)] || tracks[0];
    const audio = new Audio(track);
    audio.preload = "auto";
    audio.volume = 0.38;
    musicElement.current = audio;
    playingMode.current = nextMode;
    lastTrack.current = track;
    const filename = decodeURIComponent(track.split("/").pop() || track).replace(/\.[^.]+$/, "");
    setMusicStatus(`${nextMode.toUpperCase()} · ${filename}`);
    audio.onended = () => {
      if (request === musicRequest.current && mode.current === nextMode) void startMusic(nextMode);
    };
    audio.onerror = () => {
      if (request === musicRequest.current) {
        setMusicStatus(`Could not play ${filename}`);
        window.setTimeout(() => { if (mode.current === nextMode) void startMusic(nextMode); }, 500);
      }
    };
    if (musicOnRef.current) {
      try { await audio.play(); }
      catch { setMusicStatus(`${nextMode.toUpperCase()} ready · press MUSIC ON`); }
    }
  }, [loadManifest, stopMusicElement]);

  const activate = useCallback(async (nextMode: MusicMode = mode.current) => {
    if (!context.current) {
      const ctx = new window.AudioContext();
      const master = ctx.createGain();
      const sfx = ctx.createGain();
      master.gain.value = 0.72;
      sfx.gain.value = sfxOnRef.current ? 0.62 : 0.0001;
      sfx.connect(master); master.connect(ctx.destination);
      context.current = ctx; sfxBus.current = sfx;
      setReady(true);
    }
    if (context.current.state !== "running") void context.current.resume().catch(() => undefined);
    const currentTrack = musicElement.current;
    if (playingMode.current === nextMode && currentTrack) {
      if (musicOnRef.current && currentTrack.paused) {
        try { await currentTrack.play(); }
        catch { setMusicStatus(`${nextMode.toUpperCase()} ready · interact to begin`); }
      }
      return;
    }
    await startMusic(nextMode);
  }, [startMusic]);

  const setMusic = useCallback((nextMode: MusicMode) => {
    mode.current = nextMode;
    if (context.current && playingMode.current !== nextMode) void startMusic(nextMode);
  }, [startMusic]);

  const noiseBurst = useCallback((ctx: AudioContext, destination: AudioNode, duration: number, volume: number, cutoff: number, delay = 0) => {
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const start = ctx.currentTime + delay;
    source.buffer = makeNoise(ctx, Math.max(duration, 0.08));
    filter.type = "lowpass"; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(start); source.stop(start + duration + 0.02);
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
    if (sound === "shoot" || sound === "shootPistol") {
      noiseBurst(ctx, bus, 0.13, 0.58, 6200);
      noiseBurst(ctx, bus, 0.24, 0.16, 1500, .025);
      sweep(185, 58, 0.22, 0.25, "square");
      sweep(940, 310, 0.07, 0.07, "triangle", .018);
    }
    if (sound === "shootRifle") {
      noiseBurst(ctx, bus, 0.11, 0.7, 7600);
      noiseBurst(ctx, bus, 0.34, 0.2, 2100, .018);
      sweep(255, 52, 0.3, 0.29, "sawtooth");
      sweep(1380, 480, 0.055, 0.09, "square", .012);
      noiseBurst(ctx, bus, .16, .08, 3200, .2);
    }
    if (sound === "shootShotgun") {
      noiseBurst(ctx, bus, 0.22, 0.88, 4800);
      noiseBurst(ctx, bus, 0.48, 0.34, 900, .018);
      sweep(125, 34, 0.46, 0.42, "sawtooth");
      sweep(72, 28, 0.38, 0.26, "square", .045);
      noiseBurst(ctx, bus, .24, .1, 1800, .3);
    }
    if (sound === "enemyNormal") sweep(175, 130, 0.26, 0.08, "sawtooth");
    if (sound === "enemyDamaged") { sweep(390, 105, 0.32, 0.16, "sawtooth"); noiseBurst(ctx, bus, 0.13, 0.08, 1600); }
    if (sound === "enemyAttack") { sweep(145, 260, 0.24, 0.15, "sawtooth"); noiseBurst(ctx, bus, 0.12, 0.1, 1900); }
    if (sound === "enemyAggro") { sweep(92, 280, 0.55, 0.14, "sawtooth"); sweep(170, 125, 0.42, 0.07, "square", 0.2); }
    if (sound === "equip") { sweep(360, 510, 0.1, 0.075, "triangle"); noiseBurst(ctx, bus, 0.09, 0.055, 1200); sweep(820, 640, 0.08, 0.04, "square", 0.1); }
    if (sound === "slotSpin") {
      for (let tick = 0; tick < 9; tick++) {
        sweep(880 + tick * 22, 610 + tick * 17, .045, .055, "square", tick * .09);
        noiseBurst(ctx, bus, .025, .028, 2600, tick * .09);
      }
    }
    if (sound === "slotWin") {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => sweep(frequency, frequency * 1.015, .24, .075, "triangle", index * .11));
      sweep(1318.5, 1568, .42, .07, "sine", .48);
    }
    if (sound === "slotJackpot") {
      [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((frequency, index) => {
        sweep(frequency, frequency * 1.03, .36, .105, index % 2 ? "triangle" : "sine", index * .09);
        sweep(frequency * 2, frequency * 2.02, .18, .035, "square", index * .09 + .025);
      });
      for (let coin = 0; coin < 13; coin++) {
        const delay = .52 + coin * .045;
        sweep(1680 + (coin % 4) * 210, 1180 + (coin % 5) * 120, .075, .045, "triangle", delay);
        noiseBurst(ctx, bus, .035, .025, 4200, delay);
      }
      sweep(196, 784, .78, .13, "sawtooth", .42);
    }
    if (sound === "slotLose") {
      sweep(330, 220, .22, .07, "square");
      sweep(247, 155, .32, .065, "sawtooth", .18);
      noiseBurst(ctx, bus, .18, .035, 700, .28);
    }
  }, [noiseBurst]);

  const toggleMusic = useCallback(() => {
    const next = !musicOnRef.current;
    musicOnRef.current = next; setMusicOn(next);
    const audio = musicElement.current;
    if (!next) {
      audio?.pause();
      setMusicStatus("Music paused");
    } else if (audio) {
      void audio.play().catch(() => setMusicStatus("Press MUSIC ON again to resume"));
    } else if (context.current) void startMusic(mode.current);
  }, [startMusic]);

  const toggleSfx = useCallback(() => {
    const next = !sfxOnRef.current;
    sfxOnRef.current = next; setSfxOn(next);
    const ctx = context.current; const gain = sfxBus.current;
    if (ctx && gain) gain.gain.exponentialRampToValueAtTime(next ? 0.62 : 0.0001, ctx.currentTime + 0.08);
  }, []);

  useEffect(() => () => {
    musicRequest.current += 1;
    stopMusicElement();
    void context.current?.close();
  }, [stopMusicElement]);

  return { ready, musicOn, sfxOn, musicStatus, activate, setMusic, play, toggleMusic, toggleSfx };
}
