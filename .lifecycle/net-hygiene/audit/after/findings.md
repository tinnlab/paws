# Live UI Audit — findings

Target: `http://127.0.0.1:1547` · driven as `admin` · 2026-07-26T21:14:26.963Z

Evidence-based, objective signals only. Deduped across viewports×themes (each row lists the cells it appeared in). No subjective UX commentary.

## Totals

| Severity | Count (deduped) |
|---|---|
| 🔴 HIGH | 4 |
| 🟡 MEDIUM | 71 |
| ⚪ LOW | 47 |
| **Total** | **122** (137 raw) |

## By dimension

| Dimension | Count |
|---|---|
| **network** | 60 |
| **ui** | 52 |
| **color-theme** | 6 |
| **bug** | 2 |
| **real-infra** | 2 |

## By category (raw signal)

| Category | Count |
|---|---|
| `control-collision` | 39 |
| `network/failure` | 17 |
| `network/n+1` | 14 |
| `network/irrelevant` | 13 |
| `zero-size-control` | 13 |
| `network/waterfall` | 12 |
| `palette-drift` | 6 |
| `network/duplicate` | 4 |
| `console-error` | 2 |
| `llm-infra` | 2 |

## Counts per dimension per surface

| Surface | bug | ui | responsive | color-theme | consistency | network | permission | real-infra | 🔴 | 🟡 | ⚪ | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `(preflight) (flow-level)` |  |  |  |  |  |  |  | 2 | 2 |  |  | 2 |
| `home (flow-level)` | 1 |  |  |  |  | 7 |  |  | 1 | 6 | 1 | 8 |
| `settings-user (flow-level)` | 1 |  |  |  |  | 4 |  |  | 1 | 4 |  | 5 |
| `settings-general` |  | 4 |  | 6 |  | 4 |  |  |  | 5 | 9 | 14 |
| `settings-memory` |  | 4 |  |  |  | 6 |  |  |  | 6 | 4 | 10 |
| `settings-profile` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-assistants` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-user-llm-providers` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-mcp-servers` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-skills` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-workflows` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-citations` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-literature-keys` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-web-search-keys` |  | 4 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-root` |  | 4 |  |  |  | 3 |  |  |  | 4 | 3 | 7 |
| `home` |  | 4 |  |  |  |  |  |  |  | 1 | 3 | 4 |

## Top 20 most-actionable

| # | Sev | Dimension | Surface | Signal | Cells |
|---|---|---|---|---|---|
| 1 | 🔴 | bug | `home (flow-level)` | Failed to load resource: the server responded with a status of 429 (Too Many Requests) | 1 |
| 2 | 🔴 | bug | `settings-user (flow-level)` | Failed to load resource: the server responded with a status of 429 (Too Many Requests) | 1 |
| 3 | 🔴 | real-infra | `(preflight) (flow-level)` | STREAMING UNAVAILABLE for the driving user "admin": /api/chat/stream → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this run i | 1 |
| 4 | 🔴 | real-infra | `(preflight) (flow-level)` | STREAMING UNAVAILABLE for the driving user "admin": /api/sync/subscribe → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this ru | 1 |
| 5 | 🟡 | ui | `home` | interactive control has near-zero size 1×1px | 1 |
| 6 | 🟡 | ui | `settings-root` | interactive control has near-zero size 1×1px | 1 |
| 7 | 🟡 | ui | `settings-general` | interactive control has near-zero size 1×1px | 1 |
| 8 | 🟡 | ui | `settings-profile` | interactive control has near-zero size 1×1px | 1 |
| 9 | 🟡 | ui | `settings-assistants` | interactive control has near-zero size 1×1px | 1 |
| 10 | 🟡 | ui | `settings-user-llm-providers` | interactive control has near-zero size 1×1px | 1 |
| 11 | 🟡 | ui | `settings-mcp-servers` | interactive control has near-zero size 1×1px | 1 |
| 12 | 🟡 | ui | `settings-memory` | interactive control has near-zero size 1×1px | 1 |
| 13 | 🟡 | ui | `settings-skills` | interactive control has near-zero size 1×1px | 1 |
| 14 | 🟡 | ui | `settings-workflows` | interactive control has near-zero size 1×1px | 1 |
| 15 | 🟡 | ui | `settings-citations` | interactive control has near-zero size 1×1px | 1 |
| 16 | 🟡 | ui | `settings-literature-keys` | interactive control has near-zero size 1×1px | 1 |
| 17 | 🟡 | ui | `settings-web-search-keys` | interactive control has near-zero size 1×1px | 1 |
| 18 | 🟡 | network | `home (flow-level)` | network failure: GET /api/sync/subscribe → 429 (73ms) | 1 |
| 19 | 🟡 | network | `home (flow-level)` | network failure: GET /api/chat/stream → 429 (110ms) | 1 |
| 20 | 🟡 | network | `home (flow-level)` | network failure: GET /api/chat/stream → 429 (57ms) | 1 |

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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/home__home__desktop__light.png`
- **Repro:** login admin → flow `home` → step `home` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/home__home__desktop__light.png`
- **Repro:** login admin → flow `home` → step `home` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-general__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-profile__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-profile__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-user-llm-providers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-user-llm-providers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-skills__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-skills__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-citations__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-citations__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-literature-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-literature-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(1)>button ("Hub")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-5e2e6f63-b843-4fc8-b48e-0c0e3f297464"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 97% in-viewport — [data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(2)>button ("Onboarding")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-ca451c7a-b61f-45af-a7f5-6c2995034823"]`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 91% in-viewport — [data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"] ("Untitled Conversation") ⨯ div>div:nth-of-type(4)>nav>ul>li>ul>li:nth-of-type(3)>button ("Settings")
- **Element:** `[data-testid="chat-recent-conversations-menu-item-0a1fccac-5e9a-42f5-a668-923685ac0785"]`
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

# Dimension: network (60)

## network · `home (flow-level)` (7)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (73ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (110ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (57ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/duplicate`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/llm-models fired 3× within step "(load)" (200,200,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 3f60332f-37e8-4e0e-a719-6689c303ecff, 67beb314-1bb2-4239-9fec-616f3f43ae9a…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 8 sequential dependent /api requests (104ms serial) that could be parallelized — /api/mcp/defaults → /api/conversations → /api/memory/admin-settings → /api/llm-models
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "(load)" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

## network · `settings-memory` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (99ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2, 3f60332f-37e8-4e0e-a719-6689c303ecff, 902f8ffd-0fdf-4363-8d98-0cd7391e0d82…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (440ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
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
- **Signal:** duplicate request: GET /api/llm-models fired 2× within step "settings-memory" (200,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

## network · `settings-user (flow-level)` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (66ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (1163ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/llm-models fired 3× within step "(load)" (200,200,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3f60332f-37e8-4e0e-a719-6689c303ecff, 79f8ab98-1d27-42c7-91ea-f4109fda3696, 902f8ffd-0fdf-4363-8d98-0cd7391e0d82…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

## network · `settings-general` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (78ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (79f8ab98-1d27-42c7-91ea-f4109fda3696, 67beb314-1bb2-4239-9fec-616f3f43ae9a, 3d5e26a4-6079-4e9e-a16b-7eef4024f740…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 18 sequential dependent /api requests (421ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-general") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

## network · `settings-profile` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (92ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3d5e26a4-6079-4e9e-a16b-7eef4024f740, 3f60332f-37e8-4e0e-a719-6689c303ecff, 0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 11 sequential dependent /api requests (428ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-profile") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

## network · `settings-assistants` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (86ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2, 67beb314-1bb2-4239-9fec-616f3f43ae9a, 79f8ab98-1d27-42c7-91ea-f4109fda3696…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 4 sequential dependent /api requests (1636ms serial) that could be parallelized — /api/server-update/status → /api/assistants → /api/conversations → /api/projects/by-conversation/0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-assistants") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

## network · `settings-user-llm-providers` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (101ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (ee88219b-e506-4ed2-868b-2e276b2d445a, ca451c7a-b61f-45af-a7f5-6c2995034823, 0a1fccac-5e9a-42f5-a668-923685ac0785…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 14 sequential dependent /api requests (363ms serial) that could be parallelized — /api/user-llm-providers → /api/conversations → /api/projects/by-conversation/ca451c7a-b61f-45af-a7f5-6c2995034823 → /api/projects/by-conversation/0a1fccac-5e9a-42f5-a668-923685ac0785
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-user-llm-providers") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

## network · `settings-mcp-servers` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (71ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 3f60332f-37e8-4e0e-a719-6689c303ecff, 67beb314-1bb2-4239-9fec-616f3f43ae9a…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (408ms serial) that could be parallelized — /api/code-sandbox/flavors → /api/conversations → /api/projects/by-conversation/902f8ffd-0fdf-4363-8d98-0cd7391e0d82 → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-mcp-servers") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

## network · `settings-skills` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (79ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 79f8ab98-1d27-42c7-91ea-f4109fda3696, 67beb314-1bb2-4239-9fec-616f3f43ae9a…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 4 sequential dependent /api requests (1726ms serial) that could be parallelized — /api/notifications → /api/skills → /api/conversations → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-skills") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

## network · `settings-workflows` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (78ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3f60332f-37e8-4e0e-a719-6689c303ecff, 0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2, 67beb314-1bb2-4239-9fec-616f3f43ae9a…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 20 sequential dependent /api requests (403ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-workflows") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

## network · `settings-citations` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (95ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3f60332f-37e8-4e0e-a719-6689c303ecff, 3d5e26a4-6079-4e9e-a16b-7eef4024f740, 0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 20 sequential dependent /api requests (403ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-citations") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

## network · `settings-literature-keys` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (137ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (79f8ab98-1d27-42c7-91ea-f4109fda3696, 0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2, 3d5e26a4-6079-4e9e-a16b-7eef4024f740…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 19 sequential dependent /api requests (421ms serial) that could be parallelized — /api/onboarding/progress → /api/notifications → /api/server-update/status → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-literature-keys") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

## network · `settings-web-search-keys` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (84ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3d5e26a4-6079-4e9e-a16b-7eef4024f740, 3f60332f-37e8-4e0e-a719-6689c303ecff, 0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 17 sequential dependent /api requests (369ms serial) that could be parallelized — /api/server-update/status → /api/web-search/user-keys → /api/conversations → /api/projects/by-conversation/3d5e26a4-6079-4e9e-a16b-7eef4024f740
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-web-search-keys") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

## network · `settings-root` (3)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (90ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (79f8ab98-1d27-42c7-91ea-f4109fda3696, 3f60332f-37e8-4e0e-a719-6689c303ecff, 0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-root") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

# Dimension: real-infra (2)

## real-infra · `(preflight) (flow-level)` (2)

### 🔴 HIGH · `llm-infra`
- **JTBD:** real-infra preflight (persona: admin)
- **Signal:** STREAMING UNAVAILABLE for the driving user "admin": /api/chat/stream → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this run is a PENDING state. (Per-user stream/connection slots are exhausted — verify with a freshly created user.)
- **Element:** `/api/chat/stream`
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `(preflight)` → step `(preflight)` at desktop/light

### 🔴 HIGH · `llm-infra`
- **JTBD:** real-infra preflight (persona: admin)
- **Signal:** STREAMING UNAVAILABLE for the driving user "admin": /api/sync/subscribe → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this run is a PENDING state. (Per-user stream/connection slots are exhausted — verify with a freshly created user.)
- **Element:** `/api/sync/subscribe`
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `(preflight)` → step `(preflight)` at desktop/light
