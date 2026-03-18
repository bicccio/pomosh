import { readFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

function todayStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function logFilePath(logDir: string, date?: string): string {
  return join(logDir, `pomodoro_${date ?? todayStamp()}.log`);
}

export async function countTodayPomos(logDir: string): Promise<number> {
  const filePath = logFilePath(logDir);
  if (!existsSync(filePath)) return 0;
  const content = await readFile(filePath, 'utf-8');
  return content.split('\n').filter(l => l.trim() !== '').length;
}

export async function appendPomodoro(logDir: string, taskName: string, time: string): Promise<void> {
  const filePath = logFilePath(logDir);
  let n = 1;
  if (existsSync(filePath)) {
    const content = await readFile(filePath, 'utf-8');
    n = content.split('\n').filter(l => l.trim() !== '').length + 1;
  }
  // Format matches bash: `echo -e "$today_pomos) \t $time \t $eventname"`
  await appendFile(filePath, `${n}) \t ${time} \t ${taskName}\n`);
}

export async function listPomodoros(logDir: string, date?: string): Promise<void> {
  const filePath = logFilePath(logDir, date);
  if (!existsSync(filePath)) {
    console.log(date ? 'No pomos in this date' : 'No pomos today');
    return;
  }
  const content = await readFile(filePath, 'utf-8');
  process.stdout.write(content);
}
