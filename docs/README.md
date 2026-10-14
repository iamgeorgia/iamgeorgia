# Documentation

| Document | Who it is for | What it covers |
| --- | --- | --- |
| [LOCAL_SETUP.md](LOCAL_SETUP.md) | Anyone | Getting the whole platform running on your own machine, from prerequisites to troubleshooting |
| [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) | Testers, QA | Every endpoint under `/api`, with the exact expected result for each — success and failure |
| [postman/](postman/) | Testers, QA | A ready-to-import Postman collection: ~80 requests, each asserting its documented result |
| [security-testing/](security-testing/10-executive-summary.md) | Engineering, QA, owner | Backend security assessment and testing plan (2026-10-12): attack surface, findings, test matrix, manual/tool/automated guides, performance plan, threat model, roadmap. Start with `10-executive-summary.md`. |

## Start here

1. **[LOCAL_SETUP.md](LOCAL_SETUP.md)** — get the API and database running.
2. **[postman/README.md](postman/README.md)** — import the collection and run the
   health check.
3. **[API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) Part 1** — the ground rules.
   Read this once; it explains conventions that apply everywhere and will save
   you filing false bugs.
4. **[API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) Part 9** — a 45-minute
   suggested test run covering the paths that carry money.

## For developers

| Document | What it covers |
| --- | --- |
| [../server/README.md](../server/README.md) | Backend stack, layout, data model and the reasoning behind every design decision |
| [../server/API.md](../server/API.md) | The client-facing API contract — what to call, what comes back, who may see what |
| [../server/.env.example](../server/.env.example) | Every environment variable, fully commented |
| [../client/FRONTEND.md](../client/FRONTEND.md) | Colour system, accessibility audit, i18n and the front-end work log |
| [../README.md](../README.md) | What the project is and how the two apps fit together |
