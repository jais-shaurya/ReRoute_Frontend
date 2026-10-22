# ReRoute 2.0 Frontend Workflows

## Run locally

The client remains static HTML, CSS, and JavaScript; there is no npm build step. Start the backend after its Alembic migration and administrator provisioning, then run:

```powershell
python -m http.server 5500
```

Open `http://localhost:5500`. `config.js` contains only the API base URL and is safe to change for a local deployment. Never place the backend signing secret in frontend files.

The backend must have `REROUTE_AUTH_SECRET` configured, an administrator provisioned through `scripts/provision_admin.py`, and a `REROUTE_CORS_ORIGINS` allowlist containing the frontend origin. The backend's development CORS defaults include both localhost forms on port 5500.

## Client behavior

- Sign-in requests a token from `POST /api/auth/token`; the client keeps the short-lived token in `sessionStorage` and resolves role and organization from `GET /api/auth/me`.
- A `401` clears the saved token and returns to sign-in. `403` and validation/conflict errors are displayed without optimistic success.
- Organization identity and role are server-returned. The client never sends identity or role headers.
- Industry profile is a per-user browser preference, not an organization-level server setting. It updates the planner's profile defaults and request.
- Entity tables use the organization-scoped business APIs. Admin/planner actions and admin-only deletion/member administration are hidden or disabled by role; the backend remains authoritative.
- Scenario creation/execution and run history/comparison use the real business APIs. Planner requests use `/api/planner/recommend`.
- Partial risk is labeled supplier-only and route evidence as unknown. Missing risk is never rendered as zero.

## Verification

```powershell
node --check app.js
node --check workspace.js
```

Browser verification used the real local database and backend with a temporary local-only token key/test administrator. Verified login/profile, live dashboard, supplier create/delete, profile weights, planner recommendation and partial-risk rendering, scenario creation/execution, history comparison/explanation, member provisioning, invalid-session handling, role-aware navigation/403 handling, and a 390px viewport without horizontal overflow. Temporary test accounts and planning records were removed after verification.

The repository has no package manifest or frontend test/build framework, so there is no separate bundler build command. Use the two syntax checks and the local browser workflow above.
