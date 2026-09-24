// Applies the saved light/dark choice before the app draws (no flash). Kept as a
// file, not inline, so the Content-Security-Policy can stay script-src 'self'.
try { var t = localStorage.getItem('ipl.theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
