"""Document library on disk.

data/docs/<id>/
  meta.json      title, source file name/format, timestamps
  doc.json       current editor document (see app.hwp.model)
  source.<ext>   the file as it was imported (never modified)
  bin/           images referenced by the document (image node `src` = file name here)
  history/       previous doc.json versions, newest last
"""

from __future__ import annotations

import io
import json
import re
import secrets
import shutil
from datetime import datetime
from pathlib import Path

from PIL import Image

from app.config import DOCS_DIR, HISTORY_KEEP, TRASH_DIR
from app.hwp import model as M
from app.hwp.equation import annotate
from app.hwp.hwp5 import HwpError, read_hwp
from app.hwp.hwpx_reader import HwpxError, read_hwpx
from app.hwp.hwpx_writer import write_hwpx

WEB_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp", "svg"}
ID_RE = re.compile(r"^[a-z0-9]{12}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")


class StoreError(ValueError):
    pass


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _dir(doc_id: str) -> Path:
    if not ID_RE.match(doc_id or ""):
        raise StoreError("잘못된 문서 ID예요.")
    d = DOCS_DIR / doc_id
    if not d.is_dir():
        raise FileNotFoundError(doc_id)
    return d


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _detect(data: bytes, filename: str) -> str:
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "hwp"
    if data[:2] == b"PK":
        return "hwpx"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    raise StoreError(f"지원하지 않는 파일이에요 ({ext or '확장자 없음'}). .hwp 또는 .hwpx만 열 수 있어요.")


def _to_web_image(name: str, data: bytes) -> tuple[str, bytes]:
    """BMP/WMF/EMF/TIFF can't be shown by browsers: convert them to PNG (WMF/EMF need Windows)."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in WEB_IMAGE_EXT:
        return name, data
    try:
        with Image.open(io.BytesIO(data)) as im:
            if ext in ("wmf", "emf"):
                im.load(dpi=144)
            out = io.BytesIO()
            im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB").save(out, "PNG", optimize=True)
        return name.rsplit(".", 1)[0] + ".png", out.getvalue()
    except Exception:
        return name, data


def _rename_images(node: dict, renames: dict[str, str]) -> None:
    if node.get("type") == "image":
        src = node["attrs"].get("src")
        if src in renames:
            node["attrs"]["src"] = renames[src]
    if node.get("type") == "footnote":
        for p in node["attrs"].get("content") or []:
            _rename_images(p, renames)
    for c in node.get("content") or []:
        _rename_images(c, renames)


def _all_blocks(doc: dict):
    yield doc.get("content") or {}
    for key in ("header", "footer"):
        for p in doc.get(key) or []:
            yield p


def _meta_summary(doc_id: str, meta: dict) -> dict:
    return {"id": doc_id, **meta}


def list_docs() -> list[dict]:
    out = []
    for d in DOCS_DIR.iterdir():
        mp = d / "meta.json"
        if d.is_dir() and mp.exists():
            try:
                out.append(_meta_summary(d.name, _read_json(mp)))
            except (OSError, ValueError):
                continue
    out.sort(key=lambda m: m.get("updated", ""), reverse=True)
    return out


def _new_dir() -> tuple[str, Path]:
    while True:
        doc_id = secrets.token_hex(6)
        d = DOCS_DIR / doc_id
        if not d.exists():
            (d / "bin").mkdir(parents=True)
            (d / "history").mkdir()
            return doc_id, d


def import_file(filename: str, data: bytes) -> dict:
    fmt = _detect(data, filename)
    try:
        doc, binaries = read_hwp(data) if fmt == "hwp" else read_hwpx(data)
    except (HwpError, HwpxError) as e:
        raise StoreError(str(e)) from e
    except Exception as e:  # malformed files: report instead of 500
        raise StoreError(f"문서를 읽지 못했어요: {type(e).__name__}: {e}") from e

    doc_id, d = _new_dir()
    (d / f"source.{fmt}").write_bytes(data)
    renames: dict[str, str] = {}
    for name, blob in binaries.items():
        new_name, new_blob = _to_web_image(name, blob)
        if new_name != name:
            renames[name] = new_name
        (d / "bin" / new_name).write_bytes(new_blob)
    if renames:
        for block in _all_blocks(doc):
            _rename_images(block, renames)
    title = re.sub(r"\.(hwpx?|HWPX?)$", "", filename) or "제목 없음"
    meta = {"title": title, "sourceName": filename, "format": fmt, "created": _now(), "updated": _now(),
            "savedVersion": 0}
    _write_json(d / "doc.json", doc)
    _write_json(d / "meta.json", meta)
    return _meta_summary(doc_id, meta)


def new_doc(title: str = "") -> dict:
    doc_id, d = _new_dir()
    doc = {"page": M.default_page(), "header": None, "footer": None, "pageNumber": None, "hideFirst": None,
           "content": {"type": "doc", "content": [M.empty_paragraph()]}}
    meta = {"title": title or "새 문서", "sourceName": None, "format": "new", "created": _now(),
            "updated": _now(), "savedVersion": 0}
    _write_json(d / "doc.json", doc)
    _write_json(d / "meta.json", meta)
    return _meta_summary(doc_id, meta)


def get_doc(doc_id: str) -> dict:
    d = _dir(doc_id)
    doc = _read_json(d / "doc.json")
    for block in _all_blocks(doc):
        annotate(block)
    return {"meta": _meta_summary(doc_id, _read_json(d / "meta.json")), "doc": doc}


def save_doc(doc_id: str, doc: dict, title: str | None = None, base_version: int | None = None) -> dict:
    d = _dir(doc_id)
    meta = _read_json(d / "meta.json")
    if base_version is not None and base_version != meta.get("savedVersion", 0):
        raise StoreError("다른 창에서 이 문서가 먼저 저장됐어요. 새로고침한 뒤 다시 저장해 주세요.")
    if not isinstance(doc, dict) or (doc.get("content") or {}).get("type") != "doc":
        raise StoreError("문서 형식이 올바르지 않아요.")
    hist = d / "history"
    cur = d / "doc.json"
    if cur.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(cur, hist / f"{stamp}.json")
        old = sorted(hist.glob("*.json"))
        for p in old[:-HISTORY_KEEP]:
            p.unlink(missing_ok=True)
    _write_json(cur, doc)
    if title:
        meta["title"] = title.strip()[:200]
    meta["updated"] = _now()
    meta["savedVersion"] = meta.get("savedVersion", 0) + 1
    _write_json(d / "meta.json", meta)
    return _meta_summary(doc_id, meta)


def rename_doc(doc_id: str, title: str) -> dict:
    d = _dir(doc_id)
    meta = _read_json(d / "meta.json")
    meta["title"] = title.strip()[:200] or meta["title"]
    meta["updated"] = _now()
    _write_json(d / "meta.json", meta)
    return _meta_summary(doc_id, meta)


def delete_doc(doc_id: str) -> None:
    """Moves the document to data/trash (kept so a mistaken delete can be undone by hand)."""
    d = _dir(doc_id)
    target = TRASH_DIR / f"{doc_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    shutil.move(str(d), str(target))


def bin_path(doc_id: str, name: str) -> Path:
    if not NAME_RE.match(name or "") or name.startswith("."):
        raise StoreError("잘못된 파일 이름이에요.")
    p = _dir(doc_id) / "bin" / name
    if not p.is_file():
        raise FileNotFoundError(name)
    return p


def add_image(doc_id: str, filename: str, data: bytes) -> dict:
    d = _dir(doc_id)
    try:
        with Image.open(io.BytesIO(data)) as im:
            fmt = (im.format or "").lower()
            w, h = im.size
    except Exception as e:
        raise StoreError("그림 파일을 읽을 수 없어요.") from e
    ext = {"jpeg": "jpg"}.get(fmt, fmt) or "png"
    name = f"img_{secrets.token_hex(4)}.{ext}"
    name, data = _to_web_image(name, data)
    (d / "bin" / name).write_bytes(data)
    return {"src": name, "pixelWidth": w, "pixelHeight": h}


def history(doc_id: str) -> list[dict]:
    d = _dir(doc_id)
    return [{"name": p.stem, "size": p.stat().st_size} for p in sorted((d / "history").glob("*.json"), reverse=True)]


def history_doc(doc_id: str, name: str) -> dict:
    if not re.match(r"^\d{8}-\d{6}$", name):
        raise StoreError("잘못된 버전 이름이에요.")
    p = _dir(doc_id) / "history" / f"{name}.json"
    if not p.exists():
        raise FileNotFoundError(name)
    return _read_json(p)


def export_hwpx(doc_id: str) -> tuple[str, bytes]:
    d = _dir(doc_id)
    meta = _read_json(d / "meta.json")
    doc = _read_json(d / "doc.json")
    binaries: dict[str, bytes] = {}
    for p in (d / "bin").iterdir():
        binaries[p.name] = p.read_bytes()
    return meta["title"], write_hwpx(doc, binaries, meta["title"])


def source_file(doc_id: str) -> Path | None:
    d = _dir(doc_id)
    return next(iter(d.glob("source.*")), None)
