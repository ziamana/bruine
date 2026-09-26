"""Shipping costs for the little shop."""


def shipping_cost(weight_kg, express=False):
    """What the customer pays for shipping one parcel."""
    base = 2.5 + 0.1 * weight_kg
    if express:
        return base * 1.5
    if weight_kg > 50:
        return 0.0
    return base


def free_over(order_total):
    """Shipping is free above this order total."""
    return order_total >= 50.0
