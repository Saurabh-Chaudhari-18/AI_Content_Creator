"""The admin API — /api/v1/admin, for the product owner's side only.

Three things hold for everything under this router:

1. `require_super_admin` guards every route. Anyone else — signed out, or
   an ordinary customer login — gets 404: for them this API does not exist.
2. Routes use `get_admin_db`, a session that runs as the `omnipost_admin`
   database role. Customer content (posts, media, brands, social accounts)
   is read-only there and passwords and tokens are unreadable, enforced by
   PostgreSQL. The super admin sees everything and acts on accounts and
   platform settings, never inside a customer's workspace.
3. Every change takes a `reason` and is written to the audit trail.

Adding a setting the admin panel can change? Follow the checklist in
docs/omnipost-docs/08_admin_panel_database.md §5.
"""
from fastapi import APIRouter, Depends

from app.api.v1.admin import audit, content, overview, plans, templates, users, workspaces
from app.core.dependencies import require_super_admin

router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(require_super_admin)])
router.include_router(overview.router)
router.include_router(workspaces.router)
router.include_router(users.router)
router.include_router(plans.router)
router.include_router(templates.router)
router.include_router(content.router)
router.include_router(audit.router)
