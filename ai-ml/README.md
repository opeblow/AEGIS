# Aegis Deal Intelligence (`ai-ml/`)

Phase 9 of the Aegis backend product. A separate top-level **Python (FastAPI)**
service that produces advisory deal intelligence. The service runs where the
backend already runs (your laptop now; a container later — see `Dockerfile`).

It never connects to the production database. The backend collects only the
field-level data it is authorized to expose for the current viewer, shapes it
into our `DealIntelligenceContext` schema, and POSTs it. The result is advisory
only: it can never approve, settle, or mutate authoritative transaction state.

## Boundaries (enforced and tested)

- **Data is authorized by the backend.** This service trusts *exactly* the
  context payload it receives. No DB, no discovery, no other deals.
- **Deterministic first.** Everything that can be computed exactly is computed
  exactly (offers, money diffs, risk rules, blockers, readiness counts). Only
  the narrative layer is "model" — and it is labeled as such.
- **No floats in money paths.** All monetary fields are strings parsed as
  `Decimal`; tests assert no float leaks into output.
- **Prompt injection defense.** Document text is treated as data, not
  instructions; heuristic flags exist for engineered documents, and the mock
  provider never consumes text at all.
- **Out-of-scope questions are refused** with an explicit `within_scope=false`
  answer, never answered by guessing.

## Layout

```
app/
  api/            FastAPI app, auth (bearer), error contract, handlers
  core/           config (env), errors (AI_* codes), exact finance math
  models/         provider abstraction: mock (default) + hosted (unconfigured)
  schemas/        context (in), output (result), wire (HTTP envelope)
  services/       compare, changes, risk, documents, readiness, negotiation,
                  query engine, security
  pipelines/      orchestrator: assemble the advisory result + input hash
  retrieval/      local document retriever seam
  evaluation/     self-evaluation framework + CLI corpus
tests/            pytest suite (57 tests)
scripts/          helper scripts
```

## Run it

```bash
cd ai-ml
../venv/Scripts/python -m pip install -r requirements.txt
copy .env.example .env        # set AEGIS_AI_SERVICE_TOKEN
../venv/Scripts/python -m uvicorn app.api.app:app --host 127.0.0.1 --port 8555
```

The internal API (all protected by the bearer token unless
`AEGIS_AI_SERVICE_TOKEN` is empty for local dev):

| Method | Path        | Purpose                                        |
|--------|-------------|------------------------------------------------|
| POST   | `/analyze`  | Structured deal intelligence for one deal      |
| POST   | `/query`    | Constrained natural-language question answering|
| GET    | `/health`   | Liveness + provider/credential status (public) |

The error contract uses the backend's `AI_*` codes so a failure maps
end-to-end without leaking provider internals.

## Model providers

- `mock` (default): deterministic, credential-free, fully reproducible.
- `hosted`: adapter slot that refuses to construct without
  `DEPLOYED_MODEL_URL` + `DEPLOYED_MODEL_API_KEY`. Nothing is connected today.

```bash
set AEGIS_AI_MODEL_PROVIDER=hosted   # requires the two DEPLOYED_* vars
```

## Test / verify

```bash
../venv/Scripts/python -m pytest -q
../venv/Scripts/python -m mypy app --ignore-missing-imports
../venv/Scripts/python -m app.evaluation.cli   # runs the invariant corpus
```

## Backend integration contract

The backend (TypeScript, `backend/src/modules/ai/`) will:

1. determine the viewer's authorized deal context via `resolveDealViewer`,
2. build `DealIntelligenceContext` (backend types mirror the Pydantic schema),
3. call `POST /analyze` (or `/query`) with `Authorization: Bearer ${token}`,
4. persist the advisory payload into `DealIntelligenceRun` for auditability.

Alarms from the snapshot ("model label everywhere, mock 0.5, never bars
approval") hold here too: `confidence` is capped at `0.5` for model-generated
narratives and `blockers` are the deterministic rules only.