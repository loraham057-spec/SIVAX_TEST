"""
Document Tool — isolated service for document generation.

Generates PDF and Word reports from structured content.
"""

from app.core.config import settings


class DocumentTool:
    """Isolated tool for document generation."""

    async def execute(self, action: str, args: dict) -> dict:
        handlers = {
            "generate_pdf": self.generate_pdf,
            "generate_word": self.generate_word,
        }
        handler = handlers.get(action)
        if handler:
            return await handler(args)
        raise ValueError(f"Unknown document action: {action}")

    async def generate_pdf(self, args: dict) -> dict:
        title = args.get("title", "Untitled")
        sections = args.get("sections", [])
        # TODO: Generate PDF using reportlab/weasyprint
        return {"downloadUrl": "", "format": "pdf", "generatedAt": ""}

    async def generate_word(self, args: dict) -> dict:
        title = args.get("title", "Untitled")
        sections = args.get("sections", [])
        # TODO: Generate Word doc using python-docx
        return {"downloadUrl": "", "format": "word", "generatedAt": ""}
