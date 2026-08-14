const path = require("node:path");
const { pathToFileURL } = require("node:url");

module.exports = async function brandWindowsExecutable(context) {
  if (context.electronPlatformName !== "win32") return;

  const projectDirectory = context.packager.projectDir;
  const appInfo = context.packager.appInfo;
  const executablePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const iconPath = path.resolve(projectDirectory, "..", "desktop", "assets", "app-icon.ico");
  const rceditModule = pathToFileURL(path.join(projectDirectory, "node_modules", "rcedit", "lib", "index.js")).href;
  const { rcedit } = await import(rceditModule);

  await rcedit(executablePath, {
    icon: iconPath,
    "file-version": appInfo.version,
    "product-version": appInfo.version,
    "requested-execution-level": "asInvoker",
    "version-string": {
      CompanyName: "FennXWeb",
      FileDescription: appInfo.productName,
      InternalName: appInfo.productFilename,
      LegalCopyright: "Copyright © 2026 FennXWeb",
      OriginalFilename: `${appInfo.productFilename}.exe`,
      ProductName: appInfo.productName,
    },
  });
};
