import os
import tempfile

# Must be set before the app is imported so tests never touch the real database.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["SEED_DEMO"] = "0"
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"  # never write test files into the project
os.environ["PASSWORD_ITERATIONS"] = "1000"  # fast hashing in tests

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


def signup(client, email="owner@example.com", name="Owner", password="password123"):
    """Create an account and return (response_json)."""
    r = client.post("/api/auth/signup", json={"name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def anon_client():
    """A client with no login."""
    import shutil

    from app.config import UPLOAD_DIR

    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    shutil.rmtree(UPLOAD_DIR, ignore_errors=True)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def client(anon_client):
    """A client logged in as a fresh creator (the default for builder / results tests)."""
    data = signup(anon_client)
    anon_client.headers.update(auth_headers(data["token"]))
    return anon_client


def make_form(client, title="Test form"):
    return client.post("/api/forms", json={"title": title}).json()


def add_q(client, form_id, qtype, title, **patch):
    detail = client.post(f"/api/forms/{form_id}/questions", json={"type": qtype}).json()
    q = detail["questions"][-1]
    body = {"title": title, **patch}
    return client.patch(f"/api/forms/{form_id}/questions/{q['id']}", json=body).json()
