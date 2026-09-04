import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

export type SurfaceProps = HTMLAttributes<HTMLDivElement>;

/** The one card-like container the app reuses instead of redefining borders/radius/shadow ad hoc. */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn('rounded-2xl border border-line bg-surface', className)}
      {...props}
    />
  );
});

Surface.displayName = 'Surface';
