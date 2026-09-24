# Contributing to Aegis

Thanks for helping make Aegis safer and more useful. Contributions of code, documentation, bug reports, and thoughtful product feedback are welcome.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- For security issues, follow [SECURITY.md](SECURITY.md); do not open a public issue.
- Check existing issues and pull requests before starting substantial work. For a large change, open an issue first so the scope can be agreed on.

## Local setup

Follow the [README setup guide](README.md#run-locally). The project has a Next.js frontend, a Fastify/Prisma backend, and two Python services. Work on the service relevant to your change and keep API contracts aligned across them.

## Making a change

1. Fork the repository and create a focused branch, such as `fix/approval-history` or `docs/local-setup`.
2. Keep changes small and explain user-visible behavior in the pull request.
3. Add or update tests when behavior changes. Never include real credentials, customer data, or production records.
4. Run the checks relevant to your changes (see [Verification](README.md#verification)).
5. Open a pull request with the problem, solution, test commands and results, and any screenshots for UI changes. Link related issues and call out database or configuration changes.

## Backend tests

Backend integration tests use a dedicated PostgreSQL database named `aegis_test`. `npm run db:test:setup` force-resets that database before testing. Use it only when your `DATABASE_URL` points to a disposable test database; never point it at development or production data.

## Review expectations

Pull requests should pass the GitHub Actions checks, avoid unrelated formatting churn, and include any required documentation or migration notes. A maintainer may request changes before merging.
