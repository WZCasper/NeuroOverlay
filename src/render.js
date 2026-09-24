// There is only one HTML source file for the app: public/dashboard.html.
// The public overlay page (served at /overlay/:token) is that exact same
// markup with NOV_MODE flipped from "dashboard" to "public" -- previously
// this was done by hand-maintaining a second 350KB copy (public/overlay.html)
// and relying on a test to catch the two ever drifting apart. This module
// is the single place that performs that flip, so the dashboard and the
// overlay are identical by construction instead of by convention.
//
// NOV_TOKEN is intentionally NOT injected here: overlay.html always derived
// it client-side from the URL (`location.pathname.split("/").filter(Boolean).pop()`),
// so the output of this function is byte-identical for every token and is
// safely cacheable -- no per-request templating needed.

const DASHBOARD_HEADER = 'window.NOV_MODE = "dashboard";\n\n';
const PUBLIC_HEADER =
  'window.NOV_MODE = "public";\n' +
  'window.NOV_TOKEN = location.pathname.split("/").filter(Boolean).pop();\n';

export function toPublicOverlayHtml(dashboardHtml) {
  if (!dashboardHtml.includes(DASHBOARD_HEADER)) {
    // Fail loudly rather than silently serve a dashboard-mode page to OBS:
    // this only happens if dashboard.html's header ever changes shape
    // without this file being updated to match.
    throw new Error(
      "render.js: dashboard.html header no longer matches the expected " +
        'window.NOV_MODE = "dashboard"; pattern -- update DASHBOARD_HEADER in src/render.js'
    );
  }
  return dashboardHtml.replace(DASHBOARD_HEADER, PUBLIC_HEADER);
}
