import { parseCli } from './cli.js';
import { loadConfig, ensureDirectories } from './config.js';
import { listPomodoros, countTodayPomos, appendPomodoro } from './logger.js';
import {
  setupScreen,
  teardownScreen,
  screen,
  readKey,
  runTimer,
  askAfterPomodoro,
  askAfterBreak,
  askAfterCancel,
} from './timer.js';

const SHOW_CURSOR = '\x1b[?25h';
const HIDE_CURSOR = '\x1b[?25l';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// ─── custom fullscreen prompts ────────────────────────────────────────────────

const MENU_OPTIONS = [
  'Start a new pomodoro',
  "View today's pomodoros",
  'Exit',
] as const;

async function showMenu(): Promise<0 | 1 | 2> {
  let idx = 0;

  while (true) {
    const opts = MENU_OPTIONS.map((label, i) =>
      i === idx ? `  \x1b[1m❯\x1b[0m ${label}` : `    ${DIM}${label}${RESET}`,
    );
    process.stdout.write(screen(
      '',
      '  What would you like to do?',
      '',
      ...opts,
      '',
      `  ${DIM}[↑↓] navigate   [enter] select${RESET}`,
    ));

    const key = await readKey();
    if (key === '\x1b[A' && idx > 0)                        idx--;
    else if (key === '\x1b[B' && idx < MENU_OPTIONS.length - 1) idx++;
    else if (key === '\r' || key === '\n')                   return idx as 0 | 1 | 2;
    else if (key === 'q' || key === 'Q')                     return 2;
  }
}

async function showTextInput(prompt: string, placeholder: string): Promise<string | null> {
  let value = '';

  while (true) {
    const display = value || `${DIM}${placeholder}${RESET}`;
    process.stdout.write(screen(
      '',
      `  ${prompt}`,
      '',
      `  \x1b[1m❯\x1b[0m ${display}`,
    ));
    process.stdout.write(SHOW_CURSOR);

    const key = await readKey();
    process.stdout.write(HIDE_CURSOR);

    if (key === '\r' || key === '\n')       return value.trim() || placeholder;
    if (key === '\u0003')                   return null; // Ctrl+C
    if (key === '\x7f' || key === '\b')     value = value.slice(0, -1);
    else if (key.length === 1 && key >= ' ') value += key;
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { options, taskName: cliTaskName } = parseCli(process.argv);
  const config = await loadConfig(options.config);
  if (options.logDir) config.logDir = options.logDir;
  await ensureDirectories(config.logDir);

  // List commands: no fullscreen needed
  if (options.list)     { await listPomodoros(config.logDir);                    process.exit(0); }
  if (options.listDate) { await listPomodoros(config.logDir, options.listDate);  process.exit(0); }

  // Fullscreen from the very start
  setupScreen();

  let taskName = cliTaskName;

  if (!taskName) {
    const choice = await showMenu();

    if (choice === 2) { teardownScreen(); process.exit(0); }

    if (choice === 1) {
      teardownScreen();
      await listPomodoros(config.logDir);
      process.exit(0);
    }

    const name = await showTextInput('Task name', 'e.g. writing the readme');
    if (name === null) { teardownScreen(); process.exit(0); }
    taskName = name;
  }

  while (true) {
    const sessionNumber = (await countTodayPomos(config.logDir)) + 1;
    const breakMin = sessionNumber % 4 === 0 ? config.longBreakMin : config.shortBreakMin;

    const result = await runTimer(config.pomodoroMin, sessionNumber, taskName, false);

    if (result === 'cancelled') {
      const next = await askAfterCancel();
      if (next === 'quit') break;
      continue;
    }

    await appendPomodoro(config.logDir, taskName, currentTime());

    const afterPomo = await askAfterPomodoro(sessionNumber, taskName, breakMin);
    if (afterPomo === 'quit') break;

    if (afterPomo === 'break') {
      await runTimer(breakMin, sessionNumber, taskName, true);
      const afterBreak = await askAfterBreak();
      if (afterBreak === 'quit') break;
    }
  }

  teardownScreen();
  process.stdout.write('\n  Great work! 🍅\n\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
