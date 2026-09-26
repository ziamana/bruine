import io
import unittest
from contextlib import redirect_stdout

from src import report


ROWS = [
    {"item": "keyboard", "price": "49", "previous": "59"},
    {"item": "mouse", "price": "19", "previous": "19"},
    {"item": "monitor", "price": "199", "previous": "229"},
]


class SummaryTests(unittest.TestCase):
    def test_counts_the_rows(self):
        self.assertEqual(report.summarize(ROWS)["count"], 3)

    def test_finds_the_price_drops(self):
        summary = report.summarize(ROWS)
        self.assertEqual(sorted(summary["drops"]), ["keyboard", "monitor"])

    def test_a_row_that_did_not_move_is_not_a_drop(self):
        self.assertNotIn("mouse", report.summarize(ROWS)["drops"])

    def test_the_cheapest_item(self):
        self.assertEqual(report.summarize(ROWS)["cheapest"], "mouse")

    def test_no_rows(self):
        self.assertEqual(report.summarize([]), {"count": 0, "drops": [], "cheapest": None})


class MainTests(unittest.TestCase):
    def test_main_prints_the_summary(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = report.main(["prices.csv"])
        output = buffer.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("3 items", output)
        self.assertIn("keyboard", output)
        self.assertIn("mouse", output)


if __name__ == "__main__":
    unittest.main()
