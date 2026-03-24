import { Command } from 'commander';

export interface CliOptions {
  list?: boolean;
  listDate?: string;
  config?: string;
  logDir?: string;
  calendar?: string;
}

export interface ParsedCli {
  options: CliOptions;
  taskName: string;
}

export function parseCli(argv: string[]): ParsedCli {
  const program = new Command();

  program
    .name('onda')
    .usage('[-lh] [-L DATE] [-d CONFIG_FILE] [-g LOG_DIRECTORY] [wave_name]')
    .description('A minimal focus timer')
    .argument('[wave_name]', 'name of the wave task')
    .option('-l', 'list today waves')
    .option('-L <date>', 'list DATE waves. DATE must be in YYYYMMDD format')
    .option('-d <config_file>', 'use CONFIG_FILE other than default ~/.onda/onda.cfg')
    .option('-g <log_directory>', 'use LOG_DIRECTORY other than default ~/.onda/waves/')
    .option('-c <calendar>', 'if enabled specify the calendar name')
    .helpOption('-h, --help', 'print this help')
    .addHelpText('after', `
Configuration:
    ONDA_HOME               the Onda home directory.
    ONDA_LOG                the logs directory.
    ONDA_CONFIG=CONFIG_FILE same as option -d CONFIG_FILE.

    wave_min                wave duration in minutes (default 25).
    short_break_min         short break duration in minutes (default 5).
    long_break_min          long break duration in minutes (default 15).

    calendar_enabled        enable Google calendar synchronization. (default='false')
    growl_enabled           enable Growl notifications. (default='false')`)
    .parse(argv);

  const opts = program.opts<{ l?: boolean; L?: string; d?: string; g?: string; c?: string }>();
  const args = program.args;

  return {
    options: {
      list: opts.l,
      listDate: opts.L,
      config: opts.d,
      logDir: opts.g,
      calendar: opts.c,
    },
    taskName: args[0] ?? '',
  };
}
