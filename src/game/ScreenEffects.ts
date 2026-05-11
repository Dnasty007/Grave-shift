import { GAME_CONFIG } from "./config";
import type { Settings, SettingsState } from "./Settings";

export class ScreenEffects {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly damageVignette: HTMLElement;
  private readonly lowHealthVignette: HTMLElement;
  private readonly hitMarker: HTMLElement;
  private readonly killPopupRoot: HTMLElement;
  private readonly waveBanner: HTMLElement;
  private readonly waveBannerLabel: HTMLElement;
  private readonly bloodOverlay: HTMLElement;
  private readonly settings: Settings;

  private shakeTime = 0;
  private shakeMagnitude = 0;
  private shakeDuration = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  private hitMarkerTimer = 0;
  private damageFlashTimer = 0;
  private bloodTimer = 0;
  private bannerTimer = 0;
  private current: SettingsState;
  private healthRatio = 1;

  constructor(
    canvas: HTMLCanvasElement,
    overlayRoot: HTMLElement,
    settings: Settings
  ) {
    this.canvas = canvas;
    this.container = overlayRoot;
    this.settings = settings;
    this.current = settings.get();

    settings.subscribe((next) => {
      this.current = next;
      if (!next.damageVignette) {
        this.damageVignette.style.opacity = "0";
        this.bloodOverlay.style.opacity = "0";
      }
    });

    const damageVignette = overlayRoot.querySelector<HTMLElement>("#damage-vignette");
    const lowHealthVignette = overlayRoot.querySelector<HTMLElement>("#low-health-vignette");
    const hitMarker = overlayRoot.querySelector<HTMLElement>("#hit-marker");
    const killPopupRoot = overlayRoot.querySelector<HTMLElement>("#kill-popups");
    const waveBanner = overlayRoot.querySelector<HTMLElement>("#wave-banner");
    const waveBannerLabel = overlayRoot.querySelector<HTMLElement>("#wave-banner-label");
    const bloodOverlay = overlayRoot.querySelector<HTMLElement>("#blood-overlay");

    if (
      !damageVignette ||
      !lowHealthVignette ||
      !hitMarker ||
      !killPopupRoot ||
      !waveBanner ||
      !waveBannerLabel ||
      !bloodOverlay
    ) {
      throw new Error("ScreenEffects: overlay elements missing.");
    }

    this.damageVignette = damageVignette;
    this.lowHealthVignette = lowHealthVignette;
    this.hitMarker = hitMarker;
    this.killPopupRoot = killPopupRoot;
    this.waveBanner = waveBanner;
    this.waveBannerLabel = waveBannerLabel;
    this.bloodOverlay = bloodOverlay;
  }

  update(dt: number): void {
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
    this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);
    this.bloodTimer = Math.max(0, this.bloodTimer - dt);
    this.bannerTimer = Math.max(0, this.bannerTimer - dt);

    this.applyShake();
    this.applyHitMarker();
    this.applyDamageVignette();
    this.applyLowHealth();
    this.applyBanner();
  }

  setHealthRatio(ratio: number): void {
    this.healthRatio = Math.max(0, Math.min(1, ratio));
  }

  triggerHitMarker(): void {
    if (!this.current.showHitMarker) return;
    this.hitMarkerTimer = 0.2;
    this.hitMarker.classList.remove("is-shown");
    void this.hitMarker.offsetWidth;
    this.hitMarker.classList.add("is-shown");
  }

  triggerKillPopup(points: number, headshot: boolean): void {
    const node = document.createElement("div");
    node.className = `kill-popup${headshot ? " is-headshot" : ""}`;
    node.textContent = headshot ? `+${points} HEAD` : `+${points}`;
    const offsetX = (Math.random() - 0.5) * 80;
    const offsetY = (Math.random() - 0.5) * 32;
    node.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
    this.killPopupRoot.appendChild(node);
    window.setTimeout(() => {
      node.remove();
    }, GAME_CONFIG.fx.killPopupSeconds * 1000);
  }

  triggerDamageFlash(direction?: { x: number; y: number }): void {
    if (!this.current.damageVignette) return;
    this.damageFlashTimer = 0.5;
    this.bloodTimer = 1.4;

    if (direction) {
      const angle = Math.atan2(direction.y, direction.x);
      this.damageVignette.style.setProperty("--damage-angle", `${angle}rad`);
    }
  }

  triggerScreenShake(strength: number): void {
    if (!this.current.screenShake) return;
    const duration = 0.3 + strength * 0.18;
    if (strength * 8 >= this.shakeMagnitude && this.shakeTime > 0) {
      this.shakeTime = duration;
      this.shakeMagnitude = Math.max(this.shakeMagnitude, strength * 8);
      return;
    }
    this.shakeTime = duration;
    this.shakeDuration = duration;
    this.shakeMagnitude = strength * 8;
  }

  showWaveBanner(label: string, durationSeconds = 3): void {
    this.waveBannerLabel.textContent = label;
    this.waveBanner.style.setProperty("--wave-splash-duration", `${durationSeconds}s`);
    this.bannerTimer = durationSeconds;
    this.waveBanner.classList.remove("is-visible");
    void this.waveBanner.offsetWidth;
    this.waveBanner.classList.add("is-visible");
  }

  private applyShake(): void {
    if (this.shakeTime <= 0) {
      if (this.shakeOffsetX !== 0 || this.shakeOffsetY !== 0) {
        this.canvas.style.transform = "translate3d(0,0,0)";
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
      }
      return;
    }

    const t = this.shakeTime / Math.max(0.0001, this.shakeDuration || 0.3);
    const magnitude = this.shakeMagnitude * t;
    this.shakeOffsetX = (Math.random() - 0.5) * magnitude;
    this.shakeOffsetY = (Math.random() - 0.5) * magnitude;
    this.canvas.style.transform = `translate3d(${this.shakeOffsetX.toFixed(2)}px, ${this.shakeOffsetY.toFixed(2)}px, 0)`;
  }

  private applyHitMarker(): void {
    const opacity = this.hitMarkerTimer > 0 ? this.hitMarkerTimer / 0.2 : 0;
    this.hitMarker.style.opacity = `${opacity}`;
  }

  private applyDamageVignette(): void {
    if (!this.current.damageVignette) return;
    const flash = this.damageFlashTimer / 0.5;
    this.damageVignette.style.opacity = `${flash}`;
    this.bloodOverlay.style.opacity = `${Math.max(0, this.bloodTimer / 1.4) * 0.65}`;
  }

  private applyLowHealth(): void {
    if (!this.current.damageVignette) {
      this.lowHealthVignette.style.opacity = "0";
      return;
    }
    if (this.healthRatio >= 0.45) {
      this.lowHealthVignette.style.opacity = "0";
      return;
    }
    const intensity = 1 - this.healthRatio / 0.45;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / (160 - intensity * 80));
    this.lowHealthVignette.style.opacity = `${(0.35 + pulse * 0.55) * intensity}`;
  }

  private applyBanner(): void {
    if (this.bannerTimer <= 0) {
      this.waveBanner.classList.remove("is-visible");
    }
  }
}
