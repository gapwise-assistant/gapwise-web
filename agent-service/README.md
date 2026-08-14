# agent-service

Simple ReAct agent
Agent generated with `agents-cli` version `1.3.1`

## Project Structure

```
agent-service/
├── app/         # Core agent code
│   ├── agent.py               # Main agent logic
│   ├── fast_api_app.py        # FastAPI Backend server
│   └── app_utils/             # App utilities and helpers
├── tests/                     # Unit, integration, and load tests
├── AGENTS.md                  # AI-assisted development guide
└── pyproject.toml             # Project dependencies
```

> 💡 **Tip:** Project context is pre-configured in `AGENTS.md`.

## Requirements

Before you begin, ensure you have:
- **uv**: Python package manager (used for all dependency management in this project) - [Install](https://docs.astral.sh/uv/getting-started/installation/) ([add packages](https://docs.astral.sh/uv/concepts/dependencies/) with `uv add <package>`)
- **agents-cli**: Agents CLI - Install with `uv tool install google-agents-cli`
- **Google Cloud SDK**: For GCP services - [Install](https://cloud.google.com/sdk/docs/install)

Local development is configured to use existing Google Cloud ADC credentials with
`GOOGLE_CLOUD_PROJECT=gapwise-505217` and Vertex AI in `global`. Live agent runs,
integration tests, and evals require billing to be enabled for that project.

The agent model is configured through `GEMINI_MODEL`. Gapswise uses
`gemini-2.5-flash-lite` as its low-cost default for normal ADK traffic. Set a
different supported Vertex model explicitly when higher model capability is worth
the additional cost. Local LLM-as-judge evaluations use `GEMINI_EVAL_MODEL`, which
also defaults to Flash-Lite so an explicit eval run cannot silently select a more
expensive model.

Google lists October 20, 2026 as the retirement date for this model. Re-evaluate
the low-cost default before that date rather than relying on an automatic alias.


## Quick Start

Install `agents-cli` and its skills if not already installed:

```bash
uvx google-agents-cli setup
```

Install required packages:

```bash
agents-cli install
```

Test the agent with a local web server:

```bash
agents-cli playground
```

You can also use features from the [ADK](https://adk.dev/) CLI with `uv run adk`.

## Commands

| Command              | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `agents-cli install` | Install dependencies using uv                                                         |
| `agents-cli playground` | Launch local development environment                                                  |
| `agents-cli lint`    | Run code quality checks                                                               |
| `agents-cli eval`    | Evaluate agent behavior (generate, grade, analyze, and more — see `agents-cli eval --help`) |
| `uv run pytest tests/unit tests/integration` | Run unit and integration tests                                                        || [A2A Inspector](https://github.com/a2aproject/a2a-inspector) | Launch A2A Protocol Inspector                                                        |

## 🛠️ Project Management

| Command | What It Does |
|---------|--------------|
| `agents-cli scaffold enhance` | Add CI/CD pipelines and Terraform infrastructure |
| `agents-cli infra cicd` | One-command setup of entire CI/CD pipeline + infrastructure |
| `agents-cli scaffold upgrade` | Auto-upgrade to latest version while preserving customizations |

---

## Development

Edit your agent logic in `app/agent.py` and test with `agents-cli playground` - it auto-reloads on save.

### Gapswise Health Agent

This prototype replaces the sample scaffold behavior with one root ADK agent named
`gapswise_agent`. The agent exposes a deterministic `health_check()` tool that returns:

```json
{"product": "Gapswise", "status": "ok"}
```

The generated eval dataset includes a `Check Gapswise health` case for this behavior.

### Gapswise Context Pack Tool

The root agent also exposes `get_context_pack(user_id, query)`, which delegates to
the existing Next.js endpoint at `${GAPSWISE_APP_URL}/api/internal/context-pack`.
Local development uses:

```text
GAPSWISE_APP_URL=http://localhost:3000
GAPSWISE_INTERNAL_API_SECRET=the-same-secret-as-the-next-js-app
GAPSWISE_DEFAULT_USER_ID=demo-user
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_EVAL_MODEL=gemini-2.5-flash-lite
```

Python does not recreate or duplicate Context Pack retrieval logic.
The ADK dev UI may pass placeholder user IDs such as `default`; the tool maps
those to `GAPSWISE_DEFAULT_USER_ID` so local testing reads the same Gapswise
demo user as the Next.js app.

## Deployment

```bash
gcloud config set project <your-project-id>
agents-cli deploy
```

To add CI/CD and Terraform, run `agents-cli scaffold enhance`.
To set up your production infrastructure, run `agents-cli infra cicd`.

## Observability

Built-in telemetry exports to Cloud Trace, BigQuery, and Cloud Logging.

## A2A Inspector

This agent supports the [A2A Protocol](https://a2a-protocol.org/). Use the [A2A Inspector](https://github.com/a2aproject/a2a-inspector) to test interoperability.
See the [A2A Inspector docs](https://github.com/a2aproject/a2a-inspector) for details.
