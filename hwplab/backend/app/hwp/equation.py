"""Hangul equation script (EqEdit) -> LaTeX for on-screen rendering with KaTeX.

Uses python-hwpx's clean-room converter. The script itself stays the source of truth: it is
what gets saved back into HWPX; LaTeX is derived on every load.
"""

from __future__ import annotations

import re
from functools import lru_cache

from hwpx.equation import eqedit_to_latex

# `root {x}` without a following `of` is a plain square root in Hangul (`root n of x` is the n-th root).
_ROOT = re.compile(r"\broot\b(?![^{}]*\bof\b)", re.IGNORECASE)


@lru_cache(maxsize=8192)
def to_latex(script: str) -> str | None:
    s = (script or "").replace("\r", " ").replace("\n", " ").strip()
    if not s:
        return None
    if "root" in s.lower() and " of " not in f" {s.lower()} ":
        s = _ROOT.sub("sqrt", s)
    try:
        return eqedit_to_latex(s)
    except Exception:
        return None


def annotate(node: dict) -> None:
    """Adds attrs.latex to every equation node in place."""
    if node.get("type") == "equation":
        node["attrs"]["latex"] = to_latex(node["attrs"].get("script", ""))
    if node.get("type") == "footnote":
        for p in node["attrs"].get("content") or []:
            annotate(p)
    for c in node.get("content") or []:
        annotate(c)
