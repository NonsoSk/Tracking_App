import { describe, expect, it } from 'vitest';
import { normalizePhone, formatPhone } from './phone';
import { AppError, toAppError } from './errors';
import { formatDate } from './format';

describe('phone numbers', () => {
  it.each([
    ['0803 123 4567', '+2348031234567'],
    ['08031234567', '+2348031234567'],
    ['+234 803 123 4567', '+2348031234567'],
    ['8031234567', '+2348031234567'],
    ['0913 080 4624', '+2349130804624'],
  ])('accepts %s', (input, e164) => expect(normalizePhone(input)).toBe(e164));
  it.each(['07045', '080914591', '070348956721', '0603 123 4567', ''])('rejects %s', (input) => expect(normalizePhone(input)).toBeNull());
  it('formats for display', () => expect(formatPhone('+2348031234567')).toBe('0803 123 4567'));
});

describe('errors never leak technical text', () => {
  it('maps database keys to plain language', () => {
    const e = toAppError({ message: 'code_expired', code: '22023' });
    expect(e.key).toBe('code_expired');
    expect(e.message).toMatch(/expired/i);
    expect(e.permanent).toBe(true);
  });
  it('maps network failures as transient', () => {
    const e = toAppError(new TypeError('Failed to fetch'));
    expect(e.key).toBe('network');
    expect(e.transient).toBe(true);
  });
  it('hides unknown technical errors', () => {
    const e = toAppError({ message: 'new row violates row-level security policy for table "grievances"', code: '42501' });
    expect(e.message).not.toMatch(/row-level|policy|grievances/);
  });
  it('AppError passes through', () => expect(toAppError(new AppError('code_full')).key).toBe('code_full'));
});

describe('dates', () => {
  it('shows month precision for historical month-only dates', () => {
    expect(formatDate('2019-04-01', 'month')).toBe('Apr 2019');
    expect(formatDate('2026-09-23')).toBe('23 Sept 2026'.replace('Sept', new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date('2026-09-23T12:00:00Z'))));
  });
});

import { toCsv } from '@/staff/export';
describe('CSV export', () => {
  it('quotes, escapes and neutralises formulas', () => {
    const csv = toCsv([{ a: 'x,y', b: 'say "hi"', c: '=HYPERLINK("evil")', d: true, e: null }]);
    expect(csv.split('\r\n')[1]).toBe(`"x,y","say ""hi""","'=HYPERLINK(""evil"")",Yes,`);
  });
});
