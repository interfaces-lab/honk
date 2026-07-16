import { twMerge } from "tailwind-merge";

type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return twMerge(values.filter((value): value is string => typeof value === "string").join(" "));
}
