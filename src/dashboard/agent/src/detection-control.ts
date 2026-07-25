let paused = false;

export function pauseDetectionFrames(): void {
  paused = true;
}

export function resumeDetectionFrames(): void {
  paused = false;
}

export function detectionFramesPaused(): boolean {
  return paused;
}
