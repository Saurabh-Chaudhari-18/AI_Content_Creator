/**
 * Error reporting (Sentry) for the web app. Off unless the build had
 * VITE_SENTRY_DSN set; then the Sentry code is downloaded separately, after
 * the app has started, so it never slows the first screen.
 *
 * Privacy: no user data is attached, and URLs lose their query and #fragment
 * before sending, because a client approval link carries its token after #.
 */
type Reporter = (error: unknown, context?: Record<string, unknown>) => void;

let report: Reporter = () => {};

/** Drop the query string and #fragment (tokens live there). */
function stripUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.split(/[?#]/)[0];
}

export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
        // Collect nothing about the person or their requests beyond the error itself.
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
        beforeSend(event) {
          if (event.request) {
            event.request.url = stripUrl(event.request.url);
            delete event.request.query_string;
            delete event.request.cookies;
          }
          return event;
        },
        beforeBreadcrumb(crumb) {
          if (crumb.data) {
            for (const key of ["url", "from", "to"]) {
              if (typeof crumb.data[key] === "string") crumb.data[key] = stripUrl(crumb.data[key] as string);
            }
          }
          return crumb;
        },
      });
      report = (error, context) => Sentry.captureException(error, context ? { extra: context } : undefined);
    })
    .catch(() => {
      /* reporting is best-effort; the app works without it */
    });
}

/** Report an error caught by the app itself (error screens). */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  report(error, context);
}
