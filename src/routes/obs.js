import { json } from "../http.js";

const OBS_RELEASES_API = "https://api.github.com/repos/obsproject/obs-studio/releases/latest";
const CACHE_KEY = "https://internal-cache.neuroverlay/obs-latest";
const CACHE_SECONDS = 86400; // 1 раз в сутки, как попросили — Cache API сам не станет
// обращаться к GitHub чаще, пока не истечёт этот срок.

function pickAsset(assets, matcher) {
  const found = assets.find(matcher);
  return found ? found.browser_download_url : null;
}

export async function handleObsLatest(request, env, ctx) {
  const cache = caches.default;
  const cacheReq = new Request(CACHE_KEY);

  const cached = await cache.match(cacheReq);
  if (cached) return cached;

  const ghRes = await fetch(OBS_RELEASES_API, {
    headers: {
      // GitHub's API rejects requests with no User-Agent.
      "User-Agent": "NeuroOverlay (https://github.com/WZCasper/NeuroOverlay)",
      Accept: "application/vnd.github+json",
    },
  });

  if (!ghRes.ok) {
    // Don't cache a failure -- try again on the very next request instead
    // of being stuck showing an error for a whole day.
    return json({ error: "github_unavailable" }, { status: 502 });
  }

  const data = await ghRes.json();
  const assets = data.assets || [];

  const payload = {
    version: data.tag_name || null,
    releasePageUrl: data.html_url || "https://obsproject.com/download",
    // Exact asset-name patterns confirmed against the real GitHub release
    // (obs-studio v32.2.2) -- Windows ships one clear x64 installer, but
    // macOS/Linux don't have a single universal file, so those fall back
    // to the official download page on the client rather than risk
    // handing someone a binary that won't run on their machine.
    windowsInstallerUrl: pickAsset(assets, (a) => /Windows-x64-Installer\.exe$/i.test(a.name)),
    macAppleSiliconUrl: pickAsset(assets, (a) => /macOS-Apple\.dmg$/i.test(a.name)),
    macIntelUrl: pickAsset(assets, (a) => /macOS-Intel\.dmg$/i.test(a.name)),
  };

  const response = json(payload, {
    headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
  });
  ctx.waitUntil(cache.put(cacheReq, response.clone()));
  return response;
}
