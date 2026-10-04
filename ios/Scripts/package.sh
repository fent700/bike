#!/usr/bin/env bash
#
# Wraps the last Release build into a sideloadable IPA.
#
# The build only produces Bike.app — wrapping is a separate step, and it is the
# step that silently produces a broken IPA when the build actually failed:
# resources copy before compilation, so a dead build still leaves a .app behind
# with no executable in it. That is checked here rather than discovered in eSign.
#
# Usage:  ./Scripts/package.sh   (from ios/, after the xcodebuild in the README)

set -euo pipefail
cd "$(dirname "$0")/.."

APP="build/Build/Products/Release-iphoneos/Bike.app"

if [ ! -d "$APP" ]; then
    echo "error: no build at $APP"
    echo "       run the xcodebuild command first (see README)."
    exit 1
fi

if [ ! -f "$APP/Bike" ]; then
    echo "error: $APP has no executable."
    echo "       the build failed — resources copied, compilation did not."
    exit 1
fi

# The whole UI is the web bundle. An app without it launches to a black
# screen that looks exactly like a crash.
if [ ! -f "$APP/Web/index.html" ] || ! ls "$APP"/Web/assets/*.js >/dev/null 2>&1; then
    echo "error: $APP/Web is missing or has no scripts."
    echo "       run 'npm run build:ios' in web/ before xcodegen and xcodebuild."
    exit 1
fi

# A failed build leaves the *previous* binary in place, so "no executable" only
# catches the very first failure. After that the script would happily package a
# stale app that looks fine and behaves like the last commit. Compare against
# the newest source file instead.
NEWEST_SOURCE="$(find Sources -type f \( -name '*.swift' -o -name '*.plist' \) -newer "$APP/Bike" -print -quit)"
if [ -n "$NEWEST_SOURCE" ]; then
    echo "error: $NEWEST_SOURCE is newer than the built binary."
    echo "       the last build failed or never ran — packaging it would ship stale code."
    exit 1
fi

rm -rf Payload Bike.ipa
mkdir Payload
cp -R "$APP" Payload/

# -X strips macOS resource forks and extended attributes. Sideloaders reject
# archives carrying them.
zip -qr -X Bike.ipa Payload
rm -rf Payload

echo "Bike.ipa   $(du -h Bike.ipa | cut -f1)"
echo
unzip -l Bike.ipa | head -6
