from app.services.changes import detect_changes


def test_detects_amount_and_status(canonical_context):
    changes = detect_changes(canonical_context)
    fields = {c.field for c in changes}
    assert "status" in fields
    assert any(c.field == "amount" for c in changes)


def test_change_significance_material_via_large_delta():
    from tests.conftest import make_context

    ctx = make_context()
    ctx.offers[0].amount = "500000.00"
    ctx.offers[0].price = "500000.00"
    changes = detect_changes(ctx)
    amount = next(c for c in changes if c.field == "amount")
    assert amount.significance == "material"


def test_source_documents_diffs():
    from app.schemas.context import DocumentContextInfo
    from datetime import datetime, timezone
    from tests.conftest import make_context

    ctx = make_context()
    older = DocumentContextInfo(
        id="doc-A",
        document_type="TERM_SHEET",
        title="Term sheet (older)",
        status="SUPERSEDED",
        version=1,
        chain_id="chain-2",
        supersedes_id=None,
        created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    newer = DocumentContextInfo(
        id="doc-B",
        document_type="TERM_SHEET",
        title="Term sheet (final)",
        status="REVIEWED",
        version=2,
        chain_id="chain-2",
        supersedes_id="doc-A",
        created_at=datetime(2026, 6, 2, tzinfo=timezone.utc),
    )
    ctx.documents.append(older)
    ctx.documents.append(newer)
    changes = detect_changes(ctx)
    title = [c for c in changes if c.field == "title"]
    assert title and title[0].before == "Term sheet (older)"