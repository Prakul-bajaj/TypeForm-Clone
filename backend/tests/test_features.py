"""Partial responses, file uploads, saved themes + background images."""
import os

from fastapi.testclient import TestClient

from app.config import UPLOAD_DIR
from app.main import app
from tests.conftest import add_q, auth_headers, make_form, signup
from tests.test_api import answers, published_form

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def file_form(client, **props):
    f = make_form(client, "Uploads")
    client.delete(f"/api/forms/{f['id']}/questions/{f['questions'][0]['id']}")
    name = add_q(client, f["id"], "short_text", "Name", required=True)
    up = add_q(client, f["id"], "file_upload", "Your CV", required=True, properties=props or {"max_size_mb": 1})
    assert client.post(f"/api/forms/{f['id']}/publish").status_code == 200
    return f, client.get(f"/api/forms/{f['id']}").json(), name, up


def upload(client, public_id, ref, data=b"hello world", filename="cv.pdf", ctype="application/pdf"):
    return client.post(f"/api/public/forms/{public_id}/upload", params={"ref": ref, "filename": filename},
                       content=data, headers={"Content-Type": ctype})


# ───────────── partial responses ─────────────
def test_progress_creates_partial_then_submit_completes_same_row(client):
    f, d = published_form(client)
    pub, key = f["public_id"], "session-key-123"
    r = client.post(f"/api/public/forms/{pub}/progress", json={"idempotency_key": key, "answers": answers(d, Name="Ann")})
    assert r.status_code == 204

    # later saves update (not duplicate) the same row
    client.post(f"/api/public/forms/{pub}/progress", json={"idempotency_key": key, "answers": answers(d, Name="Ann", Email="ann@example.com")})
    page = client.get(f"/api/forms/{f['id']}/responses").json()
    assert page["total"] == 1 and page["items"][0]["status"] == "partial"
    assert {a["question_title"] for a in page["items"][0]["answers"]} == {"Name", "Email"}

    s = client.get(f"/api/forms/{f['id']}/summary").json()
    assert (s["total_responses"], s["partial_responses"], s["starts"], s["completion_rate"]) == (0, 1, 1, 0.0)
    assert client.get("/api/forms").json()[0]["response_count"] == 0  # partials are not "responses"

    # the final submit with the same key upgrades the partial row
    done = client.post(f"/api/public/forms/{pub}/responses", json={
        "idempotency_key": key, "answers": answers(d, Name="Ann", Email="ann@example.com")})
    assert done.status_code == 201
    page = client.get(f"/api/forms/{f['id']}/responses").json()
    assert page["total"] == 1 and page["items"][0]["status"] == "completed"
    s = client.get(f"/api/forms/{f['id']}/summary").json()
    assert (s["total_responses"], s["partial_responses"], s["completion_rate"]) == (1, 0, 100.0)

    # a late progress save after completion is ignored
    client.post(f"/api/public/forms/{pub}/progress", json={"idempotency_key": key, "answers": answers(d, Name="Changed")})
    assert client.get(f"/api/forms/{f['id']}/responses").json()["items"][0]["answers"][0]["value"] == "Ann"


def test_progress_is_lenient_and_ignores_empty(client):
    f, d = published_form(client)
    pub = f["public_id"]
    url = f"/api/public/forms/{pub}/progress"
    assert client.post(url, json={"idempotency_key": "k-empty-001", "answers": answers(d, Name="")}).status_code == 204
    assert client.get(f"/api/forms/{f['id']}/responses").json()["total"] == 0  # nothing answered → not a start
    # invalid email is skipped, valid name kept, required-ness ignored
    client.post(url, json={"idempotency_key": "k-bad-0001", "answers": answers(d, Name="Bo", Email="nope")})
    item = client.get(f"/api/forms/{f['id']}/responses").json()["items"][0]
    assert [a["question_title"] for a in item["answers"]] == ["Name"]
    assert client.post(url, json={"idempotency_key": "short", "answers": []}).status_code == 422


def test_status_filter_summary_abandoned_and_csv(client):
    f, d = published_form(client)
    pub = f["public_id"]
    client.post(f"/api/public/forms/{pub}/responses", json={"answers": answers(d, Name="A", Email="a@b.co")})
    client.post(f"/api/public/forms/{pub}/progress", json={"idempotency_key": "partial-0001", "answers": answers(d, Name="B")})
    client.post(f"/api/public/forms/{pub}/progress", json={"idempotency_key": "partial-0002", "answers": answers(d, Name="C")})
    base = f"/api/forms/{f['id']}/responses"
    assert client.get(base).json()["total"] == 3
    assert client.get(base + "?status=completed").json()["total"] == 1
    assert client.get(base + "?status=partial").json()["total"] == 2

    s = client.get(f"/api/forms/{f['id']}/summary").json()
    assert s["completion_rate"] == 33.3
    by_title = {q["title"]: q for q in s["questions"]}
    assert by_title["Email"]["abandoned"] == 2  # both stopped on the question after "Name"

    csv = client.get(base + ".csv").text.splitlines()
    assert csv[0].startswith("Response ID,Status,") and sum(",partial," in l for l in csv) == 2


# ───────────── file upload ─────────────
def test_file_upload_roundtrip_and_download(client):
    f, d, name, up = file_form(client)
    pub = f["public_id"]
    cv_ref = [q for q in d["questions"] if q["title"] == "Your CV"][0]["ref"]
    name_ref = [q for q in d["questions"] if q["title"] == "Name"][0]["ref"]

    r = upload(client, pub, cv_ref, b"%PDF-1.4 fake", "../../etc/passwd.pdf")
    assert r.status_code == 201
    meta = r.json()
    assert meta["name"] == "_.._etc_passwd.pdf" and meta["size"] == 13  # path separators neutralised

    ok = client.post(f"/api/public/forms/{pub}/responses", json={"answers": [
        {"ref": name_ref, "value": "Ann"}, {"ref": cv_ref, "value": {"file_id": meta["file_id"], "name": "LIE.exe", "size": 999999}}]})
    assert ok.status_code == 201
    item = client.get(f"/api/forms/{f['id']}/responses").json()["items"][0]
    cv = [a for a in item["answers"] if a["question_ref"] == cv_ref][0]["value"]
    assert cv["name"] == meta["name"] and cv["size"] == 13  # server trusts its own record, not the client

    dl = client.get(f"/api/forms/{f['id']}/files/{meta['file_id']}")
    assert dl.status_code == 200 and dl.content == b"%PDF-1.4 fake"
    assert dl.headers["content-type"] == "application/octet-stream" and "attachment" in dl.headers["content-disposition"]

    # other creators can't download it
    other = TestClient(app)
    other.headers.update(auth_headers(signup(other, "x@example.com")["token"]))
    assert other.get(f"/api/forms/{f['id']}/files/{meta['file_id']}").status_code == 404
    assert TestClient(app).get(f"/api/forms/{f['id']}/files/{meta['file_id']}").status_code == 401

    csv = client.get(f"/api/forms/{f['id']}/responses.csv").text
    assert meta["name"] in csv
    s = client.get(f"/api/forms/{f['id']}/summary").json()
    assert [q for q in s["questions"] if q["type"] == "file_upload"][0]["files"][0]["name"] == meta["name"]


def test_file_upload_rules(client):
    f, d, name, up = file_form(client)
    pub = f["public_id"]
    cv_ref = [q for q in d["questions"] if q["title"] == "Your CV"][0]["ref"]
    name_ref = [q for q in d["questions"] if q["title"] == "Name"][0]["ref"]

    assert upload(client, pub, cv_ref, b"x" * (1024 * 1024 + 1)).status_code == 413  # over the 1 MB question limit
    assert upload(client, pub, cv_ref, b"").status_code in (400, 422)
    assert upload(client, pub, name_ref).status_code == 404  # not a file question
    assert upload(client, pub, "q_nope").status_code == 404

    # required: nothing uploaded → server message
    r = client.post(f"/api/public/forms/{pub}/responses", json={"answers": [{"ref": name_ref, "value": "A"}, {"ref": cv_ref, "value": None}]})
    assert r.status_code == 422 and r.json()["detail"]["errors"][0]["message"] == "Please upload a file"
    # fake / foreign file id
    r = client.post(f"/api/public/forms/{pub}/responses", json={"answers": [
        {"ref": name_ref, "value": "A"}, {"ref": cv_ref, "value": {"file_id": "f_doesnotexist", "name": "a", "size": 1}}]})
    assert r.status_code == 422

    # another form's upload can't be attached here
    f2, d2, *_ = file_form(client)
    ref2 = [q for q in d2["questions"] if q["title"] == "Your CV"][0]["ref"]
    foreign = upload(client, f2["public_id"], ref2).json()
    r = client.post(f"/api/public/forms/{pub}/responses", json={"answers": [
        {"ref": name_ref, "value": "A"}, {"ref": cv_ref, "value": foreign}]})
    assert r.status_code == 422

    # question limit is clamped, logic only supports is_answered
    q = client.patch(f"/api/forms/{f['id']}/questions/{up['id']}", json={"properties": {"max_size_mb": 9999}}).json()
    assert q["properties"]["max_size_mb"] == 25
    bad = client.put(f"/api/forms/{f['id']}/logic", json={"rules": [{"source_question_id": up["id"], "operator": "equals", "value": "x", "destination_type": "end"}]})
    assert bad.status_code == 422


def test_discard_and_cleanup_of_files(client):
    f, d, *_ = file_form(client)
    pub = f["public_id"]
    cv_ref = [q for q in d["questions"] if q["title"] == "Your CV"][0]["ref"]
    name_ref = [q for q in d["questions"] if q["title"] == "Name"][0]["ref"]

    a = upload(client, pub, cv_ref).json()
    assert client.delete(f"/api/public/forms/{pub}/upload/{a['file_id']}").status_code == 204
    assert client.get(f"/api/forms/{f['id']}/files/{a['file_id']}").status_code == 404

    b = upload(client, pub, cv_ref).json()
    client.post(f"/api/public/forms/{pub}/responses", json={"answers": [{"ref": name_ref, "value": "A"}, {"ref": cv_ref, "value": b}]})
    # attached files can't be discarded by respondents any more
    client.delete(f"/api/public/forms/{pub}/upload/{b['file_id']}")
    assert client.get(f"/api/forms/{f['id']}/files/{b['file_id']}").status_code == 200

    resp_id = client.get(f"/api/forms/{f['id']}/responses").json()["items"][0]["id"]
    folder = UPLOAD_DIR / "answers" / str(f["id"])
    assert len(list(folder.iterdir())) == 1
    client.delete(f"/api/forms/{f['id']}/responses/{resp_id}")
    assert list(folder.iterdir()) == []  # deleting a response deletes its files

    c = upload(client, pub, cv_ref).json()
    assert len(list(folder.iterdir())) == 1
    client.delete(f"/api/forms/{f['id']}")
    assert list(folder.iterdir()) == []  # deleting the form deletes everything
    assert c  # silence linters


# ───────────── themes ─────────────
def test_custom_themes_crud_and_isolation(client):
    theme = {"name": "x", "font": "Georgia", "background": "#112233", "question_color": "#FFFFFF", "answer_color": "#FFCC00",
             "button_color": "#FFCC00", "button_text_color": "#000000", "background_image": "", "background_overlay": 35}
    r = client.post("/api/themes", json={"name": "Night owl", "theme": theme})
    assert r.status_code == 201 and r.json()["name"] == "Night owl" and r.json()["theme"]["name"] == "Night owl"
    assert r.json()["theme"]["background_overlay"] == 35
    assert client.post("/api/themes", json={"name": "bad", "theme": {**theme, "background": "red"}}).status_code == 422
    assert client.post("/api/themes", json={"name": "bad", "theme": {**theme, "background_image": "javascript:alert(1)"}}).status_code == 422
    assert client.post("/api/themes", json={"name": "bad", "theme": {**theme, "background_overlay": 99}}).status_code == 422
    assert len(client.get("/api/themes").json()) == 1

    other = TestClient(app)
    other.headers.update(auth_headers(signup(other, "o@example.com")["token"]))
    assert other.get("/api/themes").json() == []
    assert other.delete(f"/api/themes/{r.json()['id']}").status_code == 404
    assert client.delete(f"/api/themes/{r.json()['id']}").status_code == 204
    assert client.get("/api/themes").json() == []


def test_background_image_upload(client):
    f = make_form(client)
    r = client.post(f"/api/forms/{f['id']}/background", params={"filename": "bg.png"}, content=PNG)
    assert r.status_code == 201
    url = r.json()["url"]
    assert url.startswith("/api/public/assets/")
    img = TestClient(app).get(url)  # public, no login
    assert img.status_code == 200 and img.headers["content-type"] == "image/png" and img.content == PNG

    html = b"<html><script>alert(1)</script></html>"
    assert client.post(f"/api/forms/{f['id']}/background", content=html, headers={"Content-Type": "image/png"}).status_code == 415
    assert client.post(f"/api/forms/{f['id']}/background", content=PNG + b"\0" * (6 * 1024 * 1024)).status_code == 413
    assert TestClient(app).post(f"/api/forms/{f['id']}/background", content=PNG).status_code == 401

    # the theme accepts the uploaded url and serves it on the public form
    full = client.get(f"/api/forms/{f['id']}").json()
    client.patch(f"/api/forms/{f['id']}/questions/{f['questions'][0]['id']}", json={"title": "Q"})
    client.patch(f"/api/forms/{f['id']}", json={"theme": {**full["theme"], "background_image": url, "background_overlay": 40}})
    client.post(f"/api/forms/{f['id']}/publish")
    pub = TestClient(app).get(f"/api/public/forms/{f['public_id']}").json()
    assert pub["theme"]["background_image"] == url and pub["theme"]["background_overlay"] == 40
