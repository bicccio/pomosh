import { parseCli } from './cli.js';
import { loadConfig, saveConfig, ensureDirectories, Config } from './config.js';
import { countTodayWaves, appendWave, readRecords, listWaves } from './logger.js';
import { getWavesPerWeekday, getWavesPerTimeSlot, getStreaks } from './analytics.js';
import {
  setupTerminal,
  teardownTerminal,
  screen,
  readKey,
  runTimer,
  askAfterWave,
  askAfterBreak,
  sendNotification,
  previewSound,
  summaryBox,
  sectionHeader,
} from './timer.js';
import { HIDE_CURSOR, SHOW_CURSOR } from './terminal.js';

const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';
const WAVE_COLOR = '\x1b[38;2;255;165;0m';
const MUTED  = '\x1b[38;2;130;130;130m';

function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

async function buildSummary(logDir: string): Promise<string | null> {
  const recs = await readRecords(logDir);

  if (recs.length === 0) {
    return summaryBox([
      `  ${BOLD}Ready for your first wave 🏄${RESET}`,
      `  ${BOLD}Select "Start a new wave" to begin${RESET}`,
    ], 'surf');
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const yesterISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const lastISO = recs.reduce((max, r) => r.date > max ? r.date : max, recs[0].date);
  const lastRecs = recs.filter(r => r.date === lastISO);
  const totalMin = lastRecs.reduce((s, r) => s + r.duration_min, 0);
  const n = lastRecs.length;

  let title: string;
  if (lastISO === todayISO)         title = 'today';
  else if (lastISO === yesterISO)   title = 'last · yesterday';
  else {
    const d = new Date(lastISO + 'T00:00:00');
    title = `last · ${d.toLocaleString('en', { month: 'short', day: 'numeric' })}`;
  }

  const tomato = '\x1b[38;2;255;165;0m';
  const maxVisible = Math.max(0, Math.floor(((process.stdout.columns || 80) - 30) / 3));
  const overflow = Math.max(0, n - maxVisible);
  const visible  = n - overflow;
  const countLabel = `${n} done · ${totalMin} min`;
  let icons = overflow > 0 ? `${DIM}+${overflow} ${RESET}` : '';
  icons += `${tomato}🏄${RESET} `.repeat(visible);

  return summaryBox([icons, '', countLabel], title);
}

// ─── custom fullscreen prompts ────────────────────────────────────────────────

const MENU_OPTIONS = [
  'Start a new wave',
  'Log',
  'Stats',
  'Insights',
  'Settings',
  'Exit',
] as const;

async function showMenu(logDir: string): Promise<0 | 1 | 2 | 3 | 4 | 5 | 'log'> {
  const summary = await buildSummary(logDir);
  let idx = 0;

  while (true) {
    const opts = MENU_OPTIONS.map((label, i) => {
      if (i === 0 && i === idx) return `  \x1b[1m❯\x1b[0m ${WAVE_COLOR}\x1b[1m${label}\x1b[0m${RESET}`;
      if (i === 0)              return `    ${WAVE_COLOR}${label}${RESET}`;
      if (i === idx)            return `  \x1b[1m❯ ${label}\x1b[0m`;
      return `    ${label}`;
    });
    process.stdout.write(screen(
      summary,
      '',
      ...opts,
      '',
      `  ${MUTED}[↑↓] navigate   [enter] select   [l] log   [q] quit${RESET}`,
    ));

    const key = await readKey();
    if (key === '\x1b[A' && idx > 0)                             idx--;
    else if (key === '\x1b[B' && idx < MENU_OPTIONS.length - 1)  idx++;
    else if (key === '\r' || key === '\n')                        return idx as 0 | 1 | 2 | 3 | 4 | 5;
    else if (key === 'q' || key === 'Q')                         return 5;
    else if (key === 'l' || key === 'L')                         return 'log';
  }
}

const NOTIFICATION_SOUNDS = ['default', 'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink'];

async function showSettings(config: Config): Promise<boolean> {
  type NumericField = { kind: 'number'; label: string; key: 'waveMin' | 'shortBreakMin' | 'longBreakMin' };
  type BoolField    = { kind: 'bool';   label: string; key: 'notificationsEnabled' };
  type CycleField   = { kind: 'cycle';  label: string; key: 'notificationSound'; options: string[] };
  type Field = NumericField | BoolField | CycleField;

  const fields: Field[] = [
    { kind: 'number', label: 'Wave',            key: 'waveMin',             },
    { kind: 'number', label: 'Short break',    key: 'shortBreakMin',       },
    { kind: 'number', label: 'Long break',     key: 'longBreakMin',        },
    { kind: 'bool',   label: 'Notifications',  key: 'notificationsEnabled' },
    { kind: 'cycle',  label: 'Sound',          key: 'notificationSound',   options: NOTIFICATION_SOUNDS },
  ];

  const original = {
    waveMin:              config.waveMin,
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
      ? `  ${DIM}[enter] confirm  [esc] cancel${RESET}`
      : `  ${DIM}[↑↓] navigate  [enter/←/→/space] edit  [esc] back${RESET}`;

    process.stdout.write(screen(
      null,
      '',
      sectionHeader('Settings'),
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
      config.waveMin              !== original.waveMin              ||
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
        if (hasChanges()) await saveConfig(config);
        return;
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
    let subtitle: string;
    let barLines: string[];
    let totalPomos: number;
    let totalMin: number;

    if (mode === 'week') {
      const dow = (now.getDay() + 6) % 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - dow + offset * 7);
      monday.setHours(0, 0, 0, 0);
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push(d);
      }
      const currentYear = now.getFullYear();
      const fmt = (d: Date) => {
        const base = `${DAY_LABELS[d.getDay()]} ${d.toLocaleString('en', { month: 'short' })} ${d.getDate()}`;
        return d.getFullYear() !== currentYear ? `${base} ${d.getFullYear()}` : base;
      };
      subtitle = `  ${DIM}Weekly — ${fmt(days[0])} – ${fmt(days[6])}${RESET}`;

      const counts = days.map(d => countByDate.get(toISO(d)) ?? 0);
      const maxCount = Math.max(...counts, 1);
      totalPomos = counts.reduce((a, b) => a + b, 0);
      totalMin = days.reduce((s, d) => s + (minByDate.get(toISO(d)) ?? 0), 0);

      barLines = days.map((d, i) => {
        const iso = toISO(d);
        const count = counts[i];
        const filled = Math.round((count / maxCount) * BAR_WIDTH);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        const isToday = iso === todayISO;
        const label = `${DAY_LABELS[d.getDay()]} ${String(d.getDate()).padStart(2)}`;
        const countStr = String(count).padStart(2);
        if (isToday)          return `  ${BOLD}${WAVE_COLOR}${label}  ${bar}  ${countStr} 🏄${RESET}`;
        else if (count === 0) return `  ${DIM}${label}  ${bar}  ${countStr} 🏄${RESET}`;
        else                  return `  ${label}  ${bar}  ${countStr} 🏄`;
      });

    } else {
      const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const year = base.getFullYear();
      const month = base.getMonth();
      subtitle = `  ${DIM}Monthly — ${MONTH_NAMES[month]} ${year}${RESET}`;

      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const days: Date[] = [];
      for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));

      const counts = days.map(d => countByDate.get(toISO(d)) ?? 0);
      const maxCount = Math.max(...counts, 1);
      totalPomos = counts.reduce((a, b) => a + b, 0);
      totalMin = days.reduce((s, d) => s + (minByDate.get(toISO(d)) ?? 0), 0);

      const SPARK_HEIGHT = 8;
      const chartRows: string[] = [];
      for (let row = SPARK_HEIGHT - 1; row >= 0; row--) {
        let line = '  ';
        for (let i = 0; i < days.length; i++) {
          const iso = toISO(days[i]);
          const count = counts[i];
          const isToday = iso === todayISO;
          const filledRows = count === 0 ? 0 : Math.max(1, Math.ceil((count / maxCount) * SPARK_HEIGHT));
          const filled = row < filledRows;
          if (filled) {
            line += isToday ? `${BOLD}${WAVE_COLOR}██${RESET}` : '██';
          } else {
            line += isToday ? `${BOLD}${WAVE_COLOR}░░${RESET}` : `${DIM}░░${RESET}`;
          }
        }
        chartRows.push(line);
      }

      const axisChars = Array(daysInMonth * 2).fill(' ') as string[];
      for (const d of [1, 5, 10, 15, 20, 25, daysInMonth]) {
        if (d < 1 || d > daysInMonth) continue;
        const pos = (d - 1) * 2;
        const label = String(d);
        for (let j = 0; j < label.length; j++) axisChars[pos + j] = label[j];
      }
      const axis = `  ${DIM}${axisChars.join('')}${RESET}`;
      barLines = [...chartRows, axis];
    }

    const navHints = offset < 0 ? `[←] prev  [→] next` : `[←] prev`;
    const footer = `  ${DIM}[w] weekly  [m] monthly  ${navHints}  [esc] back${RESET}`;
    const total = `  Total: ${totalPomos} 🏄  ${totalMin} min`;

    process.stdout.write(screen(null, '', sectionHeader('Stats'), '', subtitle, '', ...barLines, '', total, '', footer));
  }

  while (true) {
    render();
    const key = await readKey();
    if (key === 'w' || key === 'W')      { mode = 'week';  offset = 0; }
    else if (key === 'm' || key === 'M') { mode = 'month'; offset = 0; }
    else if (key === '\x1b[D')           offset--;
    else if (key === '\x1b[C' && offset < 0) offset++;
    else if (key === 'q' || key === 'Q') return;
    else if (key === '\x1b') return;
  }
}

async function showTextInput(summary: string | null, prompt: string, placeholder: string, history: string[] = []): Promise<string | null> {
  let value = '';
  let historyIdx = -1;
  let savedInput = '';

  while (true) {
    const effectivePlaceholder = history.length > 0
      ? `${placeholder} (↑↓ history)`
      : placeholder;
    const display = value || `${DIM}${effectivePlaceholder}${RESET}`;
    const historyHint = history.length > 0
      ? `  ${DIM}[↑↓] previous tasks   [esc] menu${RESET}`
      : `  ${DIM}[esc] menu${RESET}`;
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

    if (key === '\r' || key === '\n')        return value.trim() || effectivePlaceholder;
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

function formatDateLabel(iso: string): string {
  const todayISO = new Date().toISOString().slice(0, 10);
  const yesterISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === todayISO) return 'today';
  if (iso === yesterISO) return 'yesterday';
  const d = new Date(iso + 'T00:00:00');
  const currentYear = new Date().getFullYear();
  if (d.getFullYear() !== currentYear) {
    return d.toLocaleString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  return d.toLocaleString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

async function showLog(config: Config, initialDate?: string, withSummary = false): Promise<void> {
  const summary = withSummary ? await buildSummary(config.logDir) : null;
  const allRecords = await readRecords(config.logDir);
  const datesWithRecords = [...new Set(allRecords.map(r => r.date))].sort();

  if (datesWithRecords.length === 0) {
    process.stdout.write(screen(summary, '', sectionHeader('Log'), '', `  ${DIM}No waves yet.${RESET}`, '', `  ${DIM}[any key] back${RESET}`));
    await readKey();
    return;
  }

  let currentISO = initialDate && datesWithRecords.includes(initialDate)
    ? initialDate
    : datesWithRecords[datesWithRecords.length - 1];

  while (true) {
    const idxInDates = datesWithRecords.indexOf(currentISO);
    const hasPrev = idxInDates > 0;
    const hasNext = idxInDates < datesWithRecords.length - 1;
    const records = allRecords.filter(r => r.date === currentISO);

    const lines: string[] = records.length === 0
      ? [`  ${DIM}No waves.${RESET}`]
      : records.map(r =>
          `  ${WAVE_COLOR}${r.time}${RESET}  ${BOLD}${r.task}${RESET}`
        );

    const prevDim = hasPrev ? '' : DIM;
    const nextDim = hasNext ? '' : DIM;
    const footer = `  ${DIM}[↑↓] day  [←→] month  [enter] view  [esc] back  [q] quit${RESET}`;

    process.stdout.write(screen(
      summary,
      '',
      sectionHeader('Log'),
      '',
      `  ${DIM}${formatDateLabel(currentISO)}${RESET}`,
      '',
      ...lines,
      '',
      footer,
    ));

    const key = await readKey();
    if      (key === '\x1b[A' && hasNext) currentISO = datesWithRecords[idxInDates + 1];
    else if (key === '\x1b[B' && hasPrev) currentISO = datesWithRecords[idxInDates - 1];
    else if (key === '\x1b[C') currentISO = datesWithRecords[jumpToMonth(datesWithRecords, idxInDates, +1)];
    else if (key === '\x1b[D') currentISO = datesWithRecords[jumpToMonth(datesWithRecords, idxInDates, -1)];
    else if (key === '\r' || key === '\n') {
      await showLog(config, currentISO, true);
    }
    else if (key === 'q' || key === 'Q') return;
    else if (key === '\x1b') return;
    else if (key === 'q' || key === 'Q') return;
  }
}

function jumpToMonth(dates: string[], currentIdx: number, direction: -1 | 1): number {
  const currentMonth = dates[currentIdx].slice(0, 7);
  for (let i = currentIdx + direction; i >= 0 && i < dates.length; i += direction) {
    if (dates[i].slice(0, 7) !== currentMonth) return i;
  }
  return currentIdx;
}

async function showDayPicker(config: Config): Promise<void> {
  const allRecords = await readRecords(config.logDir);
  // most recent first
  const datesWithRecords = [...new Set(allRecords.map(r => r.date))].sort().reverse();

  if (datesWithRecords.length === 0) {
    process.stdout.write(screen(null, '', sectionHeader('Log'), '', `  ${DIM}No waves yet.${RESET}`, '', `  ${DIM}[any key] back${RESET}`));
    await readKey();
    return;
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const defaultIdx = datesWithRecords.includes(todayISO) ? datesWithRecords.indexOf(todayISO) : 0;
  let idx = defaultIdx;

  const MAX_VISIBLE = 10;

  while (true) {
    // Scroll so the selected item is centered in the window
    const scrollOffset = Math.max(0, Math.min(
      idx - Math.floor(MAX_VISIBLE / 2),
      datesWithRecords.length - MAX_VISIBLE,
    ));
    const visibleDates = datesWithRecords.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

    const maxCount  = Math.max(...datesWithRecords.map(iso => allRecords.filter(r => r.date === iso).length));
    const maxMin    = Math.max(...datesWithRecords.map(iso => allRecords.filter(r => r.date === iso).reduce((s, r) => s + r.duration_min, 0)));
    const countPad  = String(maxCount).length;
    const minPad    = String(maxMin).length;

    const selDate = new Date(datesWithRecords[idx] + 'T00:00:00');
    const subtitle = `  ${DIM}${MONTH_NAMES[selDate.getMonth()]} ${selDate.getFullYear()}${RESET}`;

    const rows = visibleDates.map((iso, vi) => {
      const dateIdx = scrollOffset + vi;
      const recs = allRecords.filter(r => r.date === iso);
      const count = recs.length;
      const totalMin = recs.reduce((s, r) => s + r.duration_min, 0);
      const label = formatDateLabel(iso);
      const info = `${String(count).padStart(countPad)} 🏄  ${String(totalMin).padStart(minPad)} min`;
      if (dateIdx === idx) return `  ${BOLD}❯ ${label.padEnd(20)} ${info}${RESET}`;
      return `    ${DIM}${label.padEnd(20)}${RESET} ${info}`;
    });

    const hasScrollUp   = scrollOffset > 0;
    const hasScrollDown = scrollOffset + MAX_VISIBLE < datesWithRecords.length;
    const scrollHint = hasScrollUp || hasScrollDown
      ? `  ${DIM}${hasScrollUp ? '↑ ' : '  '}${datesWithRecords.length} days${hasScrollDown ? ' ↓' : '  '}${RESET}`
      : '';

    process.stdout.write(screen(
      null,
      '',
      sectionHeader('Log'),
      '',
      subtitle,
      '',
      ...rows,
      ...(scrollHint ? [scrollHint] : []),
      '',
      `  ${DIM}[↑↓] day  [←→] month  [enter] view  [esc] back  [q] quit${RESET}`,
    ));

    const key = await readKey();
    if      (key === '\x1b[A' && idx > 0)                            idx--;
    else if (key === '\x1b[B' && idx < datesWithRecords.length - 1)  idx++;
    else if (key === '\x1b[C')                                        idx = jumpToMonth(datesWithRecords, idx, -1);
    else if (key === '\x1b[D')                                        idx = jumpToMonth(datesWithRecords, idx, 1);
    else if (key === '\r' || key === '\n') {
      await showLog(config, datesWithRecords[idx], false);
    }
    else if (key === 'q' || key === 'Q' || key === '\x1b')           return;
  }
}

const MON_SUN = [1, 2, 3, 4, 5, 6, 0] as const; // Mon..Sat, Sun

async function showInsights(config: Config): Promise<void> {
  const records = await readRecords(config.logDir);

  if (records.length === 0) {
    process.stdout.write(screen(null, '', sectionHeader('Insights'), '', `  ${DIM}No waves yet.${RESET}`, '', `  ${DIM}[esc] back${RESET}`));
    await readKey();
    return;
  }

  const weekdayStats = getWavesPerWeekday(records);
  const timeSlots    = getWavesPerTimeSlot(records);
  const streaks      = getStreaks(records);

  const maxAvg  = Math.max(...weekdayStats.map(s => s.avg), 1);
  const WDAY_BAR = 20;

  const weekdayLines = MON_SUN.map(wd => {
    const stat   = weekdayStats[wd];
    const filled = Math.round((stat.avg / maxAvg) * WDAY_BAR);
    const bar    = '█'.repeat(filled) + '░'.repeat(WDAY_BAR - filled);
    const avg    = stat.distinctDays > 0 ? stat.avg.toFixed(1) : '—  ';
    return `  ${DAY_LABELS[wd]}  ${bar}  ${avg}`;
  });

  const maxSlot  = Math.max(...timeSlots.map(s => s.count), 1);
  const SLOT_BAR = 16;
  const timeLines = timeSlots.map(s => {
    const filled = Math.round((s.count / maxSlot) * SLOT_BAR);
    const bar    = '█'.repeat(filled) + '░'.repeat(SLOT_BAR - filled);
    const pct    = `${String(s.pct).padStart(3)}%`;
    return `  ${s.slot.padEnd(10)}  ${bar}  ${pct}`;
  });

  const cur        = streaks.current;
  const lon        = streaks.longest;
  const streakLine = `  Current  ▸ ${cur} day${cur !== 1 ? 's' : ''}    Longest  ▸ ${lon} day${lon !== 1 ? 's' : ''}`;

  process.stdout.write(screen(
    null, '',
    sectionHeader('Insights'),
    '',
    `  ${MUTED}Per weekday${RESET}`,
    '',
    ...weekdayLines,
    '',
    `  ${MUTED}Peak time${RESET}`,
    '',
    ...timeLines,
    '',
    `  ${MUTED}Streak${RESET}`,
    '',
    streakLine,
    '',
    `  ${DIM}[esc] back  [q] quit${RESET}`,
  ));

  while (true) {
    const key = await readKey();
    if (key === 'q' || key === 'Q') return;
    if (key === '\x1b') return;
  }
}

async function todayMinutes(logDir: string): Promise<number> {
  const todayISO = new Date().toISOString().slice(0, 10);
  const recs = await readRecords(logDir);
  return recs.filter(r => r.date === todayISO).reduce((s, r) => s + r.duration_min, 0);
}

async function runSession(taskName: string, config: Config): Promise<'quit' | 'menu'> {
  while (true) {
    const sessionNumber = (await countTodayWaves(config.logDir)) + 1;
    const breakMin = sessionNumber % 4 === 0 ? config.longBreakMin : config.shortBreakMin;

    const totalMinBefore = await todayMinutes(config.logDir);

    const result = await runTimer(config.waveMin, sessionNumber, taskName, false, totalMinBefore);

    if (result === 'cancelled') return 'menu';

    const logged = await appendWave(config.logDir, taskName, currentTime(), config.waveMin);
    if (!logged) process.stderr.write(`⚠ Wave not saved to log — session continues\n`);
    sendNotification(config.notificationsEnabled, 'surf 🏄', `Wave #${sessionNumber} complete!`, config.notificationSound);

    const postSummary = await buildSummary(config.logDir);
    const postTotalMin = await todayMinutes(config.logDir);

    let afterPomo: Awaited<ReturnType<typeof askAfterWave>>;
    do {
      afterPomo = await askAfterWave(sessionNumber, taskName, breakMin, postSummary);
      if (afterPomo === 'details') await showLog(config);
    } while (afterPomo === 'details');
    if (afterPomo === 'menu') return 'menu';

    if (afterPomo === 'break') {
      await runTimer(breakMin, sessionNumber, taskName, true, postTotalMin);
      sendNotification(config.notificationsEnabled, 'surf', 'Pausa terminata, torna al lavoro!', config.notificationSound);
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
  if (options.list)     { await listWaves(config.logDir);                    process.exit(0); }
  if (options.listDate) { await listWaves(config.logDir, options.listDate);  process.exit(0); }

  // Fullscreen from the very start
  setupTerminal();

  if (cliTaskName) {
    const outcome = await runSession(cliTaskName[0].toUpperCase() + cliTaskName.slice(1), config);
    if (outcome === 'quit') {
      teardownTerminal();
      process.stdout.write('\n  Great work! 🏄\n\n');
      return;
    }
    // 'menu' → fall through to the interactive menu loop below
  }

  // Main loop: menu → action → back to menu
  while (true) {
    let choice: 0 | 1 | 2 | 3 | 4 | 5 | 'log';

    do {
      choice = await showMenu(config.logDir);

      if (choice === 5)     { teardownTerminal(); process.exit(0); }
      if (choice === 'log') { await showLog(config); }
      if (choice === 1)     { await showLog(config); }
      if (choice === 2)     { await showStats(config); }
      if (choice === 3)     { await showInsights(config); }
      if (choice === 4)     { const ok = await showSettings(config); if (!ok) process.stdout.write(`\n  ⚠ Settings changed but couldn't be saved\n`); }
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
      teardownTerminal();
      process.stdout.write('\n  Great work! 🏄\n\n');
      return;
    }
    // 'menu' → loop back to showMenu
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
