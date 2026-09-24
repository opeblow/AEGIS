"""Document intelligence.

Pure, deterministic text processing. Document text supplied by the backend is
treated as UNTRUSTED DATA, never as instructions (defense-in-depth against
prompt injection). Findings are computed strictly from content patterns; any
natural-language interpretation is produced by the model provider and clearly
labeled.

No external binary parsers: only text-centric extraction is supported. Binary
payloads (PDFs, images) without extractable text yield an explicit
USE_TEXT_EXTRACTION finding instead of a silent failure.
"""

from __future__ import annotations

import re
from typing import Optional

from app.schemas.context import DealIntelligenceContext, DocumentContextInfo
from app.schemas.output import DocumentFinding
from app.services.security import classified_injection

_BINARY_MARKERS = (
    b"PK\x03\x04",  # zip / docx / xlsx
    b"%PDF-",
    b"\x89PNG",
    b"\xff\xd8\xff",  # jpeg
)

_NON_TEXT_CHAR_RATIO = 0.15
_MIN_TEXT_LENGTH = 40

_MONEY_PATTERN = re.compile(
    r"\b(?P<sym>[$€£])?\s?(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|"
    r"\d+(?:\.\d{1,2})?)\s?(?P<code>[A-Z]{3})?\b"
)
_NEG_PATTERN = re.compile(r"\b(?:negative|owing|deficit)\b", re.IGNORECASE)


def _looks_binary(content: bytes | str) -> bool:
    data = content if isinstance(content, bytes) else content.encode(
        "utf-8", errors="ignore"
    )
    if any(data.startswith(m) for m in _BINARY_MARKERS):
        return True
    if not data:
        return False
    sample = data[:4096]
    printable = sum(
        1 for b in sample if 32 <= b < 127 or b in (9, 10, 13)
    )
    if not sample:
        return False
    return (printable / len(sample)) < (1 - _NON_TEXT_CHAR_RATIO) and (
        sample.count(b"\x00") > 0
    )


def _text_from(content: bytes | str) -> Optional[str]:
    if isinstance(content, str):
        return content
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return content.decode("latin-1")
        except UnicodeDecodeError:
            return None


def _has_money_syntax(text: str) -> bool:
    return bool(_MONEY_PATTERN.search(text))


def analyze_documents(
    context: DealIntelligenceContext,
    documents: list[DocumentContextInfo] | None = None,
) -> list[DocumentFinding]:
    findings: list[DocumentFinding] = []
    docs = documents if documents is not None else context.documents
    for doc in docs:
        if not doc.text:
            continue
        if _looks_binary(doc.text):
            findings.append(_binary_finding(doc))
            continue
        text = _text_from(doc.text)
        if not text:
            findings.append(_no_text_finding(doc))
            continue
        if classified_injection(text):
            findings.append(_injection_finding(doc))
        findings.extend(_content_findings(doc, text))
    return findings


def _injection_finding(doc: DocumentContextInfo) -> DocumentFinding:
    return DocumentFinding(
        document_id=doc.id,
        document_type=doc.document_type,
        title=doc.title,
        finding_type="suspected_prompt_injection",
        finding=(
            "This document looks engineered to carry instructions rather than "
            "information. It was treated strictly as data and did not "
            "influence the analysis."
        ),
        confidence=0.9,
        requires_review=True,
        evidence=["heuristic=injection_score>=0.5"],
        label="Potential issue",
    )


def _binary_finding(doc: DocumentContextInfo) -> DocumentFinding:
    return DocumentFinding(
        document_id=doc.id,
        document_type=doc.document_type,
        title=doc.title,
        finding_type="binary_content",
        finding=(
            "Document appears to be binary (e.g. PDF/office/image). The "
            "intelligence service only extracts from text. Submit the "
            "extracted text via the document endpoint to enable analysis."
        ),
        confidence=1.0,
        requires_review=True,
        evidence=[f"document={doc.id}", "content inode=raw"],
        label="Requires review",
    )


def _no_text_finding(doc: DocumentContextInfo) -> DocumentFinding:
    return DocumentFinding(
        document_id=doc.id,
        document_type=doc.document_type,
        title=doc.title,
        finding_type="no_extractable_text",
        finding=(
            "Document content is not UTF-8 readable; analysis skipped. Submit "
            "UTF-8 extracted text to enable document intelligence."
        ),
        confidence=1.0,
        requires_review=True,
        evidence=[f"document={doc.id}", "reason=non-utf8"],
        label="Potential issue",
    )


def _content_findings(doc: DocumentContextInfo, text: str) -> list[DocumentFinding]:
    findings: list[DocumentFinding] = []
    lowered = text

    if not _has_money_syntax(lowered):
        findings.append(
            DocumentFinding(
                document_id=doc.id,
                document_type=doc.document_type,
                title=doc.title,
                finding_type="required_headers_missing",
                finding=(
                    "No monetary amount syntax detected in the provided text; "
                    "stakeholders should confirm the document is complete."
                ),
                confidence=0.9,
                requires_review=True,
                evidence=[f"document={doc.id}", "scanned=content"],
                label="Potential issue",
            )
        )

    if _NEG_PATTERN.search(lowered):
        findings.append(
            DocumentFinding(
                document_id=doc.id,
                document_type=doc.document_type,
                title=doc.title,
                finding_type="negative_terms",
                finding=(
                    "Negative/owing/deficit language was found in the text; "
                    "review whether this is an adverse condition."
                ),
                confidence=0.9,
                requires_review=True,
                evidence=[f"document={doc.id}", "matched=negative|deficit|owing"],
                label="AI finding",
            )
        )

    if len(text) < _MIN_TEXT_LENGTH:
        findings.append(
            DocumentFinding(
                document_id=doc.id,
                document_type=doc.document_type,
                title=doc.title,
                finding_type="truncated_content",
                finding=(
                    "Provided text is unusually short; the document may be "
                    "truncated, which reduces extraction reliability."
                ),
                confidence=0.7,
                requires_review=True,
                evidence=[f"document={doc.id}", "chars_in=short"],
                label="Potential issue",
            )
        )
    return findings