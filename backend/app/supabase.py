from collections import Counter
from typing import Protocol

import httpx

from .config import Settings


class AuthError(Exception):
    pass


class ReviewRepository(Protocol):
    async def get_user_id(self, access_token: str) -> str: ...
    async def get_session_owner(self, session_id: str) -> str | None: ...
    async def unassigned_flagged_reps(self, session_id: str) -> list[str]: ...
    async def physio_ids(self) -> list[str]: ...
    async def pending_counts(self) -> dict[str, int]: ...
    async def assign(self, rep_id: str, physio_id: str) -> None: ...


class SupabaseRepository:
    """Talks to Supabase Auth and PostgREST with the service-role key."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        if not settings.supabase_url or not settings.supabase_service_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        self._url = settings.supabase_url
        self._key = settings.supabase_service_key
        self._client = client

    def _headers(self) -> dict[str, str]:
        headers = {"apikey": self._key}
        if self._key.startswith("eyJ"):  # legacy JWT service_role key
            headers["Authorization"] = f"Bearer {self._key}"
        return headers

    async def _get(self, path: str, params: dict[str, str]) -> list[dict]:
        res = await self._client.get(f"{self._url}/rest/v1/{path}", params=params, headers=self._headers())
        res.raise_for_status()
        return res.json()

    async def get_user_id(self, access_token: str) -> str:
        res = await self._client.get(
            f"{self._url}/auth/v1/user",
            headers={"apikey": self._key, "Authorization": f"Bearer {access_token}"},
        )
        if res.status_code != 200:
            raise AuthError("Invalid or expired token")
        return res.json()["id"]

    async def get_session_owner(self, session_id: str) -> str | None:
        rows = await self._get("exercise_sessions", {"id": f"eq.{session_id}", "select": "patient_id"})
        return rows[0]["patient_id"] if rows else None

    async def unassigned_flagged_reps(self, session_id: str) -> list[str]:
        rows = await self._get(
            "reps",
            {
                "session_id": f"eq.{session_id}",
                "review_status": "eq.pending",
                "assigned_physio_id": "is.null",
                "select": "id",
                "order": "rep_index",
            },
        )
        return [r["id"] for r in rows]

    async def physio_ids(self) -> list[str]:
        rows = await self._get("profiles", {"role": "eq.physio", "select": "id", "order": "created_at"})
        return [r["id"] for r in rows]

    async def pending_counts(self) -> dict[str, int]:
        rows = await self._get(
            "reps",
            {"review_status": "eq.pending", "assigned_physio_id": "not.is.null", "select": "assigned_physio_id"},
        )
        return dict(Counter(r["assigned_physio_id"] for r in rows))

    async def assign(self, rep_id: str, physio_id: str) -> None:
        res = await self._client.patch(
            f"{self._url}/rest/v1/reps",
            params={"id": f"eq.{rep_id}"},
            json={"assigned_physio_id": physio_id},
            headers={**self._headers(), "Prefer": "return=minimal"},
        )
        res.raise_for_status()
