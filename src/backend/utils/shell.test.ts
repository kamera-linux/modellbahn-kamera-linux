import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { shellQuote, buildCommand } from './shell.js';

/** Let a real shell parse the command and return the resulting argv. */
const argvOf = (cmd: string): string[] =>
  JSON.parse(execFileSync('sh', ['-c', `node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- ${cmd}`]).toString());

describe('shellQuote', () => {
  it('leaves simple values untouched', () => {
    expect(shellQuote('1920')).toBe('1920');
    expect(shellQuote('/tmp/a_b-c.jpg')).toBe('/tmp/a_b-c.jpg');
    expect(shellQuote('0.25,0.25,0.5,0.5')).toBe('0.25,0.25,0.5,0.5');
  });

  it.each([
    '"; rm -rf ~ #',
    "'; touch /tmp/pwned; '",
    '$(id)',
    '`id`',
    'a b\tc\nd',
    '',
    "it's"
  ])('keeps %j as a single literal argument', payload => {
    expect(argvOf(buildCommand('', [payload]).trim())).toEqual([payload]);
  });
});
