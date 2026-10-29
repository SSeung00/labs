"""Read -> write HWPX -> read again must keep text and structure, and the package must pass
python-hwpx's package, editor-open-safety and OWPML schema checks.

Sample documents are the user's own files and are only read. Set HWPLAB_SAMPLES to a list of
paths separated by ';' to choose them; missing files are skipped.
"""

import io
import os
from collections import Counter
from pathlib import Path

import pytest
from hwpx.tools.package_validator import validate_editor_open_safety, validate_package
from hwpx.tools.validator import validate_document

from app.hwp import model as M
from app.hwp.hwp5 import read_hwp
from app.hwp.hwpx_reader import read_hwpx
from app.hwp.hwpx_writer import write_hwpx

DEFAULT_SAMPLES = [
    r"C:/Users/user/OneDrive/LAB/Automated Design/KDS/KDS 14 20 01 콘크리트구조 설계(강도설계법) 일반사항.hwp",
    r"C:/Users/user/OneDrive/LAB/Automated Design/KDS/KDS 14 31 10 강구조 부재 설계기준(하중저항계수설계법).hwp",
    r"C:/Users/user/Downloads/[별지 제132호서식] 병역의무자 국외여행(기간연장) 허가(취소) 신청서(병역법 시행규칙).hwpx",
    r"C:/Users/user/OneDrive/LAB/26_한중공동과제/[포맷]2026년_핵심연구유형C_연구제안서_채윤병.hwpx",
]
SAMPLES = [p for p in (os.environ.get("HWPLAB_SAMPLES", "").split(";") if os.environ.get("HWPLAB_SAMPLES") else DEFAULT_SAMPLES) if p]


def _read(path: str):
    data = Path(path).read_bytes()
    return (read_hwpx if path.lower().endswith(".hwpx") else read_hwp)(data)


def _text(node: dict, out: list[str]) -> list[str]:
    if node.get("type") == "text":
        out.append(node["text"])
    for c in node.get("content") or []:
        _text(c, out)
    return out


def _count(node: dict, c: Counter) -> Counter:
    c[node.get("type")] += 1
    for k in node.get("content") or []:
        _count(k, c)
    return c


def _check_package(out: bytes) -> None:
    assert validate_package(out).ok
    assert validate_editor_open_safety(out).ok
    report = validate_document(io.BytesIO(out))
    assert not list(report.issues), [str(i) for i in report.issues][:5]


@pytest.mark.parametrize("path", SAMPLES, ids=[Path(p).stem[:30] for p in SAMPLES])
def test_roundtrip(path):
    if not Path(path).exists():
        pytest.skip("sample not on this machine")
    doc, bins = _read(path)
    out = write_hwpx(doc, bins, "roundtrip")
    _check_package(out)
    doc2, _ = read_hwpx(out)
    assert "".join(_text(doc["content"], [])) == "".join(_text(doc2["content"], []))
    assert _count(doc["content"], Counter()) == _count(doc2["content"], Counter())
    # floating objects and header anchors survive
    def floats(d):
        return [n["attrs"].get("float") for n in d["content"]["content"] if n["type"] == "table"]
    assert [bool(f) for f in floats(doc)] == [bool(f) for f in floats(doc2)]
    assert (doc["header"] is None) == (doc2["header"] is None)


def test_new_document_package():
    doc = {
        "page": M.default_page(), "header": None, "footer": None, "pageNumber": {"pos": "BOTTOM_CENTER", "side": "-"},
        "content": {"type": "doc", "content": [
            {"type": "paragraph", "attrs": {**M.default_para_attrs(), "align": "center", "size": 16},
             "content": [{"type": "text", "text": "제목\t탭", "marks": [{"type": "textStyle", "attrs": {"size": 16}}, {"type": "bold"}]}]},
            {"type": "paragraph", "attrs": {**M.default_para_attrs(), "indent": -20, "left": 10, "pageBreak": True},
             "content": [{"type": "text", "text": "본문 "}, {"type": "hardBreak"},
                         {"type": "equation", "attrs": {"script": "{a} over {b}", "size": 10}},
                         {"type": "footnote", "attrs": {"kind": "foot", "content": [M.paragraph(M.default_para_attrs(), [{"type": "text", "text": "각주"}])]}}]},
            {"type": "table", "attrs": {"width": 400, "align": "center", "float": None}, "content": [
                {"type": "tableRow", "attrs": {"height": 20}, "content": [
                    {"type": "tableCell", "attrs": {"colspan": 2, "rowspan": 1, "colwidth": [200, 200], "background": "#eeeeee"},
                     "content": [M.empty_paragraph()]}]},
                {"type": "tableRow", "attrs": {"height": 20}, "content": [
                    {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [200]}, "content": [M.empty_paragraph()]},
                    {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [200]}, "content": [M.empty_paragraph()]}]}]},
        ]},
    }
    out = write_hwpx(doc, {}, "new")
    _check_package(out)
    doc2, _ = read_hwpx(out)
    blocks = doc2["content"]["content"]
    assert blocks[0]["attrs"]["align"] == "center"
    assert blocks[1]["attrs"]["indent"] == -20 and blocks[1]["attrs"]["left"] == 10
    assert blocks[1]["attrs"]["pageBreak"] is True
    assert any(n["type"] == "equation" for n in blocks[1]["content"])
    assert any(n["type"] == "footnote" for n in blocks[1]["content"])
    table = next(b for b in blocks if b["type"] == "table")
    assert table["content"][0]["content"][0]["attrs"]["colspan"] == 2
    assert table["content"][0]["content"][0]["attrs"]["background"] == "#eeeeee"
    assert doc2["pageNumber"]["pos"] == "BOTTOM_CENTER"
