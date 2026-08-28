'use client';

import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border border-cyan-400/80 bg-cyan-500 text-slate-950 hover:bg-cyan-400 hover:border-cyan-300',
  secondary: 'border border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500 hover:bg-slate-700',
  ghost: 'border border-transparent bg-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-800/70 hover:text-slate-100',
  danger: 'border border-rose-700/80 bg-rose-950/40 text-rose-200 hover:border-rose-500 hover:bg-rose-900/50',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 min-h-8 px-2.5 text-xs',
  md: 'h-10 min-h-10 px-3.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'sm',
  loading = false,
  icon,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  const contentIcon = loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : icon;

  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {contentIcon}
      {children}
    </button>
  );
}
