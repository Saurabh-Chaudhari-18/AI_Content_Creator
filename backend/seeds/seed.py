"""Seed script: demo user/workspace/brand + Smart Templates.

Run AFTER migrations:  python -m seeds.seed
Idempotent — safe to run repeatedly.
"""
import asyncio
import json
import os

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import get_async_session_factory
from app.models import (
    Brand, CaptionTemplate, TemplateCategory, User, Workspace,
    WorkspaceMember, WorkspaceRole,
)

SEED_DIR = os.path.dirname(os.path.abspath(__file__))

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "DemoPassword123!"


async def seed() -> None:
    async with get_async_session_factory()() as db:
        # Demo user
        user = await db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if not user:
            user = User(email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD),
                        full_name="Demo User", is_active=True)
            db.add(user)
            await db.flush()
            print(f"  + demo user {DEMO_EMAIL} (password: {DEMO_PASSWORD})")

        # Demo workspace
        workspace = await db.scalar(select(Workspace).where(Workspace.slug == "demo-agency"))
        if not workspace:
            workspace = Workspace(name="Demo Agency", slug="demo-agency", owner_id=user.id)
            db.add(workspace)
            await db.flush()
            db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id,
                                   role=WorkspaceRole.OWNER))
            print("  + workspace 'Demo Agency'")

        # Demo brand
        brand = await db.scalar(select(Brand).where(Brand.workspace_id == workspace.id))
        if not brand:
            db.add(Brand(
                workspace_id=workspace.id, name="Aura Coffee", industry="restaurant",
                target_audience="Urban professionals 25-40 who care about specialty coffee",
                tone_of_voice="warm, confident, a little playful", language="en",
                brand_guidelines={"colors": ["#6F4E37", "#F5F0EA"], "banned_terms": ["cheap"]},
            ))
            print("  + brand 'Aura Coffee'")

        # Smart Templates
        existing = await db.scalar(select(CaptionTemplate).limit(1))
        if not existing:
            with open(os.path.join(SEED_DIR, "caption_templates.json"), encoding="utf-8") as f:
                data = json.load(f)
            for t in data["templates"]:
                db.add(CaptionTemplate(
                    industry=t["industry"],
                    category=TemplateCategory(t["category"]),
                    title=t["title"],
                    template_text=t["template_text"],
                    suggested_hashtags=t.get("suggested_hashtags", []),
                    suggested_cta=t.get("suggested_cta"),
                    is_active=True,
                ))
            print(f"  + {len(data['templates'])} caption templates")

        await db.commit()
    print("Seeding complete.")


if __name__ == "__main__":
    asyncio.run(seed())
