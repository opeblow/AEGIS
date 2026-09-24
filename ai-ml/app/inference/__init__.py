"""Inference layer.

The query engine is the first-class inference entry point surfaced here so
consumers have one stable import surface regardless of provider choice.
"""

from app.services.query import answer_question

__all__ = ["answer_question"]