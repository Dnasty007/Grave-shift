import { normalize2D } from "./math";
import type { Settings } from "./Settings";
import {
  type GamepadLayoutFamily,
  classifyGamepadId,
  interactFaceButtonLabel
} from "./gamepadLabels";

function deadzone(v: number, z: number): number {
  const a = Math.abs(v);
  if (a < z) return 0;
  const s = Math.sign(v);
  return s * ((a - z) / (1 - z));
}

type StickKey = "left" | "right";

type StickState = {
  zone: HTMLElement;
  knob: HTMLElement;
  activePointerId: number | null;
  vectorX: number;
  vectorY: number;
};

export type InputCallbacks = {
  onPauseRequested?: () => void;
  onInteractRequested?: () => void;
  /** +1 = next weapon, -1 = previous (mouse wheel). */
  onWeaponCycleRequested?: (direction: number) => void;
  /** Weapon wheel: pick slot by keyboard (Digit1 = 0, …). */
  onWeaponWheelSlotPick?: (slotIndex: number) => void;
  /** PC: I — toggle backpack inventory (playing only; handled in GameApp). */
  onInventoryToggleRequested?: () => void;
};

/**
 * All player-facing input: keyboard/mouse, optional **Standard** gamepads (Xbox / PlayStation),
 * on-screen sticks on touch-first devices, and merged gamepad + touch when a pad is connected to a phone.
 * Feeds `PlayerController`; E / Q / Esc reach `GameApp` through `InputCallbacks`.
 */
export class InputManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly useTouchControls: boolean;
  private readonly keys = new Set<string>();
  private readonly leftStick: StickState;
  private readonly rightStick: StickState;
  private fireHeld = false;
  private adsHeld = false;
  private restartRequested = false;
  private reloadRequested = false;
  private lethalRequested = false;
  /** Space: one-shot jump (consumed by PlayerController). */
  private jumpRequested = false;
  private gameOver = false;
  private paused = false;
  private inputBlocked = false;
  private accumulatedLookX = 0;
  private accumulatedLookY = 0;
  /** Desktop weapon wheel: blocks look / fire / weapon cycle while open. */
  private weaponWheelOpen = false;
  /** Minecraft-style backpack: blocks movement, look, fire; frees pointer. */
  private inventoryOpen = false;
  private cameraViewToggleRequested = false;
  private lastPointerClientX = 0;
  private lastPointerClientY = 0;
  private callbacks: InputCallbacks = {};
  private readonly settings: Settings;
  private gamepadLayoutFamily: GamepadLayoutFamily = "generic";
  private prevGpPressed: boolean[] = [];
  private gpStartEdge = false;
  /** Virtual pointer while the radial weapon wheel is open (right stick / mouse). */
  private wheelClientX = 0;
  private wheelClientY = 0;
  /** Left stick from the active gamepad this frame (after deadzone). */
  private gpMoveX = 0;
  private gpMoveY = 0;
  /** True if the right stick contributed to look this frame (for sensitivity scaling). */
  private gamepadSteerLookFrame = false;
  private gpFireAnalog = 0;
  private gpAdsAnalog = 0;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, settings: Settings) {
    this.canvas = canvas;
    this.settings = settings;
    /**
     * Treat as “touch UI” only when there is no fine pointer (mouse/trackpad),
     * or on a narrow viewport where touch is the expected primary input.
     * Hybrid laptops used to always flip this on via maxTouchPoints and then
     * pointer-lock + mouse look broke while WASD felt “dead” to mouse-first players.
     */
    const anyFine = window.matchMedia("(any-pointer: fine)").matches;
    const anyCoarse = window.matchMedia("(any-pointer: coarse)").matches;
    const narrowViewport = window.matchMedia("(max-width: 900px)").matches;
    this.useTouchControls = anyCoarse && (!anyFine || narrowViewport);

    const leftStick = hudRoot.querySelector<HTMLElement>("#left-stick");
    const leftKnob = hudRoot.querySelector<HTMLElement>("#left-knob");
    const rightStick = hudRoot.querySelector<HTMLElement>("#right-stick");
    const rightKnob = hudRoot.querySelector<HTMLElement>("#right-knob");
    const fireButton = hudRoot.querySelector<HTMLButtonElement>("#fire-button");
    const reloadButton = hudRoot.querySelector<HTMLButtonElement>("#reload-button");
    const pauseButton = hudRoot.querySelector<HTMLButtonElement>("#pause-button");
    const interactButton = hudRoot.querySelector<HTMLButtonElement>("#interact-button");
    const swapButton = hudRoot.querySelector<HTMLButtonElement>("#swap-button");

    if (
      !leftStick ||
      !leftKnob ||
      !rightStick ||
      !rightKnob ||
      !fireButton ||
      !reloadButton ||
      !pauseButton ||
      !interactButton ||
      !swapButton
    ) {
      throw new Error("Touch control elements are missing.");
    }

    this.leftStick = {
      zone: leftStick,
      knob: leftKnob,
      activePointerId: null,
      vectorX: 0,
      vectorY: 0
    };

    this.rightStick = {
      zone: rightStick,
      knob: rightKnob,
      activePointerId: null,
      vectorX: 0,
      vectorY: 0
    };

    this.bindDesktopInput();
    this.bindTouchControls(fireButton, reloadButton, pauseButton, interactButton, swapButton);

    this.lastPointerClientX = window.innerWidth * 0.5;
    this.lastPointerClientY = window.innerHeight * 0.5;

    document.body.classList.toggle("touch-mode", this.useTouchControls);

    window.addEventListener("gamepadconnected", () => {
      /* `navigator.getGamepads()` is populated after this event; next `syncGamepads` picks it up. */
    });
  }

  setCallbacks(callbacks: InputCallbacks): void {
    this.callbacks = callbacks;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.fireHeld = false;
      this.adsHeld = false;
      this.jumpRequested = false;
      this.accumulatedLookX = 0;
      this.accumulatedLookY = 0;
      this.weaponWheelOpen = false;
      this.inventoryOpen = false;
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
    }
  }

  setInventoryOpen(open: boolean): void {
    this.inventoryOpen = open;
    if (open) {
      this.fireHeld = false;
      this.adsHeld = false;
      this.jumpRequested = false;
      this.accumulatedLookX = 0;
      this.accumulatedLookY = 0;
      this.weaponWheelOpen = false;
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
    }
  }

  isInventoryOpen(): boolean {
    return this.inventoryOpen;
  }

  setInputBlocked(blocked: boolean): void {
    this.inputBlocked = blocked;
    if (blocked) {
      this.fireHeld = false;
      this.adsHeld = false;
      this.jumpRequested = false;
    }
  }

  /**
   * Radial weapon wheel (hold V) — set each frame from `GameApp` before `update` / look consumption.
   */
  setWeaponWheelOpen(open: boolean): void {
    this.weaponWheelOpen = open;
    if (open) {
      this.inventoryOpen = false;
      this.fireHeld = false;
      this.adsHeld = false;
      this.accumulatedLookX = 0;
      this.accumulatedLookY = 0;
      this.wheelClientX = window.innerWidth * 0.5;
      this.wheelClientY = window.innerHeight * 0.5;
    }
  }

  /** True while right mouse button is held in pointer-lock, or LT / L2 on a pad. */
  isADS(): boolean {
    if (this.paused || this.inputBlocked || this.weaponWheelOpen || this.inventoryOpen) return false;
    if (this.useTouchControls && !this.hasGamepad()) return false;
    return this.adsHeld || this.gpAdsAnalog > 0.2;
  }

  isWeaponWheelOpen(): boolean {
    return this.weaponWheelOpen;
  }

  isKeyHeld(code: string): boolean {
    return this.keys.has(code);
  }

  getPointerClient(): { x: number; y: number } {
    if (this.weaponWheelOpen) {
      return { x: this.wheelClientX, y: this.wheelClientY };
    }
    return { x: this.lastPointerClientX, y: this.lastPointerClientY };
  }

  /** Standard-mapped Xbox / PlayStation / generic pad connected. */
  hasGamepad(): boolean {
    return this.pickGamepad() != null;
  }

  getGamepadLayoutFamily(): GamepadLayoutFamily {
    return this.gamepadLayoutFamily;
  }

  /** HUD “use” key: keyboard + face button hint when a pad is active. */
  getInteractKeyLabel(): string {
    if (!this.hasGamepad()) return "E";
    const g = interactFaceButtonLabel(this.gamepadLayoutFamily);
    return `E / ${g}`;
  }

  /** True after right stick moved the camera this frame (before `consumeLookDelta`). */
  didGamepadSteerLookLastFrame(): boolean {
    return this.gamepadSteerLookFrame;
  }

  /** Hold LB / L1 — same role as holding <kbd>V</kbd> for the weapon wheel. */
  isGamepadWeaponWheelHeld(): boolean {
    const gp = this.pickGamepad();
    if (!gp || this.paused || this.inputBlocked || this.inventoryOpen) return false;
    return !!(gp.buttons[4]?.pressed || (gp.buttons[4]?.value ?? 0) > 0.35);
  }

  syncGamepads(dt: number): void {
    this.gpMoveX = 0;
    this.gpMoveY = 0;
    this.gamepadSteerLookFrame = false;
    this.gpStartEdge = false;
    this.gpFireAnalog = 0;
    this.gpAdsAnalog = 0;

    const gp = this.pickGamepad();
    if (!gp) {
      this.prevGpPressed = [];
      return;
    }

    this.gamepadLayoutFamily = classifyGamepadId(gp.id);
    const bt = gp.buttons;
    const n = Math.max(16, bt.length);
    const was = this.prevGpPressed;
    const cold = was.length === 0;
    const pressed = (i: number): boolean => {
      const b = bt[i];
      if (!b) return false;
      return !!(b.pressed || (b.value ?? 0) > 0.35);
    };
    const analog = (i: number): number => {
      const b = bt[i];
      if (!b) return 0;
      return Math.max(b.value ?? 0, b.pressed ? 1 : 0);
    };
    const edge = (i: number): boolean => !cold && pressed(i) && !was[i];

    if (edge(9)) {
      this.gpStartEdge = true;
    }
    if (this.gameOver && edge(0)) {
      this.restartRequested = true;
    }

    const gameplayBlocked =
      this.paused || this.inputBlocked || this.inventoryOpen;

    if (gameplayBlocked) {
      this.prevGpPressed = Array.from({ length: n }, (_, i) => pressed(i));
      return;
    }

    if (edge(8)) {
      this.callbacks.onInventoryToggleRequested?.();
    }
    if (edge(3)) {
      this.callbacks.onInteractRequested?.();
    }
    if (edge(2)) {
      this.reloadRequested = true;
    }
    if (edge(0) && !this.weaponWheelOpen) {
      this.jumpRequested = true;
    }
    /** B / Circle — lethal (same idea as a dedicated grenade face button). */
    if (edge(1)) {
      if (!this.paused && !this.weaponWheelOpen) {
        this.lethalRequested = true;
      }
    }
    if (edge(5)) {
      this.callbacks.onWeaponCycleRequested?.(1);
    }
    /** D-pad left — previous weapon (LB is reserved for hold-to-open weapon wheel). */
    if (edge(14)) {
      this.callbacks.onWeaponCycleRequested?.(-1);
    }
    if (edge(11)) {
      this.cameraViewToggleRequested = true;
    }

    const ax0 = deadzone(gp.axes[0] ?? 0, 0.14);
    const ax1 = deadzone(gp.axes[1] ?? 0, 0.14);
    this.gpMoveX = ax0;
    this.gpMoveY = -ax1;

    const ax2 = deadzone(gp.axes[2] ?? 0, 0.12);
    const ax3 = deadzone(gp.axes[3] ?? 0, 0.12);
    const sens = this.settings.get().gamepadLookSensitivity;
    const lookRate = 125 * sens;

    if (this.weaponWheelOpen) {
      const wsp = 520 * sens;
      this.wheelClientX += ax2 * wsp * dt;
      this.wheelClientY += ax3 * wsp * dt;
      const pad = 48;
      this.wheelClientX = Math.min(
        Math.max(this.wheelClientX, pad),
        window.innerWidth - pad
      );
      this.wheelClientY = Math.min(
        Math.max(this.wheelClientY, pad),
        window.innerHeight - pad
      );
    } else {
      if (Math.abs(ax2) > 0.001 || Math.abs(ax3) > 0.001) {
        this.gamepadSteerLookFrame = true;
      }
      if (this.useTouchControls) {
        this.accumulatedLookX += ax2 * lookRate * dt;
        this.accumulatedLookY += ax3 * lookRate * dt;
      } else {
        this.accumulatedLookX -= ax2 * lookRate * dt;
        this.accumulatedLookY -= ax3 * lookRate * dt;
      }
    }

    if (!this.weaponWheelOpen) {
      this.gpFireAnalog = analog(7);
      this.gpAdsAnalog = analog(6);
    }

    this.prevGpPressed = Array.from({ length: n }, (_, i) => pressed(i));
  }

  consumeGamepadStartEdge(): boolean {
    const e = this.gpStartEdge;
    this.gpStartEdge = false;
    return e;
  }

  private pickGamepad(): Gamepad | null {
    const pads = navigator.getGamepads();
    let fallback: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      if (p.mapping === "standard") {
        return p;
      }
      if (!fallback) {
        fallback = p;
      }
    }
    return fallback;
  }

  isPaused(): boolean {
    return this.paused;
  }

  update(dt: number): void {
    if (!this.useTouchControls || this.paused || this.inputBlocked) {
      return;
    }

    this.accumulatedLookX += this.rightStick.vectorX * 95 * dt;
    this.accumulatedLookY += this.rightStick.vectorY * 95 * dt;
  }

  getMoveVector(): { x: number; y: number } {
    if (this.paused || this.inputBlocked || this.inventoryOpen) {
      return { x: 0, y: 0 };
    }

    const keyboardX =
      (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const keyboardY =
      (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);

    const combinedX = keyboardX + this.leftStick.vectorX + this.gpMoveX;
    const combinedY = keyboardY - this.leftStick.vectorY + this.gpMoveY;
    const normalized = normalize2D(combinedX, combinedY);

    return {
      x: normalized.x,
      y: normalized.y
    };
  }

  consumeLookDelta(): { x: number; y: number } {
    if (this.paused || this.inputBlocked || this.weaponWheelOpen || this.inventoryOpen) {
      this.accumulatedLookX = 0;
      this.accumulatedLookY = 0;
      return { x: 0, y: 0 };
    }

    const look = {
      x: this.accumulatedLookX,
      y: this.accumulatedLookY
    };

    this.accumulatedLookX = 0;
    this.accumulatedLookY = 0;

    return look;
  }

  isFiring(): boolean {
    if (this.paused || this.inputBlocked || this.weaponWheelOpen || this.inventoryOpen) {
      return false;
    }
    return this.fireHeld || this.gpFireAnalog > 0.22;
  }

  isSprinting(): boolean {
    if (this.paused || this.inputBlocked || this.inventoryOpen) return false;
    if (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) return true;
    const g = this.pickGamepad();
    if (!g) return false;
    return !!(g.buttons[4]?.pressed || g.buttons[10]?.pressed);
  }

  /**
   * Fly mode: move up (V — blocked while weapon wheel is open).
   */
  isFlyAscend(): boolean {
    if (this.paused || this.inputBlocked || this.weaponWheelOpen || this.inventoryOpen) {
      return false;
    }
    if (this.keys.has("KeyV")) return true;
    if (!this.settings.get().flyMode) return false;
    const g = this.pickGamepad();
    return !!(g?.buttons[12]?.pressed);
  }

  /** True once per Space press; clears after read (not used while fly mode handles vertical). */
  consumeJumpRequest(): boolean {
    const r = this.jumpRequested;
    this.jumpRequested = false;
    return r;
  }

  /** True while Space is physically held down — used for jetpack glide. */
  isJumpHeld(): boolean {
    if (this.paused || this.inputBlocked || this.inventoryOpen) return false;
    if (this.keys.has("Space")) return true;
    const g = this.pickGamepad();
    return !!(g?.buttons[0]?.pressed);
  }

  /** Fly mode: move down (Ctrl). */
  isFlyDescend(): boolean {
    if (this.paused || this.inputBlocked || this.inventoryOpen) return false;
    if (this.keys.has("ControlLeft") || this.keys.has("ControlRight")) return true;
    if (!this.settings.get().flyMode) return false;
    const g = this.pickGamepad();
    return !!(g?.buttons[13]?.pressed);
  }

  consumeRestartRequest(): boolean {
    const requested = this.restartRequested;
    this.restartRequested = false;
    return requested;
  }

  consumeLethalRequest(): boolean {
    const requested = this.lethalRequested;
    this.lethalRequested = false;
    return requested && !this.paused && !this.inputBlocked;
  }

  /** G key held (desktop) — C4 hold-to-detonate. Same guards as movement lethal use. */
  isLethalHeld(): boolean {
    if (this.paused || this.inputBlocked || this.inventoryOpen) return false;
    return this.keys.has("KeyG");
  }

  consumeReloadRequest(): boolean {
    if (this.paused || this.inputBlocked || this.weaponWheelOpen || this.inventoryOpen) {
      this.reloadRequested = false;
      return false;
    }
    const requested = this.reloadRequested;
    this.reloadRequested = false;
    return requested;
  }

  /** Desktop: C key, once per press (settings may disable use in PlayerController). */
  consumeCameraViewToggle(): boolean {
    const r = this.cameraViewToggleRequested;
    this.cameraViewToggleRequested = false;
    return r;
  }

  setGameOver(gameOver: boolean): void {
    this.gameOver = gameOver;
  }

  isTouchMode(): boolean {
    return this.useTouchControls;
  }

  requestPointerLockIfNeeded(): void {
    if (this.useTouchControls) return;
    if (this.paused) return;
    if (this.inventoryOpen) return;
    if (document.pointerLockElement === this.canvas) return;
    void this.canvas.requestPointerLock();
  }

  private bindDesktopInput(): void {
    window.addEventListener("keydown", (event) => {
      this.keys.add(event.code);

      if (event.code === "Escape") {
        event.preventDefault();
        this.callbacks.onPauseRequested?.();
        return;
      }

      if (event.code === "Space") {
        if (!this.paused && !this.inputBlocked && !this.inventoryOpen && !event.repeat) {
          this.jumpRequested = true;
        }
        if (document.pointerLockElement === this.canvas) {
          event.preventDefault();
        }
      }

      if (event.code === "KeyR") {
        if (!this.inventoryOpen) {
          this.reloadRequested = true;
        }
      }

      if (event.code === "KeyI") {
        if (!this.useTouchControls && !this.paused && !this.inputBlocked && !event.repeat) {
          this.callbacks.onInventoryToggleRequested?.();
        }
        event.preventDefault();
        return;
      }

      if (event.code === "KeyC") {
        if (
          !this.useTouchControls &&
          !this.paused &&
          !this.inputBlocked &&
          !this.weaponWheelOpen &&
          !this.inventoryOpen &&
          !event.repeat
        ) {
          this.cameraViewToggleRequested = true;
        }
      }

      if (event.code === "KeyE" || event.code === "KeyF") {
        if (!this.inventoryOpen) {
          this.callbacks.onInteractRequested?.();
        }
      }

      if (event.code === "KeyG") {
        if (!this.paused && !this.inputBlocked && !this.inventoryOpen && !event.repeat) {
          this.lethalRequested = true;
        }
      }

      if (event.code === "KeyQ" || event.code === "Tab") {
        if (this.inventoryOpen) {
          if (event.code === "Tab") event.preventDefault();
          return;
        }
        if (this.weaponWheelOpen) {
          if (event.code === "Tab") event.preventDefault();
          return;
        }
        if (event.code === "Tab") event.preventDefault();
        this.callbacks.onWeaponCycleRequested?.(1);
      }

      if (
        this.weaponWheelOpen &&
        (event.code === "Digit1" ||
          event.code === "Digit2" ||
          event.code === "Digit3" ||
          event.code === "Digit4" ||
          event.code === "Digit5" ||
          event.code === "Digit6")
      ) {
        const map: Record<string, number> = {
          Digit1: 0,
          Digit2: 1,
          Digit3: 2,
          Digit4: 3,
          Digit5: 4,
          Digit6: 5
        };
        this.callbacks.onWeaponWheelSlotPick?.(map[event.code] ?? 0);
        event.preventDefault();
        return;
      }

      if (this.gameOver && event.code === "Enter") {
        this.restartRequested = true;
      }
    });

    window.addEventListener(
      "wheel",
      (event) => {
        if (this.paused || this.inputBlocked || this.weaponWheelOpen || this.inventoryOpen) return;
        if (Math.abs(event.deltaY) < 4) return;
        const dir = event.deltaY > 0 ? 1 : -1;
        this.callbacks.onWeaponCycleRequested?.(dir);
      },
      { passive: true }
    );

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });

    // Prevent native right-click context menu while in-game
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("mousedown", (event) => {
      if (this.useTouchControls || this.inputBlocked) return;
      if (this.paused) return;
      if (this.weaponWheelOpen || this.inventoryOpen) return;

      if (event.button === 0) {
        if (document.pointerLockElement !== this.canvas) {
          void this.canvas.requestPointerLock();
        } else {
          this.fireHeld = true;
        }
        return;
      }

      if (event.button === 2) {
        if (document.pointerLockElement === this.canvas) {
          this.adsHeld = true;
        }
        return;
      }
    });

    window.addEventListener("mouseup", (event) => {
      if (event.button === 0) {
        this.fireHeld = false;
      }
      if (event.button === 2) {
        this.adsHeld = false;
      }
    });

    document.addEventListener("mousemove", (event) => {
      this.lastPointerClientX = event.clientX;
      this.lastPointerClientY = event.clientY;

      if (this.paused || this.inputBlocked || this.weaponWheelOpen || this.inventoryOpen) {
        return;
      }

      if (document.pointerLockElement !== this.canvas) {
        return;
      }

      this.accumulatedLookX -= event.movementX;
      this.accumulatedLookY -= event.movementY;
    });

    this.canvas.addEventListener("click", () => {
      if (this.gameOver) {
        this.restartRequested = true;
      }
    });
  }

  private bindTouchControls(
    fireButton: HTMLButtonElement,
    reloadButton: HTMLButtonElement,
    pauseButton: HTMLButtonElement,
    interactButton: HTMLButtonElement,
    swapButton: HTMLButtonElement
  ): void {
    for (const stickKey of ["left", "right"] as const) {
      const stick = stickKey === "left" ? this.leftStick : this.rightStick;

      stick.zone.addEventListener("pointerdown", (event) => {
        if (!this.useTouchControls || stick.activePointerId !== null) {
          return;
        }

        stick.activePointerId = event.pointerId;
        this.updateStick(stickKey, event.clientX, event.clientY);
      });
    }

    window.addEventListener("pointermove", (event) => {
      if (!this.useTouchControls) {
        return;
      }

      if (event.pointerId === this.leftStick.activePointerId) {
        this.updateStick("left", event.clientX, event.clientY);
      }

      if (event.pointerId === this.rightStick.activePointerId) {
        this.updateStick("right", event.clientX, event.clientY);
      }
    });

    window.addEventListener("pointerup", (event) => {
      if (event.pointerId === this.leftStick.activePointerId) {
        this.resetStick(this.leftStick);
      }

      if (event.pointerId === this.rightStick.activePointerId) {
        this.resetStick(this.rightStick);
      }
    });

    window.addEventListener("pointercancel", (event) => {
      if (event.pointerId === this.leftStick.activePointerId) {
        this.resetStick(this.leftStick);
      }

      if (event.pointerId === this.rightStick.activePointerId) {
        this.resetStick(this.rightStick);
      }
    });

    fireButton.addEventListener("pointerdown", () => {
      if (this.paused || this.inputBlocked) return;
      this.fireHeld = true;
    });

    fireButton.addEventListener("pointerup", () => {
      this.fireHeld = false;
    });

    fireButton.addEventListener("pointercancel", () => {
      this.fireHeld = false;
    });

    reloadButton.addEventListener("pointerup", () => {
      this.reloadRequested = true;
    });

    pauseButton.addEventListener("pointerup", () => {
      this.callbacks.onPauseRequested?.();
    });

    interactButton.addEventListener("pointerup", () => {
      this.callbacks.onInteractRequested?.();
    });

    swapButton.addEventListener("pointerup", () => {
      this.callbacks.onWeaponCycleRequested?.(1);
    });
  }

  private updateStick(stickKey: StickKey, clientX: number, clientY: number): void {
    const stick = stickKey === "left" ? this.leftStick : this.rightStick;
    const rect = stick.zone.getBoundingClientRect();
    const radius = rect.width * 0.36;
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const rawX = clientX - centerX;
    const rawY = clientY - centerY;
    const length = Math.hypot(rawX, rawY);
    const clampedLength = Math.min(length, radius);
    const normalizedX = length > 0 ? rawX / length : 0;
    const normalizedY = length > 0 ? rawY / length : 0;
    const offsetX = normalizedX * clampedLength;
    const offsetY = normalizedY * clampedLength;

    stick.vectorX = radius > 0 ? offsetX / radius : 0;
    stick.vectorY = radius > 0 ? offsetY / radius : 0;

    stick.knob.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }

  private resetStick(stick: StickState): void {
    stick.activePointerId = null;
    stick.vectorX = 0;
    stick.vectorY = 0;
    stick.knob.style.transform = "translate(0px, 0px)";
  }
}
