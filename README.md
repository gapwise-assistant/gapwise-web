# Gapswise

Find the question that unlocks the next decision.

Gapswise is a persistent AI context partner for ambiguous work and life decisions. It remembers selected context, connects it across projects and priorities, detects gaps and loose ends, and ranks what deserves attention next.

## Run Locally

```bash
cd /home/martelaxe/gapwise
npm install
npm run dev
```

Open `http://localhost:3000`.

### Google sign-in

In real mode, Gapswise requires Firebase Authentication. In the Firebase
console, enable **Authentication → Sign-in method → Google**, add your local
host (for example `localhost`) under authorized domains, and create a Firebase
Web App. Copy its web configuration into the `NEXT_PUBLIC_FIREBASE_*` values
from `.env.example`.

Set the same random `GAPSWISE_INTERNAL_API_SECRET` in the Next.js `.env.local`
and `agent-service/.env`. It is used only for the trusted ADK-to-Next.js
Context Pack request and must never be a `NEXT_PUBLIC_*` variable. Calendar
OAuth remains a separate permission flow after app sign-in.

### Zero-cost local demo

Use the local file-backed provider, deterministic Ask responses, demo Calendar,
and fixture PDF extraction without contacting Google services:

```bash
GAPSWISE_DEMO_MODE=true
USE_FIRESTORE=false
```

Restart `npm run dev` after changing these values. A small `Demo mode` badge is
shown in development. Real integrations remain available when
`GAPSWISE_DEMO_MODE=false`.

During local development, requests from `localhost`, `127.0.0.1`, and `::1`
use the hardcoded `demo-user` identity and do not require Firebase login. This
local identity is disabled in production; deployed hosts still require real
Firebase authentication.

## Verify

```bash
npm run lint
npm test
npm run build
```

## Golden Demo Flow

1. Press the reset button in the header.
2. Open Today and show ranked recommendations.
3. Open Why on a recommendation to show evidence and score factors.
4. Open Context and sync selected Workspace signals.
5. Open Memory and add: `Financial stability is my top priority for the next 3 months.`
6. Return to Today and refresh to show reranking.
7. Use feedback controls such as Not now, Done, or Wrong assumption.
8. Open My World to show cross-context map.
9. Open Project Home and answer the top clarity gap.

## Cloud Run Notes

The included `Dockerfile` builds with Node 24 and runs the Next production server. Required production configuration depends on the selected storage mode.

```bash
GOOGLE_CLOUD_PROJECT=gapwise-505217
FIRESTORE_DATABASE_ID=(default)
CLOUD_STORAGE_BUCKET=gapwise-505217-context
GOOGLE_CLOUD_LOCATION=global
GOOGLE_GENAI_USE_VERTEXAI=true
GEMINI_MODEL=gemini-2.5-flash-lite
GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/integrations/google/calendar/callback
ATTENTION_RUN_SECRET=optional-internal-scheduler-secret
```

Firestore uses Firebase Admin with Google Application Default Credentials. For
local Google smoke testing, authenticate with `gcloud auth application-default login`
and run:

```bash
npm run test:google:firestore
npm run test:google:storage
```

To force local file-backed mock storage without enabling the complete demo boundary, set `USE_FIRESTORE=false`.

Google Calendar uses read-only OAuth and stores server-side tokens under the
user's Firestore integration data. The local OAuth callback must match
`GOOGLE_OAUTH_REDIRECT_URI`.

PDF uploads from Context Inbox are stored privately in Cloud Storage and analyzed
server-side once with Vertex AI Gemini. Extraction metadata and derived graph
node IDs are saved on the Context Source; later Context Pack retrieval uses the
stored source and graph data instead of re-sending the PDF.

No Gmail, Drive, or email write action runs silently. Calendar access is read-only.

### Production configuration boundary

Production does not read `.env.local`, `agent-service/.env`, service-account JSON
files, or downloaded OAuth credentials. Deploy the two services with
`cloudbuild.yaml` instead:

```bash
gcloud builds submit . \
  --project=gapwise-505217 \
  --config=cloudbuild.yaml \
  --substitutions=_NEXT_PUBLIC_FIREBASE_API_KEY='...',_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN='gapwise-505217.firebaseapp.com',_NEXT_PUBLIC_FIREBASE_PROJECT_ID='gapwise-505217',_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET='gapwise-505217.firebasestorage.app',_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID='...',_NEXT_PUBLIC_FIREBASE_APP_ID='...',_GOOGLE_OAUTH_CLIENT_ID='...'
```

The Firebase values and OAuth client ID are public browser/build configuration
and are supplied as Cloud Build substitutions. The internal API secret and
OAuth client secret are attached to Cloud Run from Secret Manager. Firestore,
Cloud Storage, and Vertex AI use the dedicated Cloud Run service identities and
Application Default Credentials. Never place secret values in substitutions or
build arguments.

Google sign-in uses Firebase's popup flow, so its provider callback remains the
Firebase-managed URI:
`https://gapwise-505217.firebaseapp.com/__/auth/handler`.
Keep `gapwise.web.app` in Firebase Authentication's Authorized domains so the
Hosting origin is allowed to use the popup.

The deployment file intentionally omits `GAPSWISE_DEFAULT_USER_ID`; staging
requests must carry the authenticated Firebase UID. The local agent example may
set it to `demo-user` only for local demo development.

The web runtime service account must already have `roles/run.invoker` on
`gapswise-agent`; the existing staging binding is preserved by deployments.
