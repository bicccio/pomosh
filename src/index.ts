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
  sendNotification,
  previewSound,
  summaryBox,
} from './timer.js';

const SHOW_CURSOR = '\x1b[?25h';
const HIDE_CURSOR = '\x1b[?25l';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';
const TOMATO = '\x1b[38;2;255;120;60m';
const MUTED  = '\x1b[38;2;130;130;130m';

function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

async function buildSummary(logDir: string): Promise<string | null> {
  const recs = await readRecords(logDir);
  const todayISO = new Date().toISOString().slice(0, 10);
  const yesterISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const todayRecs = recs.filter(r => r.date === todayISO);
  if (todayRecs.length > 0) {
    const totalMin = todayRecs.reduce((s, r) => s + r.duration_min, 0);
    const n = todayRecs.length;
    const tomato = '\x1b[38;2;255;120;60m';
    const maxVisible = Math.max(0, Math.floor(((process.stdout.columns || 80) - 30) / 3));
    const overflow = Math.max(0, n - maxVisible);
    const visible  = n - overflow;
    const label = `${n} done · ${totalMin} min`;
    let icons = overflow > 0 ? `${DIM}+${overflow} ${RESET}` : '';
    icons += `${tomato}🍅${RESET} `.repeat(visible);
    return summaryBox([icons, '', label], 'today', '[d] details');
  }

  const yesterRecs = recs.filter(r => r.date === yesterISO);
  if (yesterRecs.length > 0) {
    const totalMin = yesterRecs.reduce((s, r) => s + r.duration_min, 0);
    const tomato = '\x1b[38;2;255;120;60m';
    return summaryBox([`${tomato}🍅${RESET} `.repeat(yesterRecs.length), '', `${yesterRecs.length} done · ${totalMin} min`], 'yesterday');
  }

  return null;
}

// ─── custom fullscreen prompts ────────────────────────────────────────────────

const MENU_OPTIONS = [
  'Start a new pomodoro',
  'View stats',
  'Settings',
  'Exit',
] as const;

async function showMenu(logDir: string): Promise<0 | 1 | 2 | 3 | 'log'> {
  const summary = await buildSummary(logDir);
  let idx = 0;

  while (true) {
    const opts = MENU_OPTIONS.map((label, i) => {
      if (i === 0 && i === idx) return `  \x1b[1m❯\x1b[0m ${TOMATO}\x1b[1m${label}\x1b[0m${RESET}`;
      if (i === 0)              return `    ${TOMATO}${label}${RESET}`;
      if (i === idx)            return `  \x1b[1m❯ ${label}\x1b[0m`;
      return `    ${label}`;
    });
    process.stdout.write(screen(
      summary,
      '',
      ...opts,
      '',
      `  ${MUTED}[↑↓] navigate   [enter] select   [q] quit${RESET}`,
    ));

    const key = await readKey();
    if (key === '\x1b[A' && idx > 0)                        idx--;
    else if (key === '\x1b[B' && idx < MENU_OPTIONS.length - 1) idx++;
    else if (key === '\r' || key === '\n')                   return idx as 0 | 1 | 2 | 3;
    else if (key === 'q' || key === 'Q')                     return 3;
    else if (key === 'd' || key === 'D')                     return 'log';
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
      null,
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

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const BAR_WIDTH = 20;
const BOLD = '\x1b[1m';

async function showStats(config: Config): Promise<void> {
  let mode: 'week' | 'month' = 'week';
  let offset = 0;
  const records = await readRecords(config.logDir);

  const countByDate = new Map<string, number>();
  const minByDate = new Map<string, number>();
  for (const r of records) {
    countByDate.set(r.date, (countByDate.get(r.date) ?? 0) + 1);
    minByDate.set(r.date, (minByDate.get(r.date) ?? 0) + r.duration_min);
  }

  function toISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function render() {
    const now = new Date();
    const todayISO = toISO(now);
    let days: Date[] = [];
    let title: string;

    if (mode === 'week') {
      const dow = (now.getDay() + 6) % 7; // 0=Monday
      const monday = new Date(now);
      monday.setDate(now.getDate() - dow + offset * 7);
      monday.setHours(0, 0, 0, 0);
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push(d);
      }
      const fmt = (d: Date) => `${DAY_LABELS[(d.getDay())]} ${d.toLocaleString('en', { month: 'short' })} ${d.getDate()}`;
      title = `  Weekly Stats — ${fmt(days[0])} – ${fmt(days[6])}`;
    } else {
      const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(new Date(base.getFullYear(), base.getMonth(), i));
      }
      title = `  Monthly Stats — ${MONTH_NAMES[base.getMonth()]} ${base.getFullYear()}`;
    }

    const counts = days.map(d => countByDate.get(toISO(d)) ?? 0);
    const maxCount = Math.max(...counts, 1);
    const totalPomos = counts.reduce((a, b) => a + b, 0);
    const totalMin = days.reduce((s, d) => s + (minByDate.get(toISO(d)) ?? 0), 0);

    const barLines = days.map((d, i) => {
      const iso = toISO(d);
      const count = counts[i];
      const filled = Math.round((count / maxCount) * BAR_WIDTH);
      const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
      const isToday = iso === todayISO;

      let label: string;
      if (mode === 'week') {
        label = `${DAY_LABELS[d.getDay()]} ${String(d.getDate()).padStart(2)}`;
      } else {
        label = String(d.getDate()).padStart(2);
      }

      const countStr = `${count} 🍅`;
      if (isToday) {
        return `  ${BOLD}${TOMATO}${label}  ${bar}  ${countStr}${RESET}`;
      } else if (count === 0) {
        return `  ${DIM}${label}  ${bar}  ${countStr}${RESET}`;
      } else {
        return `  ${label}  ${bar}  ${countStr}`;
      }
    });

    const nextDim = offset === 0 ? DIM : '';
    const footer = `  ${DIM}[w] weekly  [m] monthly  [←] prev  ${nextDim}[→] next${DIM}  [q] back${RESET}`;
    const total = `  Total: ${totalPomos} 🍅  ${totalMin} min`;

    process.stdout.write(screen(null, '', title, '', ...barLines, '', total, '', footer));
  }

  while (true) {
    render();
    const key = await readKey();
    if (key === 'w' || key === 'W')   { mode = 'week';  offset = 0; }
    else if (key === 'm' || key === 'M') { mode = 'month'; offset = 0; }
    else if (key === '\x1b[D')        offset--;
    else if (key === '\x1b[C' && offset < 0) offset++;
    else if (key === 'q' || key === 'Q' || key === '\x1b') return;
  }
}

async function showTextInput(summary: string | null, prompt: string, placeholder: string, history: string[] = []): Promise<string | null> {
  let value = '';
  let historyIdx = -1;
  let savedInput = '';

  while (true) {
    const display = value || `${DIM}${placeholder}${RESET}`;
    const historyHint = history.length > 0 ? `  ${DIM}[↑↓] history   [esc] menu${RESET}` : `  ${DIM}[esc] menu${RESET}`;
    process.stdout.write(screen(
      summary,
      '',
      `  ${prompt}`,
      '',
      `  \x1b[1m❯\x1b[0m ${display}`,
      '',
      historyHint,
    ));
    // Position cursor at end of input field (2 lines above last line, col after "  ❯ " + value)
    process.stdout.write(`\x1b[2A\x1b[${5 + value.length}G`);
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
    null,
    '',
    "  Today's pomodoros",
    '',
    ...lines,
    '',
    `  ${DIM}[any key] back${RESET}`,
  ));

  await readKey();
}

async function todayMinutes(logDir: string): Promise<number> {
  const todayISO = new Date().toISOString().slice(0, 10);
  const recs = await readRecords(logDir);
  return recs.filter(r => r.date === todayISO).reduce((s, r) => s + r.duration_min, 0);
}

async function runSession(taskName: string, config: Config): Promise<'quit' | 'menu'> {
  while (true) {
    const sessionNumber = (await countTodayPomos(config.logDir)) + 1;
    const breakMin = sessionNumber % 4 === 0 ? config.longBreakMin : config.shortBreakMin;

    const totalMinBefore = await todayMinutes(config.logDir);

    const result = await runTimer(config.pomodoroMin, sessionNumber, taskName, false, totalMinBefore);

    if (result === 'cancelled') return 'menu';

    await appendPomodoro(config.logDir, taskName, currentTime(), config.pomodoroMin);
    sendNotification(config.notificationsEnabled, 'pomosh 🍅', `Pomodoro #${sessionNumber} completato!`, config.notificationSound);

    const postSummary = await buildSummary(config.logDir);
    const postTotalMin = await todayMinutes(config.logDir);

    const afterPomo = await askAfterPomodoro(sessionNumber, taskName, breakMin, postSummary);
    if (afterPomo === 'quit') return 'quit';
    if (afterPomo === 'menu') return 'menu';

    if (afterPomo === 'break') {
      await runTimer(breakMin, sessionNumber, taskName, true, postTotalMin);
      sendNotification(config.notificationsEnabled, 'pomosh', 'Pausa terminata, torna al lavoro!', config.notificationSound);
      const afterBreak = await askAfterBreak(postSummary);
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
    const outcome = await runSession(cliTaskName[0].toUpperCase() + cliTaskName.slice(1), config);
    if (outcome === 'quit') {
      teardownScreen();
      process.stdout.write('\n  Great work! 🍅\n\n');
      return;
    }
    // 'menu' → fall through to the interactive menu loop below
  }

  // Main loop: menu → action → back to menu
  while (true) {
    let choice: 0 | 1 | 2 | 3 | 'log';

    do {
      choice = await showMenu(config.logDir);

      if (choice === 3) { teardownScreen(); process.exit(0); }

      if (choice === 'log') {
        await showLog(config);
      }

      if (choice === 1) {
        await showStats(config);
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

    const menuSummary = await buildSummary(config.logDir);
    const name = await showTextInput(menuSummary, 'Task name', 'e.g. writing the readme', taskHistory);
    if (name === null) continue; // Ctrl+C → back to menu

    const outcome = await runSession(name[0].toUpperCase() + name.slice(1), config);
    if (outcome === 'quit') {
      teardownScreen();
      process.stdout.write('\n  Great work! 🍅\n\n');
      return;
    }
    // 'menu' → loop back to showMenu
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
