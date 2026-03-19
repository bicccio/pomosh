import { parseCli } from './cli.js';
import { loadConfig, saveConfig, ensureDirectories, Config } from './config.js';
import { countTodayPomos, appendPomodoro, readRecords, listPomodoros } from './logger.js';
import {
  setupScreen,
  teardownScreen,
  screen,
  readKey,
  runTimer,
  askAfterPomodoro,
  askAfterBreak,
  askAfterCancel,
  sendNotification,
  previewSound,
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

const NOTIFICATION_SOUNDS = ['default', 'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink'];

async function showSettings(config: Config): Promise<void> {
  type NumericField = { kind: 'number'; label: string; key: 'pomodoroMin' | 'shortBreakMin' | 'longBreakMin' };
  type BoolField    = { kind: 'bool';   label: string; key: 'notificationsEnabled' };
  type CycleField   = { kind: 'cycle';  label: string; key: 'notificationSound'; options: string[] };
  type Field = NumericField | BoolField | CycleField;

  const fields: Field[] = [
    { kind: 'number', label: 'Pomodoro',       key: 'pomodoroMin',         },
    { kind: 'number', label: 'Short break',    key: 'shortBreakMin',       },
    { kind: 'number', label: 'Long break',     key: 'longBreakMin',        },
    { kind: 'bool',   label: 'Notifications',  key: 'notificationsEnabled' },
    { kind: 'cycle',  label: 'Sound',          key: 'notificationSound',   options: NOTIFICATION_SOUNDS },
  ];

  const original = {
    pomodoroMin:          config.pomodoroMin,
    shortBreakMin:        config.shortBreakMin,
    longBreakMin:         config.longBreakMin,
    notificationsEnabled: config.notificationsEnabled,
    notificationSound:    config.notificationSound,
  };

  let idx = 0;
  let editing = false;
  let editBuf = '';

  const renderRow = (i: number, inEdit: boolean, buf: string) => {
    const field = fields[i];
    const label = field.label.padEnd(14);
    if (field.kind === 'bool') {
      const val = config[field.key] ? 'on' : 'off';
      return `  \x1b[1m❯\x1b[0m ${label} ${val}`;
    }
    if (field.kind === 'cycle') {
      const opts = field.options;
      const ci = opts.indexOf(config[field.key]);
      const prev = opts[(ci - 1 + opts.length) % opts.length];
      const next = opts[(ci + 1) % opts.length];
      return `  \x1b[1m❯\x1b[0m ${label} ${DIM}${prev}${RESET} \x1b[1m${config[field.key]}\x1b[0m ${DIM}${next}${RESET}`;
    }
    if (inEdit) return `  \x1b[1m❯\x1b[0m ${label} [${buf}] min`;
    return `  \x1b[1m❯\x1b[0m ${label} ${config[field.key]} min`;
  };

  const renderIdleRow = (i: number) => {
    const field = fields[i];
    const label = field.label.padEnd(14);
    if (field.kind === 'bool') {
      const val = config[field.key] ? 'on' : 'off';
      return `    ${DIM}${label} ${val}${RESET}`;
    }
    if (field.kind === 'cycle') {
      return `    ${DIM}${label} ${config[field.key]}${RESET}`;
    }
    return `    ${DIM}${label} ${config[field.key]} min${RESET}`;
  };

  while (true) {
    const rows = fields.map((_, i) => {
      if (i === idx) return renderRow(i, editing, editBuf);
      return renderIdleRow(i);
    });

    const hint = editing
      ? `  ${DIM}[enter] confirm   [esc] cancel${RESET}`
      : `  ${DIM}[↑↓] navigate   [enter/←/→/space] edit   [esc] back${RESET}`;

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

    const currentField = fields[idx];

    const hasChanges = () =>
      config.pomodoroMin          !== original.pomodoroMin          ||
      config.shortBreakMin        !== original.shortBreakMin        ||
      config.longBreakMin         !== original.longBreakMin         ||
      config.notificationsEnabled !== original.notificationsEnabled  ||
      config.notificationSound    !== original.notificationSound;

    if ((currentField.kind === 'bool' || currentField.kind === 'cycle') && !editing) {
      if (key === '\x1b[A' && idx > 0)                 { idx--; continue; }
      if (key === '\x1b[B' && idx < fields.length - 1) { idx++; continue; }
      if (key === '\x1b') {
        if (hasChanges()) await saveConfig(config);
        return;
      }
      if (currentField.kind === 'bool') {
        if (key === ' ' || key === '\r' || key === '\n' || key === '\x1b[C' || key === '\x1b[D') {
          config.notificationsEnabled = !config.notificationsEnabled;
        }
      } else {
        const opts = currentField.options;
        const ci = opts.indexOf(config[currentField.key]);
        if (key === '\x1b[C' || key === ' ')  config.notificationSound = opts[(ci + 1) % opts.length];
        else if (key === '\x1b[D')            config.notificationSound = opts[(ci - 1 + opts.length) % opts.length];
        else { continue; }
        previewSound(config.notificationSound);
      }
      continue;
    }

    if (editing) {
      if (key === '\r' || key === '\n') {
        if (editBuf !== '') {
          const parsed = parseInt(editBuf, 10);
          if (!isNaN(parsed) && parsed > 0) {
            (config as unknown as Record<string, unknown>)[fields[idx].key] = parsed;
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
        if (hasChanges()) await saveConfig(config);
        return;
      }
    }
  }
}

async function showTextInput(prompt: string, placeholder: string, history: string[] = []): Promise<string | null> {
  let value = '';
  let historyIdx = -1;
  let savedInput = '';

  while (true) {
    const display = value || `${DIM}${placeholder}${RESET}`;
    const historyHint = history.length > 0 ? `  ${DIM}[↑↓] history   [esc] menu${RESET}` : `  ${DIM}[esc] menu${RESET}`;
    process.stdout.write(screen(
      '',
      `  ${prompt}`,
      '',
      `  \x1b[1m❯\x1b[0m ${display}`,
      '',
      historyHint,
    ));
    process.stdout.write(SHOW_CURSOR);

    const key = await readKey();
    process.stdout.write(HIDE_CURSOR);

    if (key === '\r' || key === '\n')        return value.trim() || placeholder;
    if (key === '\u0003' || key === '\x1b') return null; // Ctrl+C or Esc → back to menu
    if (key === '\x7f' || key === '\b') {
      value = value.slice(0, -1);
      historyIdx = -1;
    } else if (key === '\x1b[A' && history.length > 0) {
      // ↑ older
      if (historyIdx === -1) savedInput = value;
      if (historyIdx < history.length - 1) historyIdx++;
      value = history[historyIdx];
    } else if (key === '\x1b[B' && history.length > 0) {
      // ↓ newer
      if (historyIdx > 0) { historyIdx--; value = history[historyIdx]; }
      else if (historyIdx === 0) { historyIdx = -1; value = savedInput; }
    } else if (key.length === 1 && key >= ' ') {
      value += key;
      historyIdx = -1;
    }
  }
}

async function showLog(config: Config): Promise<void> {
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const allRecords = await readRecords(config.logDir);
  const records = allRecords.filter(r => r.date === todayISO);

  let lines: string[];
  if (records.length === 0) {
    lines = [`  ${DIM}No pomos today.${RESET}`];
  } else {
    lines = records.map((r, i) => `  ${i + 1})  ${r.time}  ${r.duration_min} min  ${r.task}`);
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

    await appendPomodoro(config.logDir, taskName, currentTime(), config.pomodoroMin);
    sendNotification(config.notificationsEnabled, 'pomosh 🍅', `Pomodoro #${sessionNumber} completato!`, config.notificationSound);

    const afterPomo = await askAfterPomodoro(sessionNumber, taskName, breakMin);
    if (afterPomo === 'quit') return 'quit';
    if (afterPomo === 'menu') return 'menu';

    if (afterPomo === 'break') {
      await runTimer(breakMin, sessionNumber, taskName, true);
      sendNotification(config.notificationsEnabled, 'pomosh', 'Pausa terminata, torna al lavoro!', config.notificationSound);
      const afterBreak = await askAfterBreak();
      if (afterBreak === 'quit') return 'quit';
      if (afterBreak === 'menu') return 'menu';
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

    const allRecords = await readRecords(config.logDir);
    const seen = new Set<string>();
    const taskHistory = allRecords
      .slice()
      .reverse()
      .map(r => r.task)
      .filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });

    const name = await showTextInput('Task name', 'e.g. writing the readme', taskHistory);
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
