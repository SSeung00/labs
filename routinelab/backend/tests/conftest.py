import os
import shutil
import tempfile
from pathlib import Path

# Point the app at a scratch data dir before anything imports app.config.
_TMP = Path(tempfile.mkdtemp(prefix="routinelab-test-"))
os.environ["ROUTINELAB_DATA_DIR"] = str(_TMP)
os.environ["ROUTINELAB_SCHEDULER"] = "off"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    SQLModel.metadata.drop_all(engine)
    # Looks like this PC (loopback, localhost Host) unless a test sends proxy headers.
    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)) as c:  # runs the lifespan
        yield c


def pytest_sessionfinish(session, exitstatus):
    engine.dispose()
    shutil.rmtree(_TMP, ignore_errors=True)
