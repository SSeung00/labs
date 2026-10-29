"""Garmin Connect session management (unofficial API via python-garminconnect).

Only the session token is persisted (TOKEN_DIR); the password is used once for
login and then dropped.
"""

from __future__ import annotations

import logging
import shutil
import threading
from dataclasses import dataclass

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from app.config import TOKEN_DIR

log = logging.getLogger(__name__)


class GarminAuthError(Exception):
    pass


@dataclass
class AuthStatus:
    connected: bool
    mfa_pending: bool = False
    full_name: str | None = None
    display_name: str | None = None


class GarminAuth:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._client: Garmin | None = None
        self._pending: Garmin | None = None
        self._tried_resume = False

    @property
    def token_dir(self) -> str:
        return str(TOKEN_DIR)

    def _resume(self) -> None:
        """Restore a session from saved tokens, once per process."""
        if self._client or self._tried_resume:
            return
        self._tried_resume = True
        if not TOKEN_DIR.exists():
            return
        g = Garmin()
        try:
            g.login(self.token_dir)
            self._client = g
        except Exception as e:  # stale or revoked tokens
            log.warning("Saved Garmin session could not be restored: %s", type(e).__name__)

    def status(self) -> AuthStatus:
        with self._lock:
            self._resume()
            c = self._client
            return AuthStatus(
                connected=c is not None,
                mfa_pending=self._pending is not None,
                full_name=getattr(c, "full_name", None) if c else None,
                display_name=getattr(c, "display_name", None) if c else None,
            )

    def client(self) -> Garmin:
        with self._lock:
            self._resume()
            if self._client is None:
                raise GarminAuthError("가민 계정이 연결되어 있지 않습니다.")
            return self._client

    def login(self, email: str, password: str) -> AuthStatus:
        with self._lock:
            g = Garmin(email=email, password=password, return_on_mfa=True)
            try:
                mfa_status, _ = g.login()
            except GarminConnectAuthenticationError as e:
                raise GarminAuthError("이메일 또는 비밀번호가 올바르지 않습니다.") from e
            except GarminConnectTooManyRequestsError as e:
                raise GarminAuthError("요청이 너무 많습니다. 잠시 후 다시 시도하세요.") from e
            except GarminConnectConnectionError as e:
                raise GarminAuthError(f"가민 서버에 연결하지 못했습니다: {e}") from e
            finally:
                g.password = None

            if mfa_status == "needs_mfa":
                self._pending = g
                return AuthStatus(connected=False, mfa_pending=True)

            # return_on_mfa skips profile loading; finish it the same way the
            # non-MFA path would by re-entering through the token store.
            self._persist(g)
            return self._finish_from_tokens()

    def submit_mfa(self, code: str) -> AuthStatus:
        with self._lock:
            g = self._pending
            if g is None:
                raise GarminAuthError("진행 중인 인증이 없습니다. 다시 로그인하세요.")
            try:
                g.resume_login({}, code.strip())
            except GarminConnectAuthenticationError as e:
                raise GarminAuthError("인증 코드가 올바르지 않습니다.") from e
            except GarminConnectConnectionError as e:
                raise GarminAuthError(f"인증에 실패했습니다: {e}") from e
            self._pending = None
            self._persist(g)
            self._client = g
            return AuthStatus(
                connected=True, full_name=g.full_name, display_name=g.display_name
            )

    def _persist(self, g: Garmin) -> None:
        TOKEN_DIR.mkdir(parents=True, exist_ok=True)
        g.client.dump(self.token_dir)

    def _finish_from_tokens(self) -> AuthStatus:
        g = Garmin()
        g.login(self.token_dir)
        self._client = g
        return AuthStatus(connected=True, full_name=g.full_name, display_name=g.display_name)

    def logout(self) -> None:
        with self._lock:
            self._client = None
            self._pending = None
            self._tried_resume = True
            shutil.rmtree(TOKEN_DIR, ignore_errors=True)


garmin_auth = GarminAuth()
