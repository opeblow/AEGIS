# Aegis

<p align="center">
  <img src="frontend/src/app/favicon.ico" alt="Aegis mark" width="64" />
</p>

<h3 align="center">Move high-stakes deals forward. Keep every decision accountable.</h3>

<p align="center">
  Aegis brings private negotiation, policy-driven approvals, advisory intelligence, settlement workflows, and an immutable audit trail into one institutional transaction workspace.
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" />
  <img alt="FastAPI" src="https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white" />
  <img alt="Python" src="https://img.shields.io/badge/Python-3.12-3776ab?logo=python&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/Database-PostgreSQL-4169e1?logo=postgresql&logoColor=white" />
  <a href="https://github.com/opeblow/AEGIS/actions/workflows/ci.yml"><img alt="CI and releases" src="https://github.com/opeblow/AEGIS/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-green.svg" /></a>
</p>

<p align="center"><a href="CONTRIBUTING.md">Contributing</a> · <a href="CODE_OF_CONDUCT.md">Code of Conduct</a> · <a href="SECURITY.md">Security</a></p>

<p align="center">
  <em>One transaction record. From first offer to verified outcome.</em>
</p>

## Product tour

Aegis makes each step of a deal visible, permissioned, and traceable. The interface carries the landing page's visual language into sign-in, account creation, and onboarding: a dark canvas, faint network nodes around the edges, emerald-to-steel highlights, and an illustrated transaction flow. On large screens, the onboarding artwork sits beside the organization form; on small screens, the form remains prominent while the edge network motif frames it.

| Deal flow | Account creation |
|---|---|
| ![Deal flow overview](docs/media/deal-flow.gif) | ![Aegis account creation](docs/media/sign-up.gif) |
| **Secure sign-in** | **Organization onboarding** |
| ![Aegis sign-in](docs/media/sign-in.gif) | ![Aegis onboarding](docs/media/onboarding.gif) |

## What Aegis does

- **Negotiation:** private deal rooms, versioned offers, counteroffers, and participant-scoped documents.
- **Approvals:** organization policies determine who can approve and why; every decision is recorded.
- **Intelligence:** deterministic risk, readiness, and change analysis with an advisory narrative layer.
- **Optimization:** compare settlement routes with inspectable constraints and a clearly identified local simulator.
- **Settlement and audit:** verified workflow states, reconciliation, and append-only event history.
- **Security:** server-side sessions, CSRF protection, role-based organization access, and tenant-scoped authorization.

Aegis keeps authoritative transaction state in the backend. Intelligence and optimization can advise a decision; they do not approve or mutate deals.

## Architecture

```text
frontend/             Next.js 16 + React 19 + TypeScript
backend/              Fastify + Prisma + PostgreSQL
ai-ml/                FastAPI advisory intelligence service
quantum computing/    FastAPI route-optimization service
```

The backend API is the authority for accounts, organizations, deals, offers, approvals, documents, settlement workflow, and audit records. The Python services receive scoped inputs from the backend and return advisory results.

## Project structure

```text
AEGIS/
├── .github/workflows/       CI checks and tagged GitHub releases
├── ai-ml/                   FastAPI deal intelligence service
│   ├── app/                 API, schemas, pipelines, and analysis services
│   └── tests/
├── backend/                 Fastify API and Prisma data layer
│   ├── prisma/              Schema, migrations, and seed data
│   ├── src/modules/         Auth, deals, approvals, documents, settlement
│   └── tests/               Unit and integration tests
├── docs/media/              Product screenshots and animated GIFs
├── frontend/                Next.js web application
│   ├── public/
│   └── src/                 App routes, components, and shared libraries
├── quantum computing/       FastAPI route optimization service
│   ├── app/                 Optimization models, solvers, and API
│   └── tests/
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
└── SECURITY.md
```

## Requirements

- Node.js 20 or newer and npm
- Python 3.12
- PostgreSQL 15 or newer

## Run locally

Install the Python service dependencies from the repository root:

```powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r ai-ml\requirements.txt
.\venv\Scripts\python.exe -m pip install -r "quantum computing\requirements.txt"
```

Start PostgreSQL and create the application database:

```sql
CREATE DATABASE aegis;
```

Set up the backend environment and database schema:

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
```

In separate terminals, start the AI service, optimization service, backend, and frontend:

```powershell
cd ai-ml
..\venv\Scripts\python.exe -m uvicorn app.api.app:app --host 127.0.0.1 --port 8555
```

```powershell
cd "quantum computing"
..\venv\Scripts\python.exe -m uvicorn app.api.app:app --host 127.0.0.1 --port 8557
```

```powershell
cd backend
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The backend listens on port `4000`; the internal Python services listen on `8555` and `8557`. Configure service URLs and tokens in `backend/.env` and each Python service's `.env.example` as needed. Keep real secrets in local environment files; never commit them.

## Verification

```powershell
# Frontend
cd frontend
npm run lint
npm run build
npx tsc --noEmit

# Backend
cd ..\backend
npm test
npm run typecheck
npm run lint
```

Backend integration tests use the dedicated `aegis_test` database. To recreate its schema before testing, run `npm run db:test:setup` from `backend/`; this force-resets that test database. Python service tests run with `pytest -q` from each service directory using the repository virtual environment.

## Project status

Aegis includes the core transaction workflow, organization access controls, negotiation, documents and requirements, approval policies, settlement/reconciliation, deal intelligence, and route optimization. External provider connections such as production email delivery, real Canton settlement, and hardware quantum execution are separate integration work; the local simulator is not quantum hardware.

## License

This project is licensed under the [MIT License](LICENSE). Copyright © 2026 Mobolaji Opeyemi Bolatito.

## GitHub automation

GitHub Actions runs frontend lint, type checks, and production build; backend tests, type checks, lint, and build against an isolated PostgreSQL test database; and both Python service test suites. Pushing a version tag such as `v1.0.0` runs the same checks and, if they pass, publishes a GitHub Release with a source archive.

