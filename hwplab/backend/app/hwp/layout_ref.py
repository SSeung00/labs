"""Hangul's own layout, as cached in HWP 5.0 files (PARA_LINE_SEG).

Every paragraph stores the line boxes Hangul computed when it last saved the file. A line whose
vertical position goes back up starts a new page, so this gives Hangul's page count and the
first characters of each page - a reference for checking HwpLab's pagination.
"""

from __future__ import annotations

import struct
import zlib

import olefile

from app.hwp.records import TAG_PARA_HEADER, TAG_PARA_LINE_SEG, TAG_PARA_TEXT, record_tree


def page_starts(data: bytes) -> list[str]:
    """Text at the start of each page (body paragraphs only), in Hangul's layout."""
    import io

    ole = olefile.OleFileIO(io.BytesIO(data))
    (flags,) = struct.unpack_from("<I", ole.openstream("FileHeader").read(), 36)
    sections = sorted(("/".join(e) for e in ole.listdir() if len(e) == 2 and e[0] == "BodyText"),
                      key=lambda n: int("".join(c for c in n if c.isdigit()) or 0))
    starts: list[str] = []
    for name in sections:
        raw = ole.openstream(name).read()
        if flags & 1:
            raw = zlib.decompress(raw, -15)
        last = None
        for rec in record_tree(raw):
            if rec.tag != TAG_PARA_HEADER:
                continue
            seg = rec.first(TAG_PARA_LINE_SEG)
            t = rec.first(TAG_PARA_TEXT)
            text = _plain(t.data) if t else ""
            if not seg:
                continue
            for k in range(len(seg.data) // 36):
                textpos, vpos = struct.unpack_from("<Ii", seg.data, k * 36)
                if last is None or vpos < last:
                    starts.append(text[textpos:textpos + 30])
                last = vpos
    return starts


def _plain(data: bytes) -> str:
    """PARA_TEXT with control characters kept as single placeholders (positions stay aligned)."""
    units = struct.unpack(f"<{len(data) // 2}H", data[: len(data) // 2 * 2])
    out: list[str] = []
    i = 0
    while i < len(units):
        ch = units[i]
        if ch < 32 and ch not in (10, 13, 24, 30, 31):
            out.extend(["￼"] * 8)
            i += 8
            continue
        out.append(chr(ch) if ch >= 32 else " ")
        i += 1
    return "".join(out)
