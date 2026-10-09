from fastapi.testclient import TestClient

from app.main import app
from app.security import decode_token, hash_password, verify_password
from tests.conftest import add_q, auth_headers, make_form, signup


def test_password_hash_roundtrip():
    h = hash_password("s3cret-pass", iterations=1000)
    assert h.startswith("pbkdf2_sha256$1000$") and "s3cret-pass" not in h
    assert verify_password("s3cret-pass", h)
    assert not verify_password("wrong", h)
    assert not verify_password("anything", None)
    assert not verify_password("anything", "garbage")


def test_signup_login_me(anon_client):
    c = anon_client
    data = signup(c, "Ada@Example.com", "Ada")
    assert data["user"]["email"] == "ada@example.com" and "password" not in str(data)
    assert decode_token(data["token"]) == data["user"]["id"]

    # logging in works with different casing / padding
    r = c.post("/api/auth/login", json={"email": "  ADA@example.com ", "password": "password123"})
    assert r.status_code == 200 and r.json()["user"]["name"] == "Ada"

    me = c.get("/api/auth/me", headers=auth_headers(r.json()["token"]))
    assert me.status_code == 200 and me.json()["email"] == "ada@example.com"


def test_signup_validation_and_duplicates(anon_client):
    c = anon_client
    assert c.post("/api/auth/signup", json={"name": "A", "email": "nope", "password": "password123"}).status_code == 422
    assert c.post("/api/auth/signup", json={"name": "A", "email": "a@b.com", "password": "short"}).status_code == 422
    assert c.post("/api/auth/signup", json={"name": "  ", "email": "a@b.com", "password": "password123"}).status_code == 422
    signup(c, "dup@example.com")
    r = c.post("/api/auth/signup", json={"name": "B", "email": "DUP@example.com", "password": "password123"})
    assert r.status_code == 409


def test_login_failures_are_generic(anon_client):
    c = anon_client
    signup(c, "real@example.com")
    wrong_pw = c.post("/api/auth/login", json={"email": "real@example.com", "password": "bad-password"})
    no_user = c.post("/api/auth/login", json={"email": "ghost@example.com", "password": "password123"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()


def test_creator_endpoints_require_login(anon_client):
    c = anon_client
    assert c.get("/api/forms").status_code == 401
    assert c.post("/api/forms", json={"title": "x"}).status_code == 401
    assert c.get("/api/forms/1/responses").status_code == 401
    assert c.get("/api/auth/me").status_code == 401
    assert c.get("/api/forms", headers=auth_headers("not.a.token")).status_code == 401


def test_public_endpoints_need_no_login(client):
    f = make_form(client)
    add_q(client, f["id"], "short_text", "Your name?")
    client.delete(f"/api/forms/{f['id']}/questions/{f['questions'][0]['id']}")  # drop the blank starter question
    assert client.post(f"/api/forms/{f['id']}/publish").status_code == 200
    anon = TestClient(app)  # no Authorization header
    assert anon.get(f"/api/public/forms/{f['public_id']}").status_code == 200


def test_users_only_see_their_own_forms(client):
    mine = make_form(client, "Mine")
    add_q(client, mine["id"], "email", "Email?")
    other = TestClient(app)
    other.headers.update(auth_headers(signup(other, "other@example.com", "Other")["token"]))

    assert other.get("/api/forms").json() == []
    for method, path in [
        ("get", f"/api/forms/{mine['id']}"),
        ("patch", f"/api/forms/{mine['id']}"),
        ("delete", f"/api/forms/{mine['id']}"),
        ("post", f"/api/forms/{mine['id']}/publish"),
        ("post", f"/api/forms/{mine['id']}/duplicate"),
        ("get", f"/api/forms/{mine['id']}/responses"),
        ("get", f"/api/forms/{mine['id']}/summary"),
        ("get", f"/api/forms/{mine['id']}/responses.csv"),
        ("post", f"/api/forms/{mine['id']}/questions"),
    ]:
        kwargs = {"json": {"title": "hack", "type": "short_text"}} if method in ("patch", "post") else {}
        assert getattr(other, method)(path, **kwargs).status_code == 404, (method, path)
    assert [f["title"] for f in client.get("/api/forms").json()] == ["Mine"]  # untouched
