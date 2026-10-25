import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  // Neutral slate primary. Colors we reserve for state (verified, bounced,
  // etc.) — the primary action stays "quiet" per coding-standards.md § web.
  primary:
    'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-500',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-400',
  ghost:
    'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
  danger:
    'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-slate-300 disabled:text-slate-500',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  leading,
  trailing,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1',
    'disabled:cursor-not-allowed',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className ?? '',
  ].join(' ');

  return (
    <button type="button" className={classes} disabled={disabled} {...rest}>
      {leading}
      <span>{children}</span>
      {trailing}
    </button>
  );
}
