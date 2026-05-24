# Evals

Reusable regression evals for Landa's prompt behavior. Run these after any prompt
change to confirm you didn't break existing behavior before shipping.

## Code category (`code_category.json` + `run_code_eval.py`)

Gate for the adaptive per-app-style `code` category (Cursor / VS Code / Codex). The
corpus is realistic raw transcriptions of code-editor dictation; each case asserts:

- **`expect`** — tokens that MUST appear (jargon reconstructed: `getUserInfo`, `async`,
  `CORS`, `CLAUDE.md`, `/review`, `Claude Opus`, …).
- **`forbid`** — mis-heard forms that must NOT survive (`a sync`, `gun fig`, `cloud
  bonnet`, `jason`), and the over-correction control (`CTRL1` forbids `Claude` so
  cloud-infra talk isn't hijacked).
- **length guard** — output that balloons past 2.5× the input fails, catching the
  regression where the model *answers* a prompt instead of cleaning it for paste.

### Run

From the repo root, with the proxy creds loaded (makes one live proxy call per case):

```sh
set -a && . ./.env && set +a
./backend/venv/bin/python evals/run_code_eval.py
```

Exits 0 if all pass, 1 on any failure. Needs `LANDA_PROXY_URL` + `LANDA_APP_SECRET`.

### Adding cases

Append to `code_category.json`. Keep `expect`/`forbid` about *behavior and tokens*,
not exact wording — the LLM rephrases run to run, so brittle full-string matches will
flake. Dated human-readable snapshots live in `tasks/code-eval-YYYY-MM-DD.md`.
