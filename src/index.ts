import { parseCli } from './cli.js';
import { loadConfig, saveConfig, ensureDirectories, Config } from './config.js';
import { countTodayPomos, appendPomodoro, listPomodoros } from './logger.js';
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
  'Settings',
  'Exit',
] as const;

async function showMenu(): Promise<0 | 1 | 2 | 3> {
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
      `  ${DIM}[↑↓] navigate   [enter] select   [q] quit${RESET}`,
    ));

    const key = await readKey();
    if (key === '\x1b[A' && idx > 0)                        idx--;
    else if (key === '\x1b[B' && idx < MENU_OPTIONS.length - 1) idx++;
    else if (key === '\r' || key === '\n')                   return idx as 0 | 1 | 2 | 3;
    else if (key === 'q' || key === 'Q')                     return 3;
  }
}

async function showSettings(config: Config): Promise<void> {
  const fields = [
    { label: 'Pomodoro',    key: 'pomodoroMin'   as keyof Config },
    { label: 'Short break', key: 'shortBreakMin' as keyof Config },
    { label: 'Long break',  key: 'longBreakMin'  as keyof Config },
  ];

  const original = {
    pomodoroMin:   config.pomodoroMin,
    shortBreakMin: config.shortBreakMin,
    longBreakMin:  config.longBreakMin,
  };

  let idx = 0;
  let editing = false;
  let editBuf = '';

  const renderRow = (i: number, inEdit: boolean, buf: string) => {
    const field = fields[i];
    const value = config[field.key] as number;
    const label = field.label.padEnd(12);
    if (inEdit) {
      return `  \x1b[1m❯\x1b[0m ${label} [${buf}] min`;
    }
    return `  \x1b[1m❯\x1b[0m ${label} ${value} min`;
  };

  const renderIdleRow = (i: number) => {
    const field = fields[i];
    const value = config[field.key] as number;
    const label = field.label.padEnd(12);
    return `    ${DIM}${label} ${value} min${RESET}`;
  };

  while (true) {
    const rows = fields.map((_, i) => {
      if (i === idx) return renderRow(i, editing, editBuf);
      return renderIdleRow(i);
    });

    const hint = editing
      ? `  ${DIM}[enter] confirm   [esc] cancel${RESET}`
      : `  ${DIM}[↑↓] navigate   [enter] edit   [esc] back${RESET}`;

    process.stdout.write(screen(
      '',
      '  Settings',
      '',
      ...rows,
      '',
      hint,
    ));

    if (editing) process.stdout.write(SHOW_CURSOR);

    const key = await readKey();

    if (editing) process.stdout.write(HIDE_CURSOR);

    if (editing) {
      if (key === '\r' || key === '\n') {
        if (editBuf !== '') {
          const parsed = parseInt(editBuf, 10);
          if (!isNaN(parsed) && parsed > 0) {
            (config as Record<string, unknown>)[fields[idx].key] = parsed;
          }
        }
        editing = false;
        editBuf = '';
      } else if (key === '\x1b') {
        editing = false;
        editBuf = '';
      } else if (key === '\x7f' || key === '\b') {
        editBuf = editBuf.slice(0, -1);
      } else if (key >= '0' && key <= '9') {
        editBuf += key;
      }
    } else {
      if (key === '\x1b[A' && idx > 0)                    idx--;
      else if (key === '\x1b[B' && idx < fields.length - 1) idx++;
      else if (key === '\r' || key === '\n') {
        editing = true;
        editBuf = '';
      } else if (key === '\x1b') {
        const changed =
          config.pomodoroMin   !== original.pomodoroMin   ||
          config.shortBreakMin !== original.shortBreakMin ||
          config.longBreakMin  !== original.longBreakMin;
        if (changed) await saveConfig(config);
        return;
      }
    }
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

async function showLog(config: Config): Promise<void> {
  const { existsSync } = await import('fs');
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const filePath = join(config.logDir, `pomodoro_${stamp}.log`);

  let lines: string[];
  if (!existsSync(filePath)) {
    lines = [`  ${DIM}No pomos today.${RESET}`];
  } else {
    const content = await readFile(filePath, 'utf-8');
    lines = content.split('\n').filter(l => l.trim() !== '').map(l => `  ${l}`);
  }

  process.stdout.write(screen(
    '',
    "  Today's pomodoros",
    '',
    ...lines,
    '',
    `  ${DIM}[any key] back${RESET}`,
  ));

  await readKey();
}

async function runSession(taskName: string, config: Config): Promise<'quit' | 'menu'> {
  while (true) {
    const sessionNumber = (await countTodayPomos(config.logDir)) + 1;
    const breakMin = sessionNumber % 4 === 0 ? config.longBreakMin : config.shortBreakMin;

    const result = await runTimer(config.pomodoroMin, sessionNumber, taskName, false);

    if (result === 'cancelled') {
      const next = await askAfterCancel();
      if (next === 'quit') return 'quit';
      if (next === 'menu') return 'menu';
      continue;
    }

    await appendPomodoro(config.logDir, taskName, currentTime());

    const afterPomo = await askAfterPomodoro(sessionNumber, taskName, breakMin);
    if (afterPomo === 'quit') return 'quit';
    if (afterPomo === 'menu') return 'menu';

    if (afterPomo === 'break') {
      const breakResult = await runTimer(breakMin, sessionNumber, taskName, true);
      if (breakResult === 'completed') {
        const afterBreak = await askAfterBreak();
        if (afterBreak === 'quit') return 'quit';
        if (afterBreak === 'menu') return 'menu';
      }
    }
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

  // If task was passed via CLI, skip the menu entirely
  if (cliTaskName) {
    const outcome = await runSession(cliTaskName, config);
    if (outcome === 'quit') {
      teardownScreen();
      process.stdout.write('\n  Great work! 🍅\n\n');
      return;
    }
    // 'menu' → fall through to the interactive menu loop below
  }

  // Main loop: menu → action → back to menu
  while (true) {
    let choice: 0 | 1 | 2 | 3;

    do {
      choice = await showMenu();

      if (choice === 3) { teardownScreen(); process.exit(0); }

      if (choice === 1) {
        await showLog(config);
      }

      if (choice === 2) {
        await showSettings(config);
      }
    } while (choice !== 0);

    const name = await showTextInput('Task name', 'e.g. writing the readme');
    if (name === null) continue; // Ctrl+C → back to menu

    const outcome = await runSession(name, config);
    if (outcome === 'quit') {
      teardownScreen();
      process.stdout.write('\n  Great work! 🍅\n\n');
      return;
    }
    // 'menu' → loop back to showMenu
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
