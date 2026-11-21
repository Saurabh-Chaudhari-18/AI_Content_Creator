import { ImageOff, RotateCw } from "lucide-react";
import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "onError" | "src"> & {
  src: string | null | undefined;
  /** Shown instead of the image when it is missing or fails to load (default: nothing). */
  fallback?: ReactNode;
  /** Show a "Photo couldn't load · Try again" box instead of `fallback`, sized by `className`. */
  retry?: boolean;
};

/** Adds a cache-busting marker so "Try again" really asks the server again. */
function withAttempt(src: string, attempt: number): string {
  if (attempt === 0) return src;
  return `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;
}

/**
 * An <img> that never shows the browser's broken-image icon. When the file
 * is missing or fails, it shows a fallback (a brand tile, a text-post tile)
 * or, with `retry`, a soft box with a Try again button.
 */
export function SafeImage({ src, fallback = null, retry = false, className, alt = "", ...rest }: SafeImageProps) {
  // Keyed by src: a new picture gets a fresh start.
  return <SafeImageInner key={src ?? ""} src={src} fallback={fallback} retry={retry} className={className} alt={alt} {...rest} />;
}

function SafeImageInner({ src, fallback, retry, className, alt, ...rest }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (!src || failed) {
    if (!retry || !src) return <>{fallback}</>;
    return (
      <div role="img" aria-label={alt ? `${alt} (couldn’t load)` : "Photo couldn’t load"} className={cn("flex flex-col items-center justify-center gap-2 bg-muted p-3 text-center text-[13px] text-muted-foreground", className)}>
        <ImageOff className="size-5" strokeWidth={1.5} aria-hidden="true" />
        <span>Photo couldn’t load</span>
        <button
          type="button"
          onClick={() => {
            setAttempt((a) => a + 1);
            setFailed(false);
          }}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <RotateCw className="size-3.5" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  return <img src={withAttempt(src, attempt)} alt={alt} className={className} onError={() => setFailed(true)} {...rest} />;
}
