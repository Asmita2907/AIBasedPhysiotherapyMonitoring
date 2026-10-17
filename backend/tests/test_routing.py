from app.routing import Assignment, assign_reps


def test_no_physios_assigns_nothing():
    assert assign_reps(["r1"], [], {}) == []


def test_picks_least_loaded_and_spreads_reps():
    result = assign_reps(["r1", "r2", "r3"], ["a", "b"], {"a": 2, "b": 0})
    assert result == [Assignment("r1", "b"), Assignment("r2", "b"), Assignment("r3", "a")]


def test_ties_go_to_first_physio():
    assert assign_reps(["r1", "r2"], ["a", "b"], {}) == [Assignment("r1", "a"), Assignment("r2", "b")]
