from app.api.app import app as fastapi_app
from app.api.deps import require_service_token

__all__ = ["fastapi_app", "require_service_token"]