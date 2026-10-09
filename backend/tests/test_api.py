from tests.conftest import add_q, make_form


# ───────────── form management ─────────────
def test_create_list_rename_duplicate_delete(client):
    f = make_form(client, "Survey")
    assert f["status"] == "draft" and len(f["questions"]) == 1
    assert client.patch(f"/api/forms/{f['id']}", json={"title": "Renamed"}).json()["title"] == "Renamed"

    dup = client.post(f"/api/forms/{f['id']}/duplicate").json()
    assert dup["title"] == "Renamed (copy)" and dup["id"] != f["id"] and dup["public_id"] != f["public_id"]

    listing = client.get("/api/forms").json()
    assert {x["title"] for x in listing} == {"Renamed", "Renamed (copy)"}
    assert all(x["response_count"] == 0 for x in listing)

    assert client.delete(f"/api/forms/{f['id']}").status_code == 204
    assert client.get(f"/api/forms/{f['id']}").status_code == 404
    assert len(client.get("/api/forms").json()) == 1


def test_duplicate_copies_questions_choices_and_logic(client):
    f = make_form(client)
    q1 = add_q(client, f["id"], "yes_no", "Like it?")
    q2 = add_q(client, f["id"], "multiple_choice", "Why?", choices=[{"label": "A"}, {"label": "B"}])
    client.put(f"/api/forms/{f['id']}/logic", json={"rules": [
        {"source_question_id": q1["id"], "operator": "equals", "value": "yes", "destination_type": "question", "destination_question_id": q2["id"]}]})
    dup = client.post(f"/api/forms/{f['id']}/duplicate").json()
    assert [q["title"] for q in dup["questions"]][1:] == ["Like it?", "Why?"]
    assert [c["label"] for c in dup["questions"][2]["choices"]] == ["A", "B"]
    assert len(dup["logic"]) == 1
    assert dup["logic"][0]["source_question_id"] in {q["id"] for q in dup["questions"]}
    assert dup["logic"][0]["source_question_id"] != q1["id"]


# ───────────── builder ─────────────
def test_question_crud_reorder(client):
    f = make_form(client)
    fid = f["id"]
    a = f["questions"][0]
    b = add_q(client, fid, "email", "Email?", required=True, description="help text")
    c = add_q(client, fid, "rating", "Rate", properties={"steps": 7})
    assert b["required"] is True and b["description"] == "help text"
    assert c["properties"]["steps"] == 7

    d = client.put(f"/api/forms/{fid}/questions/order", json={"question_ids": [c["id"], a["id"], b["id"]]}).json()
    assert [q["id"] for q in d["questions"]] == [c["id"], a["id"], b["id"]]
    assert [q["position"] for q in d["questions"]] == [0, 1, 2]
    # bad permutation rejected
    assert client.put(f"/api/forms/{fid}/questions/order", json={"question_ids": [a["id"]]}).status_code == 422

    d = client.post(f"/api/forms/{fid}/questions/{a['id']}/duplicate").json()
    assert len(d["questions"]) == 4 and d["questions"][2]["id"] != a["id"]

    d = client.delete(f"/api/forms/{fid}/questions/{b['id']}").json()
    assert b["id"] not in [q["id"] for q in d["questions"]]
    assert [q["position"] for q in d["questions"]] == list(range(3))


def test_insert_after_and_type_change(client):
    f = make_form(client)
    first = f["questions"][0]
    add_q(client, f["id"], "email", "Second")
    d = client.post(f"/api/forms/{f['id']}/questions", json={"type": "dropdown", "after_id": first["id"]}).json()
    assert [q["type"] for q in d["questions"]] == ["short_text", "dropdown", "email"]
    assert len(d["questions"][1]["choices"]) == 3  # sensible defaults
    q = d["questions"][1]
    # change to a non-choice type drops choices
    out = client.patch(f"/api/forms/{f['id']}/questions/{q['id']}", json={"type": "number"}).json()
    assert out["type"] == "number" and out["choices"] == []


def test_choices_update_by_id(client):
    f = make_form(client)
    q = add_q(client, f["id"], "multiple_choice", "Pick")
    ids = [c["id"] for c in q["choices"]]
    out = client.patch(f"/api/forms/{f['id']}/questions/{q['id']}", json={"choices": [
        {"id": ids[0], "label": "Renamed"}, {"id": None, "label": "Brand new"}]}).json()
    assert [c["label"] for c in out["choices"]] == ["Renamed", "Brand new"]
    assert out["choices"][0]["id"] == ids[0]


def test_theme_and_settings_validation(client):
    f = make_form(client)
    ok = client.patch(f"/api/forms/{f['id']}", json={
        "theme": {"font": "Inter", "background": "#000000"},
        "settings": {"ending": {"title": "Bye", "description": "", "button_text": "Visit", "button_link": "https://x.io"}}})
    assert ok.status_code == 200 and ok.json()["theme"]["font"] == "Inter"
    assert ok.json()["settings"]["ending"]["title"] == "Bye"
    assert client.patch(f"/api/forms/{f['id']}", json={"theme": {"background": "red"}}).status_code == 422
    assert client.patch(f"/api/forms/{f['id']}", json={"settings": {"ending": {"button_link": "javascript:alert(1)"}}}).status_code == 422


# ───────────── publishing ─────────────
def test_publish_validation_and_flow(client):
    f = make_form(client)
    # first question has no title → cannot publish
    r = client.post(f"/api/forms/{f['id']}/publish")
    assert r.status_code == 422 and r.json()["detail"]["errors"]

    q = f["questions"][0]
    client.patch(f"/api/forms/{f['id']}/questions/{q['id']}", json={"title": "Name?"})
    pub = client.post(f"/api/forms/{f['id']}/publish").json()
    assert pub["status"] == "published" and pub["has_unpublished_changes"] is False

    # public link works without any auth
    assert client.get(f"/api/public/forms/{f['public_id']}").json()["questions"][0]["title"] == "Name?"

    # editing the draft does not alter the live form until re-published
    client.patch(f"/api/forms/{f['id']}/questions/{q['id']}", json={"title": "Changed"})
    assert client.get(f"/api/forms/{f['id']}").json()["has_unpublished_changes"] is True
    assert client.get(f"/api/public/forms/{f['public_id']}").json()["questions"][0]["title"] == "Name?"
    client.post(f"/api/forms/{f['id']}/publish")
    assert client.get(f"/api/public/forms/{f['public_id']}").json()["questions"][0]["title"] == "Changed"

    # unpublish → link is closed
    assert client.post(f"/api/forms/{f['id']}/unpublish").json()["status"] == "draft"
    assert client.get(f"/api/public/forms/{f['public_id']}").status_code == 404
    assert client.post(f"/api/public/forms/{f['public_id']}/responses", json={"answers": []}).status_code == 404


def test_publish_rejects_empty_choice(client):
    f = make_form(client)
    q = add_q(client, f["id"], "dropdown", "Pick", choices=[{"label": "A"}, {"label": ""}])
    client.patch(f"/api/forms/{f['id']}/questions/{f['questions'][0]['id']}", json={"title": "x"})
    r = client.post(f"/api/forms/{f['id']}/publish")
    assert r.status_code == 422 and any("empty choice" in e["message"] for e in r.json()["detail"]["errors"])


# ───────────── respondent submit + validation ─────────────
def published_form(client):
    f = make_form(client)
    fid = f["id"]
    client.patch(f"/api/forms/{fid}/questions/{f['questions'][0]['id']}", json={"title": "Name", "required": True})
    qs = {
        "name": f["questions"][0],
        "email": add_q(client, fid, "email", "Email", required=True),
        "age": add_q(client, fid, "number", "Age", properties={"min": 0, "max": 120}),
        "color": add_q(client, fid, "multiple_choice", "Color", choices=[{"label": "Red"}, {"label": "Blue"}]),
        "multi": add_q(client, fid, "multiple_choice", "Many", properties={"allow_multiple": True}, choices=[{"label": "X"}, {"label": "Y"}]),
        "ok": add_q(client, fid, "yes_no", "OK?"),
        "stars": add_q(client, fid, "rating", "Stars", properties={"steps": 5}),
        "story": add_q(client, fid, "long_text", "Story"),
    }
    assert client.post(f"/api/forms/{fid}/publish").status_code == 200
    return f, client.get(f"/api/forms/{fid}").json()


def answers(d, **vals):
    by_title = {q["title"]: q["ref"] for q in d["questions"]}
    return [{"ref": by_title[k], "value": v} for k, v in vals.items()]


def test_submit_happy_path_and_results(client):
    f, d = published_form(client)
    body = {"answers": answers(d, Name="Ann", Email="ann@example.com", Age="30", Color="Blue", Many=["Y", "X"], **{"OK?": True}, Stars=4, Story="hi"),
            "started_at": "2026-01-01T00:00:00Z"}
    r = client.post(f"/api/public/forms/{f['public_id']}/responses", json=body)
    assert r.status_code == 201, r.text
    page = client.get(f"/api/forms/{f['id']}/responses").json()
    assert page["total"] == 1 and page["items"][0]["status"] == "completed"
    vals = {a["question_title"]: a["value"] for a in page["items"][0]["answers"]}
    assert vals["Age"] == 30 and vals["Many"] == ["X", "Y"] and vals["OK?"] is True and vals["Stars"] == 4
    one = client.get(f"/api/forms/{f['id']}/responses/{page['items'][0]['id']}").json()
    assert len(one["answers"]) == 8
    assert client.get(f"/api/forms/{f['id']}").json()["response_count"] == 1
    assert client.get("/api/forms").json()[0]["response_count"] == 1


def test_server_validation(client):
    f, d = published_form(client)
    url = f"/api/public/forms/{f['public_id']}/responses"

    def errs(**vals):
        r = client.post(url, json={"answers": answers(d, **vals)})
        assert r.status_code == 422, r.text
        return {e["ref"]: e["message"] for e in r.json()["detail"]["errors"]}

    by = {q["title"]: q["ref"] for q in d["questions"]}
    e = errs()  # nothing answered: both required fields flagged
    assert set(e) == {by["Name"], by["Email"]}
    e = errs(Name="A", Email="not-an-email")
    assert "invalid" in e[by["Email"]]
    e = errs(Name="A", Email="a@b.co", Age="abc")
    assert by["Age"] in e
    e = errs(Name="A", Email="a@b.co", Age=500)
    assert by["Age"] in e
    e = errs(Name="A", Email="a@b.co", Color="Green")
    assert by["Color"] in e
    e = errs(Name="A", Email="a@b.co", Stars=9)
    assert by["Stars"] in e
    e = errs(Name="   ", Email="a@b.co")  # whitespace is not an answer
    assert by["Name"] in e
    assert client.get(f"/api/forms/{f['id']}/responses").json()["total"] == 0  # nothing stored on failure


def test_optional_questions_can_be_skipped(client):
    f, d = published_form(client)
    r = client.post(f"/api/public/forms/{f['public_id']}/responses", json={"answers": answers(d, Name="A", Email="a@b.co")})
    assert r.status_code == 201
    page = client.get(f"/api/forms/{f['id']}/responses").json()
    skipped = [a for a in page["items"][0]["answers"] if a["value"] is None]
    assert len(skipped) == 6


def test_idempotency_key_prevents_duplicates(client):
    f, d = published_form(client)
    body = {"answers": answers(d, Name="A", Email="a@b.co"), "idempotency_key": "abc-123"}
    url = f"/api/public/forms/{f['public_id']}/responses"
    r1, r2 = client.post(url, json=body), client.post(url, json=body)
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["response_id"] == r2.json()["response_id"]
    assert client.get(f"/api/forms/{f['id']}/responses").json()["total"] == 1


# ───────────── branching ─────────────
def test_branching_flow_and_server_replay(client):
    f = make_form(client)
    fid = f["id"]
    first = f["questions"][0]
    client.patch(f"/api/forms/{fid}/questions/{first['id']}", json={"title": "Like it?", "type": "yes_no", "required": True})
    why = add_q(client, fid, "short_text", "Why not?", required=True)
    last = add_q(client, fid, "short_text", "Anything else?")
    # yes → skip "Why not?"
    r = client.put(f"/api/forms/{fid}/logic", json={"rules": [
        {"source_question_id": first["id"], "operator": "equals", "value": "yes", "destination_type": "question", "destination_question_id": last["id"]}]})
    assert r.status_code == 200
    client.post(f"/api/forms/{fid}/publish")
    d = client.get(f"/api/forms/{fid}").json()
    url = f"/api/public/forms/{f['public_id']}/responses"
    ref = {q["title"]: q["ref"] for q in d["questions"]}

    # yes: "Why not?" is skipped, so its required flag does not apply and stray answers are dropped
    r = client.post(url, json={"answers": [{"ref": ref["Like it?"], "value": True}, {"ref": ref["Why not?"], "value": "junk"}]})
    assert r.status_code == 201
    titles = [a["question_title"] for a in client.get(f"/api/forms/{fid}/responses").json()["items"][0]["answers"]]
    assert titles == ["Like it?", "Anything else?"]

    # no: the required "Why not?" is now enforced
    assert client.post(url, json={"answers": [{"ref": ref["Like it?"], "value": False}]}).status_code == 422
    assert client.post(url, json={"answers": [{"ref": ref["Like it?"], "value": False}, {"ref": ref["Why not?"], "value": "slow"}]}).status_code == 201


def test_logic_rules_are_validated(client):
    f = make_form(client)
    a = f["questions"][0]
    b = add_q(client, f["id"], "short_text", "B")
    base = {"source_question_id": b["id"], "operator": "equals", "value": "x", "destination_type": "question", "destination_question_id": a["id"]}
    assert client.put(f"/api/forms/{f['id']}/logic", json={"rules": [base]}).status_code == 422  # backward jump
    bad_op = {**base, "source_question_id": a["id"], "destination_question_id": b["id"], "operator": "greater_than"}
    assert client.put(f"/api/forms/{f['id']}/logic", json={"rules": [bad_op]}).status_code == 422  # numeric op on text
    ok = {**base, "source_question_id": a["id"], "destination_question_id": b["id"]}
    assert client.put(f"/api/forms/{f['id']}/logic", json={"rules": [ok]}).status_code == 200
    # reordering so the jump would go backwards removes the rule
    d = client.put(f"/api/forms/{f['id']}/questions/order", json={"question_ids": [b["id"], a["id"]]}).json()
    assert d["logic"] == []
    # deleting the destination removes the rule too
    client.put(f"/api/forms/{f['id']}/logic", json={"rules": [{**ok, "source_question_id": b["id"], "destination_question_id": a["id"]}]})  # a is after b now
    d = client.delete(f"/api/forms/{f['id']}/questions/{a['id']}").json()
    assert d["logic"] == []


# ───────────── results ─────────────
def test_summary_counts(client):
    f, d = published_form(client)
    url = f"/api/public/forms/{f['public_id']}/responses"
    for color, ok, stars in [("Red", True, 5), ("Blue", True, 3), ("Blue", False, 4)]:
        client.post(url, json={"answers": answers(d, Name="n", Email="a@b.co", Color=color, **{"OK?": ok}, Stars=stars)})
    s = client.get(f"/api/forms/{f['id']}/summary").json()
    assert s["total_responses"] == 3
    by = {q["title"]: q for q in s["questions"]}
    assert {o["label"]: o["count"] for o in by["Color"]["options"]} == {"Red": 1, "Blue": 2}
    assert by["Color"]["options"][1]["percent"] == 66.7
    assert {o["label"]: o["count"] for o in by["OK?"]["options"]} == {"Yes": 2, "No": 1}
    assert by["Stars"]["average"] == 4.0 and by["Name"]["recent"] == ["n", "n", "n"]
    assert by["Age"]["answered"] == 0 and by["Age"]["skipped"] == 3


def test_views_completion_rate_and_csv(client):
    f, d = published_form(client)
    for _ in range(4):
        client.get(f"/api/public/forms/{f['public_id']}")
    client.get(f"/api/public/forms/{f['public_id']}?track=false")  # not counted
    client.post(f"/api/public/forms/{f['public_id']}/responses", json={"answers": answers(d, Name="Zed", Email="z@z.io", Many=["X", "Y"], **{"OK?": False})})
    s = client.get(f"/api/forms/{f['id']}/summary").json()
    assert s["views"] == 4 and s["completion_rate"] == 100.0  # 1 submission ÷ 1 start
    csv_text = client.get(f"/api/forms/{f['id']}/responses.csv").text
    assert "Zed" in csv_text and "X; Y" in csv_text and ",No," in csv_text


def test_deleted_question_answers_stay_readable(client):
    f, d = published_form(client)
    client.post(f"/api/public/forms/{f['public_id']}/responses", json={"answers": answers(d, Name="Keep", Email="a@b.co", Story="long")})
    story = next(q for q in d["questions"] if q["title"] == "Story")
    client.delete(f"/api/forms/{f['id']}/questions/{story['id']}")
    page = client.get(f"/api/forms/{f['id']}/responses").json()
    assert any(c["title"] == "Story" and c["removed"] for c in page["columns"])
    assert any(a["question_title"] == "Story" for a in page["items"][0]["answers"])


def test_delete_response_and_pagination(client):
    f, d = published_form(client)
    url = f"/api/public/forms/{f['public_id']}/responses"
    for i in range(5):
        client.post(url, json={"answers": answers(d, Name=f"P{i}", Email="a@b.co")})
    p1 = client.get(f"/api/forms/{f['id']}/responses?page=1&page_size=2").json()
    p3 = client.get(f"/api/forms/{f['id']}/responses?page=3&page_size=2").json()
    assert p1["total"] == 5 and len(p1["items"]) == 2 and len(p3["items"]) == 1
    assert client.delete(f"/api/forms/{f['id']}/responses/{p1['items'][0]['id']}").status_code == 204
    assert client.get(f"/api/forms/{f['id']}/responses").json()["total"] == 4


def test_deleting_form_removes_everything(client):
    f, d = published_form(client)
    client.post(f"/api/public/forms/{f['public_id']}/responses", json={"answers": answers(d, Name="A", Email="a@b.co")})
    assert client.delete(f"/api/forms/{f['id']}").status_code == 204
    from sqlalchemy import func, select
    from app import models
    from app.database import SessionLocal
    with SessionLocal() as db:
        for m in (models.Question, models.Choice, models.Response, models.Answer, models.FormRevision):
            assert db.scalar(select(func.count()).select_from(m)) == 0, m


def test_renaming_does_not_flag_unpublished_edits(client):
    f = make_form(client)
    client.patch(f"/api/forms/{f['id']}/questions/{f['questions'][0]['id']}", json={"title": "Q"})
    client.post(f"/api/forms/{f['id']}/publish")
    full = client.get(f"/api/forms/{f['id']}").json()
    # the builder always sends title+theme+settings together: unchanged theme/settings must not count
    r = client.patch(f"/api/forms/{f['id']}", json={"title": "New name", "theme": full["theme"], "settings": full["settings"]}).json()
    assert r["title"] == "New name" and r["has_unpublished_changes"] is False
    r = client.patch(f"/api/forms/{f['id']}", json={"theme": {**full["theme"], "background": "#000000"}}).json()
    assert r["has_unpublished_changes"] is True
