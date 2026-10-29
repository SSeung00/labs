#!/usr/bin/env bash
# Set up the Lab apps on a Linux desktop: Python and web packages, the web build, and, for apps with a
# background service, a systemd user service plus an app-menu launcher.
#   scripts/linux-setup.sh                  all apps
#   scripts/linux-setup.sh runlab moneylab  only these
set -euo pipefail
cd "$(dirname "$0")/.."
command -v uv >/dev/null || { echo "Install uv first: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
command -v npm >/dev/null || { echo "Install Node.js 20+ first."; exit 1; }

apps=("$@")
[ ${#apps[@]} -gt 0 ] || apps=(runlab moneylab englishlab routinelab hwplab)
for app in "${apps[@]}"; do
  echo "== $app"
  "./$app/setup.sh"
  if [ -f "$app/install-autostart.sh" ]; then
    "./$app/install-autostart.sh"
  fi
done
echo "Done. Copy your data over with scripts/import-windows-data.sh if you are coming from Windows."
