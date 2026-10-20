"""Compile a bounded positive ground graph to ProbLog; never execute agent code."""
import json
import math
import re
import sys
from importlib.metadata import version

from problog import get_evaluatable
from problog.program import PrologString

RESERVED = {"query", "evidence", "true", "false", "fail", "call", "consult"}


def validate(model):
    params, rules = model["parameters"], model["rules"]
    if not 2 <= len(params) <= 20 or not 1 <= len(rules) <= 32:
        raise ValueError("Use 2–20 parameters and 1–32 rules")
    names = [p["atom"] for p in params]
    heads = {r["head"] for r in rules}
    atoms = set(names) | heads
    if len(names) != len(set(names)) or set(names) & heads or "p_doom" not in heads:
        raise ValueError("Unique parameters, separate derived heads, and derived p_doom required")
    for atom in atoms:
        if not isinstance(atom, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", atom) or atom in RESERVED:
            raise ValueError("Invalid or reserved atom")
    for p in params:
        values = [p[k] for k in ("low", "central", "high")]
        if any(type(x) not in (int, float) or not math.isfinite(x) for x in values) or not 0 <= values[0] <= values[1] <= values[2] <= 1:
            raise ValueError("Require finite 0 <= low <= central <= high <= 1")
    dependencies = {a: set() for a in atoms}
    for r in rules:
        body = r["body"]
        if not isinstance(body, list) or not 1 <= len(body) <= 20 or any(not isinstance(a, str) or a not in atoms for a in body):
            raise ValueError("Rule bodies must reference defined atoms")
        dependencies[r["head"]].update(body)
    visiting, visited = set(), set()

    def walk(atom):
        if atom in visiting:
            raise ValueError("Cycles are not supported")
        if atom in visited:
            return
        visiting.add(atom)
        for child in dependencies[atom]:
            walk(child)
        visiting.remove(atom)
        visited.add(atom)

    walk("p_doom")
    if visited != atoms:
        raise ValueError("Every atom must contribute to p_doom")


def compile_model(model, field="central", override=None):
    validate(model)
    override = override or {}
    facts = [f'{float(override.get(p["atom"], p[field])):.17g}::{p["atom"]}.' for p in model["parameters"]]
    rules = [f'{r["head"]} :- {", ".join(r["body"])}.' for r in model["rules"]]
    queries = [f'query({a}).' for a in sorted({r["head"] for r in model["rules"]})]
    return "\n".join(facts + rules + queries) + "\n"


def infer(model, field="central", override=None):
    text = compile_model(model, field, override)
    result = get_evaluatable().create_from(PrologString(text)).evaluate()
    return {str(k): float(v) for k, v in result.items()}


def analyze(model):
    central = infer(model)
    low, high = infer(model, "low")["p_doom"], infer(model, "high")["p_doom"]
    sensitivities = []
    for p in model["parameters"]:
        lo = infer(model, override={p["atom"]: p["low"]})["p_doom"]
        hi = infer(model, override={p["atom"]: p["high"]})["p_doom"]
        sensitivities.append({"atom": p["atom"], "low": lo, "high": hi, "swing": hi - lo})
    return {
        "engine": "ProbLog", "version": version("problog"), "pDoom": central["p_doom"],
        "queries": central, "scenarioBounds": {"low": low, "high": high},
        "boundsMeaning": "All-low/all-high parameter scenarios in a positive monotone graph; not a confidence interval. Structural uncertainty is excluded.",
        "sensitivity": sorted(sensitivities, key=lambda s: s["swing"], reverse=True),
        "program": compile_model(model),
    }


if __name__ == "__main__":
    try:
        print(json.dumps(analyze(json.load(sys.stdin)), allow_nan=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
