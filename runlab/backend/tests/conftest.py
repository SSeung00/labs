import os
import tempfile

# Point the app at a throwaway data dir before app.config is imported.
os.environ["RUNLAB_DATA_DIR"] = tempfile.mkdtemp(prefix="runlab-test-")
# Never pick up the real Garmin session from the user's home directory.
os.environ["RUNLAB_TOKEN_DIR"] = tempfile.mkdtemp(prefix="runlab-test-tokens-")
# Tests drive the scheduler by hand (auto_sync.tick); never start the real background loop.
os.environ["RUNLAB_DISABLE_SCHEDULER"] = "1"

# TestClient talks as client "testclient" to host "testserver"; treat that as this PC.
# Tests that need a remote (phone) client use another base_url.
from app import auth

auth.LOCAL_CLIENTS.add("testclient")
auth.LOCAL_HOSTS.add("testserver")
