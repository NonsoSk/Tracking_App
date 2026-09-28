/**
 * The Indorama logo, used as supplied (never redrawn). It sits on a white plate
 * so it reads correctly on the blue bars and in dark mode.
 * To use a sharper version, replace public/brand/indorama-logo.png (same name).
 */
export function IndoramaLogo({ height = 22, plate = true, className = '' }: { height?: number; plate?: boolean; className?: string }) {
  const img = <img src="/brand/indorama-logo.png" alt="Indorama" style={{ height, width: 'auto' }} className="block select-none" draggable={false} />;
  if (!plate) return <span className={className}>{img}</span>;
  return <span className={`inline-flex items-center rounded-xl bg-white px-2.5 py-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.08)] ${className}`}>{img}</span>;
}
