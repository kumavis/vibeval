"""Executable tool-fit trial. All numerical inputs are hypothetical test fixtures."""
import json
import math
import time
from importlib.metadata import version

from problog import get_evaluatable
from problog.program import PrologString


def evaluate(program):
    started = time.monotonic()
    result = get_evaluatable().create_from(PrologString(program)).evaluate()
    return {str(k): float(v) for k, v in result.items()}, time.monotonic() - started


def run():
    shared = """0.5::capability_by_2050.
0.4::loss_of_control_switch.
0.2::misuse_switch.
0.1::mortality_threshold_switch.
loss_of_control :- capability_by_2050, loss_of_control_switch.
misuse :- capability_by_2050, misuse_switch.
catastrophe :- loss_of_control.
catastrophe :- misuse.
p_doom :- catastrophe, mortality_threshold_switch.
query(p_doom).
query(catastrophe).
"""
    cases = [
        ("shared prerequisite and overlapping pathways", shared,
         {"p_doom": 0.5 * (1 - (1 - 0.4) * (1 - 0.2)) * 0.1,
          "catastrophe": 0.26}),
        ("duplicate proofs do not double count", "0.3::a. b :- a. b :- a. query(b).", {"b": 0.3}),
        ("impossible prerequisite blocks event", shared.replace("0.5::", "0.0::"),
         {"p_doom": 0.0, "catastrophe": 0.0}),
        ("observed absence of prerequisite blocks event",
         shared + "evidence(capability_by_2050, false).", {"p_doom": 0.0, "catastrophe": 0.0}),
        ("mutually exclusive timeline alternatives",
         "0.2::early; 0.3::late. arrives :- early. arrives :- late. query(arrives).",
         {"arrives": 0.5}),
    ]
    results = []
    for name, program, expected in cases:
        actual, seconds = evaluate(program)
        assert all(math.isclose(actual[k], v, abs_tol=1e-10) for k, v in expected.items()), (name, actual, expected)
        results.append({"name": name, "expected": expected, "actual": actual, "seconds": seconds, "passed": True})
    print(json.dumps({
        "problog_version": version("problog"),
        "hypothetical_fixture_only": True,
        "tests": results,
        "shared_model": shared,
        "comparison": {
            "correct_shared_gate": 0.026,
            "incorrect_independent_paths": (1 - (1 - 0.5 * 0.4) * (1 - 0.5 * 0.2)) * 0.1,
            "incorrect_sum": (0.5 * 0.4 + 0.5 * 0.2) * 0.1,
        },
    }, indent=2))


if __name__ == "__main__":
    run()
