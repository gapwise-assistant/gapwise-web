# Gemini 3.5+ execution verification

Gapwise's live default is `gemini-3.5-flash-lite`. This exact model identifier
was listed by Vertex AI for the configured project in location `global` and is
kept in `GEMINI_MODEL` (with the separate `GEMINI_EVAL_MODEL` setting for evals).
Cloud Build passes the same explicit value to both live Cloud Run services.

## Preflight

With Application Default Credentials configured, verify the configured project
and model list without generating content:

```bash
gcloud config get-value project
gcloud services list --enabled --filter='config.name=aiplatform.googleapis.com'
uv run --with google-genai python - <<'PY'
from google import genai

client = genai.Client(vertexai=True, project="<GCP_PROJECT_ID>", location="global")
models = {model.name.rsplit("/", 1)[-1] for model in client.models.list()}
assert "gemini-3.5-flash-lite" in models, sorted(models)
print("Vertex model available: gemini-3.5-flash-lite")
PY
```

Both the Next.js runtime preflight (`/api/runtime`) and the ADK service startup
reject a configured Gemini model older than 3.5. They do not silently fall back.
When `GAPSWISE_DEMO_MODE=true`, the preflight is intentionally skipped and all
Vertex, ADK, Firestore, Cloud Storage, Calendar, and related external calls
remain blocked.

## Demo-video proof

1. Deploy with the explicit Cloud Build substitution (or use the checked-in
   default), then open the developer trace panel and run a live Ask or context
   ingestion action. The sanitized trace shows only `Model:
   gemini-3.5-flash-lite` plus bounded run metrics such as token counts and
   latency; it never includes prompts, credentials, model output, or Context
   Pack contents.
2. For PDF/context ingestion, open the source's **Processing and storage** panel.
   Its `Analysis` value is the provider-reported model version (or the requested
   model when Vertex omits a version), alongside the existing hash and status.
3. In Google Cloud Logs Explorer, select the `gapswise-agent` and
   `gapswise-web` Cloud Run revisions to show a healthy startup/request. Confirm
   the exact model on the revision metadata with:

   ```bash
   gcloud run services describe <AGENT_SERVICE> --region=<REGION> \
     --project=<GCP_PROJECT_ID> --format='yaml(status.latestReadyRevisionName,spec.template.spec.containers[0].env)'
   ```

   The developer trace/source metadata is the execution proof; the revision
   environment is the deployment proof. ADK capture of message content remains
   disabled, so logs do not contain private prompts or reasoning.

The deterministic demos do not call Gemini and do not emit fake Gemini/ADK
traces; their fixture metadata remains unchanged.
