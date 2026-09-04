import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'bg-surface-raised text-ink-900 hover:bg-line',
  ghost: 'bg-transparent text-ink-600 hover:text-ink-900',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold',
          'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          variantClasses[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
