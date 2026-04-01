import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, saveConfig, ensureDirectories } from '../config.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/home/user',
}));

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when config file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config = await loadConfig();
    expect(config.waveMin).toBe(25);
    expect(config.shortBreakMin).toBe(5);
    expect(config.longBreakMin).toBe(15);
    expect(config.notificationsEnabled).toBe(true);
    expect(config.notificationSound).toBe('default');
  });

  it('parses valid config file correctly', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue(
      'wave_min = 30\nshort_break_min = 10\nlong_break_min = 20\nnotifications_enabled = false\nnotification_sound = Basso\n'
    );

    const config = await loadConfig();
    expect(config.waveMin).toBe(30);
    expect(config.shortBreakMin).toBe(10);
    expect(config.longBreakMin).toBe(20);
    expect(config.notificationsEnabled).toBe(false);
    expect(config.notificationSound).toBe('Basso');
  });

  it('returns defaults for corrupted config file', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue('this is not valid config\nrandom garbage\n');

    const config = await loadConfig();
    expect(config.waveMin).toBe(25);
    expect(config.shortBreakMin).toBe(5);
    expect(config.longBreakMin).toBe(15);
  });

  it('returns defaults when file is unreadable', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockRejectedValue(new Error('EACCES'));

    const config = await loadConfig();
    expect(config.waveMin).toBe(25);
  });
});

describe('saveConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls writeFile with config content', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const config = await loadConfig();
    config.waveMin = 30;
    await saveConfig(config);

    expect(vi.mocked(writeFile)).toHaveBeenCalled();
    const callArgs = vi.mocked(writeFile).mock.calls[0];
    const content = callArgs[1] as string;
    expect(content).toContain('wave_min = 30');
  });
});

describe('ensureDirectories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls mkdir for both directories', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined);
    await ensureDirectories('/home/user/.surftime/waves');
    expect(vi.mocked(mkdir)).toHaveBeenCalledTimes(2);
  });
});
