# Live UI Audit — findings

Target: `http://127.0.0.1:1548` · driven as `admin` · 2026-07-26T23:12:43.083Z

Evidence-based, objective signals only. Deduped across viewports×themes (each row lists the cells it appeared in). No subjective UX commentary.

## Totals

| Severity | Count (deduped) |
|---|---|
| 🔴 HIGH | 3 |
| 🟡 MEDIUM | 79 |
| ⚪ LOW | 60 |
| **Total** | **142** (172 raw) |

## By dimension

| Dimension | Count |
|---|---|
| **network** | 68 |
| **ui** | 52 |
| **a11y-name** | 13 |
| **color-theme** | 6 |
| **bug** | 2 |
| **real-infra** | 1 |

## By category (raw signal)

| Category | Count |
|---|---|
| `control-collision` | 39 |
| `network/failure` | 26 |
| `network/duplicate` | 16 |
| `a11y-name` | 13 |
| `network/waterfall` | 13 |
| `network/irrelevant` | 13 |
| `zero-size-control` | 13 |
| `palette-drift` | 6 |
| `console-error` | 2 |
| `llm-infra` | 1 |

## Counts per dimension per surface

| Surface | bug | ui | responsive | color-theme | consistency | network | permission | real-infra | 🔴 | 🟡 | ⚪ | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `settings-user (flow-level)` | 1 |  |  |  |  | 4 |  |  | 1 | 3 | 1 | 5 |
| `home (flow-level)` | 1 |  |  |  |  | 3 |  |  | 1 | 2 | 1 | 4 |
| `(preflight) (flow-level)` |  |  |  |  |  |  |  | 1 | 1 |  |  | 1 |
| `settings-general` |  | 4 |  | 6 |  | 4 |  |  |  | 5 | 10 | 15 |
| `settings-root` |  | 4 |  |  |  | 6 |  |  |  | 6 | 5 | 11 |
| `settings-profile` |  | 4 |  |  |  | 6 |  |  |  | 6 | 5 | 11 |
| `settings-memory` |  | 4 |  |  |  | 6 |  |  |  | 7 | 4 | 11 |
| `settings-assistants` |  | 4 |  |  |  | 5 |  |  |  | 6 | 4 | 10 |
| `settings-mcp-servers` |  | 4 |  |  |  | 5 |  |  |  | 6 | 4 | 10 |
| `settings-skills` |  | 4 |  |  |  | 5 |  |  |  | 6 | 4 | 10 |
| `settings-workflows` |  | 4 |  |  |  | 5 |  |  |  | 6 | 4 | 10 |
| `settings-citations` |  | 4 |  |  |  | 5 |  |  |  | 6 | 4 | 10 |
| `settings-literature-keys` |  | 4 |  |  |  | 5 |  |  |  | 6 | 4 | 10 |
| `settings-web-search-keys` |  | 4 |  |  |  | 5 |  |  |  | 7 | 3 | 10 |
| `settings-user-llm-providers` |  | 4 |  |  |  | 4 |  |  |  | 5 | 4 | 9 |
| `home` |  | 4 |  |  |  |  |  |  |  | 2 | 3 | 5 |

## Top 20 most-actionable

| # | Sev | Dimension | Surface | Signal | Cells |
|---|---|---|---|---|---|
| 1 | 🔴 | bug | `home (flow-level)` | Failed to load resource: the server responded with a status of 429 (Too Many Requests) | 1 |
| 2 | 🔴 | bug | `settings-user (flow-level)` | Failed to load resource: the server responded with a status of 429 (Too Many Requests) | 1 |
| 3 | 🔴 | real-infra | `(preflight) (flow-level)` | STREAMING UNAVAILABLE for the driving user "admin": /api/sync/subscribe → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this ru | 1 |
| 4 | 🟡 | ui | `home` | interactive control has near-zero size 1×1px | 1 |
| 5 | 🟡 | ui | `settings-root` | interactive control has near-zero size 1×1px | 1 |
| 6 | 🟡 | ui | `settings-general` | interactive control has near-zero size 1×1px | 1 |
| 7 | 🟡 | ui | `settings-profile` | interactive control has near-zero size 1×1px | 1 |
| 8 | 🟡 | ui | `settings-assistants` | interactive control has near-zero size 1×1px | 1 |
| 9 | 🟡 | ui | `settings-user-llm-providers` | interactive control has near-zero size 1×1px | 1 |
| 10 | 🟡 | ui | `settings-mcp-servers` | interactive control has near-zero size 1×1px | 1 |
| 11 | 🟡 | ui | `settings-memory` | interactive control has near-zero size 1×1px | 1 |
| 12 | 🟡 | ui | `settings-skills` | interactive control has near-zero size 1×1px | 1 |
| 13 | 🟡 | ui | `settings-workflows` | interactive control has near-zero size 1×1px | 1 |
| 14 | 🟡 | ui | `settings-citations` | interactive control has near-zero size 1×1px | 1 |
| 15 | 🟡 | ui | `settings-literature-keys` | interactive control has near-zero size 1×1px | 1 |
| 16 | 🟡 | ui | `settings-web-search-keys` | interactive control has near-zero size 1×1px | 1 |
| 17 | 🟡 | network | `home (flow-level)` | network failure: GET /api/sync/subscribe → 429 (122ms) | 1 |
| 18 | 🟡 | network | `home (flow-level)` | waterfall: 16 sequential dependent /api requests (1094ms serial) that could be parallelized — /api/conversations → /api/projects/by-conversations → /api/projects → /api/mcp/defaults | 1 |
| 19 | 🟡 | network | `settings-user (flow-level)` | network failure: GET /api/sync/subscribe → 429 (190ms) | 1 |
| 20 | 🟡 | network | `settings-user (flow-level)` | network failure: GET /api/sync/subscribe → 429 (57ms) | 1 |

## Full inventory — grouped by dimension, then surface

# Dimension: bug (2)

## bug · `home (flow-level)` (1)

### 🔴 HIGH · `console-error`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(console)` at desktop/light

## bug · `settings-user (flow-level)` (1)

### 🔴 HIGH · `console-error`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(console)` at desktop/light

# Dimension: ui (52)

## ui · `home` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/home__home__desktop__light.png`
- **Repro:** login admin → flow `home` → step `home` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/home__home__desktop__light.png`
- **Repro:** login admin → flow `home` → step `home` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/home__home__desktop__light.png`
- **Repro:** login admin → flow `home` → step `home` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/home__home__desktop__light.png`
- **Repro:** login admin → flow `home` → step `home` at desktop/light

## ui · `settings-root` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

## ui · `settings-general` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

## ui · `settings-profile` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-profile__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-profile__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-profile__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-profile__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

## ui · `settings-assistants` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

## ui · `settings-user-llm-providers` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-user-llm-providers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-user-llm-providers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-user-llm-providers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-user-llm-providers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

## ui · `settings-mcp-servers` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

## ui · `settings-memory` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

## ui · `settings-skills` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-skills__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-skills__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-skills__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-skills__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

## ui · `settings-workflows` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

## ui · `settings-citations` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-citations__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-citations__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-citations__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-citations__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

## ui · `settings-literature-keys` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-literature-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-literature-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-literature-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-literature-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

## ui · `settings-web-search-keys` (4)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"] ("measurement conversation 14") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-1177a2bf-4b37-4b16-83bd-39d01a98b953"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"] ("measurement conversation 13") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-d647fb9e-3eac-4c01-8998-5056f79c7fa9"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"] ("measurement conversation 12") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-a0d5fef9-23ae-4c03-9ea1-098e008e911f"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

# Dimension: color-theme (6)

## color-theme · `settings-general` (6)

### ⚪ LOW · `palette-drift`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** saturated background color rgb(69, 79, 176) not resolvable to any DESIGN_SYSTEM token (possible hardcoded color / theme-drift)
- **Element:** `[data-testid="settingsgen-accent-indigo"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `palette-drift`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** saturated background color rgb(67, 86, 112) not resolvable to any DESIGN_SYSTEM token (possible hardcoded color / theme-drift)
- **Element:** `[data-testid="settingsgen-accent-slate"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `palette-drift`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** saturated background color rgb(29, 111, 124) not resolvable to any DESIGN_SYSTEM token (possible hardcoded color / theme-drift)
- **Element:** `[data-testid="settingsgen-accent-teal"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `palette-drift`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** saturated background color rgb(45, 123, 87) not resolvable to any DESIGN_SYSTEM token (possible hardcoded color / theme-drift)
- **Element:** `[data-testid="settingsgen-accent-green"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `palette-drift`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** saturated background color rgb(119, 77, 179) not resolvable to any DESIGN_SYSTEM token (possible hardcoded color / theme-drift)
- **Element:** `[data-testid="settingsgen-accent-violet"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `palette-drift`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** saturated background color rgb(182, 53, 85) not resolvable to any DESIGN_SYSTEM token (possible hardcoded color / theme-drift)
- **Element:** `[data-testid="settingsgen-accent-rose"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

# Dimension: network (68)

## network · `settings-root` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (84ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 9 sequential dependent /api requests (1046ms serial) that could be parallelized — /api/onboarding/progress → /api/notifications → /api/llm-models/downloads → /api/server-update/status
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-root") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/auth/me fired 2× within step "settings-root" (200,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-root" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

## network · `settings-profile` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (140ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (59ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 12 sequential dependent /api requests (1442ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-profile") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/auth/me fired 2× within step "settings-profile" (200,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-profile" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

## network · `settings-memory` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (104ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (59ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 5 sequential dependent /api requests (656ms serial) that could be parallelized — /api/memory/audit-log → /api/conversations → /api/projects/by-conversations → /api/projects
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/memories — "List the caller's own memories (paginated)". Flow "settings-user" (step "settings-memory") has no use for the `memories` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-memory") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-memory" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

## network · `settings-assistants` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (131ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (73ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (998ms serial) that could be parallelized — /api/notifications → /api/conversations → /api/assistants → /api/projects/by-conversations
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-assistants") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-assistants" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

## network · `settings-mcp-servers` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (117ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 5 sequential dependent /api requests (114ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/llm-models/downloads → /api/notifications
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-mcp-servers") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-mcp-servers" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

## network · `settings-skills` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (167ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (56ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (984ms serial) that could be parallelized — /api/llm-models/downloads → /api/skills → /api/conversations → /api/projects/by-conversations
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-skills") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-skills" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

## network · `settings-workflows` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (76ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (60ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 9 sequential dependent /api requests (1036ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-workflows") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-workflows" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

## network · `settings-citations` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (101ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (91ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 9 sequential dependent /api requests (1073ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-citations") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-citations" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

## network · `settings-literature-keys` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (72ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (102ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (1075ms serial) that could be parallelized — /api/llm-models/downloads → /api/lit-search/user-keys → /api/conversations → /api/projects/by-conversations
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-literature-keys") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-literature-keys" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

## network · `settings-web-search-keys` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (149ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 3× within step "settings-web-search-keys" (429,429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 7 sequential dependent /api requests (444ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/llm-models/downloads → /api/notifications
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-web-search-keys") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

## network · `settings-user (flow-level)` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (190ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 4 sequential dependent /api requests (597ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

## network · `settings-general` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (102ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 8 sequential dependent /api requests (1080ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/llm-models/downloads → /api/notifications
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-general") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-general" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

## network · `settings-user-llm-providers` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (110ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (78ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-user-llm-providers") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-user-llm-providers" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

## network · `home (flow-level)` (3)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (122ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 16 sequential dependent /api requests (1094ms serial) that could be parallelized — /api/conversations → /api/projects/by-conversations → /api/projects → /api/mcp/defaults
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

# Dimension: real-infra (1)

## real-infra · `(preflight) (flow-level)` (1)

### 🔴 HIGH · `llm-infra`
- **JTBD:** real-infra preflight (persona: admin)
- **Signal:** STREAMING UNAVAILABLE for the driving user "admin": /api/sync/subscribe → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this run is a PENDING state. (Per-user stream/connection slots are exhausted — verify with a freshly created user.)
- **Element:** `/api/sync/subscribe`
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `(preflight)` → step `(preflight)` at desktop/light
