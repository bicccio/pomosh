import { spawn } from 'child_process';
import { HIDE_CURSOR, SHOW_CURSOR, ENTER_ALT, EXIT_ALT, withRawMode } from './terminal.js';

const CLEAR       = '\x1b[2J\x1b[H';
const BOLD        = '\x1b[1m';
const DIM         = '\x1b[2m';
const RESET       = '\x1b[0m';

export { setupTerminal, teardownTerminal } from './terminal.js';

// ─── drawing ──────────────────────────────────────────────────────────────────

function cols(): number { return process.stdout.columns || 80; }

export function visibleWidth(s: string): number {
  const clean = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of [...clean]) {
    w += (ch.codePointAt(0) ?? 0) > 0x1F000 ? 2 : 1;
  }
  return w;
}

export function summaryBox(lines: string | string[], title?: string, footer?: string): string {
  const all = Array.isArray(lines) ? lines : [lines];
  const inners = all.map(l => `  ${l}  `);
  const titleW = title ? visibleWidth(title) : 0;
  const minW = Math.max(footer ? footer.length + 4 : 0, title ? titleW + 3 : 0);
  const w = Math.max(...inners.map(visibleWidth), minW);
  const top = title
    ? `╭─ ${title} ${'─'.repeat(Math.max(0, w - titleW - 3))}╮`
    : `╭${'─'.repeat(w)}╮`;
  const bottom = footer
    ? `╰${'─'.repeat(Math.max(0, w - footer.length - 3))} ${footer} ─╯`
    : `╰${'─'.repeat(w)}╯`;
  const empty = `  │${' '.repeat(w)}│`;
  const rows = inners
    .map(inner => `  │${inner}${' '.repeat(Math.max(0, w - visibleWidth(inner)))}│`)
    .join('\n');
  return `  ${top}\n${empty}\n${rows}\n${empty}\n  ${bottom}`;
}

const BLOCK_TITLE = [
  '  █████ █████ █████ ███████   ██████',
  ' ███░░ ░░███  ░███ ░███░░███ ░███░░ ',
  '░░█████ ░███  ░███ ░███ ░███ ██████ ',
  ' ░░░░███░███  ░███ ░███ ░░░ ░░███░  ',
  ' ██████ ░░███████  ░███      ░███   ',
  '░░░░░░   ░░░░░░░   ░░░       ░░░    ',
];

// Sunset gradient: bright yellow at top → deep orange at bottom
const TITLE_COLORS = [
  '\x1b[38;2;255;220;50m',
  '\x1b[38;2;255;200;40m',
  '\x1b[38;2;255;180;30m',
  '\x1b[38;2;255;160;20m',
  '\x1b[38;2;255;150;10m',
  '\x1b[38;2;255;140;0m',
];

function titleBar(): string {
  const sep = '─'.repeat(Math.max(0, cols() - 4));
  if (cols() >= 65) {
    const lines = BLOCK_TITLE.map((row, i) => `  ${BOLD}${TITLE_COLORS[i]}${row}${RESET}`);
    return lines.join('\n') + `\n  ${TITLE_COLORS[5]}${sep}${RESET}`;
  }
  return `${BOLD}  surf 🏄${RESET}\n  ${'─'.repeat(Math.max(0, cols() - 4))}`;
}

function drawBar(remaining: number, total: number): string {
  const width  = Math.max(20, Math.min(cols() - 10, 50));
  const filled = total > 0 ? Math.round(((total - remaining) / total) * width) : width;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function sessionSummaryBox(sessionNumber: number, isBreak: boolean, totalMinToday: number, blinkOn: boolean): string {
  const completedToday = isBreak ? sessionNumber : sessionNumber - 1;
  const tomato = TITLE_COLORS[0];

  const maxVisible = Math.max(0, Math.floor((cols() - 30) / 3));
  const overflow   = Math.max(0, completedToday - maxVisible);
  const visible    = completedToday - overflow;

  let icons = '';
  if (overflow > 0) icons += `${DIM}+${overflow} ${RESET}`;
  icons += `${tomato}🌊${RESET} `.repeat(visible);

  const current = isBreak ? '' : (blinkOn ? `${tomato}◉${RESET} ` : '  ');
  const label = `${completedToday} done · ${totalMinToday} min`;

  return summaryBox([`${icons}${current}`, '', label], 'today');
}

export function sectionHeader(name: string): string {
  const tomato = TITLE_COLORS[0];
  return `  ${BOLD}${tomato}▌ ${name}${RESET}`;
}

export function screen(summary: string | null, ...lines: string[]): string {
  const mid = summary != null ? ['', summary] : [''];
  return [CLEAR, titleBar(), ...mid, ...lines].join('\n');
}

function buildTimerScreen(
  sessionNumber: number,
  taskName: string,
  seconds: number,
  totalMin: number,
  isBreak: boolean,
  totalMinToday: number,
): string {
  const mm  = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss  = String(seconds % 60).padStart(2, '0');
  const bar = drawBar(seconds, totalMin * 60);

  return screen(
    sessionSummaryBox(sessionNumber, isBreak, totalMinToday, seconds % 2 === 0),
    '',
    `  ${isBreak ? 'Break' : taskName}`,
    '',
    `  ${mm}:${ss}`,
    `  ${bar}`,
    '',
    `  ${DIM}[esc] interrupt${RESET}`,
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
  totalMinToday: number,
): Promise<'completed' | 'cancelled'> {
  return withRawMode(async () => {
    let remaining = minutes * 60;
    let interruptResolve: (() => void) | null = null;

    const onKey = (key: string) => {
      if (key === '\u0003') { process.stdout.write(SHOW_CURSOR + EXIT_ALT); process.exit(0); }
      if (key === '\x1b' && interruptResolve) {
        const r = interruptResolve;
        interruptResolve = null;
        r();
      }
    };
    process.stdin.on('data', onKey);

    try {
      while (remaining > 0) {
        process.stdout.write(buildTimerScreen(sessionNumber, taskName, remaining, minutes, isBreak, totalMinToday));

        const interrupted = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => { interruptResolve = null; resolve(false); }, 1000);
          interruptResolve = () => { clearTimeout(timer); resolve(true); };
        });

        if (interrupted) {
          process.stdout.write(
            buildTimerScreen(sessionNumber, taskName, remaining, minutes, isBreak, totalMinToday) +
            `\n\n  ${isBreak ? 'Break' : 'Wave'} interrupted — cancel it? ${DIM}[y] yes   [n] no${RESET}`,
          );

          while (true) {
            const key = await readKey();
            if (key === 'y' || key === 'Y') return 'cancelled';
            if (key === 'n' || key === 'N' || key === '\x1b') break;
          }
        } else {
          remaining--;
        }
      }

      process.stdout.write(buildTimerScreen(sessionNumber, taskName, 0, minutes, isBreak, totalMinToday));
      return 'completed';
    } finally {
      process.stdin.removeListener('data', onKey);
    }
  });
}

// ─── notifications ────────────────────────────────────────────────────────────

function notify(title: string, body: string, sound: string): void {
  // terminal-notifier: persistent (stays until clicked, max 30s), no spurious "Show" button
  // Install with: brew install terminal-notifier
  const tn = spawn('terminal-notifier', ['-title', title, '-message', body, '-timeout', '30', '-sound', sound], { stdio: 'ignore' });
  tn.once('error', () => {
    // terminal-notifier not available — fallback to osascript banner
    const safe = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const osaSound = sound === 'default' ? 'Ping' : sound;
    const osa = spawn('osascript', ['-e', `display notification "${safe(body)}" with title "${safe(title)}" sound name "${safe(osaSound)}"`], { stdio: 'ignore' });
    osa.unref();
  });
  tn.unref();
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

export async function askAfterWave(
  sessionNumber: number,
  taskName: string,
  breakMin: number,
  summary: string | null,
): Promise<'break' | 'next' | 'menu' | 'details'> {
  process.stdout.write(screen(
    summary,
    '',
    `  ${BOLD}\x1b[38;2;40;190;220m✓  Wave #${sessionNumber} complete!${RESET}  ${DIM}— ${taskName}${RESET}`,
    '',
    `  [b] break   [enter] next   [l] log   [m] menu`,
  ));
  process.stdout.write(SHOW_CURSOR);
  while (true) {
    const key = await readKey();
    if (key === 'b' || key === 'B')                  { process.stdout.write(HIDE_CURSOR); return 'break'; }
    if (key === '\r' || key === '\n' || key === ' ') { process.stdout.write(HIDE_CURSOR); return 'next'; }
    if (key === 'l' || key === 'L')                  { process.stdout.write(HIDE_CURSOR); return 'details'; }
    if (key === 'm' || key === 'M')                  { process.stdout.write(HIDE_CURSOR); return 'menu'; }
  }
}

export async function askAfterBreak(summary: string | null): Promise<'next' | 'menu'> {
  process.stdout.write(screen(
    summary,
    '',
    '  ✓  Break complete!',
    '',
    '  [enter] next wave   [esc] menu',
  ));
  process.stdout.write(SHOW_CURSOR);
  while (true) {
    const key = await readKey();
    if (key === '\r' || key === '\n' || key === ' ') { process.stdout.write(HIDE_CURSOR); return 'next'; }
    if (key === '\x1b')                              { process.stdout.write(HIDE_CURSOR); return 'menu'; }
  }
}

