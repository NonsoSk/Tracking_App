import { useId, type ReactNode } from 'react';
import { cx } from '@/design/ui';

/**
 * Lightweight illustrations (inline SVG, a few KB): soft gradients and
 * shadows give a subtle 3D feel without images to download.
 */
export function CommunityScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 220" className={className} role="img" aria-label="Houses in a community, with a message being answered">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E6ECF8" /><stop offset="1" stopColor="#F7F9FD" /></linearGradient>
        <linearGradient id="roofA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0A4FD1" /><stop offset="1" stopColor="#0033A1" /></linearGradient>
        <linearGradient id="roofB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E03A3A" /><stop offset="1" stopColor="#C00000" /></linearGradient>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#E9EDF5" /></linearGradient>
        <linearGradient id="wallSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DCE2EE" /><stop offset="1" stopColor="#C9D0DE" /></linearGradient>
        <linearGradient id="bubble" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#EEF3FC" /></linearGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0033A1" floodOpacity=".16" /></filter>
      </defs>
      <rect width="320" height="220" rx="28" fill="url(#sky)" />
      <ellipse cx="160" cy="192" rx="140" ry="18" fill="#0033A1" opacity=".08" />
      {/* palm */}
      <path d="M262 186c2-30 0-52-6-70" stroke="#6B8F5A" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M256 118c-18-6-30 2-36 10 14-4 26-4 36-10zm0 0c14-14 28-14 38-8-14 2-26 4-38 8zm0 0c-4-16 4-28 14-32-4 12-8 22-14 32zm0 0c-10-12-24-14-34-10 12 2 24 4 34 10z" fill="#7FA66B" />
      {/* house left */}
      <g filter="url(#soft)">
        <path d="M44 130l40-26 40 26v54H44z" fill="url(#wall)" />
        <path d="M124 130l22-12v58l-22 8z" fill="url(#wallSide)" />
        <path d="M36 134l48-36 48 36-8 4-40-30-40 30z" fill="url(#roofA)" />
        <path d="M84 98l62 18 8 6-30 12z" fill="#00257A" />
        <rect x="74" y="150" width="20" height="34" rx="3" fill="#0033A1" />
        <rect x="52" y="142" width="14" height="14" rx="2" fill="#E6ECF8" />
        <rect x="102" y="142" width="14" height="14" rx="2" fill="#E6ECF8" />
      </g>
      {/* house right */}
      <g filter="url(#soft)">
        <path d="M168 144l32-20 32 20v42h-64z" fill="url(#wall)" />
        <path d="M232 144l16-9v44l-16 7z" fill="url(#wallSide)" />
        <path d="M162 147l38-28 38 28-6 3-32-23-32 23z" fill="url(#roofB)" />
        <rect x="192" y="160" width="16" height="26" rx="3" fill="#8A0000" />
      </g>
      {/* people */}
      <g>
        <circle cx="146" cy="160" r="6" fill="#8A5A3C" /><path d="M136 186c0-12 4-18 10-18s10 6 10 18z" fill="#B0700E" />
        <circle cx="160" cy="166" r="5" fill="#6E4630" /><path d="M152 188c0-10 3-15 8-15s8 5 8 15z" fill="#0A4FD1" />
      </g>
      {/* speech bubble with check: "we heard you" */}
      <g filter="url(#soft)">
        <rect x="132" y="40" width="70" height="46" rx="16" fill="url(#bubble)" />
        <path d="M150 84l-6 14 18-12z" fill="#EEF3FC" />
        <circle cx="167" cy="63" r="13" fill="#0033A1" />
        <path d="M160 63l5 5 9-10" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="226" cy="54" r="6" fill="#B0700E" opacity=".85" />
      <circle cx="98" cy="58" r="4" fill="#0A4FD1" opacity=".5" />
    </svg>
  );
}

/** Animated success mark used after a submission reaches the server. */
export function SuccessMark() {
  return (
    <div className="relative mx-auto grid h-24 w-24 place-items-center animate-pop">
      <div className="absolute inset-0 rounded-full bg-success-soft" />
      <div className="absolute inset-2 rounded-full bg-gradient-to-b from-[#2E9A5E] to-[#247748] shadow-[0_10px_24px_rgb(36_119_72/0.35),inset_0_2px_0_rgb(255_255_255/0.3)]" />
      <svg viewBox="0 0 48 48" className="relative h-12 w-12" aria-hidden>
        <path d="M13 25l7 7 15-16" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="48" className="animate-draw" />
      </svg>
    </div>
  );
}

/** "Saved on this phone" mark: deliberately different from the success mark. */
export function SavedOnDeviceMark() {
  return (
    <div className="relative mx-auto grid h-24 w-24 place-items-center animate-pop">
      <div className="absolute inset-0 rounded-full bg-warning-soft" />
      <div className="absolute inset-2 rounded-full bg-gradient-to-b from-[#E08A2E] to-[#B25C07] shadow-[0_10px_24px_rgb(178_92_7/0.35),inset_0_2px_0_rgb(255_255_255/0.3)]" />
      <svg viewBox="0 0 24 24" className="relative h-11 w-11" aria-hidden fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /><path d="M12 7v5m0 0-2-2m2 2 2-2" />
      </svg>
    </div>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  // Unique gradient id: the same logo is drawn in the (hidden on phones) sidebar and the top bar.
  const id = `lg${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0A4FD1" /><stop offset="1" stopColor="#00257A" /></linearGradient></defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <circle cx="50" cy="14" r="5" fill="#C00000" />
      <path d="M18 34l9 9 19-21" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


/* ---------------------------------------------------------------------------
   Floating 3D objects for page headers. Lit from the top-left, with a white
   shine spot and a soft shadow underneath; they bob ~5px every 6s (off when
   the phone asks for reduced motion).
   --------------------------------------------------------------------------- */
export type ObjectKind = 'coin' | 'sphere' | 'block' | 'bubble' | 'book' | 'box' | 'gem' | 'shield' | 'bell' | 'pin' | 'chart' | 'check';

function Obj({ kind, size = 56, delay = 0, className }: { kind: ObjectKind; size?: number; delay?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const g = (n: string) => `${id}${n}`;
  const shadow = <ellipse cx="32" cy="60" rx="16" ry="3" fill="#0B1224" opacity=".16" />;
  const shine = (x: number, y: number, rx = 6, ry = 3.5) => <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#fff" opacity=".55" transform={`rotate(-30 ${x} ${y})`} />;
  const blue = <linearGradient id={g('b')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3D7BF0" /><stop offset=".55" stopColor="#0A4FD1" /><stop offset="1" stopColor="#00257A" /></linearGradient>;
  const gold = <linearGradient id={g('g')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F6D38A" /><stop offset=".5" stopColor="#D4952F" /><stop offset="1" stopColor="#8C5709" /></linearGradient>;
  const red = <linearGradient id={g('r')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FF6B6B" /><stop offset=".5" stopColor="#E03A3A" /><stop offset="1" stopColor="#8A0000" /></linearGradient>;
  const white = <linearGradient id={g('w')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#DCE4F5" /></linearGradient>;
  let body: ReactNode = null;
  switch (kind) {
    case 'coin': body = (<>
      <ellipse cx="32" cy="34" rx="20" ry="20" fill="#8C5709" />
      <ellipse cx="30" cy="31" rx="20" ry="20" fill={`url(#${g('g')})`} />
      <ellipse cx="30" cy="31" rx="14" ry="14" fill="none" stroke="#FDF3DF" strokeOpacity=".6" strokeWidth="2" />
      <path d="M24 31l4.5 4.5L37 26" fill="none" stroke="#FDF3DF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      {shine(22, 20)}</>); break;
    case 'sphere': body = (<><circle cx="32" cy="30" r="20" fill={`url(#${g('b')})`} />{shine(24, 20, 7, 4)}</>); break;
    case 'gem': body = (<><circle cx="32" cy="30" r="16" fill={`url(#${g('r')})`} />{shine(26, 22, 5, 3)}</>); break;
    case 'block': body = (<>
      <path d="M32 10l18 10v20L32 50 14 40V20z" fill="#00257A" />
      <path d="M32 10l18 10-18 10-18-10z" fill="#5B8CFF" />
      <path d="M14 20l18 10v20L14 40z" fill={`url(#${g('b')})`} />
      {shine(26, 16, 5, 2.5)}</>); break;
    case 'box': body = (<>
      <path d="M32 12l19 9v21L32 52 13 42V21z" fill="#B0700E" />
      <path d="M32 12l19 9-19 10-19-10z" fill="#EFD4A0" />
      <path d="M13 21l19 10v21L13 42z" fill={`url(#${g('g')})`} />
      <path d="M22 16.5l19 10v6" stroke="#C00000" strokeWidth="4" fill="none" />
      {shine(25, 17, 5, 2.5)}</>); break;
    case 'bubble': body = (<>
      <path d="M14 14h36a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H30l-10 8v-8h-6a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" fill={`url(#${g('w')})`} />
      <circle cx="22" cy="30" r="3" fill="#0033A1" /><circle cx="32" cy="30" r="3" fill="#0A4FD1" /><circle cx="42" cy="30" r="3" fill="#C00000" />
      {shine(16, 19, 4, 2)}</>); break;
    case 'book': body = (<>
      <rect x="14" y="30" width="36" height="10" rx="3" fill="#C00000" /><rect x="16" y="32" width="32" height="6" rx="1.5" fill="#fff" />
      <rect x="12" y="18" width="40" height="12" rx="3" fill={`url(#${g('b')})`} /><rect x="14" y="20.5" width="34" height="7" rx="1.5" fill="#E6ECF8" />
      <rect x="18" y="40" width="30" height="9" rx="3" fill={`url(#${g('g')})`} />
      {shine(20, 21, 4, 1.8)}</>); break;
    case 'shield': body = (<>
      <path d="M32 8l20 7v14c0 12-8 20-20 25C20 49 12 41 12 29V15z" fill={`url(#${g('b')})`} />
      <path d="M24 30l6 6 11-12" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {shine(21, 17, 5, 3)}</>); break;
    case 'bell': body = (<>
      <path d="M32 10c-9 0-15 7-15 16v10l-5 6h40l-5-6V26c0-9-6-16-15-16z" fill={`url(#${g('g')})`} />
      <circle cx="32" cy="46" r="5" fill="#8C5709" /><circle cx="46" cy="14" r="6" fill={`url(#${g('r')})`} />
      {shine(24, 18, 4, 2.5)}</>); break;
    case 'pin': body = (<>
      <path d="M32 54s-16-15-16-28a16 16 0 0 1 32 0c0 13-16 28-16 28z" fill={`url(#${g('r')})`} />
      <circle cx="32" cy="26" r="6" fill="#fff" />{shine(24, 16, 4, 2.5)}</>); break;
    case 'chart': body = (<>
      <rect x="12" y="32" width="10" height="18" rx="3" fill={`url(#${g('b')})`} />
      <rect x="27" y="20" width="10" height="30" rx="3" fill={`url(#${g('b')})`} />
      <rect x="42" y="12" width="10" height="38" rx="3" fill={`url(#${g('g')})`} />
      {shine(45, 16, 2.5, 1.5)}</>); break;
    case 'check': body = (<>
      <circle cx="32" cy="30" r="20" fill="#0F8A4A" /><circle cx="30" cy="28" r="20" fill="#20A862" />
      <path d="M21 29l6 6 13-14" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />{shine(22, 17)}</>); break;
  }
  return (
    <span className={cx('inline-block float-3d', className)} style={{ animationDelay: `${delay}s` }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden><defs>{blue}{gold}{red}{white}</defs>{shadow}{body}</svg>
    </span>
  );
}

/** A little cluster of floating objects for a page header. */
export function HeaderArt({ items, className }: { items: [ObjectKind, ObjectKind?, ObjectKind?]; className?: string }) {
  const [a, b, c] = items;
  return (
    <div className={cx('relative h-[76px] w-[92px] shrink-0', className)} aria-hidden>
      <Obj kind={a} size={58} className="absolute left-2 top-2" />
      {b && <Obj kind={b} size={34} delay={1.2} className="absolute right-0 top-0" />}
      {c && <Obj kind={c} size={28} delay={2.4} className="absolute bottom-0 right-3" />}
    </div>
  );
}
export { Obj as Object3D };
