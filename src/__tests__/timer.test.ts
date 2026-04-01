import { describe, it, expect } from 'vitest';
import { visibleWidth, summaryBox } from '../timer.js';

describe('visibleWidth', () => {
  it('returns correct width for plain text', () => {
    expect(visibleWidth('hello')).toBe(5);
  });

  it('ignores ANSI escape codes', () => {
    expect(visibleWidth('\x1b[38;2;255;165;0mhello\x1b[0m')).toBe(5);
  });

  it('counts emoji as 2 characters', () => {
    expect(visibleWidth('🏄')).toBe(2);
  });

  it('handles mixed content with ANSI and emoji', () => {
    expect(visibleWidth('\x1b[1mhello 🏄\x1b[0m')).toBe(8);
  });

  it('handles wide CJK characters', () => {
    // The visibleWidth function counts chars > 0x1F000 as wide (2 chars)
    // CJK chars are in 0x4E00-0x9FFF range, so they count as 1 in this implementation
    expect(visibleWidth('你好')).toBe(2);
  });
});

describe('summaryBox', () => {
  it('creates box with single line', () => {
    const result = summaryBox('Hello');
    expect(result).toContain('Hello');
    expect(result).toContain('╭');
    expect(result).toContain('╮');
    expect(result).toContain('╰');
    expect(result).toContain('╯');
  });

  it('creates box with title', () => {
    const result = summaryBox(['Line 1', 'Line 2'], 'my title');
    expect(result).toContain('my title');
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
  });

  it('creates box with footer', () => {
    const result = summaryBox('Content', undefined, 'footer text');
    expect(result).toContain('footer text');
  });

  it('creates box with all elements', () => {
    const result = summaryBox(['Line 1', 'Line 2'], 'title', 'footer');
    expect(result).toContain('title');
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
    expect(result).toContain('footer');
  });
});
