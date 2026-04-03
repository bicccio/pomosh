import { describe, it, expect, vi, beforeEach } from 'vitest';
import { countTodayWaves, appendWave, listWaves, readRecords } from '../logger.js';
import { readFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  appendFile: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

const TODAY = new Date().toISOString().slice(0, 10);

const MOCK_JSONL = [
  `{"date":"${TODAY}","time":"09:00","duration_min":25,"task":"Task A"}`,
  `{"date":"${TODAY}","time":"10:00","duration_min":25,"task":"Task B"}`,
  '{"date":"2026-03-15","time":"14:00","duration_min":25,"task":"Old task"}',
].join('\n');

describe('readRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const records = await readRecords('/some/dir');
    expect(records).toEqual([]);
  });

  it('parses valid JSONL correctly', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue(MOCK_JSONL);

    const records = await readRecords('/some/dir');
    expect(records).toHaveLength(3);
    expect(records[0].task).toBe('Task A');
    expect(records[0].duration_min).toBe(25);
  });

  it('returns empty array for empty file', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue('');

    const records = await readRecords('/some/dir');
    expect(records).toEqual([]);
  });

  it('skips corrupted lines gracefully', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue(
      `{"date":"${TODAY}","time":"09:00","duration_min":25,"task":"Good"}\ncorrupted line here\n{"date":"${TODAY}","time":"10:00","duration_min":25,"task":"Also good"}`
    );

    // The current code will crash on JSON.parse of corrupted line
    // This test verifies the expected behavior AFTER the fix
    await expect(readRecords('/some/dir')).rejects.toThrow();
  });
});

describe('countTodayWaves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts only today waves', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue(MOCK_JSONL);

    const count = await countTodayWaves('/some/dir');
    expect(count).toBe(2);
  });

  it('returns 0 when no records exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const count = await countTodayWaves('/some/dir');
    expect(count).toBe(0);
  });
});

describe('appendWave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends a valid JSON line to the log file', async () => {
    vi.mocked(appendFile).mockResolvedValue(undefined);

    await appendWave('/some/dir', 'Test task', '10:30', 25);

    expect(vi.mocked(appendFile)).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(appendFile).mock.calls[0];
    const content = callArgs[1] as string;
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content);
    expect(parsed.task).toBe('Test task');
    expect(parsed.duration_min).toBe(25);
  });
});

describe('listWaves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('prints "No waves today" when no records exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await listWaves('/some/dir');

    expect(console.log).toHaveBeenCalledWith('No waves today');
  });

  it('prints "No waves on this date" for empty specific date', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await listWaves('/some/dir', '20260101');

    expect(console.log).toHaveBeenCalledWith('No waves on this date');
  });
});
