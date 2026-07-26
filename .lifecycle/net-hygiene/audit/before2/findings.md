# Live UI Audit — findings

Target: `http://127.0.0.1:1548` · driven as `admin` · 2026-07-26T21:49:28.363Z

Evidence-based, objective signals only. Deduped across viewports×themes (each row lists the cells it appeared in). No subjective UX commentary.

## Totals

| Severity | Count (deduped) |
|---|---|
| 🔴 HIGH | 7 |
| 🟡 MEDIUM | 73 |
| ⚪ LOW | 55 |
| **Total** | **135** (171 raw) |

## By dimension

| Dimension | Count |
|---|---|
| **network** | 70 |
| **ui** | 46 |
| **bug** | 12 |
| **color-theme** | 6 |
| **real-infra** | 1 |

## By category (raw signal)

| Category | Count |
|---|---|
| `control-collision` | 33 |
| `network/failure` | 29 |
| `network/duplicate` | 16 |
| `network/irrelevant` | 13 |
| `zero-size-control` | 13 |
| `network/waterfall` | 12 |
| `console-error` | 6 |
| `stuck-loading` | 6 |
| `palette-drift` | 6 |
| `llm-infra` | 1 |

## Counts per dimension per surface

| Surface | bug | ui | responsive | color-theme | consistency | network | permission | real-infra | 🔴 | 🟡 | ⚪ | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `home (flow-level)` | 3 |  |  |  |  | 5 |  |  | 3 | 4 | 1 | 8 |
| `settings-user (flow-level)` | 3 |  |  |  |  | 4 |  |  | 3 | 3 | 1 | 7 |
| `(preflight) (flow-level)` |  |  |  |  |  |  |  | 1 | 1 |  |  | 1 |
| `settings-general` |  | 4 |  | 6 |  | 6 |  |  |  | 6 | 10 | 16 |
| `settings-profile` |  | 4 |  |  |  | 6 |  |  |  | 5 | 5 | 10 |
| `settings-user-llm-providers` |  | 4 |  |  |  | 6 |  |  |  | 6 | 4 | 10 |
| `settings-skills` |  | 4 |  |  |  | 6 |  |  |  | 6 | 4 | 10 |
| `settings-citations` |  | 4 |  |  |  | 6 |  |  |  | 6 | 4 | 10 |
| `settings-root` | 1 | 3 |  |  |  | 5 |  |  |  | 5 | 4 | 9 |
| `settings-memory` | 1 | 3 |  |  |  | 5 |  |  |  | 6 | 3 | 9 |
| `settings-literature-keys` |  | 4 |  |  |  | 5 |  |  |  | 5 | 4 | 9 |
| `settings-assistants` | 1 | 3 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-mcp-servers` | 1 | 3 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-workflows` | 1 | 3 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `settings-web-search-keys` | 1 | 3 |  |  |  | 4 |  |  |  | 5 | 3 | 8 |
| `home` |  | 4 |  |  |  |  |  |  |  | 1 | 3 | 4 |

## Systematically broken (surface × viewport/theme)

| Surface @ cell | Breakage categories |
|---|---|
| `settings-root @ desktop/light` | `stuck-loading` |
| `settings-assistants @ desktop/light` | `stuck-loading` |
| `settings-mcp-servers @ desktop/light` | `stuck-loading` |
| `settings-memory @ desktop/light` | `stuck-loading` |
| `settings-workflows @ desktop/light` | `stuck-loading` |
| `settings-web-search-keys @ desktop/light` | `stuck-loading` |

## Top 20 most-actionable

| # | Sev | Dimension | Surface | Signal | Cells |
|---|---|---|---|---|---|
| 1 | 🔴 | bug | `home (flow-level)` | Failed to load resource: the server responded with a status of 429 (Too Many Requests) | 1 |
| 2 | 🔴 | bug | `home (flow-level)` | Failed to load resource: the server responded with a status of 405 (Method Not Allowed) | 1 |
| 3 | 🔴 | bug | `home (flow-level)` | Error calling endpoint POST /api/projects/by-conversations: Error: HTTP error! status: 405 at y (http://127.0.0.1:1548/assets/core-D_0e4JzZ.js:3:624) at async Object.fetchChunk (http://127.0 | 1 |
| 4 | 🔴 | bug | `settings-user (flow-level)` | Failed to load resource: the server responded with a status of 429 (Too Many Requests) | 1 |
| 5 | 🔴 | bug | `settings-user (flow-level)` | Failed to load resource: the server responded with a status of 405 (Method Not Allowed) | 1 |
| 6 | 🔴 | bug | `settings-user (flow-level)` | Error calling endpoint POST /api/projects/by-conversations: Error: HTTP error! status: 405 at y (http://127.0.0.1:1548/assets/core-D_0e4JzZ.js:3:624) at async Object.fetchChunk (http://127.0 | 1 |
| 7 | 🔴 | real-infra | `(preflight) (flow-level)` | STREAMING UNAVAILABLE for the driving user "admin": /api/sync/subscribe → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this ru | 1 |
| 8 | 🟡 | bug | `settings-root` | 1 loading indicator(s) still present after settle window | 1 |
| 9 | 🟡 | bug | `settings-assistants` | 1 loading indicator(s) still present after settle window | 1 |
| 10 | 🟡 | bug | `settings-mcp-servers` | 1 loading indicator(s) still present after settle window | 1 |
| 11 | 🟡 | bug | `settings-memory` | 1 loading indicator(s) still present after settle window | 1 |
| 12 | 🟡 | bug | `settings-workflows` | 1 loading indicator(s) still present after settle window | 1 |
| 13 | 🟡 | bug | `settings-web-search-keys` | 1 loading indicator(s) still present after settle window | 1 |
| 14 | 🟡 | ui | `home` | interactive control has near-zero size 1×1px | 1 |
| 15 | 🟡 | ui | `settings-root` | interactive control has near-zero size 1×1px | 1 |
| 16 | 🟡 | ui | `settings-general` | interactive control has near-zero size 1×1px | 1 |
| 17 | 🟡 | ui | `settings-profile` | interactive control has near-zero size 1×1px | 1 |
| 18 | 🟡 | ui | `settings-assistants` | interactive control has near-zero size 1×1px | 1 |
| 19 | 🟡 | ui | `settings-user-llm-providers` | interactive control has near-zero size 1×1px | 1 |
| 20 | 🟡 | ui | `settings-mcp-servers` | interactive control has near-zero size 1×1px | 1 |

## Full inventory — grouped by dimension, then surface

# Dimension: bug (12)

## bug · `home (flow-level)` (3)

### 🔴 HIGH · `console-error`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(console)` at desktop/light

### 🔴 HIGH · `console-error`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 405 (Method Not Allowed)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(console)` at desktop/light

### 🔴 HIGH · `console-error`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** Error calling endpoint POST /api/projects/by-conversations: Error: HTTP error! status: 405 at y (http://127.0.0.1:1548/assets/core-D_0e4JzZ.js:3:624) at async Object.fetchChunk (http://127.0.0.1:1548/assets/extension-FvuXJC8m.js:1:2845) at async Promise.all (index 0)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(console)` at desktop/light

## bug · `settings-user (flow-level)` (3)

### 🔴 HIGH · `console-error`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(console)` at desktop/light

### 🔴 HIGH · `console-error`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 405 (Method Not Allowed)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(console)` at desktop/light

### 🔴 HIGH · `console-error`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** Error calling endpoint POST /api/projects/by-conversations: Error: HTTP error! status: 405 at y (http://127.0.0.1:1548/assets/core-D_0e4JzZ.js:3:624) at async Object.fetchChunk (http://127.0.0.1:1548/assets/extension-FvuXJC8m.js:1:2845) at async Promise.all (index 0)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(console)` at desktop/light

## bug · `settings-root` (1)

### 🟡 MEDIUM · `stuck-loading`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** 1 loading indicator(s) still present after settle window
- **Element:** `div>div:nth-of-type(3)>div>div>div:nth-of-type(2)>div>span>svg`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

## bug · `settings-assistants` (1)

### 🟡 MEDIUM · `stuck-loading`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** 1 loading indicator(s) still present after settle window
- **Element:** `div>div:nth-of-type(3)>div>div>div:nth-of-type(2)>div>span>svg`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

## bug · `settings-mcp-servers` (1)

### 🟡 MEDIUM · `stuck-loading`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** 1 loading indicator(s) still present after settle window
- **Element:** `div>div:nth-of-type(3)>div>div>div:nth-of-type(2)>div>span>svg`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

## bug · `settings-memory` (1)

### 🟡 MEDIUM · `stuck-loading`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** 1 loading indicator(s) still present after settle window
- **Element:** `div>div:nth-of-type(3)>div>div>div:nth-of-type(2)>div>span>svg`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

## bug · `settings-workflows` (1)

### 🟡 MEDIUM · `stuck-loading`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** 1 loading indicator(s) still present after settle window
- **Element:** `div>div:nth-of-type(3)>div>div>div:nth-of-type(2)>div>span>svg`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

## bug · `settings-web-search-keys` (1)

### 🟡 MEDIUM · `stuck-loading`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** 1 loading indicator(s) still present after settle window
- **Element:** `div>div:nth-of-type(3)>div>div>div:nth-of-type(2)>div>span>svg`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

# Dimension: ui (46)

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

## ui · `settings-root` (3)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 72% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button ("Web Search") ⨯ main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>button ("Onboarding guide")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 60% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button ("System Workflows") ⨯ tion#main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>a ("Help & documentation")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-root__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

## ui · `settings-assistants` (3)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 72% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button ("Web Search") ⨯ main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>button ("Onboarding guide")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 60% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button ("System Workflows") ⨯ tion#main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>a ("Help & documentation")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-assistants__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

## ui · `settings-mcp-servers` (3)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 72% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button ("Web Search") ⨯ main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>button ("Onboarding guide")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 60% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button ("System Workflows") ⨯ tion#main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>a ("Help & documentation")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-mcp-servers__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

## ui · `settings-memory` (3)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 72% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button ("Web Search") ⨯ main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>button ("Onboarding guide")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 60% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button ("System Workflows") ⨯ tion#main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>a ("Help & documentation")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-memory__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

## ui · `settings-workflows` (3)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 72% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button ("Web Search") ⨯ main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>button ("Onboarding guide")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 60% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button ("System Workflows") ⨯ tion#main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>a ("Help & documentation")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-workflows__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

## ui · `settings-web-search-keys` (3)

### 🟡 MEDIUM · `zero-size-control`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** interactive control has near-zero size 1×1px
- **Element:** `div#root>div>div>a`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 72% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button ("Web Search") ⨯ main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>button ("Onboarding guide")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(12)>button`
- **Cells (viewport/theme):** desktop/light
- **Screenshot:** `screenshots/settings-user__settings-web-search-keys__desktop__light.png`
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### ⚪ LOW · `control-collision`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** two distinct interactive controls overlap 60% in-viewport — ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button ("System Workflows") ⨯ tion#main-content>div>div:nth-of-type(2)>div:nth-of-type(1)>div:nth-of-type(2)>a ("Help & documentation")
- **Element:** `ype(1)>div:nth-of-type(1)>nav>ul>li:nth-of-type(13)>ul>li:nth-of-type(13)>button`
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

# Dimension: network (70)

## network · `settings-general` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (63ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (3ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (880ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 7 sequential dependent /api requests (2125ms serial) that could be parallelized — /api/auth/me → /api/sync/subscribe → /api/onboarding/progress → /api/notifications
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

## network · `settings-profile` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (82ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (778ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (3ms)
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

## network · `settings-user-llm-providers` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (72ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (1172ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (4ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 7 sequential dependent /api requests (328ms serial) that could be parallelized — /api/auth/me → /api/sync/subscribe → /api/onboarding/progress → /api/server-update/status
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

## network · `settings-skills` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (71ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (4ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (858ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (1781ms serial) that could be parallelized — /api/onboarding/progress → /api/notifications → /api/server-update/status → /api/llm-models/downloads
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

## network · `settings-citations` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (73ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (790ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (5ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 4 sequential dependent /api requests (2036ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
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

## network · `home (flow-level)` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (156ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (5ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (64ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 16 sequential dependent /api requests (1039ms serial) that could be parallelized — /api/conversations → /api/projects/by-conversations → /api/projects → /api/mcp/defaults
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

## network · `settings-root` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (73ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 9 sequential dependent /api requests (3354ms serial) that could be parallelized — /api/chat/stream/subscription → /api/app/setup/status → /api/auth/me → /api/sync/subscribe
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-root") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/auth/me fired 2× within step "settings-root" (200,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-root" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

## network · `settings-memory` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (66ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 8 sequential dependent /api requests (1953ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
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
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-memory" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

## network · `settings-literature-keys` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (100ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (3ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (1970ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/llm-models/downloads → /api/notifications
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

## network · `settings-user (flow-level)` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (86ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (16ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 4 sequential dependent /api requests (2070ms serial) that could be parallelized — /api/conversations → /api/projects/by-conversations → /api/projects → /api/chat/stream
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

## network · `settings-assistants` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (115ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (1250ms serial) that could be parallelized — /api/onboarding/progress → /api/notifications → /api/server-update/status → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-assistants") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-assistants" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

## network · `settings-mcp-servers` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (102ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 5 sequential dependent /api requests (59ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-mcp-servers") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-mcp-servers" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

## network · `settings-workflows` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (78ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 6 sequential dependent /api requests (1754ms serial) that could be parallelized — /api/onboarding/progress → /api/server-update/status → /api/notifications → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-workflows") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-workflows" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

## network · `settings-web-search-keys` (4)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (145ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: POST /api/projects/by-conversations → 405 (2ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-web-search-keys") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-web-search-keys" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

# Dimension: real-infra (1)

## real-infra · `(preflight) (flow-level)` (1)

### 🔴 HIGH · `llm-infra`
- **JTBD:** real-infra preflight (persona: admin)
- **Signal:** STREAMING UNAVAILABLE for the driving user "admin": /api/sync/subscribe → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this run is a PENDING state. (Per-user stream/connection slots are exhausted — verify with a freshly created user.)
- **Element:** `/api/sync/subscribe`
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `(preflight)` → step `(preflight)` at desktop/light
