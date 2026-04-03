const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ENTER_ALT   = '\x1b[?1049h';
const EXIT_ALT    = '\x1b[?1049l';

export function setupTerminal(): void {
  process.stdout.write(ENTER_ALT + HIDE_CURSOR);
}

export function teardownTerminal(): void {
  process.stdin.setRawMode(false);
  process.stdout.write(SHOW_CURSOR + EXIT_ALT);
}

export function withRawMode<T>(fn: () => Promise<T>): Promise<T> {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return fn().finally(() => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  });
}

// Global safety net
process.on('exit', () => {
  process.stdin.setRawMode(false);
  process.stdout.write(SHOW_CURSOR + EXIT_ALT);
});

export { HIDE_CURSOR, SHOW_CURSOR, ENTER_ALT, EXIT_ALT };
