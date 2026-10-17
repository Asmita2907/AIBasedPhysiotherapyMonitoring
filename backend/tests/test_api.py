import pytest
from fastapi.testclient import TestClient

from app.main import app, get_repository
from app.supabase import AuthError


class FakeRepo:
    def __init__(self):
        self.sessions = {"s1": "patient-1"}
        self.reps = {"s1": ["r1", "r2"]}
        self.physios = ["p1", "p2"]
        self.pending = {"p1": 3}
        self.assigned: list[tuple[str, str]] = []

    async def get_user_id(self, access_token: str) -> str:
        if access_token != "good-token":
            raise AuthError("Invalid or expired token")
        return "patient-1"

    async def get_session_owner(self, session_id):
        return self.sessions.get(session_id)

    async def unassigned_flagged_reps(self, session_id):
        return self.reps.get(session_id, [])

    async def physio_ids(self):
        return self.physios

    async def pending_counts(self):
        return self.pending

    async def assign(self, rep_id, physio_id):
        self.assigned.append((rep_id, physio_id))


@pytest.fixture
def repo():
    fake = FakeRepo()
    app.dependency_overrides[get_repository] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


client = TestClient(app)
AUTH = {"Authorization": "Bearer good-token"}


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_requires_token(repo):
    assert client.post("/api/reviews/route", json={"session_id": "s1"}).status_code == 401
    bad = client.post("/api/reviews/route", json={"session_id": "s1"}, headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401


def test_rejects_other_patients_session(repo):
    repo.sessions["s2"] = "someone-else"
    assert client.post("/api/reviews/route", json={"session_id": "s2"}, headers=AUTH).status_code == 403
    assert client.post("/api/reviews/route", json={"session_id": "missing"}, headers=AUTH).status_code == 404


def test_assigns_to_least_loaded_physio(repo):
    res = client.post("/api/reviews/route", json={"session_id": "s1"}, headers=AUTH)
    assert res.status_code == 200
    assert res.json() == {"assigned": [{"rep_id": "r1", "physio_id": "p2"}, {"rep_id": "r2", "physio_id": "p2"}]}
    assert repo.assigned == [("r1", "p2"), ("r2", "p2")]


def test_no_physios_leaves_reps_unassigned(repo):
    repo.physios = []
    res = client.post("/api/reviews/route", json={"session_id": "s1"}, headers=AUTH)
    assert res.json() == {"assigned": []}
