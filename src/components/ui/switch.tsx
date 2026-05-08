import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-border/70 bg-input/70 p-0.5 shadow-inner transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary/80 data-[state=checked]:bg-primary data-[state=checked]:shadow-sm data-[state=unchecked]:hover:border-primary/40 dark:bg-background/70 dark:data-[state=checked]:bg-primary dark:data-[state=unchecked]:border-white/15 dark:data-[state=unchecked]:hover:border-primary/50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full border border-black/5 bg-cream shadow-[0_2px_6px_oklch(0.22_0.02_60_/_0.18)] ring-0 transition-transform duration-200 ease-out data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 dark:border-white/10 dark:bg-foreground dark:shadow-[0_2px_8px_oklch(0_0_0_/_0.35)] dark:data-[state=checked]:bg-primary-foreground",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
