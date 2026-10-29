"""Desktop integration: run-at-log-in and app shortcuts for the background service on Windows
(Start-up folder, Start menu, Desktop) and Linux (systemd user service, app-menu launcher).

All shortcuts are per-user (Start-up folder, Start menu, Desktop) — nothing system-wide, no admin.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

from app.config import FRONTEND_DIST, ROOT_DIR

SERVICE = ROOT_DIR / "englishlab-service.pyw"
LINUX = sys.platform.startswith("linux")
PYTHONW = ROOT_DIR / "backend" / ".venv" / ("bin/python" if LINUX else "Scripts/pythonw.exe")
ICON = ROOT_DIR / "frontend" / "public" / "icons" / "englishlab.ico"
ICON_PNG = ROOT_DIR / "frontend" / "public" / "icons" / "icon-512.png"
UNIT = "englishlab.service"
CONTROL_PORT = 8095
NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
# Taskbar ID Edge gives the app window (its --app URL host + path); see URL in englishlab-service.pyw.
APP_ID = "MSEdge.englishlab.localhost_/"

# Gives a shortcut the app window's taskbar ID (System.AppUserModel.ID): the open window then groups
# under that shortcut with its icon, and pinning it relaunches through the service.
_SET_APP_ID = r"""
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LabLink {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPersistFile {
    void GetClassID(out Guid c); [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string f, bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);
  }
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PropKey { public Guid fmt; public uint pid; }
  [StructLayout(LayoutKind.Explicit)] struct PropVar { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    void GetCount(out uint c); void GetAt(uint i, out PropKey k); void GetValue(ref PropKey k, out PropVar v);
    void SetValue(ref PropKey k, ref PropVar v); void Commit();
  }
  public static void SetAppId(string path, string id) {
    object link = new ShellLink();
    IPersistFile file = (IPersistFile)link;
    file.Load(path, 2);
    PropKey key = new PropKey { fmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    PropVar val = new PropVar { vt = 31, p = Marshal.StringToCoTaskMemUni(id) };
    IPropertyStore store = (IPropertyStore)link;
    store.SetValue(ref key, ref val);
    store.Commit();
    Marshal.FreeCoTaskMem(val.p);
    file.Save(path, true);
  }
}
'@
"""


def _folder(name: str) -> Path:
    # Startup, Programs (Start menu), Desktop — resolved by Windows for the current user.
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", f"[Environment]::GetFolderPath('{name}')"],
        capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW, check=False,
    )
    return Path(out.stdout.strip())


def startup_link() -> Path:
    return _folder("Startup") / "EnglishLab.lnk"


def app_links() -> list[Path]:
    return [_folder("Programs") / "EnglishLab.lnk", _folder("Desktop") / "EnglishLab.lnk"]


def _make_link(path: Path, args: str, description: str, app_id: str | None = None) -> None:
    def q(v: str) -> str:
        return v.replace("'", "''")

    script = (
        f"$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{q(str(path))}');"
        f"$s.TargetPath = '{q(str(PYTHONW))}';"
        f"$s.Arguments = '\"{q(str(SERVICE))}\" {args}';"
        f"$s.WorkingDirectory = '{q(str(ROOT_DIR))}';"
        f"$s.IconLocation = '{q(str(ICON))}';"
        f"$s.Description = '{q(description)}';"
        "$s.Save()"
    )
    if app_id:
        script += f"\n{_SET_APP_ID}\n[LabLink]::SetAppId('{q(str(path))}', '{q(app_id)}')"
    # Encoded, so the C# helper's quotes and newlines reach PowerShell intact.
    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    r = subprocess.run(["powershell", "-NoProfile", "-EncodedCommand", encoded], capture_output=True, text=True,
                       timeout=60, creationflags=NO_WINDOW, check=False)
    if r.returncode != 0 or not path.exists():
        raise OSError(f"바로가기를 만들지 못했어요: {r.stderr.strip()[:200]}")


# ---------- Linux: a systemd user service + an app-menu launcher ----------

def _xdg(var: str, default: str) -> Path:
    return Path(os.environ.get(var) or Path.home() / default)


def unit_file() -> Path:
    return _xdg("XDG_CONFIG_HOME", ".config") / "systemd" / "user" / UNIT


def launcher_file() -> Path:
    return _xdg("XDG_DATA_HOME", ".local/share") / "applications" / "englishlab.desktop"


def _systemctl(*args: str) -> bool:
    try:
        r = subprocess.run(["systemctl", "--user", *args], capture_output=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0


def _set_autostart_linux(enabled: bool) -> None:
    if not enabled:
        _systemctl("disable", UNIT)
        return
    # The server calls npm, tailscale and CLIs, so the service keeps the PATH of whoever installed it.
    path = os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin").replace("%", "%%")
    unit_file().parent.mkdir(parents=True, exist_ok=True)
    unit_file().write_text(
        "[Unit]\nDescription=EnglishLab (background server)\n\n"
        f'[Service]\nExecStart="{PYTHONW}" "{SERVICE}"\nWorkingDirectory={ROOT_DIR}\n'
        f'Environment="PATH={path}"\nRestart=on-failure\nRestartSec=5\n\n'
        "[Install]\nWantedBy=default.target\n", encoding="utf-8")
    if not (_systemctl("daemon-reload") and _systemctl("enable", UNIT)):
        raise OSError("systemctl --user enable englishlab 에 실패했어요.")


def start_service() -> bool:
    """Linux: have systemd start the installed service; False when it is not installed."""
    return LINUX and unit_file().exists() and _systemctl("start", UNIT)


def _make_launcher() -> str:
    path = launcher_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "[Desktop Entry]\nType=Application\nName=EnglishLab\nComment=EnglishLab\n"
        f'Exec="{PYTHONW}" "{SERVICE}" --open\nIcon={ICON_PNG}\nTerminal=false\n'
        "Categories=Utility;\nStartupWMClass=EnglishLab\n", encoding="utf-8")
    return str(path)


def autostart_enabled() -> bool:
    if LINUX:
        return (unit_file().parent / "default.target.wants" / UNIT).exists()
    return startup_link().exists()


def shortcuts_made() -> bool:
    if LINUX:
        return launcher_file().exists()
    return any(p.exists() for p in app_links())


def set_autostart(enabled: bool) -> None:
    if LINUX:
        _set_autostart_linux(enabled)
        return
    link = startup_link()
    if enabled:
        _make_link(link, "", "EnglishLab (background server)")
    elif link.exists():
        link.unlink()


def make_app_shortcuts() -> list[str]:
    if LINUX:
        return [_make_launcher()]
    made = []
    for link in app_links():
        _make_link(link, "--open", "EnglishLab", APP_ID)
        made.append(str(link))
    return made


def control(command: str) -> str | None:
    try:
        with socket.create_connection(("127.0.0.1", CONTROL_PORT), timeout=2) as s:
            s.sendall(command.encode() + b"\n")
            return s.recv(1024).decode().strip()
    except OSError:
        return None


def build_info() -> dict | None:
    try:
        return json.loads((FRONTEND_DIST / "version.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def status() -> dict:
    return {
        "supervised": os.environ.get("ENGLISHLAB_SUPERVISED") == "1",
        "service": control("status"),
        "autostart": autostart_enabled(),
        "shortcuts": shortcuts_made(),
        "build": build_info(),
        "windows": sys.platform == "win32" or LINUX,  # key kept for the frontend: integration available
    }
