/**
 * CoD World at War Round Timer System
 *
 * Round structure:
 * - Round 1: 180 seconds
 * - Each round: -5 seconds (minimum 40 seconds)
 * - Round ends when timer expires OR all zombies are dead
 * - Intermission between rounds: 5 seconds
 */

export class RoundTimer {
  private currentRound: number = 1;
  private roundTimeRemaining: number = 0;
  private isRunning: boolean = false;
  private isIntermission: boolean = false;
  private intermissionTimeRemaining: number = 5;
  private readonly INITIAL_ROUND_TIME = 180; // seconds
  private readonly ROUND_TIME_DECREASE = 5;
  private readonly MIN_ROUND_TIME = 40;
  private readonly INTERMISSION_TIME = 5;

  constructor() {
    this.roundTimeRemaining = this.INITIAL_ROUND_TIME;
  }

  startRound(): void {
    this.isRunning = true;
    this.isIntermission = false;
    this.roundTimeRemaining = this.calculateRoundDuration(this.currentRound);
  }

  startIntermission(): void {
    this.isRunning = false;
    this.isIntermission = true;
    this.intermissionTimeRemaining = this.INTERMISSION_TIME;
  }

  updateTimer(deltaSeconds: number): void {
    if (!this.isRunning && !this.isIntermission) return;

    if (this.isIntermission) {
      this.intermissionTimeRemaining -= deltaSeconds;
      if (this.intermissionTimeRemaining <= 0) {
        this.endIntermission();
      }
    } else {
      this.roundTimeRemaining -= deltaSeconds;
    }
  }

  private endIntermission(): void {
    this.isIntermission = false;
    this.currentRound++;
    this.startRound();
  }

  endRound(): void {
    this.isRunning = false;
    this.isIntermission = false;
  }

  completeRound(): void {
    this.endRound();
    this.startIntermission();
  }

  isRoundTimeExpired(): boolean {
    return this.roundTimeRemaining <= 0;
  }

  getCurrentRound(): number {
    return this.currentRound;
  }

  getRoundTimeRemaining(): number {
    return Math.max(0, this.roundTimeRemaining);
  }

  getIntermissionTimeRemaining(): number {
    return Math.max(0, this.intermissionTimeRemaining);
  }

  isInIntermission(): boolean {
    return this.isIntermission;
  }

  isTimerRunning(): boolean {
    return this.isRunning;
  }

  private calculateRoundDuration(round: number): number {
    const duration = this.INITIAL_ROUND_TIME - (round - 1) * this.ROUND_TIME_DECREASE;
    return Math.max(duration, this.MIN_ROUND_TIME);
  }

  resetToRound1(): void {
    this.currentRound = 1;
    this.roundTimeRemaining = this.INITIAL_ROUND_TIME;
    this.isRunning = false;
    this.isIntermission = false;
  }

  // Utility: format time as MM:SS
  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  getFormattedRoundTime(): string {
    return this.formatTime(this.getRoundTimeRemaining());
  }

  getFormattedIntermissionTime(): string {
    return this.formatTime(this.getIntermissionTimeRemaining());
  }
}
