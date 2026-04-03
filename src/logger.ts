import { readFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function logFile(logDir: string): string {
  return join(logDir, 'surftime.jsonl');
}

interface WaveRecord {
  date: string;
  time: string;
  duration_min: number;
  task: string;
}

async function readRecords(logDir: string): Promise<WaveRecord[]> {
  const filePath = logFile(logDir);
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, 'utf-8');
  return content
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as WaveRecord);
}

export async function countTodayWaves(logDir: string): Promise<number> {
  const today = todayISO();
  const records = await readRecords(logDir);
  return records.filter(r => r.date === today).length;
}

export async function appendWave(logDir: string, taskName: string, time: string, durationMin: number): Promise<void> {
  const date = todayISO();
  const record: WaveRecord = { date, time, duration_min: durationMin, task: taskName };
  await appendFile(logFile(logDir), JSON.stringify(record) + '\n');
}

export async function listWaves(logDir: string, date?: string): Promise<void> {
  const records = await readRecords(logDir);
  let filtered: WaveRecord[];

  if (date) {
    // CLI passes YYYYMMDD, convert to YYYY-MM-DD
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    filtered = records.filter(r => r.date === iso);
  } else {
    filtered = records.filter(r => r.date === todayISO());
  }

  if (filtered.length === 0) {
    console.log(date ? 'No waves on this date' : 'No waves today');
    return;
  }

  if (process.stdout.isTTY) {
    const padTime = 8;
    const padDur = 10;
    const totalMin = filtered.reduce((s, r) => s + r.duration_min, 0);
    const BOLD = '\x1b[1m';
    const DIM = '\x1b[2m';
    const RESET = '\x1b[0m';

    console.log('');
    console.log(`  ${BOLD}Time${RESET}${' '.repeat(padTime - 4)} ${BOLD}Duration${RESET}${' '.repeat(padDur - 8)} ${BOLD}Task${RESET}`);
    console.log(`  ${DIM}${'─'.repeat(padTime)}${RESET} ${DIM}${'─'.repeat(padDur)}${RESET} ${DIM}${'─'.repeat(40)}${RESET}`);
    for (const r of filtered) {
      console.log(`  ${r.time.padEnd(padTime)} ${String(r.duration_min + ' min').padEnd(padDur)} ${r.task}`);
    }
    console.log('');
    console.log(`  ${DIM}${filtered.length} wave${filtered.length !== 1 ? 's' : ''} · ${totalMin} min${RESET}`);
    console.log('');
  } else {
    for (const r of filtered) {
      process.stdout.write(JSON.stringify(r) + '\n');
    }
  }
}

export { WaveRecord, readRecords };
