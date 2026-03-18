import { spawnSync, spawn } from 'child_process';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ENTER_ALT   = '\x1b[?1049h';
const EXIT_ALT    = '\x1b[?1049l';
const CLEAR       = '\x1b[2J\x1b[H';
const BOLD        = '\x1b[1m';
const DIM         = '\x1b[2m';
const RESET       = '\x1b[0m';

export function setupScreen(): void {
  process.stdout.write(ENTER_ALT + HIDE_CURSOR);
  const cleanup = () => { process.stdout.write(SHOW_CURSOR + EXIT_ALT); process.exit(0); };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

export function teardownScreen(): void {
  process.stdout.write(SHOW_CURSOR + EXIT_ALT);
}

// ─── drawing ──────────────────────────────────────────────────────────────────

function cols(): number { return process.stdout.columns || 80; }

function titleBar(): string {
  return `${BOLD}  pomosh 🍅${RESET}\n  ${'─'.repeat(Math.max(0, cols() - 4))}`;
}

function drawBar(remaining: number, total: number): string {
  const width  = Math.max(20, Math.min(cols() - 10, 50));
  const filled = total > 0 ? Math.round(((total - remaining) / total) * width) : width;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function screen(...lines: string[]): string {
  return [CLEAR, titleBar(), '', ...lines].join('\n');
}

function buildTimerScreen(
  sessionNumber: number,
  taskName: string,
  seconds: number,
  totalMin: number,
  isBreak: boolean,
): string {
  const mm  = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss  = String(seconds % 60).padStart(2, '0');
  const bar = drawBar(seconds, totalMin * 60);
  const label = isBreak
    ? `Break — ${totalMin} min`
    : `Pomodoro #${sessionNumber} — ${taskName}`;

  return screen(
    '',
    `  ${label}`,
    '',
    `  ${mm}:${ss}`,
    `  ${bar}`,
    '',
    `  ${DIM}[q] interrupt${RESET}`,
  );
}

// ─── raw keypress ─────────────────────────────────────────────────────────────

export function readKey(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (key: string) => {
      if (key === '\u0003') { process.stdout.write(SHOW_CURSOR + EXIT_ALT); process.exit(0); }
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      resolve(key);
    };
    stdin.on('data', onData);
  });
}

// ─── timer ────────────────────────────────────────────────────────────────────

export async function runTimer(
  minutes: number,
  sessionNumber: number,
  taskName: string,
  isBreak: boolean,
): Promise<'completed' | 'cancelled'> {
  let remaining = minutes * 60;
  let interruptResolve: (() => void) | null = null;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const onKey = (key: string) => {
    if (key === '\u0003') { process.stdout.write(SHOW_CURSOR + EXIT_ALT); process.exit(0); }
    if ((key === 'q' || key === 'Q' || key === '\x1b') && interruptResolve) {
      const r = interruptResolve;
      interruptResolve = null;
      r();
    }
  };
  process.stdin.on('data', onKey);

  const cleanupStdin = () => {
    process.stdin.removeListener('data', onKey);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  };

  while (remaining > 0) {
    process.stdout.write(buildTimerScreen(sessionNumber, taskName, remaining, minutes, isBreak));

    const interrupted = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { interruptResolve = null; resolve(false); }, 1000);
      interruptResolve = () => { clearTimeout(timer); resolve(true); };
    });

    if (interrupted) {
      cleanupStdin();
      process.stdout.write(SHOW_CURSOR);
      process.stdout.write(screen(
        '',
        `  ${isBreak ? 'Break' : 'Pomodoro'} interrupted.`,
        '',
        '  Cancel it? [y / n]',
      ));

      while (true) {
        const key = await readKey();
        if (key === 'y' || key === 'Y') return 'cancelled';
        if (key === 'n' || key === 'N' || key === '\x1b') break;
      }

      process.stdout.write(HIDE_CURSOR);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', onKey);
    } else {
      remaining--;
    }
  }

  process.stdout.write(buildTimerScreen(sessionNumber, taskName, 0, minutes, isBreak));
  cleanupStdin();
  return 'completed';
}

// ─── notifications ────────────────────────────────────────────────────────────

function notify(title: string, body: string, sound: string): void {
  // terminal-notifier: persistent (stays until clicked, max 30s), no spurious "Show" button
  // Install with: brew install terminal-notifier
  const tn = spawnSync('terminal-notifier', ['-title', title, '-message', body, '-timeout', '30', '-sound', sound]);
  if (tn.status === 0) return;

  // Fallback: basic banner via osascript (disappears on its own, may show "Show" button)
  const safe = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const osaSound = sound === 'default' ? 'Ping' : sound;
  spawnSync('osascript', ['-e', `display notification "${safe(body)}" with title "${safe(title)}" sound name "${safe(osaSound)}"`]);
}

export function sendNotification(enabled: boolean, title: string, body: string, sound: string): void {
  if (enabled) notify(title, body, sound);
}

export function previewSound(sound: string): void {
  const name = sound === 'default' ? 'Ping' : sound;
  const proc = spawn('afplay', [`/System/Library/Sounds/${name}.aiff`], { stdio: 'ignore' });
  proc.unref();
}

// ─── post-timer prompts ───────────────────────────────────────────────────────

export async function askAfterPomodoro(
  sessionNumber: number,
  taskName: string,
  breakMin: number,
): Promise<'break' | 'next' | 'quit' | 'menu'> {
  process.stdout.write(screen(
    '',
    `  ✓  Pomodoro #${sessionNumber} complete! — ${taskName}`,
    '',
    `  [b] break   [enter] next   [m] menu   [q] quit`,
  ));
  process.stdout.write(SHOW_CURSOR);
  while (true) {
    const key = await readKey();
    if (key === 'b' || key === 'B')                  { process.stdout.write(HIDE_CURSOR); return 'break'; }
    if (key === '\r' || key === '\n' || key === ' ') { process.stdout.write(HIDE_CURSOR); return 'next'; }
    if (key === 'm' || key === 'M')                  { process.stdout.write(HIDE_CURSOR); return 'menu'; }
    if (key === 'q' || key === 'Q')                  return 'quit';
  }
}

export async function askAfterBreak(): Promise<'next' | 'quit' | 'menu'> {
  process.stdout.write(screen(
    '',
    '  ✓  Break complete!',
    '',
    '  [enter] next pomodoro   [m] menu   [q] quit',
  ));
  process.stdout.write(SHOW_CURSOR);
  while (true) {
    const key = await readKey();
    if (key === '\r' || key === '\n' || key === ' ') { process.stdout.write(HIDE_CURSOR); return 'next'; }
    if (key === 'm' || key === 'M')                  { process.stdout.write(HIDE_CURSOR); return 'menu'; }
    if (key === 'q' || key === 'Q')                  return 'quit';
  }
}

export async function askAfterCancel(): Promise<'retry' | 'quit' | 'menu'> {
  process.stdout.write(screen(
    '',
    '  Pomodoro cancelled.',
    '',
    '  [enter] start over   [m] menu   [q] quit',
  ));
  process.stdout.write(SHOW_CURSOR);
  while (true) {
    const key = await readKey();
    if (key === '\r' || key === '\n' || key === ' ') { process.stdout.write(HIDE_CURSOR); return 'retry'; }
    if (key === 'm' || key === 'M')                  { process.stdout.write(HIDE_CURSOR); return 'menu'; }
    if (key === 'q' || key === 'Q')                  return 'quit';
  }
}
