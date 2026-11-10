import { describe, it, expect } from 'vitest';
import { nextVersion, insertRelease, notesFor } from './release.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

### Neu
- Etwas Neues

## [1.1.0] - 2026-11-08

- Erste Version
`;

describe('nextVersion', () => {
  it('bumps patch, minor and major', () => {
    expect(nextVersion('1.1.0', 'patch')).toBe('1.1.1');
    expect(nextVersion('1.1.3', 'minor')).toBe('1.2.0');
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('accepts an explicit version and rejects garbage', () => {
    expect(nextVersion('1.1.0', '1.5.0')).toBe('1.5.0');
    expect(() => nextVersion('1.1.0', 'gross')).toThrow();
  });
});

describe('insertRelease', () => {
  it('turns [Unreleased] into a version section and keeps an empty [Unreleased]', () => {
    const { text, notes } = insertRelease(CHANGELOG, '1.2.0', '2026-11-10', 'Titel', '- aus git');
    expect(notes).toBe('### Neu\n- Etwas Neues');
    expect(text).toContain('## [Unreleased]\n\n## [1.2.0] - 2026-11-10 – Titel\n\n### Neu\n- Etwas Neues\n\n## [1.1.0]');
  });

  it('falls back to the generated notes when [Unreleased] is empty', () => {
    const empty = CHANGELOG.replace('### Neu\n- Etwas Neues\n', '');
    const { text, notes } = insertRelease(empty, '1.1.1', '2026-11-10', '', '- Fix aus git');
    expect(notes).toBe('- Fix aus git');
    expect(text).toContain('## [1.1.1] - 2026-11-10\n\n- Fix aus git\n\n## [1.1.0]');
  });

  it('refuses a release without changes', () => {
    const empty = CHANGELOG.replace('### Neu\n- Etwas Neues\n', '');
    expect(() => insertRelease(empty, '1.1.1', '2026-11-10', '', '')).toThrow(/Keine Änderungen/);
  });
});

describe('notesFor', () => {
  it('extracts the notes of one version', () => {
    expect(notesFor(CHANGELOG, '1.1.0')).toBe('- Erste Version');
    expect(notesFor(CHANGELOG, '9.9.9')).toBeNull();
  });
});
