import type { CSSProperties } from "react";

import type { Brand } from "./api";

/** Warm and calm hues that sit well on both obsidian and white. */
const FALLBACK = ["#D4A15F", "#E07A5F", "#3FB6A8", "#8FB573", "#D17AA0", "#5BA4E6", "#B79CED"];

const HEX = /^#(?:[0-9a-f]{3}){1,2}$/i;

/**
 * A brand's identity colour: the first palette colour from its guidelines if it
 * has one, otherwise a stable colour picked from its id. Used only on things the
 * brand owns (its tile, avatars, the preview glow) — never on app chrome.
 */
export function brandColor(brand: Pick<Brand, "id" | "brand_guidelines"> | undefined | null): string {
  if (!brand) return "#8b97ad";
  const palette = (brand.brand_guidelines as { palette?: unknown } | null | undefined)?.palette;
  const first = Array.isArray(palette) ? palette[0] : undefined;
  if (typeof first === "string" && HEX.test(first.trim())) return first.trim();
  let h = 0;
  for (const ch of brand.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}

/** Style for an element with the `brand-tile` class. */
export function brandStyle(brand: Pick<Brand, "id" | "brand_guidelines"> | undefined | null): CSSProperties {
  return { "--b": brandColor(brand) } as CSSProperties;
}

export function initials(name: string | undefined | null): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
