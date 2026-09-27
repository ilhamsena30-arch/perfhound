from perfhound.model import Sample
from perfhound.stats import summarize


def test_summarize_basic():
    assert summarize([1.0, 3.0, 2.0]) == (1.0, 3.0, 2.0)


def test_summarize_ignores_none():
    assert summarize([1.0, None, 5.0]) == (1.0, 5.0, 3.0)


def test_summarize_empty_returns_none():
    assert summarize([None, None]) is None
    assert summarize([]) is None
