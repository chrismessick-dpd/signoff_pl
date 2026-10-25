"""Stamp Signoff PL's version: assets/version.js and ?v=<hash> on every asset URL in index.html.

    python tools/stamp_version.py           # stamp
    python tools/stamp_version.py --check   # exit 1 if the stamp is stale (CI / pre-commit)

The hash covers index.html (without its ?v= stamps) and everything in assets/ except
version.js, so browsers load fresh files after an update instead of mixing old and new.
"""
import datetime
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
VERSION = ROOT / "assets" / "version.js"
ASSET_URL = re.compile(r'((?:src|href)="assets/[^"?]+)(\?v=[0-9a-fx]*)?(")')


def content_hash():
    h = hashlib.sha256()
    files = [HTML] + sorted(p for p in (ROOT / "assets").rglob("*") if p.is_file() and p != VERSION)
    for path in files:
        data = path.read_bytes().replace(b"\r\n", b"\n")
        if path == HTML:
            data = ASSET_URL.sub(r"\1\3", data.decode("utf-8")).encode("utf-8")
        h.update(path.relative_to(ROOT).as_posix().encode() + b"\0" + data + b"\0")
    return h.hexdigest()[:12]


def main():
    check = "--check" in sys.argv
    digest = content_hash()
    html = HTML.read_text(encoding="utf-8")
    stamped = ASSET_URL.sub(lambda m: m.group(1) + "?v=" + digest + m.group(3), html)
    old = VERSION.read_text(encoding="utf-8") if VERSION.exists() else ""
    if check:
        ok = stamped == html and f"hash: '{digest}'" in old
        print(("up to date (" + digest + ")") if ok else "stale - run python tools/stamp_version.py")
        return 0 if ok else 1
    if f"hash: '{digest}'" not in old:
        VERSION.write_text("window.SIGNOFF_VERSION = { hash: '" + digest + "', date: '" + datetime.date.today().isoformat() + "' };\n", encoding="utf-8", newline="\n")
    if stamped != html:
        HTML.write_text(stamped, encoding="utf-8", newline="\n")
    print("stamped " + digest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
