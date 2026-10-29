#!/usr/bin/env bash
# Copy each app's local data (SQLite databases, keys, caches) from a Windows install of the Lab apps.
#   scripts/import-windows-data.sh /run/media/$USER/Windows/Users/<name>/projects
# Mount the Windows drive read-only, and turn off Windows "Fast startup" first, or NTFS may be left dirty.
# Sibling repos are included when they sit next to this one (../researchlab, ../creativelab).
set -euo pipefail
src="${1:?usage: import-windows-data.sh <Windows projects folder>}"
here="$(cd "$(dirname "$0")/.." && pwd)"

copy() {  # copy <path under the Windows projects folder> <local app folder>
  local from="$src/$1/data" to="$2"
  [ -d "$from" ] && [ -d "$to" ] || return 0
  local name
  name="$(basename "$to")"
  [ -x "$to/stop-$name.sh" ] && "$to/stop-$name.sh" >/dev/null 2>&1 || true
  echo "== $1 -> $to/data"
  rsync -a --info=stats1 --exclude logs/ "$from/" "$to/data/"
}

for app in runlab moneylab englishlab routinelab hwplab; do
  copy "$app" "$here/$app"
done
copy researchlab "$here/../researchlab"
copy creativelab/photolab "$here/../creativelab/photolab"

# ResearchLab stores absolute workspace folders (C:\Project\<name>); point them at $PROJECT_DIR/<name>.
db="$here/../researchlab/data/researchlab.db"
if [ -f "$db" ]; then
  python3 - "$db" "${PROJECT_DIR:-$HOME/Project}" <<'EOF'
import sqlite3, sys
db, base = sys.argv[1], sys.argv[2].rstrip("/")
con = sqlite3.connect(db)
for wid, path in con.execute("select id, path from workspace").fetchall():
    if len(path) > 1 and path[1] == ":":
        new = f"{base}/{path.replace(chr(92), '/').rstrip('/').split('/')[-1]}"
        con.execute("update workspace set path = ? where id = ?", (new, wid))
        print(f"workspace {path} -> {new}")
con.commit()
EOF
fi
echo "Done. Start the apps again (./<app>/start-<app>.sh) and re-run 'tailscale serve' for the phone."
