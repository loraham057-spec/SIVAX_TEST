"""
Automated evaluation and self-improvement system for the DHIS2 AI agent.

Pipeline:
    1. Ground Truth Sampler  — sample real (indicator, org_unit, period, value) from Supabase
    2. Question Generator    — generate diverse NL questions (templates + LLM)
    3. Pipeline Runner        — run questions through the agent with full tracing
    4. Multi-Layer Diagnostic — identify the FIRST failing layer in the pipeline
    5. Auto-Correction        — generate targeted fixes (few-shot, planner rules, …)
    6. CLI                    — orchestrate, report, detect regressions
"""
