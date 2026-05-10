import "./styles.css";
import { GameApp } from "./game/GameApp";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const hudRoot = document.querySelector<HTMLElement>("#hud");

if (!canvas || !hudRoot) {
  throw new Error("Game canvas or HUD root is missing.");
}

new GameApp(canvas, hudRoot);
