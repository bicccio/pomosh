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
  return join(logDir, 'pomosh.jsonl');
}

interface PomoRecord {
  date: string;
  time: string;
  duration_min: number;
  task: string;
}

async function readRecords(logDir: string): Promise<PomoRecord[]> {
  const filePath = logFile(logDir);
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, 'utf-8');
  return content
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as PomoRecord);
}

export async function countTodayPomos(logDir: string): Promise<number> {
  const today = todayISO();
  const records = await readRecords(logDir);
  return records.filter(r => r.date === today).length;
}

export async function appendPomodoro(logDir: string, taskName: string, time: string, durationMin: number): Promise<void> {
  const date = todayISO();
  const record: PomoRecord = { date, time, duration_min: durationMin, task: taskName };
  await appendFile(logFile(logDir), JSON.stringify(record) + '\n');
}

export async function listPomodoros(logDir: string, date?: string): Promise<void> {
  const records = await readRecords(logDir);
  let filtered: PomoRecord[];

  if (date) {
    // CLI passes YYYYMMDD, convert to YYYY-MM-DD
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    filtered = records.filter(r => r.date === iso);
  } else {
    filtered = records.filter(r => r.date === todayISO());
  }

  if (filtered.length === 0) {
    console.log(date ? 'No pomos in this date' : 'No pomos today');
    return;
  }

  for (const r of filtered) {
    process.stdout.write(JSON.stringify(r) + '\n');
  }
}

export { PomoRecord, readRecords };
