/**
 * Browser {@link Gamepad} `id` strings are vendor-specific; classify for UI hints.
 * In-game actions use the **Standard** mapping (same button indices for Xbox / PlayStation).
 */
export type GamepadLayoutFamily = "xbox" | "playstation" | "generic";

export function classifyGamepadId(id: string): GamepadLayoutFamily {
  const s = id.toLowerCase();
  if (
    s.includes("xbox") ||
    s.includes("microsoft") ||
    (s.includes("gamepad") && s.includes("vendor: 045e"))
  ) {
    return "xbox";
  }
  if (
    s.includes("dualsense") ||
    s.includes("dualshock") ||
    s.includes("sony") ||
    s.includes("wireless controller") ||
    s.includes("playstation")
  ) {
    return "playstation";
  }
  return "generic";
}

/** Standard face button index 3 — top button (Y / Triangle) — we use for interact. */
export function interactFaceButtonLabel(family: GamepadLayoutFamily): string {
  switch (family) {
    case "playstation":
      return "△";
    case "xbox":
      return "Y";
    default:
      return "Y / △";
  }
}

/** Standard index 2 — left face (X / Square) — reload. */
export function reloadFaceButtonLabel(family: GamepadLayoutFamily): string {
  switch (family) {
    case "playstation":
      return "□";
    case "xbox":
      return "X";
    default:
      return "X / □";
  }
}

/** Standard index 0 — bottom (A / Cross) — jump. */
export function jumpFaceButtonLabel(family: GamepadLayoutFamily): string {
  switch (family) {
    case "playstation":
      return "✕";
    case "xbox":
      return "A";
    default:
      return "A / ✕";
  }
}
