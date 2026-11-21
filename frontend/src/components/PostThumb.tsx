import { Film, Type } from "lucide-react";

import type { Brand, Post } from "@/lib/api";
import { brandStyle, initials } from "@/lib/brandColor";
import { cn } from "@/lib/utils";

import { SafeImage } from "./SafeImage";

/** A brand's initials on its own colour: the stand-in for a missing logo or photo. */
export function BrandTile({ brand, name, className }: { brand?: Brand | null; name?: string; className?: string }) {
  return (
    <span aria-hidden="true" style={brandStyle(brand)} className={cn("brand-tile flex shrink-0 items-center justify-center rounded-lg text-xs font-medium", className)}>
      {initials(brand?.name ?? name) || "·"}
    </span>
  );
}

/** A brand's logo, or its initials tile when there is no logo or it fails to load. */
export function BrandLogo({ brand, className }: { brand: Brand; className?: string }) {
  return <SafeImage src={brand.logo_url} alt="" className={cn("shrink-0 object-cover", className)} fallback={<BrandTile brand={brand} className={className} />} />;
}

/**
 * A post's thumbnail in lists: its first photo, or a clear tile that says
 * what kind of post it is (text only, or video) in the brand's colour.
 * Never a blank grey square, never a broken-image icon.
 */
export function PostThumb({ post, brand, className }: { post: Pick<Post, "media">; brand?: Brand | null; className?: string }) {
  const sorted = [...post.media].sort((a, b) => a.sort_order - b.sort_order);
  const photo = sorted.find((m) => m.media_type !== "video");
  const kind = photo ? "photo" : sorted.length ? "video" : "text";
  const Icon = kind === "video" ? Film : Type;

  const tile = (
    <span
      aria-hidden="true"
      style={brandStyle(brand)}
      className={cn("brand-tile relative flex shrink-0 items-center justify-center rounded-lg text-xs font-medium", className)}
    >
      {initials(brand?.name) || "·"}
      <span className="absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-[4px] bg-background/80 text-foreground">
        <Icon className="size-2.5" strokeWidth={2} />
      </span>
    </span>
  );

  if (!photo) return tile;
  return <SafeImage src={photo.media_url} alt="" className={cn("shrink-0 rounded-lg object-cover", className)} fallback={tile} />;
}
