import * as React from "react";

import { cn } from "@/lib/utils";

type AutoResizeTextareaProps = React.ComponentProps<"textarea"> & {
  minRows?: number;
  maxRows?: number;
};

const AutoResizeTextarea = React.forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  ({ className, minRows = 1, maxRows = 6, onChange, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    const resize = React.useCallback(() => {
      const element = innerRef.current;
      if (!element) return;

      const styles = window.getComputedStyle(element);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
      const verticalChrome =
        Number.parseFloat(styles.paddingTop) +
        Number.parseFloat(styles.paddingBottom) +
        Number.parseFloat(styles.borderTopWidth) +
        Number.parseFloat(styles.borderBottomWidth);
      const minHeight = lineHeight * minRows + verticalChrome;
      const maxHeight = lineHeight * maxRows + verticalChrome;

      element.style.height = "0px";
      const nextHeight = Math.min(Math.max(element.scrollHeight, minHeight), maxHeight);
      element.style.height = `${nextHeight}px`;
      element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [maxRows, minRows]);

    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;

        if (typeof forwardedRef === "function") {
          forwardedRef(node);
          return;
        }

        if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    React.useLayoutEffect(() => {
      resize();
    }, [resize, props.value]);

    const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event);
      resize();
    };

    return (
      <textarea
        {...props}
        ref={setRef}
        rows={minRows}
        onChange={handleChange}
        className={cn(
          "flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
      />
    );
  },
);

AutoResizeTextarea.displayName = "AutoResizeTextarea";

export { AutoResizeTextarea };
