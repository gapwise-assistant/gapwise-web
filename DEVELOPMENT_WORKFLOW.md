# Development and Deployment Workflow

## Branches

- `feature/*`: short-lived implementation branches.
- `develop`: integration branch. Pull requests into `develop` run the full
  web checks and offline agent unit tests.
- `main`: deployment branch. Only reviewed changes should enter `main`.

There is no separate deployment branch. `main` is the deployment source of
truth; a second long-lived deployment branch would make the deployed code easy
to diverge from the reviewed code.

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `develop` and
`main`. It runs:

- `npm run lint`
- `npm test`
- `npm run build`
- `uv run pytest tests/unit` in `agent-service/`

CI uses local/mock configuration. It does not call Vertex AI, Firestore,
Cloud Storage, Calendar, or OAuth, and it does not run the Google smoke tests.

## Deployment

`cloudbuild.yaml` is the deployment pipeline for `main`. Configure a Google
Cloud Build trigger for this repository with:

- Event: push to a branch
- Branch filter: `^main$`
- Configuration: `cloudbuild.yaml`
- Project: `gapwise-505217`
- Region: global

Provide the public Firebase substitutions and OAuth client ID in the trigger's
substitution settings. Do not place OAuth client secrets or the internal API
secret in GitHub, Cloud Build substitutions, Docker build arguments, or source
files. `cloudbuild.yaml` reads those secrets from Secret Manager when deploying
Cloud Run.

The deployment pipeline:

1. Builds and pushes the web and ADK images to Artifact Registry.
2. Deploys the private `gapswise-agent` service.
3. Deploys the public `gapswise-web` service.
4. Uses the existing `gapswise-web-runtime` and `gapswise-agent-runtime`
   service identities with ADC.
5. Keeps minimum instances at `0` and maximum instances at `3`.

The existing `roles/run.invoker` binding from the web runtime identity to the
private agent must remain configured. It is an infrastructure prerequisite,
not a per-build IAM mutation.

## First-time branch setup

From a clean working tree:

```bash
git switch main
git pull --ff-only origin main
git switch -c develop
git push --set-upstream origin develop
```

Recommended GitHub branch rules:

- Require pull requests for `develop` and `main`.
- Require the `Gapswise CI` checks before merge.
- Require one approval for `main`.
- Disable direct pushes and force-pushes to `main`.
- Merge `develop` into `main` when a deployable increment is ready.

## Manual live checks

Run the real Google smoke tests only from an authenticated development machine:

```bash
npm run test:google:firestore
npm run test:google:storage
```

These are intentionally separate from CI because they use real project
resources and ADC.
