const assert = require("node:assert/strict");
const test = require("node:test");
const { linuxUpdateUrl } = require("../update-links.js");

test("upstream desktop download pages open the latest Norc release", () => {
  for (const url of [
    "https://www.notion.com/product/calendar/download/desktop",
    "https://notion.com/product/calendar/download/desktop/?source=update#download",
    "https://www.notion.com/product/calendar/download",
    "https://www.notion.so/calendar/desktop/mac/download?source=calendar",
    "https://notion.so/calendar/desktop/windows/download",
  ]) {
    assert.equal(linuxUpdateUrl(url), "https://github.com/rohankmr414/norc/releases/latest");
  }
});

test("meeting, authentication, mobile download and unrelated links keep their original values", () => {
  for (const url of [
    "https://meet.google.com/abc-defg-hij",
    "https://www.notion.so/login/calendar?state=test",
    "https://calendar.notion.so",
    "https://www.notion.com/product/calendar/download/ios",
    "https://www.notion.com/product/calendar/download/android",
    "https://www.notion.com/product/calendar/download/mobile",
    "https://www.notion.com/product/calendar",
    "https://www.notion.so/desktop/mac/download",
    "https://github.com/rohankmr414/norc/releases/latest",
    "https://example.com/product/calendar/download/desktop",
    "https://notion.com.example.com/product/calendar/download/desktop",
    "https://www.notion.com:8443/product/calendar/download/desktop",
    "https://user:password@www.notion.com/product/calendar/download/desktop",
    "http://www.notion.com/product/calendar/download/desktop",
    "cron://oauth/callback?code=test",
    "mailto:person@example.com",
    "file:///product/calendar/download/desktop",
    "/product/calendar/download/desktop",
    "invalid URL",
    "",
    undefined,
    null,
  ])
    assert.equal(linuxUpdateUrl(url), url);
});
