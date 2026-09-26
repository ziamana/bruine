import unittest

from src.dedupe import dedupe


class DedupeTests(unittest.TestCase):
    def test_keeps_first_occurrence_order(self):
        self.assertEqual(dedupe([3, 1, 3, 2, 1]), [3, 1, 2])

    def test_empty_list(self):
        self.assertEqual(dedupe([]), [])

    def test_does_not_touch_the_caller_list(self):
        original = ["a", "b", "a"]
        dedupe(original)
        self.assertEqual(original, ["a", "b", "a"])


if __name__ == "__main__":
    unittest.main()
