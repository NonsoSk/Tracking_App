import { describe, expect, it } from 'vitest';
import { calmLine, type CalmPlace } from './calm';

const places: CalmPlace[] = ['home', 'concern', 'review', 'done', 'saved', 'waiting', 'resolved', 'closed', 'alerts'];
const base = { userId: 'u-1', firstName: 'Ada', community: 'Agbonchia', sent: 2, settled: 1 };

describe('calm lines', () => {
  it('has a personal line for every place', () => {
    for (const p of places) expect(calmLine(p, base).length).toBeGreaterThan(10);
  });
  it('stays the same all day for one person, and differs between people', () => {
    const d = new Date('2026-09-28T09:00:00+01:00');
    expect(calmLine('home', { ...base, now: d })).toBe(calmLine('home', { ...base, now: new Date('2026-09-28T09:30:00+01:00') }));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => calmLine('home', { ...base, userId: `u-${i}`, now: d })));
    expect(seen.size).toBeGreaterThan(3);
  });
  it('never talks people out of raising a concern', () => {
    const lines = new Set<string>();
    for (const p of places) for (let i = 0; i < 60; i++) {
      for (const h of [8, 14, 20]) lines.add(calmLine(p, { ...base, userId: `u-${i}`, now: new Date(`2026-09-${String(20 + (i % 7)).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+01:00`) }));
    }
    for (const l of lines) expect(l).not.toMatch(/don't complain|not worth|too small|forget it|let it go|calm down|overreact/i);
  });
  it('home lines never repeat the collection-status words shown on the same screen', () => {
    for (let i = 0; i < 80; i++) expect(calmLine('home', { ...base, userId: `u-${i}` })).not.toMatch(/open|grievance collection/i);
  });
});
