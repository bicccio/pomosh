import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { safeWrite } from './errors.js';

export interface Config {
  waveMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  notificationsEnabled: boolean;
  notificationSound: string;
  logDir: string;
  configPath: string;
}

const DEFAULT_CONFIG: Config = {
  waveMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  notificationsEnabled: true,
  notificationSound: 'default',
  logDir: join(homedir(), '.surftime', 'waves'),
  configPath: join(homedir(), '.surftime', 'surftime.cfg'),
};

export async function ensureDirectories(logDir: string): Promise<void> {
  try {
    await mkdir(join(homedir(), '.surftime'), { recursive: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot create config directory: ${join(homedir(), '.surftime')}. Check permissions. (${msg})`);
  }
  try {
    await mkdir(logDir, { recursive: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot create config directory: ${logDir}. Check permissions. (${msg})`);
  }
}

export async function saveConfig(config: Config): Promise<boolean> {
  const content = [
    `wave_min = ${config.waveMin}`,
    `short_break_min = ${config.shortBreakMin}`,
    `long_break_min = ${config.longBreakMin}`,
    `notifications_enabled = ${config.notificationsEnabled ? 'true' : 'false'}`,
    `notification_sound = ${config.notificationSound}`,
  ].join('\n') + '\n';
  return safeWrite(config.configPath, content);
}

export async function loadConfig(configPath?: string): Promise<Config> {
  const cfg: Config = { ...DEFAULT_CONFIG };

  if (configPath) {
    cfg.configPath = configPath;
  }

  if (!existsSync(cfg.configPath)) {
    return cfg;
  }

  try {
    const content = await readFile(cfg.configPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key === 'wave_min') cfg.waveMin = parseInt(val, 10) || cfg.waveMin;
      if (key === 'short_break_min') cfg.shortBreakMin = parseInt(val, 10) || cfg.shortBreakMin;
      if (key === 'long_break_min') cfg.longBreakMin = parseInt(val, 10) || cfg.longBreakMin;
      if (key === 'notifications_enabled') cfg.notificationsEnabled = val === 'true';
      if (key === 'notification_sound' && val) cfg.notificationSound = val;
    }
  } catch {
    // config file unreadable — use defaults
  }

  return cfg;
}
