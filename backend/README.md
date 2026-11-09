# SIVAX — Backend de l’assistant décisionnel

FastAPI + LangGraph orchestration layer for the healthcare analytics platform.

## Architecture

```
User → Next.js → FastAPI → LangGraph Agent → Structured JSON Action
                                         → Validation Layer (Policy Engine)
                                         → Business Rules
                                         → Tool Executor
                                         → Power BI SDK / Python ML / Database
```

## Graph Flow

```
User Input → Intent Detection → Planner → Tool Selection
           → Tool Execution → Result Verification → Response Generation
           → Conversation Memory
```

## Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env  # fill in your keys
uvicorn app.main:app --reload --port 8000
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for LLM |
| `OPENAI_MODEL` | Model name (default: gpt-6-luna) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `POWERBI_TENANT_ID` | Power BI tenant ID |
| `POWERBI_CLIENT_ID` | Power BI client ID |
| `POWERBI_CLIENT_SECRET` | Power BI client secret |
| `SUPABASE_JWT_SECRET` | JWT secret for auth verification |
| `FRONTEND_URL` | Frontend URL for CORS (default: localhost:3000) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/agent/chat` | Main agent chat endpoint |
| POST | `/api/tools/powerbi/embed` | Power BI embed token |
| POST | `/api/tools/ml/forecast` | ML forecasting |
| POST | `/api/tools/ml/anomaly` | ML anomaly detection |
| GET | `/api/tools/database/tables` | List database tables |

## Security

- **Policy Engine**: validates every action (schema, auth, risk)
- **Risk Tiers**: LOW (auto), MEDIUM (confirm), HIGH (explicit approval)
- **Rate Limiting**: 30 requests/minute per IP
- **Prompt Injection Detection**: blocks suspicious patterns
- **Tool Allow-List**: per-role tool access
- **Audit Logging**: every action logged to `agent_audit_log` table
- **RBAC**: role-based access control on every command

## Tools

| Tool | Capabilities |
|------|-------------|
| PowerBITool | apply filters, change page, export, refresh |
| MLTool | forecasting, anomaly detection, clustering, recommendations |
| DatabaseTool | read data, aggregated queries, metadata |
| DocumentTool | generate PDF, generate Word |
| NotificationTool | email, push notifications |
