const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const THRESHOLD_MS = 200;

export class Spinner {
  private idx = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private shown = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    this.started = true;
    this.timeout = setTimeout(() => {
      this.shown = true;
      this.interval = setInterval(() => {
        process.stdout.write(`\x1b[2K\r  ${FRAMES[this.idx]} loading...\x1b[0G`);
        this.idx = (this.idx + 1) % FRAMES.length;
      }, 100);
    }, THRESHOLD_MS);
  }

  stop(): void {
    this.started = false;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.shown) {
      process.stdout.write('\x1b[2K\r');
      this.shown = false;
    }
  }
}
