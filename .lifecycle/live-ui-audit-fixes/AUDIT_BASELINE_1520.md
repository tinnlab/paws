# Live UI Audit — findings

Target: `http://127.0.0.1:1520` · driven as `admin` · 2026-07-26T18:44:20.176Z

Evidence-based, objective signals only. Deduped across viewports×themes (each row lists the cells it appeared in). No subjective UX commentary.

## Totals

| Severity | Count (deduped) |
|---|---|
| 🔴 HIGH | 7 |
| 🟡 MEDIUM | 238 |
| ⚪ LOW | 63 |
| **Total** | **308** (776 raw) |

## By category

| Category | Count |
|---|---|
| `network/failure` | 97 |
| `network/duplicate` | 79 |
| `network/waterfall` | 40 |
| `network/irrelevant` | 27 |
| `network/n+1` | 26 |
| `network/excess` | 16 |
| `clipped-control` | 7 |
| `console-error` | 4 |
| `stuck-loading` | 4 |
| `spacing-grid` | 4 |
| `overflow-x` | 2 |
| `page-error` | 1 |
| `palette-drift` | 1 |

## Findings (most-severe first)

### 🔴 HIGH · `console-error` — home / (console)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `home` → step `(console)` at mobile/light

### 🔴 HIGH · `console-error` — compose-send / (console)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(console)` at mobile/light

### 🔴 HIGH · `console-error` — adversarial-compose / (console)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(console)` at mobile/light

### 🔴 HIGH · `console-error` — browse-settings / (console)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(console)` at mobile/light

### 🔴 HIGH · `overflow-x` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** body scrollWidth 419 > viewport 390 — horizontal scroll
- **Element:** `body`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/compose-send__sent__mobile__light.png`
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🔴 HIGH · `overflow-x` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** body scrollWidth 419 > viewport 390 — horizontal scroll
- **Element:** `body`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/adversarial-compose__rapid-double-submit__mobile__light.png`
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🔴 HIGH · `page-error` — adversarial-compose / (pageerror)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** Message cannot be empty
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(pageerror)` at mobile/light

### 🟡 MEDIUM · `clipped-control` — home / home
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** interactive control clipped by viewport edge (rect left=379 right=403, viewport width 390)
- **Element:** `button#base-ui-_r_5q_`
- **Cells:** mobile/light
- **Screenshot:** `screenshots/home__home__mobile__light.png`
- **Repro:** login admin → flow `home` → step `home` at mobile/light

### 🟡 MEDIUM · `clipped-control` — home / home
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** interactive control clipped by viewport edge (rect left=379 right=403, viewport width 390)
- **Element:** `button#base-ui-_r_q_`
- **Cells:** mobile/dark
- **Screenshot:** `screenshots/home__home__mobile__dark.png`
- **Repro:** login admin → flow `home` → step `home` at mobile/dark

### 🟡 MEDIUM · `clipped-control` — compose-send / compose
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** interactive control clipped by viewport edge (rect left=379 right=403, viewport width 390)
- **Element:** `button#base-ui-_r_q_`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/compose-send__compose__mobile__light.png`
- **Repro:** login admin → flow `compose-send` → step `compose` at mobile/light

### 🟡 MEDIUM · `clipped-control` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** interactive control clipped by viewport edge (rect left=-29 right=32, viewport width 390)
- **Element:** `div#root>div>div>a`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/compose-send__sent__mobile__light.png`
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `clipped-control` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** interactive control clipped by viewport edge (rect left=379 right=403, viewport width 390)
- **Element:** `button#base-ui-_r_q_`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/adversarial-compose__empty-submit__mobile__light.png`
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at mobile/light

### 🟡 MEDIUM · `clipped-control` — adversarial-compose / huge-input
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** interactive control clipped by viewport edge (rect left=379 right=403, viewport width 390)
- **Element:** `button#base-ui-_r_q_`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/adversarial-compose__huge-input__mobile__light.png`
- **Repro:** login admin → flow `adversarial-compose` → step `huge-input` at mobile/light

### 🟡 MEDIUM · `clipped-control` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** interactive control clipped by viewport edge (rect left=-29 right=32, viewport width 390)
- **Element:** `div#root>div>div>a`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/adversarial-compose__rapid-double-submit__mobile__light.png`
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (148ms)
- **Cells:** mobile/light, mobile/dark, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (196ms)
- **Cells:** mobile/light, desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (56ms)
- **Cells:** mobile/light, mobile/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/duplicate` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/llm-models fired 3× within step "(load)" (200,200,200)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/n+1` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** N+1 pattern: 20 distinct requests to template GET /api/projects/by-conversation/{id} in one step (7e27c0b7-4c97-47d9-8fa8-e8e5099b2ba9, 58d25023-e00e-4438-98e1-e5658aab5771, 24d40dbd-9970-41d5-95db-b33ded93da13…)
- **Cells:** mobile/light
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/waterfall` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 10 sequential dependent /api requests (160ms serial) that could be parallelized — /api/mcp/defaults → /api/voice/capability → /api/mcp/servers → /api/knowledge-bases
- **Cells:** mobile/light
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (84ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/waterfall` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (1039ms serial) that could be parallelized — /api/mcp/defaults → /api/memory/admin-settings → /api/llm-models → /api/llm-models
- **Cells:** mobile/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (97ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `home` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (89ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `home` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (84ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `home` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (58ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `home` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/n+1` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** N+1 pattern: 37 distinct requests to template GET /api/projects/by-conversation/{id} in one step (029d732c-0ac1-43db-8ced-fd3304bad45f, 58d25023-e00e-4438-98e1-e5658aab5771, 696df0a5-9dc8-4f08-8736-a87cfce10fdc…)
- **Cells:** tablet/light
- **Repro:** login admin → flow `home` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/waterfall` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 10 sequential dependent /api requests (38ms serial) that could be parallelized — /api/mcp/defaults → /api/knowledge-bases → /api/assistants → /api/mcp/servers
- **Cells:** tablet/light
- **Repro:** login admin → flow `home` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — home / home
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `home` → step `home` at tablet/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (73ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `home` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (57ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `home` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/n+1` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** N+1 pattern: 37 distinct requests to template GET /api/projects/by-conversation/{id} in one step (24d40dbd-9970-41d5-95db-b33ded93da13, 79c74a36-0c7c-4d51-b69a-85c04783fa1f, 696df0a5-9dc8-4f08-8736-a87cfce10fdc…)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `home` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/waterfall` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (1048ms serial) that could be parallelized — /api/mcp/defaults → /api/knowledge-bases → /api/llm-models → /api/assistants
- **Cells:** tablet/dark
- **Repro:** login admin → flow `home` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (90ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/n+1` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** N+1 pattern: 37 distinct requests to template GET /api/projects/by-conversation/{id} in one step (029d732c-0ac1-43db-8ced-fd3304bad45f, 58d25023-e00e-4438-98e1-e5658aab5771, 7e27c0b7-4c97-47d9-8fa8-e8e5099b2ba9…)
- **Cells:** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure` — home / home
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells:** desktop/light, desktop/dark
- **Repro:** login admin → flow `home` → step `home` at desktop/light

### 🟡 MEDIUM · `network/failure` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (66ms)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/n+1` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** N+1 pattern: 37 distinct requests to template GET /api/projects/by-conversation/{id} in one step (24d40dbd-9970-41d5-95db-b33ded93da13, 79c74a36-0c7c-4d51-b69a-85c04783fa1f, 7e27c0b7-4c97-47d9-8fa8-e8e5099b2ba9…)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/waterfall` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 11 sequential dependent /api requests (1040ms serial) that could be parallelized — /api/mcp/servers → /api/memory/admin-settings/rebuild-status → /api/memory/admin/fts/rebuild/status → /api/llm-models
- **Cells:** desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (117ms)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (78ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** mobile/light, mobile/dark, tablet/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (60ms)
- **Cells:** mobile/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/duplicate` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/llm-models fired 3× within step "(load)" (200,200,200)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/waterfall` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (24ms serial) that could be parallelized — /api/memory/admin-settings → /api/knowledge-bases → /api/llm-models → /api/memory/admin-settings/rebuild-status
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (61ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (52ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (58ms)
- **Cells:** mobile/light, mobile/dark, tablet/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (55ms)
- **Cells:** mobile/light, tablet/dark, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/fbf1cab5-e97e-448b-9de2-37d8a78016ca/summary fired 3× within step "sent" (200,200,200)
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `network/waterfall` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 16 sequential dependent /api requests (5098ms serial) that could be parallelized — /api/conversations/fbf1cab5-e97e-448b-9de2-37d8a78016ca/summarization-mode → /api/projects/by-conversation/fbf1cab5-e97e-448b-9de2-37d8a78016ca → /api/conversations/fbf1cab5-e97e-448b-9de2-37d8a78016ca/summary → /api/conversations/fbf1cab5-e97e-448b-9de2-37d8a78016ca/summarization-mode
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `network/irrelevant` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/branches/67e9618c-1706-40d4-a068-5a9853aa2380/pending-approvals. Flow "compose-send" (step "sent") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `network/irrelevant` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/background/runs. Flow "compose-send" (step "sent") has no use for the `background` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `network/excess` — compose-send / (cell)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** excess/polling: GET /api/sync/subscribe fired 4× across the flow (possible timer/render-storm) — steps: (load), sent
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(cell)` at mobile/light

### 🟡 MEDIUM · `network/excess` — compose-send / (cell)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** excess/polling: GET /api/chat/stream fired 4× across the flow (possible timer/render-storm) — steps: (load), sent
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(cell)` at mobile/light

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (68ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (58ms)
- **Cells:** mobile/dark, tablet/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/waterfall` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (1053ms serial) that could be parallelized — /api/mcp/defaults → /api/memory/admin-settings → /api/llm-models → /api/llm-models
- **Cells:** mobile/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** mobile/dark, tablet/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (56ms)
- **Cells:** mobile/dark, tablet/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (58ms)
- **Cells:** mobile/dark, desktop/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### 🟡 MEDIUM · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/dab48c41-9ca5-484b-9ea8-d9921badacca/summary fired 3× within step "sent" (200,200,200)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### 🟡 MEDIUM · `network/waterfall` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 19 sequential dependent /api requests (5091ms serial) that could be parallelized — /api/conversations → /api/conversations/dab48c41-9ca5-484b-9ea8-d9921badacca/summarization-mode → /api/conversations/dab48c41-9ca5-484b-9ea8-d9921badacca/summary → /api/conversations/dab48c41-9ca5-484b-9ea8-d9921badacca/memory-mode
- **Cells:** mobile/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### 🟡 MEDIUM · `network/irrelevant` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/branches/84c7f91f-1543-49a1-8a1d-226528733fb5/pending-approvals. Flow "compose-send" (step "sent") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (76ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/n+1` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** N+1 pattern: 39 distinct requests to template GET /api/projects/by-conversation/{id} in one step (dab48c41-9ca5-484b-9ea8-d9921badacca, fbf1cab5-e97e-448b-9de2-37d8a78016ca, 24d40dbd-9970-41d5-95db-b33ded93da13…)
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/waterfall` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (1054ms serial) that could be parallelized — /api/mcp/defaults → /api/assistants → /api/knowledge-bases → /api/mcp/servers
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (55ms)
- **Cells:** tablet/light, tablet/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/light

### 🟡 MEDIUM · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/6dd9ad7f-2502-4496-bf86-c18f9339cfd7/summary fired 3× within step "sent" (200,200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/light

### 🟡 MEDIUM · `network/waterfall` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (5029ms serial) that could be parallelized — /api/projects/by-conversation/6dd9ad7f-2502-4496-bf86-c18f9339cfd7 → /api/conversations/6dd9ad7f-2502-4496-bf86-c18f9339cfd7/memory-mode → /api/conversations/6dd9ad7f-2502-4496-bf86-c18f9339cfd7/summarization-mode → /api/conversations/6dd9ad7f-2502-4496-bf86-c18f9339cfd7/summary
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/light

### 🟡 MEDIUM · `network/irrelevant` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/branches/a7258d3e-8fc3-479a-8dd9-a97728a3dccd/pending-approvals. Flow "compose-send" (step "sent") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/light

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (168ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (55ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/n+1` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** N+1 pattern: 40 distinct requests to template GET /api/projects/by-conversation/{id} in one step (6dd9ad7f-2502-4496-bf86-c18f9339cfd7, fbf1cab5-e97e-448b-9de2-37d8a78016ca, 7e27c0b7-4c97-47d9-8fa8-e8e5099b2ba9…)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/waterfall` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 11 sequential dependent /api requests (622ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/server-update/status
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (57ms)
- **Cells:** tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/dark

### 🟡 MEDIUM · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/a74b3270-a634-4379-b38a-ba49b2460666/summary fired 3× within step "sent" (200,200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/dark

### 🟡 MEDIUM · `network/waterfall` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (5136ms serial) that could be parallelized — /api/projects/by-conversation/a74b3270-a634-4379-b38a-ba49b2460666 → /api/conversations/a74b3270-a634-4379-b38a-ba49b2460666/summary → /api/conversations/a74b3270-a634-4379-b38a-ba49b2460666/summarization-mode → /api/conversations/a74b3270-a634-4379-b38a-ba49b2460666/memory-mode
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/dark

### 🟡 MEDIUM · `network/irrelevant` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/branches/f281a720-c81d-4356-9e5e-0adb36bb7705/pending-approvals. Flow "compose-send" (step "sent") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/dark

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (69ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (55ms)
- **Cells:** desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (57ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/duplicate` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations fired 3× within step "(load)" (200,200,200)
- **Cells:** desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/n+1` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** N+1 pattern: 41 distinct requests to template GET /api/projects/by-conversation/{id} in one step (24d40dbd-9970-41d5-95db-b33ded93da13, dab48c41-9ca5-484b-9ea8-d9921badacca, 6dd9ad7f-2502-4496-bf86-c18f9339cfd7…)
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (1054ms serial) that could be parallelized — /api/mcp/defaults → /api/knowledge-bases → /api/mcp/servers → /api/llm-models
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (54ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/light

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells:** desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/light

### 🟡 MEDIUM · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/46850e36-47cf-4ed8-924e-7893948c790e/summary fired 3× within step "sent" (200,200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/light

### 🟡 MEDIUM · `network/waterfall` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 13 sequential dependent /api requests (4406ms serial) that could be parallelized — /api/conversations/46850e36-47cf-4ed8-924e-7893948c790e/summarization-mode → /api/conversations/46850e36-47cf-4ed8-924e-7893948c790e/memory-mode → /api/conversations/46850e36-47cf-4ed8-924e-7893948c790e/summary → /api/projects/by-conversation/46850e36-47cf-4ed8-924e-7893948c790e
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/light

### 🟡 MEDIUM · `network/irrelevant` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/branches/269af275-5d65-4185-8a6d-d86313b06761/pending-approvals. Flow "compose-send" (step "sent") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/light

### 🟡 MEDIUM · `network/failure` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (91ms)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/n+1` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** N+1 pattern: 42 distinct requests to template GET /api/projects/by-conversation/{id} in one step (fbf1cab5-e97e-448b-9de2-37d8a78016ca, 46850e36-47cf-4ed8-924e-7893948c790e, a74b3270-a634-4379-b38a-ba49b2460666…)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/waterfall` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (1063ms serial) that could be parallelized — /api/mcp/defaults → /api/mcp/servers → /api/assistants → /api/knowledge-bases
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/failure` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (71ms)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/dark

### 🟡 MEDIUM · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/9dcca802-2cf6-40a5-922a-e3b0e3e39c18/summary fired 3× within step "sent" (200,200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/dark

### 🟡 MEDIUM · `network/waterfall` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (4617ms serial) that could be parallelized — /api/projects/by-conversation/9dcca802-2cf6-40a5-922a-e3b0e3e39c18 → /api/sync/subscribe → /api/conversations/9dcca802-2cf6-40a5-922a-e3b0e3e39c18/memory-mode → /api/conversations/9dcca802-2cf6-40a5-922a-e3b0e3e39c18/summary
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/dark

### 🟡 MEDIUM · `network/irrelevant` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/branches/1b15af20-e841-42fe-8f84-aa808d862172/pending-approvals. Flow "compose-send" (step "sent") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (152ms)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (75ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (49ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (57ms)
- **Cells:** mobile/light, mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/duplicate` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/llm-models fired 3× within step "(load)" (200,200,200)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 15 sequential dependent /api requests (1054ms serial) that could be parallelized — /api/mcp/defaults → /api/voice/capability → /api/memory/admin-settings → /api/llm-models
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (74ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at mobile/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / huge-input
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (57ms)
- **Cells:** mobile/light, tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `huge-input` at mobile/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (58ms)
- **Cells:** mobile/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/5f7bdd00-6e90-4385-88ec-5967ee505404/summary fired 4× within step "rapid-double-submit" (200,200,200,200)
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 20 sequential dependent /api requests (2300ms serial) that could be parallelized — /api/conversations/5f7bdd00-6e90-4385-88ec-5967ee505404/summarization-mode → /api/projects/by-conversation/5f7bdd00-6e90-4385-88ec-5967ee505404 → /api/conversations/5f7bdd00-6e90-4385-88ec-5967ee505404/summarization-mode → /api/conversations/5f7bdd00-6e90-4385-88ec-5967ee505404/summary
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/0b8cd583-f30f-46d1-b1f0-c6e7fe4480a7/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/c981e78b-db1b-48db-9312-7934d023b409/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/background/runs. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `background` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/sync/subscribe fired 4× across the flow (possible timer/render-storm) — steps: (load), empty-submit, rapid-double-submit
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at mobile/light

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/chat/stream fired 4× across the flow (possible timer/render-storm) — steps: (load), huge-input, rapid-double-submit
- **Cells:** mobile/light, mobile/dark, tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at mobile/light

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/conversations/5f7bdd00-6e90-4385-88ec-5967ee505404/summary fired 4× across the flow (possible timer/render-storm) — steps: rapid-double-submit
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at mobile/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (81ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (55ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 8 sequential dependent /api requests (30ms serial) that could be parallelized — /api/mcp/defaults → /api/assistants → /api/llm-models → /api/llm-models
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (65ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at mobile/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / huge-input
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (58ms)
- **Cells:** mobile/dark, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `huge-input` at mobile/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells:** mobile/dark, tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (57ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### 🟡 MEDIUM · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/b058e00e-c6a6-439d-9038-7d7b3d39ad8f/summary fired 4× within step "rapid-double-submit" (200,200,200,200)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 16 sequential dependent /api requests (134ms serial) that could be parallelized — /api/conversations/b058e00e-c6a6-439d-9038-7d7b3d39ad8f/summary → /api/projects/by-conversation/b058e00e-c6a6-439d-9038-7d7b3d39ad8f → /api/conversations/b058e00e-c6a6-439d-9038-7d7b3d39ad8f/memory-mode → /api/conversations/b058e00e-c6a6-439d-9038-7d7b3d39ad8f/summarization-mode
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/a002c954-5000-4f18-bbb0-8434281141dd/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/e07a81a8-0262-4570-9332-61d9ac372571/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/conversations/b058e00e-c6a6-439d-9038-7d7b3d39ad8f/summary fired 4× across the flow (possible timer/render-storm) — steps: rapid-double-submit
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (130ms)
- **Cells:** tablet/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** tablet/light, desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (56ms)
- **Cells:** tablet/light, tablet/dark, desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/duplicate` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations fired 3× within step "(load)" (200,200,200)
- **Cells:** tablet/light, tablet/dark, desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/n+1` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** N+1 pattern: 47 distinct requests to template GET /api/projects/by-conversation/{id} in one step (b058e00e-c6a6-439d-9038-7d7b3d39ad8f, ccb4d76f-443a-4e6c-8012-4fa0357a6315, 6e7ab1b6-8c38-4527-ac78-e29977183803…)
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 15 sequential dependent /api requests (1058ms serial) that could be parallelized — /api/mcp/defaults → /api/mcp/servers → /api/knowledge-bases → /api/user-llm-providers
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (58ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at tablet/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (55ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at tablet/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (55ms)
- **Cells:** tablet/light, tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### 🟡 MEDIUM · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/2349303b-f1a5-44be-a5f9-dad37713b5ea/summary fired 4× within step "rapid-double-submit" (200,200,200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 12 sequential dependent /api requests (171ms serial) that could be parallelized — /api/conversations/2349303b-f1a5-44be-a5f9-dad37713b5ea/summary → /api/projects/by-conversation/2349303b-f1a5-44be-a5f9-dad37713b5ea → /api/conversations/2349303b-f1a5-44be-a5f9-dad37713b5ea/memory-mode → /api/conversations/2349303b-f1a5-44be-a5f9-dad37713b5ea/summary
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/10dc9e46-2822-41b4-8f37-14c65345fcd8/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/952fda16-320a-44a0-9ddc-21d1794b67b0/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/chat/stream fired 4× across the flow (possible timer/render-storm) — steps: (load), empty-submit, rapid-double-submit
- **Cells:** tablet/light, desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at tablet/light

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/conversations/2349303b-f1a5-44be-a5f9-dad37713b5ea/summary fired 4× across the flow (possible timer/render-storm) — steps: rapid-double-submit
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at tablet/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (70ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (82ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/n+1` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** N+1 pattern: 49 distinct requests to template GET /api/projects/by-conversation/{id} in one step (2349303b-f1a5-44be-a5f9-dad37713b5ea, 0931779f-ddde-4883-af28-6867ca88c63f, 5f7bdd00-6e90-4385-88ec-5967ee505404…)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 13 sequential dependent /api requests (176ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/conversations
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** tablet/dark, desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at tablet/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (58ms)
- **Cells:** tablet/dark, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### 🟡 MEDIUM · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/5e0c6b23-c040-4cc1-8061-0c138c2dd625/summary fired 4× within step "rapid-double-submit" (200,200,200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 16 sequential dependent /api requests (239ms serial) that could be parallelized — /api/conversations/5e0c6b23-c040-4cc1-8061-0c138c2dd625/summarization-mode → /api/projects/by-conversation/5e0c6b23-c040-4cc1-8061-0c138c2dd625 → /api/conversations/5e0c6b23-c040-4cc1-8061-0c138c2dd625/memory-mode → /api/conversations/5e0c6b23-c040-4cc1-8061-0c138c2dd625/summarization-mode
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/fe86c2bb-0ce4-4ec3-8f03-8bf73536ca8d/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/aaceb381-699e-4721-a360-c88256ec8ac5/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/conversations/5e0c6b23-c040-4cc1-8061-0c138c2dd625/summary fired 4× across the flow (possible timer/render-storm) — steps: rapid-double-submit
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (94ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/n+1` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** N+1 pattern: 51 distinct requests to template GET /api/projects/by-conversation/{id} in one step (ccb4d76f-443a-4e6c-8012-4fa0357a6315, 0931779f-ddde-4883-af28-6867ca88c63f, b058e00e-c6a6-439d-9038-7d7b3d39ad8f…)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 10 sequential dependent /api requests (43ms serial) that could be parallelized — /api/mcp/defaults → /api/knowledge-bases → /api/mcp/servers → /api/assistants
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (56ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at desktop/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (55ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### 🟡 MEDIUM · `network/failure` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (56ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### 🟡 MEDIUM · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/b7cf6238-7c6e-4de9-91a7-9de345829655/summary fired 4× within step "rapid-double-submit" (200,200,200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 13 sequential dependent /api requests (182ms serial) that could be parallelized — /api/projects/by-conversation/b7cf6238-7c6e-4de9-91a7-9de345829655 → /api/conversations/b7cf6238-7c6e-4de9-91a7-9de345829655/memory-mode → /api/conversations/b7cf6238-7c6e-4de9-91a7-9de345829655/summary → /api/conversations/b7cf6238-7c6e-4de9-91a7-9de345829655/summarization-mode
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/d3e4a8aa-6a6a-48be-873f-ec31758e7dce/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/b3f457a0-06aa-465d-9dba-9fa8282a0e93/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/conversations/b7cf6238-7c6e-4de9-91a7-9de345829655/summary fired 4× across the flow (possible timer/render-storm) — steps: rapid-double-submit
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at desktop/light

### 🟡 MEDIUM · `network/n+1` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** N+1 pattern: 30 distinct requests to template GET /api/projects/by-conversation/{id} in one step (a34b4ba5-0180-47de-9944-e007bbbdcd5e, 5e0c6b23-c040-4cc1-8061-0c138c2dd625, b7cf6238-7c6e-4de9-91a7-9de345829655…)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/chat/stream → 429 (138ms)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at desktop/dark

### 🟡 MEDIUM · `network/n+1` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** N+1 pattern: 23 distinct requests to template GET /api/projects/by-conversation/{id} in one step (62cd0ac0-a2fc-4bcd-abe0-0d5f755501e8, 622cae0e-d322-489a-9f38-e2f674841450, ac72a0e9-be6f-4d91-9741-c85e4d71c2fc…)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at desktop/dark

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / empty-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 4 sequential dependent /api requests (96ms serial) that could be parallelized — /api/projects/by-conversation/10000000-0000-0000-0000-0000000000c1 → /api/projects/by-conversation/10000000-0000-0000-0000-0000000000c4 → /api/projects/by-conversation/11111111-1111-1111-1111-111111111111 → /api/projects/by-conversation/10000000-0000-0000-0000-0000000000c3
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `empty-submit` at desktop/dark

### 🟡 MEDIUM · `network/failure` — adversarial-compose / huge-input
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (54ms)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `huge-input` at desktop/dark

### 🟡 MEDIUM · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/7622fc74-64d3-4128-99e8-f70df1e81bdd/summary fired 4× within step "rapid-double-submit" (200,200,200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/dark

### 🟡 MEDIUM · `network/waterfall` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** waterfall: 14 sequential dependent /api requests (214ms serial) that could be parallelized — /api/conversations/7622fc74-64d3-4128-99e8-f70df1e81bdd/summarization-mode → /api/projects/by-conversation/7622fc74-64d3-4128-99e8-f70df1e81bdd → /api/conversations/7622fc74-64d3-4128-99e8-f70df1e81bdd/memory-mode → /api/conversations/7622fc74-64d3-4128-99e8-f70df1e81bdd/summary
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/dark

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/79209a25-e4ef-4856-a718-6bed3a790fa3/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/dark

### 🟡 MEDIUM · `network/irrelevant` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** irrelevant fetch for this page: GET /api/branches/d597dfbf-4a18-4d2f-b26f-b4facb6d3c01/pending-approvals. Flow "adversarial-compose" (step "rapid-double-submit") has no use for the `branches` domain; likely eager over-fetch of unrelated data.
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/dark

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/sync/subscribe fired 4× across the flow (possible timer/render-storm) — steps: (load), huge-input, rapid-double-submit
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at desktop/dark

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/chat/stream fired 4× across the flow (possible timer/render-storm) — steps: (load), empty-submit, huge-input, rapid-double-submit
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at desktop/dark

### 🟡 MEDIUM · `network/excess` — adversarial-compose / (cell)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** excess/polling: GET /api/conversations/7622fc74-64d3-4128-99e8-f70df1e81bdd/summary fired 4× across the flow (possible timer/render-storm) — steps: rapid-double-submit
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(cell)` at desktop/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (125ms)
- **Cells:** mobile/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (83ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (54ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (56ms)
- **Cells:** mobile/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/duplicate` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/llm-models fired 3× within step "(load)" (200,200,200)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/waterfall` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 10 sequential dependent /api requests (31ms serial) that could be parallelized — /api/mcp/defaults → /api/memory/admin-settings → /api/llm-models → /api/llm-models
- **Cells:** mobile/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/irrelevant` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "browse-settings" (step "(load)") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/irrelevant` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/chat/stream — "Subscribe to live assistant-token frames via SSE". Flow "browse-settings" (step "(load)") has no use for the `chat` domain; likely eager over-fetch of unrelated data.
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (103ms)
- **Cells:** mobile/light, mobile/dark, tablet/dark, desktop/light
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at mobile/light

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** mobile/light, tablet/dark, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at mobile/light

### 🟡 MEDIUM · `network/waterfall` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 4 sequential dependent /api requests (1047ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/auth/me → /api/sync/subscribe
- **Cells:** mobile/light
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at mobile/light

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (69ms)
- **Cells:** mobile/light
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at mobile/light

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** mobile/light, tablet/light, tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at mobile/light

### 🟡 MEDIUM · `network/excess` — browse-settings / (cell)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** excess/polling: GET /api/auth/me fired 4× across the flow (possible timer/render-storm) — steps: (load), settings-root, settings-general
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(cell)` at mobile/light

### 🟡 MEDIUM · `network/excess` — browse-settings / (cell)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** excess/polling: GET /api/sync/subscribe fired 6× across the flow (possible timer/render-storm) — steps: (load), settings-root, settings-general
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(cell)` at mobile/light

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (90ms)
- **Cells:** mobile/dark, tablet/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (81ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells:** mobile/dark, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/waterfall` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 7 sequential dependent /api requests (477ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
- **Cells:** mobile/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells:** mobile/dark, tablet/light, desktop/light
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at mobile/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (121ms)
- **Cells:** mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at mobile/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (54ms)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at mobile/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (148ms)
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells:** tablet/light, desktop/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (57ms)
- **Cells:** tablet/light, tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/duplicate` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/conversations fired 3× within step "(load)" (200,200,200)
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/n+1` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc, 5e0c6b23-c040-4cc1-8061-0c138c2dd625, 7622fc74-64d3-4128-99e8-f70df1e81bdd…)
- **Cells:** tablet/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/waterfall` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 4 sequential dependent /api requests (467ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
- **Cells:** tablet/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/irrelevant` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/projects — "List user's projects". Flow "browse-settings" (step "(load)") has no use for the `projects` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/light

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (82ms)
- **Cells:** tablet/light
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at tablet/light

### 🟡 MEDIUM · `network/duplicate` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/conversations fired 3× within step "settings-root" (200,200,200)
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at tablet/light

### 🟡 MEDIUM · `network/n+1` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (7622fc74-64d3-4128-99e8-f70df1e81bdd, 5e0c6b23-c040-4cc1-8061-0c138c2dd625, b7cf6238-7c6e-4de9-91a7-9de345829655…)
- **Cells:** tablet/light
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at tablet/light

### 🟡 MEDIUM · `network/irrelevant` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "browse-settings" (step "settings-root") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at tablet/light

### 🟡 MEDIUM · `network/irrelevant` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/projects — "List user's projects". Flow "browse-settings" (step "settings-root") has no use for the `projects` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at tablet/light

### 🟡 MEDIUM · `network/duplicate` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/conversations fired 3× within step "settings-general" (200,200,200)
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at tablet/light

### 🟡 MEDIUM · `network/n+1` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc, a34b4ba5-0180-47de-9944-e007bbbdcd5e, b7cf6238-7c6e-4de9-91a7-9de345829655…)
- **Cells:** tablet/light
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at tablet/light

### 🟡 MEDIUM · `network/waterfall` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (395ms serial) that could be parallelized — /api/onboarding/progress → /api/notifications → /api/server-update/status → /api/llm-models/downloads
- **Cells:** tablet/light, tablet/dark, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at tablet/light

### 🟡 MEDIUM · `network/irrelevant` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "browse-settings" (step "settings-general") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at tablet/light

### 🟡 MEDIUM · `network/irrelevant` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/projects — "List user's projects". Flow "browse-settings" (step "settings-general") has no use for the `projects` domain; likely eager over-fetch of unrelated data.
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at tablet/light

### 🟡 MEDIUM · `network/excess` — browse-settings / (cell)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** excess/polling: GET /api/conversations fired 9× across the flow (possible timer/render-storm) — steps: (load), settings-root, settings-general
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(cell)` at tablet/light

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (98ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (63ms)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/n+1` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc, 7622fc74-64d3-4128-99e8-f70df1e81bdd, b7cf6238-7c6e-4de9-91a7-9de345829655…)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/waterfall` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 17 sequential dependent /api requests (612ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/server-update/status
- **Cells:** tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at tablet/dark

### 🟡 MEDIUM · `network/n+1` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (a34b4ba5-0180-47de-9944-e007bbbdcd5e, 5e0c6b23-c040-4cc1-8061-0c138c2dd625, 7622fc74-64d3-4128-99e8-f70df1e81bdd…)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at tablet/dark

### 🟡 MEDIUM · `network/waterfall` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (455ms serial) that could be parallelized — /api/onboarding/progress → /api/notifications → /api/server-update/status → /api/llm-models/downloads
- **Cells:** tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at tablet/dark

### 🟡 MEDIUM · `network/n+1` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (a34b4ba5-0180-47de-9944-e007bbbdcd5e, 07a8f665-8fec-40ae-af12-1cd1bbace5ca, 7622fc74-64d3-4128-99e8-f70df1e81bdd…)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at tablet/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (80ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (58ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/n+1` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc, a34b4ba5-0180-47de-9944-e007bbbdcd5e, 07a8f665-8fec-40ae-af12-1cd1bbace5ca…)
- **Cells:** desktop/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (1053ms serial) that could be parallelized — /api/mcp/defaults → /api/assistants → /api/knowledge-bases → /api/mcp/servers
- **Cells:** desktop/light
- **Repro:** login admin → flow `browse-settings` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/n+1` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (a34b4ba5-0180-47de-9944-e007bbbdcd5e, 7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc, b7cf6238-7c6e-4de9-91a7-9de345829655…)
- **Cells:** desktop/light
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/waterfall` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 4 sequential dependent /api requests (203ms serial) that could be parallelized — /api/projects/by-conversation/7e27c0b7-4c97-47d9-8fa8-e8e5099b2ba9 → /api/projects → /api/conversations → /api/projects/by-conversation/696df0a5-9dc8-4f08-8736-a87cfce10fdc
- **Cells:** desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (55ms)
- **Cells:** desktop/light
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/n+1` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc, a34b4ba5-0180-47de-9944-e007bbbdcd5e, 07a8f665-8fec-40ae-af12-1cd1bbace5ca…)
- **Cells:** desktop/light
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/waterfall` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (382ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells:** desktop/light
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/n+1` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (a34b4ba5-0180-47de-9944-e007bbbdcd5e, 07a8f665-8fec-40ae-af12-1cd1bbace5ca, 7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc…)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/waterfall` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** waterfall: 11 sequential dependent /api requests (1034ms serial) that could be parallelized — /api/mcp/servers → /api/llm-models → /api/llm-models → /api/memory/admin-settings/rebuild-status
- **Cells:** desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at desktop/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (79ms)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at desktop/dark

### 🟡 MEDIUM · `network/n+1` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (07a8f665-8fec-40ae-af12-1cd1bbace5ca, b7cf6238-7c6e-4de9-91a7-9de345829655, 7622fc74-64d3-4128-99e8-f70df1e81bdd…)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at desktop/dark

### 🟡 MEDIUM · `network/failure` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (63ms)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at desktop/dark

### 🟡 MEDIUM · `network/n+1` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** N+1 pattern: 55 distinct requests to template GET /api/projects/by-conversation/{id} in one step (7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc, a34b4ba5-0180-47de-9944-e007bbbdcd5e, 7622fc74-64d3-4128-99e8-f70df1e81bdd…)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at desktop/dark

### 🟡 MEDIUM · `stuck-loading` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** 3 loading indicator(s) still present after settle window
- **Element:** `type(2)>div>div:nth-of-type(3)>div>div>div:nth-of-type(2)>div:nth-of-type(3)>svg`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/compose-send__sent__mobile__light.png`
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### 🟡 MEDIUM · `stuck-loading` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** 3 loading indicator(s) still present after settle window
- **Element:** `-of-type(3)>div:nth-of-type(1)>div>div>div:nth-of-type(2)>div:nth-of-type(3)>svg`
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Screenshot:** `screenshots/compose-send__sent__tablet__light.png`
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/light

### 🟡 MEDIUM · `stuck-loading` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** 3 loading indicator(s) still present after settle window
- **Element:** `type(2)>div>div:nth-of-type(3)>div>div>div:nth-of-type(2)>div:nth-of-type(3)>svg`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/adversarial-compose__rapid-double-submit__mobile__light.png`
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### 🟡 MEDIUM · `stuck-loading` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** 3 loading indicator(s) still present after settle window
- **Element:** `-of-type(3)>div:nth-of-type(1)>div>div>div:nth-of-type(2)>div:nth-of-type(3)>svg`
- **Cells:** tablet/light, tablet/dark, desktop/light, desktop/dark
- **Screenshot:** `screenshots/adversarial-compose__rapid-double-submit__tablet__light.png`
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### ⚪ LOW · `network/duplicate` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/conversations fired 2× within step "(load)" (200,200)
- **Cells:** mobile/light, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — home / (load)
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "(load)" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `home` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "(load)" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/fbf1cab5-e97e-448b-9de2-37d8a78016ca/memory-mode fired 2× within step "sent" (200,200)
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/fbf1cab5-e97e-448b-9de2-37d8a78016ca/summarization-mode fired 2× within step "sent" (200,200)
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/fbf1cab5-e97e-448b-9de2-37d8a78016ca fired 2× within step "sent" (200,200)
- **Cells:** mobile/light
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "sent" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "sent" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/dab48c41-9ca5-484b-9ea8-d9921badacca/summarization-mode fired 2× within step "sent" (200,200)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/dab48c41-9ca5-484b-9ea8-d9921badacca/memory-mode fired 2× within step "sent" (200,200)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/dab48c41-9ca5-484b-9ea8-d9921badacca fired 2× within step "sent" (200,200)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/dark

### ⚪ LOW · `network/duplicate` — compose-send / (load)
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations fired 2× within step "(load)" (200,200)
- **Cells:** tablet/light, tablet/dark
- **Repro:** login admin → flow `compose-send` → step `(load)` at tablet/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/6dd9ad7f-2502-4496-bf86-c18f9339cfd7/memory-mode fired 2× within step "sent" (200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/6dd9ad7f-2502-4496-bf86-c18f9339cfd7/summarization-mode fired 2× within step "sent" (200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/6dd9ad7f-2502-4496-bf86-c18f9339cfd7 fired 2× within step "sent" (200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/a74b3270-a634-4379-b38a-ba49b2460666/memory-mode fired 2× within step "sent" (200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/dark

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/a74b3270-a634-4379-b38a-ba49b2460666/summarization-mode fired 2× within step "sent" (200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/dark

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/a74b3270-a634-4379-b38a-ba49b2460666 fired 2× within step "sent" (200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at tablet/dark

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/46850e36-47cf-4ed8-924e-7893948c790e/memory-mode fired 2× within step "sent" (200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/46850e36-47cf-4ed8-924e-7893948c790e/summarization-mode fired 2× within step "sent" (200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/46850e36-47cf-4ed8-924e-7893948c790e fired 2× within step "sent" (200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/light

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/9dcca802-2cf6-40a5-922a-e3b0e3e39c18/memory-mode fired 2× within step "sent" (200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/dark

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/conversations/9dcca802-2cf6-40a5-922a-e3b0e3e39c18/summarization-mode fired 2× within step "sent" (200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/dark

### ⚪ LOW · `network/duplicate` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/9dcca802-2cf6-40a5-922a-e3b0e3e39c18 fired 2× within step "sent" (200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `compose-send` → step `sent` at desktop/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "(load)" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: POST /api/conversations fired 2× within step "rapid-double-submit" (201,201)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/5f7bdd00-6e90-4385-88ec-5967ee505404/memory-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/5f7bdd00-6e90-4385-88ec-5967ee505404/summarization-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/5f7bdd00-6e90-4385-88ec-5967ee505404 fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** mobile/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/b058e00e-c6a6-439d-9038-7d7b3d39ad8f/summarization-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/b058e00e-c6a6-439d-9038-7d7b3d39ad8f/memory-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/b058e00e-c6a6-439d-9038-7d7b3d39ad8f fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/0931779f-ddde-4883-af28-6867ca88c63f fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/2349303b-f1a5-44be-a5f9-dad37713b5ea/memory-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/2349303b-f1a5-44be-a5f9-dad37713b5ea/summarization-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/2349303b-f1a5-44be-a5f9-dad37713b5ea fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** tablet/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/a34b4ba5-0180-47de-9944-e007bbbdcd5e fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/5e0c6b23-c040-4cc1-8061-0c138c2dd625/memory-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/5e0c6b23-c040-4cc1-8061-0c138c2dd625/summarization-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/5e0c6b23-c040-4cc1-8061-0c138c2dd625 fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** tablet/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at tablet/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/07a8f665-8fec-40ae-af12-1cd1bbace5ca fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/b7cf6238-7c6e-4de9-91a7-9de345829655/memory-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/b7cf6238-7c6e-4de9-91a7-9de345829655/summarization-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/b7cf6238-7c6e-4de9-91a7-9de345829655 fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** desktop/light
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/light

### ⚪ LOW · `network/duplicate` — adversarial-compose / (load)
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations fired 2× within step "(load)" (200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `(load)` at desktop/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/7852d4fa-b706-4f9a-8dd1-86bcc2ae81cc fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/7622fc74-64d3-4128-99e8-f70df1e81bdd/memory-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/conversations/7622fc74-64d3-4128-99e8-f70df1e81bdd/summarization-mode fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/dark

### ⚪ LOW · `network/duplicate` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** duplicate request: GET /api/projects/by-conversation/7622fc74-64d3-4128-99e8-f70df1e81bdd fired 2× within step "rapid-double-submit" (200,200)
- **Cells:** desktop/dark
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at desktop/dark

### ⚪ LOW · `network/duplicate` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "(load)" (429,429)
- **Cells:** mobile/light, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/light

### ⚪ LOW · `network/duplicate` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/auth/me fired 2× within step "settings-root" (200,200)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at mobile/light

### ⚪ LOW · `network/duplicate` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-root" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at mobile/light

### ⚪ LOW · `network/duplicate` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-general" (429,429)
- **Cells:** mobile/light, mobile/dark, tablet/light, tablet/dark, desktop/light, desktop/dark
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at mobile/light

### ⚪ LOW · `network/duplicate` — browse-settings / (load)
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "(load)" (429,net::ERR_ABORTED)
- **Cells:** mobile/dark
- **Repro:** login admin → flow `browse-settings` → step `(load)` at mobile/dark

### ⚪ LOW · `palette-drift` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** saturated background color rgb(58, 92, 161) not resolvable to any DESIGN_SYSTEM token (possible hardcoded color / theme-drift)
- **Element:** `[data-testid="settingsgen-accent-blue"]`
- **Cells:** mobile/dark, tablet/dark, desktop/dark
- **Screenshot:** `screenshots/browse-settings__settings-general__mobile__dark.png`
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at mobile/dark

### ⚪ LOW · `spacing-grid` — compose-send / sent
- **JTBD:** Compose and send a chat message (persona: normal)
- **Signal:** 2 distinct off-grid spacing value(s) (2px half-step tolerated): 5px, 11px
- **Element:** `body`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/compose-send__sent__mobile__light.png`
- **Repro:** login admin → flow `compose-send` → step `sent` at mobile/light

### ⚪ LOW · `spacing-grid` — adversarial-compose / rapid-double-submit
- **JTBD:** Adversarial composer — empty / huge / double-submit (persona: adversarial)
- **Signal:** 2 distinct off-grid spacing value(s) (2px half-step tolerated): 5px, 11px
- **Element:** `body`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/adversarial-compose__rapid-double-submit__mobile__light.png`
- **Repro:** login admin → flow `adversarial-compose` → step `rapid-double-submit` at mobile/light

### ⚪ LOW · `spacing-grid` — browse-settings / settings-root
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** 1 distinct off-grid spacing value(s) (2px half-step tolerated): 5px
- **Element:** `body`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/browse-settings__settings-root__mobile__light.png`
- **Repro:** login admin → flow `browse-settings` → step `settings-root` at mobile/light

### ⚪ LOW · `spacing-grid` — browse-settings / settings-general
- **JTBD:** Browse settings surfaces (persona: normal)
- **Signal:** 1 distinct off-grid spacing value(s) (2px half-step tolerated): 5px
- **Element:** `body`
- **Cells:** mobile/light, mobile/dark
- **Screenshot:** `screenshots/browse-settings__settings-general__mobile__light.png`
- **Repro:** login admin → flow `browse-settings` → step `settings-general` at mobile/light
