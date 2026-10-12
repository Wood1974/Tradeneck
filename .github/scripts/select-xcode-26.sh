#!/bin/bash
# Select the newest installed Xcode 26.x and print the iOS SDK it ships.
# App Store Connect rejects uploads built with an older SDK (run 37676381644
# used Xcode 16.4 / iOS 18.5). Xcode 27 is a separate preview and is ignored.
set -euo pipefail

python3 - <<'PY'
import os
import plistlib
import subprocess
from pathlib import Path


def version_key(text: str) -> tuple:
    parts = []
    for piece in text.split("."):
        if piece.isdigit():
            parts.append(int(piece))
        else:
            break
    return tuple(parts)


seen = set()
found = []
for app in sorted(Path("/Applications").glob("Xcode_26*.app")):
    resolved = app.resolve()
    developer = resolved / "Contents" / "Developer"
    if resolved in seen or not (developer / "usr" / "bin" / "xcodebuild").is_file():
        continue
    seen.add(resolved)
    with open(resolved / "Contents" / "Info.plist", "rb") as fh:
        info = plistlib.load(fh)
    version = str(info.get("CFBundleShortVersionString", ""))
    if version_key(version)[:1] != (26,):
        continue
    found.append((version_key(version), version, developer))

if not found:
    installed = sorted(p.name for p in Path("/Applications").glob("Xcode*.app"))
    raise SystemExit(
        "No Xcode 26.x is installed under /Applications. Found: "
        + (", ".join(installed) or "(none)")
    )

found.sort()
version, developer = found[-1][1], found[-1][2]
print(f"Selecting Xcode {version} at {developer}")
subprocess.check_call(["sudo", "xcode-select", "-s", str(developer)])
env_path = os.environ.get("GITHUB_ENV")
if env_path:
    with open(env_path, "a", encoding="utf-8") as fh:
        fh.write(f"DEVELOPER_DIR={developer}\n")
PY

# First launch accepts the license and installs extra components when this
# Xcode has not been selected on the runner image yet.
sudo xcodebuild -runFirstLaunch

echo "===== xcodebuild -version ====="
xcodebuild -version
SDK_VERSION="$(xcrun --sdk iphoneos --show-sdk-version)"
SDK_PATH="$(xcrun --sdk iphoneos --show-sdk-path)"
echo "iOS SDK: ${SDK_VERSION}"
echo "iOS SDK path: ${SDK_PATH}"
case "$SDK_VERSION" in
  26.*|2[7-9].*|[3-9][0-9].*) ;;
  *)
    echo "::error::iOS SDK ${SDK_VERSION} is older than 26. App Store Connect rejects those builds."
    exit 1
    ;;
esac
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "IOS_SDK_VERSION=${SDK_VERSION}" >> "$GITHUB_ENV"
fi
