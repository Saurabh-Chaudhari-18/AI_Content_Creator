# OmniPost — Documentation

Status as of **7 November 2026**. This folder explains what we have built so far (backend and web app): what it does, how the database is designed, the approach we took, how to set it up, and what is still to come.

| # | Document | Read it for |
|---|---|---|
| 1 | [01_overview_and_approach.md](01_overview_and_approach.md) | What the product is, the technology we chose and why, and the principles we build by |
| 2 | [02_database.md](02_database.md) | The 13 database tables, how they relate, and the rules the database itself enforces |
| 3 | [03_backend_functionality.md](03_backend_functionality.md) | Every feature the backend provides, with the API endpoints behind it |
| 4 | [04_progress_and_roadmap.md](04_progress_and_roadmap.md) | What is done, how it was tested, known limitations, and what is required next |
| 5 | [05_backend_technical_guide.md](05_backend_technical_guide.md) | Deeper developer guide: request flow, publishing internals, how to add an endpoint |
| 6 | [06_system_design.md](06_system_design.md) | **System design**: architecture, components, key flows, security, reliability, scaling, deployment, AI design, development approach and delivery plan |
| 7 | [07_setup_guide.md](07_setup_guide.md) | **Developer setup**: install, configure and run the whole project on a new laptop, step by step |
| 8 | [database_guide.pdf](database_guide.pdf) | Printable database reference (5 Nov snapshot; `02_database.md` is the current reference) |

**Short version.** The Phase 1 backend is feature-complete: sign-in, workspaces and team roles, brands, post creation with Smart Templates, media upload, a strict approval workflow, scheduling, and background publishing to Facebook, Instagram and LinkedIn, with an audit trail of every action. 66 automated tests cover it. The web app covers every Phase 1 screen in the owner's design (dark by default) and the full journey has been verified in the browser. AI content generation is planned for Phase 2.

To run the project locally, follow [07_setup_guide.md](07_setup_guide.md).
