import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

// Every variant is a pill (rounded-full, min-h-11). There is deliberately no square/rounded-md variant
// and no destructive variant: failures are weight + copy, not red chrome.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-transparent " +
    "text-button transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 " +
    "disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-chrome-2",
        secondary: "bg-secondary text-secondary-foreground border-hairline hover:bg-surface-soft",
        ghost: "bg-transparent text-foreground hover:bg-surface-soft",
        link: "bg-transparent text-foreground underline underline-offset-4 min-h-0 px-0",
        inverse: "bg-white text-black hover:bg-hairline-soft", // on navy blocks / graphite rail
        magenta: "bg-accent-magenta text-white hover:bg-accent-magenta/90", // Sarvam only
      },
      size: {
        default: "min-h-11 px-6 py-2.5",
        sm: "min-h-11 px-4 py-2 text-body-sm", // tap height never below 44
        lg: "min-h-14 px-8 py-3",
        icon: "min-h-11 min-w-11 size-11 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
