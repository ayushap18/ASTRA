import type { ComponentProps } from "react";
import { Button as ShadcnButton } from "@/components/ui/shadcn-button";

// Legacy API kept for existing call sites: tone → shadcn variant. New code imports shadcn-button directly.
type Tone = "primary" | "secondary" | "magenta";
const VARIANT: Record<Tone, "default" | "secondary" | "magenta"> = {
  primary: "default",
  secondary: "secondary",
  magenta: "magenta", // Sarvam only
};

export function Button({
  tone = "primary",
  ...props
}: Omit<ComponentProps<typeof ShadcnButton>, "variant"> & { tone?: Tone }) {
  return <ShadcnButton variant={VARIANT[tone]} {...props} />;
}
