import { cn } from '@/lib/utils'

/** Machine-readout label: mono, uppercase, tracked. */
export function MonoLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground', className)} {...props} />
}

/** Presence/status dot. `busy` breathes in the signal colour. */
export function StatusDot({ state, className }: { state: 'on' | 'off' | 'busy'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 flex-none rounded-full',
        state === 'on' && 'bg-ok',
        state === 'off' && 'bg-idle',
        state === 'busy' && 'hm-breathe bg-signal',
        className,
      )}
    />
  )
}
