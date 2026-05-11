"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-full border border-white/10 bg-clay px-4 py-2 text-center text-[13px] font-medium leading-none text-cream shadow-[0_12px_30px_-14px_oklch(0.28_0.02_60_/_0.45)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-tooltip-content-transform-origin)",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

type AppTooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  delayDuration?: number;
  disabled?: boolean;
} & React.ComponentPropsWithoutRef<typeof TooltipContent>;

function AppTooltip({
  content,
  children,
  delayDuration = 120,
  disabled = false,
  ...contentProps
}: AppTooltipProps) {
  void delayDuration;

  if (disabled || content == null || content === "") {
    return children;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent {...contentProps}>{content}</TooltipContent>
    </Tooltip>
  );
}

export { AppTooltip, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
