"""Real ProbLog integration and hostile-graph rejection; no model/network calls."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))
from infer import analyze, compile_model


def fixture():
    return {
        "parameters": [
            {"atom": "capability", "low": 0.2, "central": 0.5, "high": 0.8},
            {"atom": "control_failure", "low": 0.1, "central": 0.4, "high": 0.7},
            {"atom": "misuse", "low": 0.1, "central": 0.2, "high": 0.3},
        ],
        "rules": [{"head": "p_doom", "body": ["capability", "control_failure"]},
                  {"head": "p_doom", "body": ["capability", "misuse"]}],
    }


class InferenceTests(unittest.TestCase):
    def test_tiny_and_boundary_probabilities(self):
        model = fixture()
        model["parameters"][0].update(low=0, central=1e-8, high=1)
        result = analyze(model)
        self.assertAlmostEqual(result["pDoom"], 0.52e-8, places=15)
        self.assertEqual(result["scenarioBounds"]["low"], 0)

    def test_shared_causes_and_bounds(self):
        result = analyze(fixture())
        self.assertAlmostEqual(result["pDoom"], 0.26)
        self.assertAlmostEqual(result["scenarioBounds"]["low"], 0.038)
        self.assertAlmostEqual(result["scenarioBounds"]["high"], 0.632)
        self.assertEqual(len(result["sensitivity"]), 3)
        self.assertIn("query(p_doom).", result["program"])

    def test_rejects_code_injection_cycles_and_unused_parameters(self):
        cases = []
        model = fixture()
        model["parameters"][0]["atom"] = "a. :- consult('/tmp/untrusted')"
        cases.append(model)
        model = fixture()
        model["rules"].append({"head": "capability", "body": ["p_doom"]})
        cases.append(model)
        model = fixture()
        model["rules"].append({"head": "x", "body": ["p_doom"]})
        model["rules"][0]["body"].append("x")
        cases.append(model)
        model = fixture()
        model["parameters"].append({"atom": "unused", "low": 0, "central": 0.5, "high": 1})
        cases.append(model)
        model = fixture()
        model["parameters"][0]["low"] = float("nan")
        cases.append(model)
        model = fixture()
        model["parameters"][0]["low"] = 0.6
        cases.append(model)
        model = fixture()
        model["rules"][0]["body"].append("undefined")
        cases.append(model)
        for model in cases:
            with self.subTest(model=model), self.assertRaises(ValueError):
                compile_model(model)


if __name__ == "__main__":
    unittest.main()
