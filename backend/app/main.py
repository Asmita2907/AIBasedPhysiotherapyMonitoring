import logging
from collections.abc import AsyncIterator

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import get_settings
from .routing import assign_reps
from .supabase import AuthError, ReviewRepository, SupabaseRepository

logger = logging.getLogger("physio.review")

settings = get_settings()
app = FastAPI(title="Physio tele-review service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


async def get_repository() -> AsyncIterator[ReviewRepository]:
    async with httpx.AsyncClient(timeout=10) as client:
        yield SupabaseRepository(get_settings(), client)


class RouteRequest(BaseModel):
    session_id: str


class AssignmentOut(BaseModel):
    rep_id: str
    physio_id: str


class RouteResponse(BaseModel):
    assigned: list[AssignmentOut]


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/reviews/route", response_model=RouteResponse)
async def route_reviews(
    body: RouteRequest,
    authorization: str = Header(default=""),
    repo: ReviewRepository = Depends(get_repository),
) -> RouteResponse:
    """Assigns a session's flagged reps to the least-busy physiotherapists."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        user_id = await repo.get_user_id(token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    owner = await repo.get_session_owner(body.session_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if owner != user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    rep_ids = await repo.unassigned_flagged_reps(body.session_id)
    physios = await repo.physio_ids() if rep_ids else []
    pending = await repo.pending_counts() if physios else {}
    assignments = assign_reps(rep_ids, physios, pending)
    for a in assignments:
        await repo.assign(a.rep_id, a.physio_id)
        # Hook for notifications (email/push) to the physiotherapist.
        logger.info("Rep %s assigned to physio %s", a.rep_id, a.physio_id)
    return RouteResponse(assigned=[AssignmentOut(rep_id=a.rep_id, physio_id=a.physio_id) for a in assignments])
