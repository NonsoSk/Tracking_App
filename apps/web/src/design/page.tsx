import type { ReactNode } from 'react';
import { HeaderArt, type ObjectKind } from './art';
import { cx } from './ui';

/**
 * Page header: floating illustration, eyebrow, title and a one-line description;
 * sub-tabs or actions sit on the right (full width on phones).
 */
export function PageHero({ eyebrow, title, description, art, right, compact }: {
  eyebrow?: string; title: ReactNode; description?: ReactNode; art?: [ObjectKind, ObjectKind?, ObjectKind?]; right?: ReactNode; compact?: boolean;
}) {
  return (
    <header className="mb-[18px] flex flex-col gap-4 animate-fade-up md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        {art && <HeaderArt items={art} className={cx('hidden sm:block', compact && '!hidden')} />}
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow text-brand-700">{eyebrow}</p>}
          <h1 className={cx('font-extrabold leading-[1.1] tracking-[-0.02em] text-ink-900', compact ? 'text-[1.5rem]' : 'text-[1.75rem] sm:text-[2.3rem]')}>{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[15px] text-ink-500">{description}</p>}
        </div>
        {art && <HeaderArt items={art} className={cx('ml-auto scale-90 sm:hidden', compact && '!hidden')} />}
      </div>
      {right && <div className="flex flex-wrap gap-2 no-print md:justify-end">{right}</div>}
    </header>
  );
}
