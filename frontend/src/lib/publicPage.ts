import { useEffect } from "react";

/** Pages for people without an account (client approval, certificate check):
 * always the light theme, never indexed by search engines. */
export function usePublicPageChrome(pageTitle: string) {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    // After the app's theme effect has run on first paint.
    const t = window.setTimeout(() => root.classList.remove("dark"), 0);
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const title = document.title;
    document.title = pageTitle;
    return () => {
      window.clearTimeout(t);
      meta.remove();
      document.title = title;
      if (wasDark) root.classList.add("dark");
    };
  }, [pageTitle]);
}
