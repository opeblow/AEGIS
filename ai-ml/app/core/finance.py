"""Deterministic, exact financial math.

All monetary arithmetic is performed on Python Decimal (string inputs) so no
float ever touches a dollar value. Relative differences are only produced when
the denominator is non-zero and a meaningful basis exists; otherwise a caller
gets an explicit None rather than a fabricated percentage.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, getcontext
from typing import Optional, Union

getcontext().prec = 50

AMOUNT = Union[str, int, Decimal]


def to_decimal(value: AMOUNT) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return Decimal(value)
    return Decimal(str(value).strip())


def is_valid_amount(value: AMOUNT) -> bool:
    try:
        to_decimal(value)
        return True
    except InvalidOperation:
        return False


def normalize(value: AMOUNT) -> str:
    """Canonical decimal string: no exponent, trailing zeros trimmed."""
    if not is_valid_amount(value):
        raise ValueError(f"Invalid monetary amount: {value!r}")
    s = format(to_decimal(value), "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def decimal_abs_diff(before: AMOUNT, after: AMOUNT) -> str:
    return normalize(abs(to_decimal(after) - to_decimal(before)))


def decimal_relative_diff_percent(
    before: AMOUNT, after: AMOUNT
) -> Optional[float]:
    """Relative change from `before` to `after`, or None when undefined."""
    base = to_decimal(before)
    if base == 0:
        return None
    delta = to_decimal(after) - base
    ratio = delta / base
    try:
        return float(ratio * 100)
    except (OverflowError, ValueError):
        return None


def decimal_compare(
    before: AMOUNT, after: AMOUNT, currency: str
) -> dict:
    """Exact comparison of two money values. Produces string differences only;
    never floats in the money path."""
    a = to_decimal(before)
    b = to_decimal(after)
    delta = b - a
    return {
        "currency": currency,
        "before": normalize(a),
        "after": normalize(b),
        "absolute_difference": normalize(abs(delta)),
        "direction": "increased" if delta > 0 else "decreased" if delta < 0 else "unchanged",
        "relative_difference_percent": decimal_relative_diff_percent(a, b),
    }


def relative_change_basis(before: AMOUNT, after: AMOUNT) -> Optional[float]:
    return decimal_relative_diff_percent(before, after)


def has_decimal_overlap(value: AMOUNT) -> bool:
    """True when the value is a valid finite decimal (so numeric rules apply)."""
    try:
        d = to_decimal(value)
        return d.is_finite()
    except InvalidOperation:
        return False


def money_conflicts(a: AMOUNT, b: AMOUNT) -> bool:
    """Exact money equality test used to detect conflicts."""
    try:
        return to_decimal(a) != to_decimal(b)
    except InvalidOperation:
        return True