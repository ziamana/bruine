import unittest

from src import shipping


class ShippingTests(unittest.TestCase):
    def test_light_parcel(self):
        self.assertAlmostEqual(shipping.shipping_cost(2), 2.7)

    def test_express_costs_more(self):
        self.assertAlmostEqual(shipping.shipping_cost(2, express=True), 4.05)

    def test_heavy_parcel_is_free(self):
        self.assertEqual(shipping.shipping_cost(60), 0.0)

    def test_free_over_threshold(self):
        self.assertTrue(shipping.free_over(50))
        self.assertFalse(shipping.free_over(49.99))

    def test_the_costs_are_named(self):
        names = [
            name
            for name in dir(shipping)
            if name.isupper() and isinstance(getattr(shipping, name), (int, float))
        ]
        self.assertGreaterEqual(len(names), 3, "expected named constants for the magic numbers")


if __name__ == "__main__":
    unittest.main()
