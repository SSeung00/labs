"""Web Push: VAPID key, subscriptions and sending.

The PC signs each message with its own VAPID key; the browser vendor's push service
(FCM for Chrome on Android) delivers it to the phone even when RoutineLab isn't open.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01
from pywebpush import WebPushException, webpush
from sqlmodel import Session, select

from app.config import VAPID_KEY
from app.models import PushSub

log = logging.getLogger("routinelab.push")

# Push services want a contact; nothing is ever sent there.
CLAIMS_SUB = "mailto:routinelab@localhost"


def _vapid() -> Vapid01:
    if not VAPID_KEY.exists():
        v = Vapid01()
        v.generate_keys()
        v.save_key(str(VAPID_KEY))
        return v
    return Vapid01.from_file(str(VAPID_KEY))


def public_key() -> str:
    """applicationServerKey for PushManager.subscribe (base64url, uncompressed P-256 point)."""
    raw = _vapid().public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def subscribe(session: Session, endpoint: str, p256dh: str, auth: str, label: str = "") -> PushSub:
    sub = session.exec(select(PushSub).where(PushSub.endpoint == endpoint)).first() or PushSub(
        endpoint=endpoint, p256dh=p256dh, auth=auth)
    sub.p256dh, sub.auth = p256dh, auth
    if label:
        sub.label = label[:80]
    session.add(sub)
    session.commit()
    return sub


def unsubscribe(session: Session, endpoint: str) -> None:
    sub = session.exec(select(PushSub).where(PushSub.endpoint == endpoint)).first()
    if sub:
        session.delete(sub)
        session.commit()


def send_all(session: Session, payload: dict, ttl: int = 3600) -> int:
    """Send to every subscribed device; drops subscriptions the push service says are gone."""
    subs = session.exec(select(PushSub)).all()
    if not subs:
        return 0
    key = str(VAPID_KEY) if VAPID_KEY.exists() else _vapid()
    data = json.dumps(payload, ensure_ascii=False)
    sent = 0
    for sub in subs:
        try:
            webpush(
                {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=data, vapid_private_key=key, vapid_claims={"sub": CLAIMS_SUB}, ttl=ttl, timeout=10,
            )
            sub.last_ok = datetime.now()
            session.add(sub)
            sent += 1
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410):  # unsubscribed / expired on the phone
                session.delete(sub)
            else:
                log.warning("push failed (%s): %s", status, e)
        except Exception as e:  # network down etc. — try again next reminder
            log.warning("push error: %s", e)
    session.commit()
    return sent
