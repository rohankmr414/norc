// Keep desktop download links in the upstream UI useful for Norc on Linux.
const RELEASE_URL = "https://github.com/rohankmr414/norc/releases/latest";
const NOTION_HOSTS = new Set(["notion.com", "www.notion.com", "notion.so", "www.notion.so"]);
const DESKTOP_DOWNLOAD_PATHS = new Set([
  "/product/calendar/download",
  "/product/calendar/download/desktop",
  "/calendar/desktop/mac/download",
  "/calendar/desktop/windows/download",
]);

function linuxUpdateUrl(value) {
  if (typeof value !== "string") return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (
    url.protocol !== "https:" ||
    !NOTION_HOSTS.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  )
    return value;
  return DESKTOP_DOWNLOAD_PATHS.has(url.pathname.replace(/\/$/, "")) ? RELEASE_URL : value;
}

module.exports = { linuxUpdateUrl };
