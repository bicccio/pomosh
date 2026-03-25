import type { WaveRecord } from './logger.js';

export interface WeekdayStat {
  weekday: number;     // JS convention: 0=Sun, 1=Mon, ..., 6=Sat
  avg: number;         // average waves per occurrence of this weekday
  totalWaves: number;
  distinctDays: number;
}

export interface TimeSlotStat {
  slot: string;
  count: number;
  pct: number;
}

export interface Streaks {
  current: number;
  longest: number;
}

export interface TodayInsight {
  todayCount: number;
  weekdayAvg: number;
  weekdayName: string;
  rank: 'best' | 'good' | 'average' | 'slow' | 'worst';
  hasEnoughData: boolean; // true when >= 3 historical occurrences of this weekday
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isoWeekday(iso: string): number {
  return new Date(iso + 'T00:00:00').getDay();
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function prevDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function getWavesPerWeekday(records: WaveRecord[]): WeekdayStat[] {
  const wavesByWd = new Map<number, number>();
  const daysByWd  = new Map<number, Set<string>>();

  for (const r of records) {
    const wd = isoWeekday(r.date);
    wavesByWd.set(wd, (wavesByWd.get(wd) ?? 0) + 1);
    if (!daysByWd.has(wd)) daysByWd.set(wd, new Set());
    daysByWd.get(wd)!.add(r.date);
  }

  return Array.from({ length: 7 }, (_, wd) => {
    const total = wavesByWd.get(wd) ?? 0;
    const days  = daysByWd.get(wd)?.size ?? 0;
    return { weekday: wd, avg: days > 0 ? total / days : 0, totalWaves: total, distinctDays: days };
  });
}

function hourToSlot(hhmm: string): string {
  const hour = parseInt(hhmm.slice(0, 2), 10);
  if (hour >= 6  && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 22) return 'Evening';
  return 'Night';
}

export function getWavesPerTimeSlot(records: WaveRecord[]): TimeSlotStat[] {
  const ORDER = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const counts = new Map(ORDER.map(s => [s, 0] as [string, number]));

  for (const r of records) {
    const slot = hourToSlot(r.time);
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }

  const total = records.length;
  return ORDER.map(slot => {
    const count = counts.get(slot)!;
    return { slot, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 };
  });
}

export function getStreaks(records: WaveRecord[]): Streaks {
  if (records.length === 0) return { current: 0, longest: 0 };

  const dateSet = new Set(records.map(r => r.date));
  const today   = todayISO();

  // Current streak: start from today if it has waves, otherwise from yesterday
  let current = 0;
  let check   = dateSet.has(today) ? today : prevDay(today);
  while (dateSet.has(check)) {
    current++;
    check = prevDay(check);
  }

  // Longest streak
  const sorted = [...dateSet].sort();
  let longest = 0;
  let run     = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (new Date(sorted[i] + 'T00:00:00').getTime() - new Date(sorted[i - 1] + 'T00:00:00').getTime()) / 86400000;
    if (diff === 1) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  longest = Math.max(longest, run, current);

  return { current, longest };
}

export function getTodayInsight(records: WaveRecord[]): TodayInsight | null {
  if (records.length === 0) return null;

  const today      = todayISO();
  const todayWd    = isoWeekday(today);
  const todayCount = records.filter(r => r.date === today).length;

  // Historical: same weekday, excluding today
  const historical   = records.filter(r => r.date !== today && isoWeekday(r.date) === todayWd);
  const distinctDays = new Set(historical.map(r => r.date)).size;
  const hasEnoughData = distinctDays >= 3;

  if (!hasEnoughData) {
    return { todayCount, weekdayAvg: 0, weekdayName: WEEKDAY_NAMES[todayWd], rank: 'average', hasEnoughData: false };
  }

  const weekdayAvg = historical.length / distinctDays;

  // Rank this weekday against all other weekdays (excluding today's date)
  const statsExclToday = getWavesPerWeekday(records.filter(r => r.date !== today));
  const allAvgs = statsExclToday.filter(s => s.distinctDays > 0).map(s => s.avg).sort((a, b) => a - b);
  const pct     = allAvgs.filter(a => a <= weekdayAvg).length / allAvgs.length;

  const rank =
    pct >= 0.8 ? 'best'    :
    pct >= 0.6 ? 'good'    :
    pct >= 0.4 ? 'average' :
    pct >= 0.2 ? 'slow'    : 'worst';

  return { todayCount, weekdayAvg, weekdayName: WEEKDAY_NAMES[todayWd], rank, hasEnoughData };
}
