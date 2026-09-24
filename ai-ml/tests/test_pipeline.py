from app.pipelines.orchestrator import analyze, input_hash_of, run_query


def test_analysis_invariants(canonical_context):
    result = analyze(canonical_context)
    assert result.deal_id == "deal-1"
    assert result.summary.summary
    assert result.summary.model_summary is True
    assert result.model.provider == "mock"
    assert 0.0 <= result.confidence <= 1.0
    assert result.generated_at is not None
    assert result.input_hash


def test_no_float_money_in_output(canonical_context):
    result = analyze(canonical_context)
    rendered = result.model_dump(mode="json")

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k in (
                    "absolute_difference",
                    "before",
                    "after",
                    "notional_amount",
                    "settled_amount",
                ):
                    assert not isinstance(v, float), f"money leak at {k}={v!r}"
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(rendered)


def test_deterministic_reproducibility(canonical_context):
    a = analyze(canonical_context)
    b = analyze(canonical_context)
    assert a.model_dump(exclude={"generated_at"}) == b.model_dump(
        exclude={"generated_at"}
    )
    assert input_hash_of(
        a.model_dump(exclude={"generated_at"})
    ) == input_hash_of(b.model_dump(exclude={"generated_at"}))


def test_query_end_to_end(canonical_query):
    ans = run_query(canonical_query)
    assert ans.deal_id == "deal-1"
    assert ans.within_scope is True
    assert "1550000" in ans.answer
    assert ans.model.provider == "mock"


def test_input_hash_is_stable_format(canonical_context):
    h = input_hash_of({"a": 1, "b": "x"})
    assert h
    assert len(h) == 48
    assert all(c in "0123456789abcdef" for c in h)