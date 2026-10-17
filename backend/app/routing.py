from dataclasses import dataclass


@dataclass(frozen=True)
class Assignment:
    rep_id: str
    physio_id: str


def assign_reps(rep_ids: list[str], physio_ids: list[str], pending: dict[str, int]) -> list[Assignment]:
    """Gives each rep to the physiotherapist with the fewest pending reviews.

    Ties go to the physiotherapist listed first, so results are deterministic.
    """
    if not physio_ids:
        return []
    load = {p: pending.get(p, 0) for p in physio_ids}
    order = {p: i for i, p in enumerate(physio_ids)}
    assignments = []
    for rep_id in rep_ids:
        physio = min(physio_ids, key=lambda p: (load[p], order[p]))
        load[physio] += 1
        assignments.append(Assignment(rep_id=rep_id, physio_id=physio))
    return assignments
