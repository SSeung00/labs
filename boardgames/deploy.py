"""Deploy to GitHub Pages.

    python deploy.py --init                 # first time only: create the public repo and enable Pages
    python deploy.py -m "Commit message"    # publish changes (English commit message)

Requires a GitHub CLI (gh) login. Site URL: https://<user>.github.io/<repo>/
Only the files the site needs are copied into .pages/ and pushed (no tests, no dev docs).
"""
import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, ".pages")
SITE_FILES = ["index.html", "manifest.webmanifest", "sw.js", "og.png", "icon-180.png", "icon-192.png", "icon-512.png"]
SITE_DIRS = ["core", "games"]
SKIP = (".mjs", ".md", ".py")
DESCRIPTION = "Board games to play with friends on your phone — Korean / English, AI fills empty seats"

README = """# Game Room (보드게임 놀이방)

Board games to play with friends on your phone: Dalmuti, Old Maid, One Card, Texas Hold'em, Go-Stop, Gem Merchant, Gold Mine,
Yacht Dice, Liar Game, Liar's Dice and Secret Numbers.
Create a room, send the link, and play. AI players fill any empty seats. The interface is in Korean and English (🌐 toggle).

**Play:** https://sseung00.github.io/boardgames/

There is no server: the host's browser runs the game and connects to the other players directly (PeerJS / WebRTC).
This repository contains the built site only.
"""


def run(*cmd, cwd=None, capture=False):
    print("$", " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd, text=True, capture_output=capture, encoding="utf-8")
    if r.returncode != 0:
        if capture:
            print(r.stdout, r.stderr)
        raise SystemExit(f"failed: {' '.join(cmd)}")
    return r.stdout.strip() if capture else ""


def copy_site():
    for name in os.listdir(WORK):
        if name != ".git":
            p = os.path.join(WORK, name)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    for f in SITE_FILES:
        shutil.copy2(os.path.join(HERE, f), os.path.join(WORK, f))
    for d in SITE_DIRS:
        shutil.copytree(os.path.join(HERE, d), os.path.join(WORK, d),
                        ignore=lambda _dir, names: [n for n in names if n.endswith(SKIP) or n == "__pycache__"])
    open(os.path.join(WORK, ".nojekyll"), "w").close()
    stamp_sw()
    with open(os.path.join(WORK, "README.md"), "w", encoding="utf-8") as f:
        f.write(README)


def stamp_sw():
    """The offline copy (sw.js) precaches every published file; its cache name changes whenever any file changes."""
    files, digest = [], hashlib.sha1()
    for root, dirs, names in os.walk(WORK):
        dirs[:] = [d for d in dirs if d != ".git"]
        for n in sorted(names):
            rel = os.path.relpath(os.path.join(root, n), WORK).replace(os.sep, "/")
            if rel in ("sw.js", "README.md", ".nojekyll"):
                continue
            files.append(rel)
    files.sort()
    for rel in files:
        with open(os.path.join(WORK, rel), "rb") as f:
            digest.update(rel.encode() + f.read())
    path = os.path.join(WORK, "sw.js")
    with open(path, encoding="utf-8") as f:
        s = f.read()
    start = s.index("const FILES = [")
    end = s.index("];", start) + 2
    nl = chr(10)
    listed = ("," + nl).join(f'  "{x}"' for x in ["./"] + files)
    s = s[:start] + "const FILES = [" + nl + listed + nl + "];" + s[end:]
    s = re.sub(r'const CACHE = "[^"]*";', f'const CACHE = "bg-site-{digest.hexdigest()[:10]}";', s)
    with open(path, "w", encoding="utf-8", newline=nl) as f:
        f.write(s)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--init", action="store_true")
    ap.add_argument("--repo", default="boardgames")
    ap.add_argument("-m", "--message", default="Update site", help="commit message (English)")
    args = ap.parse_args()

    user = run("gh", "api", "user", "--jq", ".login", capture=True)
    email = run("gh", "api", "user", "--jq", r'"\(.id)+\(.login)@users.noreply.github.com"', capture=True)
    if args.init and not os.path.isdir(os.path.join(WORK, ".git")):
        os.makedirs(WORK, exist_ok=True)
        run("git", "init", "-b", "main", cwd=WORK)
        run("git", "config", "user.name", user, cwd=WORK)
        run("git", "config", "user.email", email, cwd=WORK)
    if not os.path.isdir(os.path.join(WORK, ".git")):
        raise SystemExit("First deployment? Run with --init.")

    copy_site()
    run("git", "add", "-A", cwd=WORK)
    if run("git", "status", "--porcelain", cwd=WORK, capture=True):
        run("git", "commit", "-m", args.message, cwd=WORK)
    else:
        print("Nothing changed.")

    # Windows Credential Manager can hang on a login window; use gh's credentials for this push only.
    gh_cred = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]
    if args.init:
        exists = subprocess.run(["gh", "repo", "view", f"{user}/{args.repo}"], capture_output=True).returncode == 0
        if exists:
            raise SystemExit(f"{user}/{args.repo} already exists. Pick another name with --repo.")
        run("gh", "repo", "create", args.repo, "--public", "--description", DESCRIPTION)
        run("git", "remote", "add", "origin", f"https://github.com/{user}/{args.repo}.git", cwd=WORK)
        run("git", *gh_cred, "push", "-u", "origin", "main", cwd=WORK)
        run("gh", "api", "-X", "POST", f"repos/{user}/{args.repo}/pages", "-f", "source[branch]=main", "-f", "source[path]=/")
    else:
        run("git", *gh_cred, "push", "origin", "main", cwd=WORK)

    print(f"\nSite: https://{user}.github.io/{args.repo}/")
    print("A first deployment can take 1-2 minutes to come online.")


if __name__ == "__main__":
    main()
