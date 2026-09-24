from decimal import InvalidOperation

import pytest

from app.core.finance import (
    decimal_abs_diff,
    decimal_compare,
    decimal_relative_diff_percent,
    is_valid_amount,
    money_conflicts,
    normalize,
)


def test_normalize_trims_to_canonical():
    assert normalize("1.50") == "1.5"
    assert normalize("0001.2300") == "1.23"
    assert normalize(100) == "100"


def test_absolute_diff_exact():
    assert decimal_abs_diff("1.10", "1.15") == "0.05"


def test_relative_diff_percent():
    assert decimal_relative_diff_percent("100.00", "125.00") == 25.0


def test_relative_diff_zero_base_is_none():
    assert decimal_relative_diff_percent("0", "5") is None


def test_compare_reports_direction():
    cmp = decimal_compare("10.00", "12.50", "USD")
    assert cmp["absolute_difference"] == "2.5"
    assert cmp["direction"] == "increased"
    assert cmp["relative_difference_percent"] == 25.0


def test_compare_unchanged():
    cmp = decimal_compare("5", "5", "USD")
    assert cmp["direction"] == "unchanged"
    assert cmp["absolute_difference"] == "0"


def test_invalid_amount_rejected():
    assert not is_valid_amount("not-money")
    with pytest.raises((ValueError, InvalidOperation)):
        normalize("bogus")


def test_money_conflicts_exact():
    assert money_conflicts("1.00", "1.01")
    assert not money_conflicts("1.00", "1.00")