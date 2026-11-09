"""
Database Tool — isolated service for database operations.

Read-only access to PostgreSQL/Supabase. The AI can never
write or modify data directly through this tool.
"""

from app.core.config import settings
import httpx


class DatabaseTool:
    """Isolated tool for database read operations."""

    async def execute(self, action: str, args: dict) -> dict:
        handlers = {
            "read_data": self.read_data,
            "aggregate_query": self.aggregate_query,
            "get_metadata": self.get_metadata,
        }
        handler = handlers.get(action)
        if handler:
            return await handler(args)
        raise ValueError(f"Unknown database action: {action}")

    async def read_data(self, args: dict) -> dict:
        table = args.get("table", "")
        select = args.get("select", ["*"])
        filters = args.get("filters", {})
        limit = args.get("limit", 100)
        # TODO: Query Supabase via service client
        return {"rows": [], "count": 0}

    async def aggregate_query(self, args: dict) -> dict:
        table = args.get("table", "")
        metric = args.get("metric", "")
        aggregation = args.get("aggregation", "count")
        group_by = args.get("groupBy")
        # TODO: Query Supabase
        return {"rows": []}

    async def get_metadata(self, args: dict) -> dict:
        table = args.get("table", "")
        # TODO: Query information_schema
        return {"name": table, "columns": [], "rowCount": 0}
