"""
Notification Tool — isolated service for sending notifications.

Handles email and push notifications.
"""

from app.core.config import settings
import httpx


class NotificationTool:
    """Isolated tool for notification operations."""

    async def execute(self, action: str, args: dict) -> dict:
        handlers = {
            "send_email": self.send_email,
            "send_push": self.send_push,
        }
        handler = handlers.get(action)
        if handler:
            return await handler(args)
        raise ValueError(f"Unknown notification action: {action}")

    async def send_email(self, args: dict) -> dict:
        to = args.get("to", [])
        subject = args.get("subject", "")
        body = args.get("body", "")
        # TODO: Send via SMTP / SendGrid / Resend
        return {"sent": True, "messageId": ""}

    async def send_push(self, args: dict) -> dict:
        user_ids = args.get("userIds", [])
        title = args.get("title", "")
        body = args.get("body", "")
        # TODO: Send via web push / FCM
        return {"sent": len(user_ids), "failed": 0}
