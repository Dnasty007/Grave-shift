import type { Settings, SettingsState } from "./Settings";
import { GAME_CONFIG } from "./config";
import { HYTOPIA } from "./hytopiaContent";

type SfxName =
  | "shot"
  | "shotgunShot"
  | "smgShot"
  | "rifleShot"
  | "magnumShot"
  | "impact"
  | "kill"
  | "headshot"
  | "playerHit"
  | "reload"
  | "reloadDone"
  | "empty"
  | "waveStart"
  | "waveCleared"
  | "gameOver"
  | "uiClick"
  | "uiHover"
  | "weaponBuy"
  | "weaponRefill"
  | "weaponSwap"
  | "doorOpen"
  | "rejected"
  | "maxAmmo";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private droneNode: { osc: OscillatorNode; gain: GainNode } | null = null;
  private heartbeatTimer: number | null = null;
  private current: SettingsState;
  /** Easter-egg reward song: at most one start per run (see {@link resetTeddyEasterEggAudioState}). */
  private teddyRewardSongStartedThisRun = false;
  private teddyRewardSource: AudioBufferSourceNode | null = null;

  /** Decoded from {@link HYTOPIA.footstepManifest} (or legacy fallback). */
  private footstepBuffers: AudioBuffer[] = [];
  private footstepLoadStarted = false;

  /** UI click sample (see {@link GAME_CONFIG.audio.uiClickUrl}). */
  private uiClickBuffer: AudioBuffer | null = null;
  /**
   * Title / pause / game-over bed: {@link HTMLAudioElement} so the track can start on load without
   * waiting for Web Audio unlock (menu overlay clicks never hit the canvas `pointerdown` listener).
   */
  private readonly menuHtmlAudio: HTMLAudioElement;
  private uiAndMenuLoadStarted = false;
  /** When true, start the menu loop as soon as the buffer and context exist. */
  private menuMusicRequested = false;
  /** Last argument passed to {@link setDroneIntensity} (used when menu music ducks the drone off). */
  private lastDroneIntensityArg = 0;
  /** Decoded sample for critical heartbeat; synth fallback if missing. */
  private lowHealthHeartbeatBuffer: AudioBuffer | null = null;
  private lowHealthHeartbeatDuration = 0;
  /** Latest health ratio passed to {@link setHeartbeatRate} (drives sample vs synth). */
  private heartbeatHealthRatio = 1;
  /** Decoded hellhound wave intro sample. */
  private hellhoundWaveIntroBuffer: AudioBuffer | null = null;

  /**
   * True after {@link unlock} has created master/sfx/music gains and connected to destination.
   * Decode-only prefetch may create {@link ctx} earlier without wiring the graph.
   */
  private audioGraphWired = false;

  constructor(settings: Settings) {
    const menuUrl = GAME_CONFIG.audio.menuMusicUrl;
    this.menuHtmlAudio = new Audio(menuUrl);
    this.menuHtmlAudio.loop = true;
    this.menuHtmlAudio.preload = "auto";
    this.menuHtmlAudio.setAttribute("playsinline", "");

    this.current = settings.get();
    settings.subscribe((next) => {
      this.current = next;
      this.applyVolumes();
    });
    this.applyMenuHtmlVolume();
  }

  /**
   * Start fetching/decoding menu + UI samples as soon as the page loads (suspended `AudioContext`).
   * Browsers allow decode before the first user gesture; {@link unlock} resumes playback and wires the graph.
   * Call from `GameApp` right after construction so Ghost Stories is ready when the title screen appears.
   */
  prefetchMenuAndUiSamples(): void {
    this.ensureDecodeContext();
    if (!this.ctx) {
      return;
    }
    this.beginUiAndMenuSampleLoad();
  }

  private ensureDecodeContext(): void {
    if (this.ctx) {
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      return;
    }
    try {
      this.ctx = new Ctor();
    } catch {
      /* Some environments block context until a gesture */
    }
  }

  /** First user gesture: resume context, wire output graph if needed, attach menu loop when buffers exist. */
  unlock(): void {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!Ctor) {
      return;
    }

    if (!this.ctx) {
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
    }

    if (!this.audioGraphWired) {
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();

      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.audioGraphWired = true;
      this.applyVolumes();
      this.startDrone();
      this.applyDroneGain();
      this.beginFootstepSampleLoad();
    }

    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    this.beginUiAndMenuSampleLoad();
    this.playMenuHtmlIfRequested();
    this.rescheduleHeartbeatIfActive();
  }

  /**
   * One-shot footstep from Hytopia stone sample. No-op until {@link unlock} has run and the buffer decoded.
   */
  playFootstep(sprinting: boolean): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    const buffers = this.footstepBuffers;
    if (!ctx || !sfx) {
      return;
    }
    if (buffers.length === 0) {
      this.playSyntheticFootstep(sprinting);
      return;
    }

    const buf = buffers[(Math.random() * buffers.length) >>> 0];
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const pace = sprinting ? 1.07 : 0.99;
    src.playbackRate.value = pace * (0.93 + Math.random() * 0.14);

    const g = ctx.createGain();
    g.gain.setValueAtTime(sprinting ? 0.42 : 0.34, now);

    src.connect(g).connect(sfx);
    src.start(now);
  }

  private beginFootstepSampleLoad(): void {
    if (!this.ctx || this.footstepLoadStarted) {
      return;
    }
    this.footstepLoadStarted = true;
    void this.loadFootstepBuffers();
  }

  private async loadFootstepBuffers(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    const urls: string[] = [];
    try {
      const r = await fetch(HYTOPIA.footstepManifest);
      if (r.ok) {
        const data: unknown = await r.json();
        if (Array.isArray(data)) {
          for (const u of data) {
            if (typeof u === "string" && u.trim()) urls.push(u.trim());
          }
        }
      }
    } catch {
      /* optional manifest */
    }
    if (urls.length === 0) {
      urls.push("/audio/footsteps/stone-step-04.mp3");
    }

    const buffers: AudioBuffer[] = [];
    await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const ab = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(ab.slice(0));
          buffers.push(buf);
        } catch {
          /* skip bad URL */
        }
      })
    );
    this.footstepBuffers = buffers;
    if (buffers.length === 0) {
      console.warn(
        "[AudioEngine] No footstep samples loaded; using synthetic steps. Add MP3s under public/ or fix manifest:",
        urls
      );
    }
  }

  /** Short band-limited thud when no footstep buffers are available (missing assets / fetch blocked). */
  private playSyntheticFootstep(sprinting: boolean): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;
    const now = ctx.currentTime;
    const dur = sprinting ? 0.045 : 0.055;
    const peak = sprinting ? 0.2 : 0.16;
    const noise = this.createNoise(dur + 0.02);
    const hp = ctx.createBiquadFilter();
    const lp = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    hp.type = "highpass";
    hp.frequency.value = 90;
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(sprinting ? 2200 : 1800, now);
    lp.frequency.exponentialRampToValueAtTime(400, now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(hp).connect(lp).connect(gain).connect(sfx);
    noise.start(now);
    noise.stop(now + dur + 0.03);
  }

  private beginUiAndMenuSampleLoad(): void {
    if (!this.ctx || this.uiAndMenuLoadStarted) {
      return;
    }
    this.uiAndMenuLoadStarted = true;
    void this.loadUiAndMenuSamples();
  }

  private async loadUiAndMenuSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    const { uiClickUrl, lowHealthHeartbeatUrl } = GAME_CONFIG.audio;
    const hound = GAME_CONFIG.hellhoundWave;

    const decodeUrl = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        return await ctx.decodeAudioData(ab.slice(0));
      } catch {
        return null;
      }
    };

    const [uiBuf, lowBuf, houndBuf] = await Promise.all([
      decodeUrl(uiClickUrl),
      decodeUrl(lowHealthHeartbeatUrl),
      hound.enabled ? decodeUrl(hound.introSoundUrl) : Promise.resolve(null)
    ]);

    this.uiClickBuffer = uiBuf;
    if (!this.uiClickBuffer) {
      console.warn("[AudioEngine] UI click sample missing or failed:", uiClickUrl);
    }

    this.lowHealthHeartbeatBuffer = lowBuf;
    this.lowHealthHeartbeatDuration = lowBuf ? lowBuf.duration : 0;
    if (!this.lowHealthHeartbeatBuffer) {
      console.warn("[AudioEngine] Low-health heartbeat sample missing or failed:", lowHealthHeartbeatUrl);
    }

    if (hound.enabled) {
      this.hellhoundWaveIntroBuffer = houndBuf;
      if (!this.hellhoundWaveIntroBuffer) {
        console.warn("[AudioEngine] Hellhound intro missing or failed:", hound.introSoundUrl);
      }
    }

    this.playMenuHtmlIfRequested();
    this.rescheduleHeartbeatIfActive();
  }

  /** Rebuild heartbeat interval after async buffers arrive (e.g. low-health MP3 decoded). */
  private rescheduleHeartbeatIfActive(): void {
    if (!this.ctx || !this.sfxGain) return;
    if (this.heartbeatTimer === null || this.heartbeatIntensity <= 0.01) {
      return;
    }
    const hr = this.heartbeatHealthRatio;
    const clamped = this.heartbeatIntensity;
    const thr = GAME_CONFIG.audio.lowHealthHeartbeatThreshold;
    const useSample = this.lowHealthHeartbeatBuffer !== null && hr <= thr + 1e-5;

    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;

    let interval = Math.max(280, 1100 - 600 * clamped);
    if (useSample && this.lowHealthHeartbeatDuration > 0) {
      interval = Math.max(
        interval,
        Math.ceil(this.lowHealthHeartbeatDuration * 1000 * 0.92),
        GAME_CONFIG.audio.lowHealthHeartbeatMinIntervalMs
      );
    }

    this.playHeartbeat(clamped);
    this.heartbeatTimer = window.setInterval(() => {
      this.playHeartbeat(this.heartbeatIntensity);
    }, interval);
  }

  /** Loops {@link GAME_CONFIG.audio.menuMusicUrl} via {@link menuHtmlAudio} (no Web Audio unlock required). */
  startMenuMusicLoop(): void {
    this.menuMusicRequested = true;
    this.applyMenuHtmlVolume();
    void this.menuHtmlAudio.play().catch(() => {
      /* autoplay policy — {@link unlock} or any gesture retries via {@link playMenuHtmlIfRequested} */
    });
    this.applyDroneGain();
  }

  stopMenuMusicLoop(): void {
    this.menuMusicRequested = false;
    this.menuHtmlAudio.pause();
    this.menuHtmlAudio.currentTime = 0;
    this.applyDroneGain();
  }

  private playMenuHtmlIfRequested(): void {
    if (!this.menuMusicRequested) {
      return;
    }
    this.applyMenuHtmlVolume();
    void this.menuHtmlAudio.play().catch(() => {});
  }

  private applyMenuHtmlVolume(): void {
    const g = GAME_CONFIG.audio.menuMusicGain;
    const v = this.current.masterVolume * this.current.musicVolume * g;
    this.menuHtmlAudio.volume = Math.max(0, Math.min(1, v));
  }

  /** Sting when a hellhound (wolf) wave starts; falls back to `waveStart` if the sample is missing. */
  playHellhoundWaveIntro(): void {
    if (!GAME_CONFIG.hellhoundWave.enabled) {
      return;
    }
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    const buf = this.hellhoundWaveIntroBuffer;
    if (!ctx || !sfx) {
      return;
    }
    if (buf) {
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(GAME_CONFIG.hellhoundWave.introSoundGain, now);
      src.connect(g).connect(sfx);
      src.start(now);
      return;
    }
    this.play("waveStart");
  }

  play(name: SfxName): void {
    if (!this.ctx || !this.sfxGain) {
      return;
    }

    switch (name) {
      case "shot":
        this.playShot(2400, 360, 0.16, 0.9, 140, 45);
        break;
      case "shotgunShot":
        this.playShot(1600, 220, 0.32, 1.1, 90, 36);
        break;
      case "smgShot":
        this.playShot(2800, 480, 0.09, 0.7, 150, 60);
        break;
      case "rifleShot":
        this.playShot(2200, 280, 0.28, 1.0, 80, 28);
        break;
      case "magnumShot":
        this.playShot(1700, 220, 0.36, 1.2, 70, 24);
        break;
      case "impact":
        this.playImpact();
        break;
      case "kill":
        this.playKill();
        break;
      case "headshot":
        this.playHeadshot();
        break;
      case "playerHit":
        this.playPlayerHit();
        break;
      case "reload":
        this.playReload();
        break;
      case "reloadDone":
        this.playReloadDone();
        break;
      case "empty":
        this.playEmpty();
        break;
      case "waveStart":
        this.playWaveStart();
        break;
      case "waveCleared":
        this.playWaveCleared();
        break;
      case "gameOver":
        this.playGameOver();
        break;
      case "uiClick":
        this.playUiClick();
        break;
      case "uiHover":
        this.playUiHover();
        break;
      case "weaponBuy":
        this.playWeaponBuy();
        break;
      case "weaponRefill":
        this.playWeaponRefill();
        break;
      case "weaponSwap":
        this.playWeaponSwap();
        break;
      case "doorOpen":
        this.playDoorOpen();
        break;
      case "rejected":
        this.playRejected();
        break;
      case "maxAmmo":
        this.playMaxAmmo();
        break;
    }
  }

  private heartbeatIntensity = 0;

  setHeartbeatRate(intensity: number, healthRatio?: number): void {
    if (!this.ctx || !this.sfxGain) {
      return;
    }

    const clamped = Math.max(0, Math.min(1, intensity));
    const hr =
      healthRatio !== undefined
        ? Math.max(0, Math.min(1, healthRatio))
        : clamped <= 0.01
          ? 1
          : (1 - clamped) * 0.45;

    if (clamped <= 0.01) {
      this.stopHeartbeat();
      this.heartbeatIntensity = 0;
      this.heartbeatHealthRatio = hr;
      return;
    }

    const thr = GAME_CONFIG.audio.lowHealthHeartbeatThreshold;
    const useSample = this.lowHealthHeartbeatBuffer !== null && hr <= thr + 1e-5;
    const wasSample =
      this.lowHealthHeartbeatBuffer !== null && this.heartbeatHealthRatio <= thr + 1e-5;

    if (
      Math.abs(clamped - this.heartbeatIntensity) < 0.05 &&
      this.heartbeatTimer !== null &&
      useSample === wasSample &&
      Math.abs(hr - this.heartbeatHealthRatio) < 0.004
    ) {
      this.heartbeatHealthRatio = hr;
      return;
    }

    this.heartbeatHealthRatio = hr;
    this.heartbeatIntensity = clamped;

    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    let interval = Math.max(280, 1100 - 600 * clamped);
    if (useSample && this.lowHealthHeartbeatDuration > 0) {
      interval = Math.max(
        interval,
        Math.ceil(this.lowHealthHeartbeatDuration * 1000 * 0.92),
        GAME_CONFIG.audio.lowHealthHeartbeatMinIntervalMs
      );
    }

    this.playHeartbeat(clamped);
    this.heartbeatTimer = window.setInterval(() => {
      this.playHeartbeat(this.heartbeatIntensity);
    }, interval);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatHealthRatio = 1;
  }

  setDroneIntensity(intensity: number): void {
    this.lastDroneIntensityArg = intensity;
    this.applyDroneGain();
  }

  /** Ramp procedural drone; silenced while the HTML menu bed is requested (see {@link startMenuMusicLoop}). */
  private applyDroneGain(): void {
    if (!this.ctx || !this.droneNode) {
      return;
    }
    const target = Math.max(0, Math.min(0.18, 0.04 + this.lastDroneIntensityArg * 0.12));
    const menuDucks = this.menuMusicRequested;
    const out = menuDucks ? 0 : target;
    this.droneNode.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.droneNode.gain.gain.linearRampToValueAtTime(
      out,
      this.ctx.currentTime + 0.6
    );
  }

  private applyVolumes(): void {
    if (!this.masterGain || !this.sfxGain || !this.musicGain) {
      this.applyMenuHtmlVolume();
      return;
    }
    this.masterGain.gain.value = this.current.masterVolume;
    this.sfxGain.gain.value = this.current.sfxVolume;
    this.musicGain.gain.value = this.current.musicVolume;
    this.applyMenuHtmlVolume();
  }

  private startDrone(): void {
    if (!this.ctx || !this.musicGain) {
      return;
    }
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 48;
    gain.gain.value = 0.05;

    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.18;
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(osc.frequency);

    osc.connect(gain).connect(this.musicGain);
    osc.start();
    lfo.start();

    this.droneNode = { osc, gain };
  }

  private playShot(
    cutoffStart: number,
    cutoffEnd: number,
    duration: number,
    peak: number,
    thumpStart: number,
    thumpEnd: number
  ): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;

    const now = ctx.currentTime;
    const noise = this.createNoise(duration + 0.04);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoffStart, now);
    filter.frequency.exponentialRampToValueAtTime(cutoffEnd, now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter).connect(gain).connect(sfx);
    noise.start(now);
    noise.stop(now + duration + 0.04);

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(thumpStart, now);
    thump.frequency.exponentialRampToValueAtTime(thumpEnd, now + duration);
    thumpGain.gain.setValueAtTime(0.55, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.02);
    thump.connect(thumpGain).connect(sfx);
    thump.start(now);
    thump.stop(now + duration + 0.06);
  }

  private playWeaponBuy(): void {
    this.tone(440, 880, 0.16, "triangle", 0.22);
    window.setTimeout(() => this.tone(660, 1100, 0.1, "triangle", 0.18), 80);
  }

  private playWeaponRefill(): void {
    this.tone(360, 540, 0.18, "triangle", 0.18);
  }

  private playWeaponSwap(): void {
    this.tone(420, 280, 0.08, "triangle", 0.12);
  }

  private playDoorOpen(): void {
    this.tone(140, 60, 0.6, "sawtooth", 0.28);
    this.tone(220, 360, 0.4, "triangle", 0.16);
  }

  private playRejected(): void {
    this.tone(220, 110, 0.2, "square", 0.18);
  }

  private playImpact(): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;
    const now = ctx.currentTime;
    const noise = this.createNoise(0.07);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    noise.connect(filter).connect(gain).connect(sfx);
    noise.start(now);
    noise.stop(now + 0.08);
  }

  private playKill(): void {
    this.tone(180, 60, 0.22, "sawtooth", 0.3);
  }

  private playHeadshot(): void {
    this.tone(620, 240, 0.18, "square", 0.28);
  }

  private playPlayerHit(): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;
    const now = ctx.currentTime;
    const noise = this.createNoise(0.18);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    noise.connect(filter).connect(gain).connect(sfx);
    noise.start(now);
    noise.stop(now + 0.24);
  }

  private playReload(): void {
    this.tone(310, 270, 0.06, "triangle", 0.2);
    window.setTimeout(() => this.tone(220, 200, 0.05, "triangle", 0.18), 220);
  }

  private playReloadDone(): void {
    this.tone(540, 480, 0.07, "triangle", 0.18);
  }

  private playEmpty(): void {
    this.tone(120, 110, 0.05, "square", 0.18);
  }

  private playWaveStart(): void {
    this.tone(80, 40, 0.65, "sawtooth", 0.28);
  }

  private playWaveCleared(): void {
    this.tone(440, 660, 0.45, "triangle", 0.18);
  }

  // 3-note rising arpeggio — CoD Zombies Max Ammo jingle feel
  private playMaxAmmo(): void {
    this.tone(440, 520, 0.14, "triangle", 0.22);
    window.setTimeout(() => this.tone(550, 640, 0.12, "triangle", 0.22), 90);
    window.setTimeout(() => this.tone(660, 880, 0.22, "triangle", 0.26), 180);
  }

  private playGameOver(): void {
    this.tone(110, 35, 1.4, "sawtooth", 0.34);
  }

  private playUiClick(): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    const buf = this.uiClickBuffer;
    if (!ctx || !sfx) {
      return;
    }
    if (buf) {
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.82, now);
      src.connect(g).connect(sfx);
      src.start(now);
      return;
    }
    this.tone(660, 440, 0.06, "square", 0.12);
  }

  private playUiHover(): void {
    this.tone(380, 320, 0.04, "triangle", 0.08);
  }

  private playHeartbeat(intensity: number): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const buf = this.lowHealthHeartbeatBuffer;
    const thr = GAME_CONFIG.audio.lowHealthHeartbeatThreshold;
    if (buf && this.heartbeatHealthRatio <= thr + 1e-5) {
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      const peak = Math.min(1, (0.55 + intensity * 0.45) * 1.2);
      g.gain.setValueAtTime(peak, now);
      src.playbackRate.value = 0.9 + intensity * 0.22;
      src.connect(g).connect(sfx);
      src.start(now);
      return;
    }

    const now = ctx.currentTime;
    const peak = 0.18 + intensity * 0.4;

    const beat = (offset: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(80, now + offset);
      osc.frequency.exponentialRampToValueAtTime(40, now + offset + 0.16);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(peak, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      osc.connect(gain).connect(sfx);
      osc.start(now + offset);
      osc.stop(now + offset + 0.24);
    };

    beat(0);
    beat(0.18);
  }

  private tone(
    fromHz: number,
    toHz: number,
    duration: number,
    type: OscillatorType,
    peak: number
  ): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, now);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, toHz),
      now + duration
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(sfx);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  private createNoise(duration: number): AudioBufferSourceNode {
    const ctx = this.ctx;
    if (!ctx) {
      throw new Error("Audio context not ready");
    }
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    return node;
  }

  resetTeddyEasterEggAudioState(): void {
    this.teddyRewardSongStartedThisRun = false;
    this.stopTeddyEasterRewardSong();
  }

  stopTeddyEasterRewardSong(): void {
    if (this.teddyRewardSource) {
      try {
        this.teddyRewardSource.stop();
      } catch {
        /* already stopped */
      }
      try {
        this.teddyRewardSource.disconnect();
      } catch {
        /* */
      }
      this.teddyRewardSource = null;
    }
  }

  playTeddyBearHit(): void {
    if (!GAME_CONFIG.teddyBearEasterEgg.enabled) return;
    void this.playOneShotUrl(GAME_CONFIG.teddyBearEasterEgg.hitSoundUrl, 0.92, this.sfxGain);
  }

  playTeddyEasterRewardSong(): void {
    if (!GAME_CONFIG.teddyBearEasterEgg.enabled) return;
    if (this.teddyRewardSongStartedThisRun || this.teddyRewardSource) return;
    this.teddyRewardSongStartedThisRun = true;
    void this.startTeddyRewardSongFromUrl(GAME_CONFIG.teddyBearEasterEgg.rewardSongUrl);
  }

  private async playOneShotUrl(url: string, volume: number, dest: GainNode | null): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !dest) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const ab = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(dest);
      src.start();
    } catch {
      this.play("uiClick");
    }
  }

  private async startTeddyRewardSongFromUrl(url: string): Promise<void> {
    const ctx = this.ctx;
    const music = this.musicGain;
    if (!ctx || !music) return;
    this.stopTeddyEasterRewardSong();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const ab = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      src.connect(g).connect(music);
      this.teddyRewardSource = src;
      src.onended = () => {
        this.teddyRewardSource = null;
      };
      src.start();
    } catch {
      this.play("waveCleared");
    }
  }
}
