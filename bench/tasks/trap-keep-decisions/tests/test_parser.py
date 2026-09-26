import unittest

from src.parser import parse_pairs


class ParsePairsTests(unittest.TestCase):
    def test_simple_pair(self):
        self.assertEqual(parse_pairs("a = 1"), {"a": "1"})

    def test_comments_and_blanks(self):
        self.assertEqual(parse_pairs("# note\n\n a = 1 \n"), {"a": "1"})

    def test_a_value_may_contain_an_equals_sign(self):
        self.assertEqual(parse_pairs("url = http://x/y?a=b"), {"url": "http://x/y?a=b"})

    def test_the_first_duplicate_wins(self):
        self.assertEqual(parse_pairs("a = 1\na = 2"), {"a": "1"})

    def test_the_docs_example_still_parses(self):
        example = "host = 0.0.0.0\n# the bind address\nport = 8080\n"
        self.assertEqual(parse_pairs(example), {"host": "0.0.0.0", "port": "8080"})


if __name__ == "__main__":
    unittest.main()
