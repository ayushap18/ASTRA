import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** UI-only helper. Never import from lib modules that tests cover (they must stay React/alias free). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
