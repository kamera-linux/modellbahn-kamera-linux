/**
 * Quote a value for safe use as a single argument in a POSIX shell command.
 * Wraps in single quotes and escapes embedded single quotes.
 */
export function shellQuote(value: string | number): string {
  const s = String(value);
  if (/^[A-Za-z0-9_./:=,@%+-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a command line from a program and its arguments.
 * The program itself is not quoted so that `~` expansion still works for script paths
 * coming from trusted configuration.
 */
export function buildCommand(program: string, args: Array<string | number>): string {
  return [program, ...args.map(shellQuote)].join(' ');
}
