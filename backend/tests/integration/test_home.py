"""Home's one-request summary (GET /workspaces/{id}/home)."""
from .conftest import register
from .test_approval_deadlines import _set_round
from .test_client_approvals import API, draft, submit, team


def test_home_counts_lists_brand_filter_and_tenancy(api, db_exec):
    t = team(api)
    other_brand = api.post(f"{API}/workspaces/{t.ws}/brands", json={"name": "Other"}, headers=t.owner.headers).json()["id"]
    waiting = [draft(api, t.writer, t.brand_id) for _ in range(6)]
    for post_id in waiting:
        submit(api, t.writer, post_id)
    _set_round(db_exec, waiting[0], due_in_hours=-1)
    draft(api, t.writer, other_brand)

    body = api.get(f"{API}/workspaces/{t.ws}/home", headers=t.writer.headers).json()
    assert body["counts"] == {"pending_approval": 6, "draft": 1, "overdue": 1}
    assert len(body["pending_approval"]) == 5          # a preview; the count is exact
    assert len(body["recent"]) == 7 and body["failed"] == [] and body["scheduled"] == []
    assert {"id", "status", "approval_due_at", "media"} <= body["recent"][0].keys()

    only = api.get(f"{API}/workspaces/{t.ws}/home", params={"brand_id": other_brand}, headers=t.writer.headers).json()
    assert only["counts"] == {"draft": 1, "overdue": 0} and len(only["recent"]) == 1

    stranger = register(api, "Someone Else")
    assert api.get(f"{API}/workspaces/{t.ws}/home", headers=stranger.headers).status_code == 404
    # Their own workspace with our brand id: nothing of ours comes back.
    theirs = api.get(f"{API}/workspaces/{stranger.workspace_id}/home", params={"brand_id": t.brand_id},
                     headers=stranger.headers).json()
    assert theirs["recent"] == [] and theirs["counts"] == {"overdue": 0}
