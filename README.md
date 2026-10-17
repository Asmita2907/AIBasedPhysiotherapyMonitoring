# AIBasedPhysiotherapyMonitoring

Design Thinking Project - **camera-based home physiotherapy assistant with tele-review**.

The patient exercises in front of a phone or laptop camera. MediaPipe Pose runs in the browser (the video never leaves the device), the app measures joint angles, counts reps and gives feedback straight after every rep. Each rep gets a confidence score; reps below the threshold (default 60%) are flagged and sent, as landmark + angle data only, to a physiotherapist's review queue. The physiotherapist watches a skeleton replay with an angle graph, marks the rep correct or incorrect and can leave a comment, which the patient sees in their history.

The first exercise is the **bicep curl**.

## Repository layout

| Path | What it is |
| --- | --- |
| `frontend/` | React + Vite + TypeScript web app (patient and physiotherapist screens, MediaPipe pose tracking, rep rules) |
| `frontend/src/exercise/` | Angle maths, bicep-curl rep state machine, confidence score, set summary (+ unit tests) |
| `frontend/src/data/` | Data layer: Supabase backend, or a localStorage demo backend when no keys are set |
| `backend/` | FastAPI service that assigns flagged reps to the physiotherapist with the fewest pending reviews |
| `supabase/` | Database schema (migrations), row-level security, local seed data |

## How a rep is judged

1. Elbow angle = angle at the elbow between shoulder and wrist; upper-arm swing = angle at the shoulder between hip and elbow.
2. A rep starts when the elbow angle drops below 130°, and ends once the arm has straightened again and stops moving (or the next rep starts). Movements that never bend past 110° are ignored.
3. Rules (in `frontend/src/exercise/bicepCurl.ts`, `DEFAULT_RULES`):
   - fully curled: smallest elbow angle <= 60°, else "Curl higher"
   - fully straightened: elbow angle back to >= 150°, else "Straighten your arm"
   - upper arm steady: swing <= 35°, else "Keep your elbow by your side" (skipped if the hip is not visible)
   - reps faster than 1 s get a "slow down" tip (not counted as incorrect)
4. Confidence (0-1) combines landmark visibility, how many frames were tracked and angle noise, multiplied by how far the measurements were from the thresholds - a close call gets a lower score. Below the threshold => `needs_review`.

## Running locally

Requirements: Node 20+, Python 3.10+, and (optional) the [Supabase CLI](https://supabase.com/docs/guides/cli) with Docker.

### Quick start (demo mode, no backend)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. With no Supabase keys the app runs in **demo mode**: data is kept in your browser's localStorage. Sign in as `patient@demo.local` or `physio@demo.local` (password `password123`), or create accounts.

Camera access needs `localhost` or HTTPS. No webcam? Choose **Input: Video file** on the exercise screen and pick a recording of someone doing bicep curls.

### With Supabase

Local Supabase:

```bash
supabase start          # prints the API URL and keys
supabase db reset       # applies supabase/migrations and supabase/seed.sql
```

Hosted Supabase: create a project, then run `supabase/migrations/*.sql` in the SQL editor (or `supabase link` + `supabase db push`).

Then create `frontend/.env.local` (see `frontend/.env.example`):

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
VITE_API_URL=http://localhost:8000   # optional, see below
```

New sign-ups are always patients. Make someone a physiotherapist in the SQL editor:

```sql
update public.profiles set role = 'physio' where email = 'physio@example.com';
```

The local seed already creates `patient@demo.local` and `physio@demo.local` (password `password123`).

### Review routing service (FastAPI, optional)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env    # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
set -a && source .env && set +a
uvicorn app.main:app --reload --port 8000
```

After a set is saved, the frontend calls `POST /api/reviews/route`, which checks the patient's Supabase token and assigns each flagged rep to the least-busy physiotherapist. Without the service, flagged reps stay unassigned and show up in every physiotherapist's queue.

### Tests and checks

```bash
cd frontend && npm test && npm run lint && npm run build
cd backend && pytest
```

## Data model

- `profiles` - one per auth user, `role` is `patient` or `physio`
- `exercise_sessions` - one per set: totals, average confidence, tips
- `reps` - one per rep: verdict, confidence, feedback, metrics; `frames` (landmarks + angles at ~15 fps) is stored only for flagged reps
- `reviews` - physiotherapist verdict + comment, one per flagged rep

Row-level security: patients read and insert only their own sessions and reps; physiotherapists read flagged reps and add reviews.

## Not in this version yet

- Android app via Capacitor
- Exercises other than the bicep curl
- Notifications to physiotherapists (there is a hook in `backend/app/main.py`)
- Training an ML classifier on the physiotherapist verdicts
