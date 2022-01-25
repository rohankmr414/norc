// Post-build hook. This file must be in the `appFiles` array in todesktop.json.
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

module.exports = (context) => {
  const APP_NAME = context.packager.appInfo.productFilename;
  const APP_OUT_DIR = context.appOutDir;
  const PLATFORM = os.platform();
  switch (PLATFORM) {
    case "darwin":
      // Add Spotlight search keywords to the app.
      const appPath = path.join(`${APP_OUT_DIR}`, `${APP_NAME}.app`);
      const keywords = [
        "calendar",
        "time",
        "schedule",
        "meet",
        "super",
        "ical",
        "ics",
      ];
      childProcess.exec(
        `xattr -xw com.apple.metadata:kMDItemKeywords $(echo '["${keywords.join(
          '","'
        )}"]' | plutil -convert binary1 - -o - | xxd -p -c 256 -u) ${appPath}`
      );
      break;
    default:
      break;
  }
};
