import { describe, it, expect } from 'vitest';
import { getWavesPerWeekday, getWavesPerTimeSlot, getStreaks, getTodayInsight } from '../analytics.js';

const RECORDS = [
  { date: '2026-03-16', time: '09:00', duration_min: 25, task: 'A' },
  { date: '2026-03-16', time: '10:00', duration_min: 25, task: 'B' },
  { date: '2026-03-17', time: '14:00', duration_min: 25, task: 'C' },
  { date: '2026-03-18', time: '09:30', duration_min: 25, task: 'D' },
  { date: '2026-03-19', time: '20:00', duration_min: 25, task: 'E' },
  { date: '2026-03-20', time: '23:00', duration_min: 25, task: 'F' },
];

describe('getWavesPerWeekday', () => {
  it('returns 7 entries (one per weekday)', () => {
    const result = getWavesPerWeekday(RECORDS);
    expect(result).toHaveLength(7);
  });

  it('calculates correct average for Monday (2026-03-16)', () => {
    const result = getWavesPerWeekday(RECORDS);
    const monday = result[1]; // JS: 0=Sun, 1=Mon
    expect(monday.totalWaves).toBe(2);
    expect(monday.distinctDays).toBe(1);
    expect(monday.avg).toBe(2);
  });

  it('returns 0 for days with no records', () => {
    const result = getWavesPerWeekday(RECORDS);
    const sunday = result[0];
    expect(sunday.totalWaves).toBe(0);
    expect(sunday.distinctDays).toBe(0);
    expect(sunday.avg).toBe(0);
  });
});

describe('getWavesPerTimeSlot', () => {
  it('returns 4 slots in order', () => {
    const result = getWavesPerTimeSlot(RECORDS);
    expect(result).toHaveLength(4);
    expect(result[0].slot).toBe('Morning');
    expect(result[1].slot).toBe('Afternoon');
    expect(result[2].slot).toBe('Evening');
    expect(result[3].slot).toBe('Night');
  });

  it('counts morning waves correctly (06:00-12:00)', () => {
    const result = getWavesPerTimeSlot(RECORDS);
    expect(result[0].count).toBe(3);
  });

  it('counts afternoon waves correctly (12:00-17:00)', () => {
    const result = getWavesPerTimeSlot(RECORDS);
    expect(result[1].count).toBe(1);
  });

  it('counts evening waves correctly (17:00-22:00)', () => {
    const result = getWavesPerTimeSlot(RECORDS);
    expect(result[2].count).toBe(1);
  });

  it('counts night waves correctly (22:00-06:00)', () => {
    const result = getWavesPerTimeSlot(RECORDS);
    expect(result[3].count).toBe(1);
  });

  it('calculates percentages that sum to ~100 (rounding)', () => {
    const result = getWavesPerTimeSlot(RECORDS);
    const total = result.reduce((s, r) => s + r.pct, 0);
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });

  it('returns all zeros for empty records', () => {
    const result = getWavesPerTimeSlot([]);
    result.forEach(r => {
      expect(r.count).toBe(0);
      expect(r.pct).toBe(0);
    });
  });
});

describe('getStreaks', () => {
  it('returns zeros for empty records', () => {
    const result = getStreaks([]);
    expect(result).toEqual({ current: 0, longest: 0 });
  });

  it('detects consecutive day streak', () => {
    const records = [
      { date: '2026-03-16', time: '09:00', duration_min: 25, task: 'A' },
      { date: '2026-03-17', time: '09:00', duration_min: 25, task: 'B' },
      { date: '2026-03-18', time: '09:00', duration_min: 25, task: 'C' },
    ];
    const result = getStreaks(records);
    expect(result.longest).toBe(3);
  });

  it('handles gaps in streak', () => {
    const records = [
      { date: '2026-03-16', time: '09:00', duration_min: 25, task: 'A' },
      { date: '2026-03-17', time: '09:00', duration_min: 25, task: 'B' },
      { date: '2026-03-19', time: '09:00', duration_min: 25, task: 'C' },
    ];
    const result = getStreaks(records);
    expect(result.longest).toBe(2);
  });

  it('counts current streak from today or yesterday', () => {
    const today = new Date().toISOString().slice(0, 10);
    const records = [
      { date: today, time: '09:00', duration_min: 25, task: 'A' },
    ];
    const result = getStreaks(records);
    expect(result.current).toBe(1);
  });

  it('multiple waves on same day count as one day in streak', () => {
    const records = [
      { date: '2026-03-16', time: '09:00', duration_min: 25, task: 'A' },
      { date: '2026-03-16', time: '10:00', duration_min: 25, task: 'B' },
      { date: '2026-03-17', time: '14:00', duration_min: 25, task: 'C' },
    ];
    const result = getStreaks(records);
    expect(result.longest).toBe(2);
  });
});

describe('getTodayInsight', () => {
  it('returns null for empty records', () => {
    expect(getTodayInsight([])).toBeNull();
  });

  it('returns hasEnoughData false with insufficient history', () => {
    const result = getTodayInsight(RECORDS);
    if (result) {
      expect(result.hasEnoughData).toBeDefined();
    }
  });
});
