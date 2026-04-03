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

const CONSTRAINTS = {
  waveMin:       { min: 1,  max: 120, default: 25 },
  shortBreakMin: { min: 1,  max: 30,  default: 5  },
  longBreakMin:  { min: 1,  max: 60,  default: 15 },
};

const ALLOWED_SOUNDS = ['default', 'Basso', 'Blow', 'Bottle', 'Frog', 'Funk',
  'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink'];

const DEFAULT_CONFIG: Config = {
  waveMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  notificationsEnabled: true,
  notificationSound: 'default',
  logDir: join(homedir(), '.surftime', 'waves'),
  configPath: join(homedir(), '.surftime', 'surftime.cfg'),
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function validateConfigValue(key: string, raw: unknown): { value: unknown; warning: string | null } {
  if (key === 'wave_min') {
    const v = parseInt(String(raw), 10);
    if (isNaN(v) || v < CONSTRAINTS.waveMin.min || v > CONSTRAINTS.waveMin.max) {
      return { value: CONSTRAINTS.waveMin.default, warning: `Invalid wave_min (${raw}), using default ${CONSTRAINTS.waveMin.default}` };
    }
    return { value: clamp(v, CONSTRAINTS.waveMin.min, CONSTRAINTS.waveMin.max), warning: null };
  }
  if (key === 'short_break_min') {
    const v = parseInt(String(raw), 10);
    if (isNaN(v) || v < CONSTRAINTS.shortBreakMin.min || v > CONSTRAINTS.shortBreakMin.max) {
      return { value: CONSTRAINTS.shortBreakMin.default, warning: `Invalid short_break_min (${raw}), using default ${CONSTRAINTS.shortBreakMin.default}` };
    }
    return { value: clamp(v, CONSTRAINTS.shortBreakMin.min, CONSTRAINTS.shortBreakMin.max), warning: null };
  }
  if (key === 'long_break_min') {
    const v = parseInt(String(raw), 10);
    if (isNaN(v) || v < CONSTRAINTS.longBreakMin.min || v > CONSTRAINTS.longBreakMin.max) {
      return { value: CONSTRAINTS.longBreakMin.default, warning: `Invalid long_break_min (${raw}), using default ${CONSTRAINTS.longBreakMin.default}` };
    }
    return { value: clamp(v, CONSTRAINTS.longBreakMin.min, CONSTRAINTS.longBreakMin.max), warning: null };
  }
  if (key === 'notification_sound') {
    if (raw && !ALLOWED_SOUNDS.includes(String(raw))) {
      return { value: 'default', warning: `Invalid sound "${raw}", using default` };
    }
    return { value: raw || 'default', warning: null };
  }
  return { value: raw, warning: null };
}

export { CONSTRAINTS, ALLOWED_SOUNDS };

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

      let configKey: string | null = null;
      if (key === 'wave_min') configKey = 'wave_min';
      else if (key === 'short_break_min') configKey = 'short_break_min';
      else if (key === 'long_break_min') configKey = 'long_break_min';
      else if (key === 'notification_sound') configKey = 'notification_sound';

      if (configKey) {
        const { value, warning } = validateConfigValue(configKey, val);
        if (warning) process.stderr.write(`⚠ ${warning}\n`);
        if (configKey === 'wave_min') cfg.waveMin = value as number;
        else if (configKey === 'short_break_min') cfg.shortBreakMin = value as number;
        else if (configKey === 'long_break_min') cfg.longBreakMin = value as number;
        else if (configKey === 'notification_sound') cfg.notificationSound = value as string;
      }
      if (key === 'notifications_enabled') cfg.notificationsEnabled = val === 'true';
    }
  } catch {
    // config file unreadable — use defaults
  }

  return cfg;
}
