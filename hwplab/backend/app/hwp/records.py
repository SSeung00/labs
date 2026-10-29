"""HWP 5.0 record stream helpers (한글 문서 파일 형식 5.0, 공개 스펙 §4.1).

A stream (DocInfo, BodyText/SectionN) is a flat list of records. Each starts with a 32-bit
header: TagID (10 bits) | Level (10 bits) | Size (12 bits); Size 0xFFF means a 32-bit size follows.
Levels turn the flat list into a tree: a record owns the following records with a deeper level.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

HWPTAG_BEGIN = 0x010

# DocInfo
TAG_DOCUMENT_PROPERTIES = HWPTAG_BEGIN
TAG_ID_MAPPINGS = HWPTAG_BEGIN + 1
TAG_BIN_DATA = HWPTAG_BEGIN + 2
TAG_FACE_NAME = HWPTAG_BEGIN + 3
TAG_BORDER_FILL = HWPTAG_BEGIN + 4
TAG_CHAR_SHAPE = HWPTAG_BEGIN + 5
TAG_TAB_DEF = HWPTAG_BEGIN + 6
TAG_NUMBERING = HWPTAG_BEGIN + 7
TAG_BULLET = HWPTAG_BEGIN + 8
TAG_PARA_SHAPE = HWPTAG_BEGIN + 9
TAG_STYLE = HWPTAG_BEGIN + 10

# BodyText
TAG_PARA_HEADER = HWPTAG_BEGIN + 50
TAG_PARA_TEXT = HWPTAG_BEGIN + 51
TAG_PARA_CHAR_SHAPE = HWPTAG_BEGIN + 52
TAG_PARA_LINE_SEG = HWPTAG_BEGIN + 53
TAG_PARA_RANGE_TAG = HWPTAG_BEGIN + 54
TAG_CTRL_HEADER = HWPTAG_BEGIN + 55
TAG_LIST_HEADER = HWPTAG_BEGIN + 56
TAG_PAGE_DEF = HWPTAG_BEGIN + 57
TAG_FOOTNOTE_SHAPE = HWPTAG_BEGIN + 58
TAG_PAGE_BORDER_FILL = HWPTAG_BEGIN + 59
TAG_SHAPE_COMPONENT = HWPTAG_BEGIN + 60
TAG_TABLE = HWPTAG_BEGIN + 61
TAG_SHAPE_COMPONENT_LINE = HWPTAG_BEGIN + 62
TAG_SHAPE_COMPONENT_RECTANGLE = HWPTAG_BEGIN + 63
TAG_SHAPE_COMPONENT_ELLIPSE = HWPTAG_BEGIN + 64
TAG_SHAPE_COMPONENT_ARC = HWPTAG_BEGIN + 65
TAG_SHAPE_COMPONENT_POLYGON = HWPTAG_BEGIN + 66
TAG_SHAPE_COMPONENT_CURVE = HWPTAG_BEGIN + 67
TAG_SHAPE_COMPONENT_OLE = HWPTAG_BEGIN + 68
TAG_SHAPE_COMPONENT_PICTURE = HWPTAG_BEGIN + 69
TAG_SHAPE_COMPONENT_CONTAINER = HWPTAG_BEGIN + 70
TAG_CTRL_DATA = HWPTAG_BEGIN + 71
TAG_EQEDIT = HWPTAG_BEGIN + 72


@dataclass
class Record:
    tag: int
    level: int
    data: bytes
    children: list["Record"] = field(default_factory=list)

    def first(self, tag: int) -> "Record | None":
        return next((c for c in self.children if c.tag == tag), None)

    def all(self, tag: int) -> list["Record"]:
        return [c for c in self.children if c.tag == tag]


def iter_records(data: bytes):
    pos, n = 0, len(data)
    while pos + 4 <= n:
        (head,) = struct.unpack_from("<I", data, pos)
        pos += 4
        tag = head & 0x3FF
        level = (head >> 10) & 0x3FF
        size = (head >> 20) & 0xFFF
        if size == 0xFFF:
            if pos + 4 > n:
                break
            (size,) = struct.unpack_from("<I", data, pos)
            pos += 4
        yield Record(tag, level, data[pos:pos + size])
        pos += size


def record_tree(data: bytes) -> list[Record]:
    """Top-level records (level 0) with their descendants attached."""
    roots: list[Record] = []
    stack: list[Record] = []
    for rec in iter_records(data):
        while stack and stack[-1].level >= rec.level:
            stack.pop()
        if stack:
            stack[-1].children.append(rec)
        else:
            roots.append(rec)
        stack.append(rec)
    return roots


class Reader:
    """Little-endian cursor over a record payload that never raises on short data."""

    def __init__(self, data: bytes, pos: int = 0):
        self.data = data
        self.pos = pos

    def remaining(self) -> int:
        return len(self.data) - self.pos

    def _unpack(self, fmt: str, size: int, default=0):
        if self.pos + size > len(self.data):
            self.pos = len(self.data)
            return default
        (v,) = struct.unpack_from(fmt, self.data, self.pos)
        self.pos += size
        return v

    def u8(self): return self._unpack("<B", 1)
    def i8(self): return self._unpack("<b", 1)
    def u16(self): return self._unpack("<H", 2)
    def i16(self): return self._unpack("<h", 2)
    def u32(self): return self._unpack("<I", 4)
    def i32(self): return self._unpack("<i", 4)

    def skip(self, n: int) -> None:
        self.pos = min(len(self.data), self.pos + n)

    def wstr(self) -> str:
        """WORD length + UTF-16LE characters."""
        n = self.u16()
        raw = self.data[self.pos:self.pos + 2 * n]
        self.pos += 2 * n
        return raw.decode("utf-16-le", errors="replace")


def ctrl_id(chars: str) -> int:
    """MAKE_4CHID: 'tbl ' -> 0x74626c20 (stored little-endian in the file)."""
    a, b, c, d = (ord(x) for x in chars)
    return (a << 24) | (b << 16) | (c << 8) | d


def ctrl_name(value: int) -> str:
    return "".join(chr((value >> s) & 0xFF) for s in (24, 16, 8, 0))


def colorref(v: int) -> str | None:
    """COLORREF 0x00BBGGRR -> '#rrggbb'; 0xFFFFFFFF (and other high-byte values) mean none."""
    if v >> 24:
        return None
    return f"#{v & 0xFF:02x}{(v >> 8) & 0xFF:02x}{(v >> 16) & 0xFF:02x}"
