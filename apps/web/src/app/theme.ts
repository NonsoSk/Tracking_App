import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'ipl.theme';
const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

function saved(): Theme | null {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch { return null; }
}
function effective(): Theme {
  return saved() ?? (media()?.matches ? 'dark' : 'light');
}
function apply(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0B1224' : '#0033A1');
}

/** Light / dark. Follows the phone until the person picks one; the choice stays on this device only. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(effective);
  useEffect(() => {
    const m = media();
    const on = () => { if (!saved()) setTheme(m?.matches ? 'dark' : 'light'); };
    m?.addEventListener?.('change', on);
    const sync = () => setTheme(effective());
    window.addEventListener('ipl-theme', sync);
    return () => { m?.removeEventListener?.('change', on); window.removeEventListener('ipl-theme', sync); };
  }, []);
  const toggle = useCallback(() => {
    const next: Theme = effective() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* private mode: still switches for this visit */ }
    apply(next);
    window.dispatchEvent(new Event('ipl-theme'));
  }, []);
  return [theme, toggle];
}
