/**
 * Lightweight illustrations (inline SVG, a few KB): soft gradients and
 * shadows give a subtle 3D feel without images to download.
 */
export function CommunityScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 220" className={className} role="img" aria-label="Houses in a community, with a message being answered">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DEF0ED" /><stop offset="1" stopColor="#F7F5F1" /></linearGradient>
        <linearGradient id="roofA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1A8580" /><stop offset="1" stopColor="#0F5E5B" /></linearGradient>
        <linearGradient id="roofB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F0B455" /><stop offset="1" stopColor="#C48016" /></linearGradient>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#EDE8E0" /></linearGradient>
        <linearGradient id="wallSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E3DDD3" /><stop offset="1" stopColor="#D2CABD" /></linearGradient>
        <linearGradient id="bubble" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#F1F8F7" /></linearGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0F5E5B" floodOpacity=".16" /></filter>
      </defs>
      <rect width="320" height="220" rx="28" fill="url(#sky)" />
      <ellipse cx="160" cy="192" rx="140" ry="18" fill="#0F5E5B" opacity=".08" />
      {/* palm */}
      <path d="M262 186c2-30 0-52-6-70" stroke="#6B8F5A" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M256 118c-18-6-30 2-36 10 14-4 26-4 36-10zm0 0c14-14 28-14 38-8-14 2-26 4-38 8zm0 0c-4-16 4-28 14-32-4 12-8 22-14 32zm0 0c-10-12-24-14-34-10 12 2 24 4 34 10z" fill="#7FA66B" />
      {/* house left */}
      <g filter="url(#soft)">
        <path d="M44 130l40-26 40 26v54H44z" fill="url(#wall)" />
        <path d="M124 130l22-12v58l-22 8z" fill="url(#wallSide)" />
        <path d="M36 134l48-36 48 36-8 4-40-30-40 30z" fill="url(#roofA)" />
        <path d="M84 98l62 18 8 6-30 12z" fill="#0C4A48" />
        <rect x="74" y="150" width="20" height="34" rx="3" fill="#0F5E5B" />
        <rect x="52" y="142" width="14" height="14" rx="2" fill="#DEF0ED" />
        <rect x="102" y="142" width="14" height="14" rx="2" fill="#DEF0ED" />
      </g>
      {/* house right */}
      <g filter="url(#soft)">
        <path d="M168 144l32-20 32 20v42h-64z" fill="url(#wall)" />
        <path d="M232 144l16-9v44l-16 7z" fill="url(#wallSide)" />
        <path d="M162 147l38-28 38 28-6 3-32-23-32 23z" fill="url(#roofB)" />
        <rect x="192" y="160" width="16" height="26" rx="3" fill="#A0650D" />
      </g>
      {/* people */}
      <g>
        <circle cx="146" cy="160" r="6" fill="#8A5A3C" /><path d="M136 186c0-12 4-18 10-18s10 6 10 18z" fill="#E09B2D" />
        <circle cx="160" cy="166" r="5" fill="#6E4630" /><path d="M152 188c0-10 3-15 8-15s8 5 8 15z" fill="#1A8580" />
      </g>
      {/* speech bubble with check: "we heard you" */}
      <g filter="url(#soft)">
        <rect x="132" y="40" width="70" height="46" rx="16" fill="url(#bubble)" />
        <path d="M150 84l-6 14 18-12z" fill="#F1F8F7" />
        <circle cx="167" cy="63" r="13" fill="#0F5E5B" />
        <path d="M160 63l5 5 9-10" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="226" cy="54" r="6" fill="#E09B2D" opacity=".85" />
      <circle cx="98" cy="58" r="4" fill="#1A8580" opacity=".5" />
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
      <div className="absolute inset-2 rounded-full bg-gradient-to-b from-[#F0B455] to-[#C48016] shadow-[0_10px_24px_rgb(196_128_22/0.35),inset_0_2px_0_rgb(255_255_255/0.3)]" />
      <svg viewBox="0 0 24 24" className="relative h-11 w-11" aria-hidden fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /><path d="M12 7v5m0 0-2-2m2 2 2-2" />
      </svg>
    </div>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1A8580" /><stop offset="1" stopColor="#0C4A48" /></linearGradient></defs>
      <rect width="64" height="64" rx="16" fill="url(#lg)" />
      <path d="M18 34l9 9 19-21" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
