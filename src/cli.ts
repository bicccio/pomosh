import { Command } from 'commander';

export interface CliOptions {
  list?: boolean;
  listDate?: string;
  config?: string;
  logDir?: string;
}

export interface ParsedCli {
  options: CliOptions;
  taskName: string;
}

export function parseCli(argv: string[]): ParsedCli {
  const program = new Command();

  program
    .name('pomosh')
    .usage('[-lh] [-L DATE] [-d CONFIG_FILE] [-g LOG_DIRECTORY] [pomodoro_name]')
    .description('A simple Pomodoro timer')
    .argument('[pomodoro_name]', 'name of the pomodoro task')
    .option('-l', 'list today pomos')
    .option('-L <date>', 'list DATE pomos. DATE must be in YYYYMMDD format')
    .option('-d <config_file>', 'use CONFIG_FILE other than default ~/.pomosh/pomosh.cfg')
    .option('-g <log_directory>', 'use LOG_DIRECTORY other than default ~/.pomosh/pomos/')
    .helpOption('-h, --help', 'print this help')
    .addHelpText('after', `
Configuration:
    POMO_HOME               the Pomosh home directory.
    POMO_LOG                the logs directory.
    POMO_CONFIG=CONFIG_FILE same as option -d CONFIG_FILE.

    pomodoro_min            pomodoro duration in minutes (default 25).
    short_break_min         short break duration in minutes (default 5).
    long_break_min          long break duration in minutes (default 15).`)
    .parse(argv);

  const opts = program.opts<{ l?: boolean; L?: string; d?: string; g?: string }>();
  const args = program.args;

  return {
    options: {
      list: opts.l,
      listDate: opts.L,
      config: opts.d,
      logDir: opts.g,
    },
    taskName: args[0] ?? '',
  };
}
