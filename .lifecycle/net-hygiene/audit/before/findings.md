# Live UI Audit — findings

Target: `http://127.0.0.1:1547` · driven as `admin` · 2026-07-26T20:36:57.279Z

Evidence-based, objective signals only. Deduped across viewports×themes (each row lists the cells it appeared in). No subjective UX commentary.

## Totals

| Severity | Count (deduped) |
|---|---|
| 🔴 HIGH | 21 |
| 🟡 MEDIUM | 81 |
| ⚪ LOW | 78 |
| **Total** | **180** (222 raw) |

## By dimension

| Dimension | Count |
|---|---|
| **network** | 115 |
| **ui** | 52 |
| **color-theme** | 6 |
| **bug** | 5 |
| **real-infra** | 2 |

## By category (raw signal)

| Category | Count |
|---|---|
| `network/failure` | 39 |
| `control-collision` | 39 |
| `network/duplicate` | 35 |
| `network/n+1` | 14 |
| `network/waterfall` | 14 |
| `network/irrelevant` | 13 |
| `zero-size-control` | 13 |
| `palette-drift` | 6 |
| `console-error` | 3 |
| `llm-infra` | 2 |
| `request-failed` | 2 |

## Counts per dimension per surface

| Surface | bug | ui | responsive | color-theme | consistency | network | permission | real-infra | 🔴 | 🟡 | ⚪ | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `settings-mcp-servers` |  | 4 |  |  |  | 34 |  |  | 14 | 6 | 18 | 38 |
| `settings-user (flow-level)` | 4 |  |  |  |  | 8 |  |  | 4 | 6 | 2 | 12 |
| `(preflight) (flow-level)` |  |  |  |  |  |  |  | 2 | 2 |  |  | 2 |
| `home (flow-level)` | 1 |  |  |  |  | 9 |  |  | 1 | 7 | 2 | 10 |
| `settings-general` |  | 4 |  | 6 |  | 5 |  |  |  | 5 | 10 | 15 |
| `settings-root` |  | 4 |  |  |  | 7 |  |  |  | 6 | 5 | 11 |
| `settings-profile` |  | 4 |  |  |  | 7 |  |  |  | 6 | 5 | 11 |
| `settings-memory` |  | 4 |  |  |  | 7 |  |  |  | 6 | 5 | 11 |
| `settings-workflows` |  | 4 |  |  |  | 6 |  |  |  | 6 | 4 | 10 |
| `settings-citations` |  | 4 |  |  |  | 6 |  |  |  | 6 | 4 | 10 |
| `settings-web-search-keys` |  | 4 |  |  |  | 6 |  |  |  | 6 | 4 | 10 |
| `settings-assistants` |  | 4 |  |  |  | 5 |  |  |  | 5 | 4 | 9 |
| `settings-user-llm-providers` |  | 4 |  |  |  | 5 |  |  |  | 5 | 4 | 9 |
| `settings-skills` |  | 4 |  |  |  | 5 |  |  |  | 5 | 4 | 9 |
| `settings-literature-keys` |  | 4 |  |  |  | 5 |  |  |  | 5 | 4 | 9 |
| `home` |  | 4 |  |  |  |  |  |  |  | 1 | 3 | 4 |

## Top 20 most-actionable

| # | Sev | Dimension | Surface | Signal | Cells |
|---|---|---|---|---|---|
| 1 | 🔴 | bug | `home (flow-level)` | Failed to load resource: the server responded with a status of 429 (Too Many Requests) | 1 |
| 2 | 🔴 | bug | `settings-user (flow-level)` | Failed to load resource: the server responded with a status of 429 (Too Many Requests) | 1 |
| 3 | 🔴 | bug | `settings-user (flow-level)` | Failed to load resource: net::ERR_NETWORK_CHANGED | 1 |
| 4 | 🔴 | bug | `settings-user (flow-level)` | GET http://127.0.0.1:1547/assets/FileViewPage-C0Ig3kBk.js — net::ERR_NETWORK_CHANGED | 1 |
| 5 | 🔴 | bug | `settings-user (flow-level)` | GET http://127.0.0.1:1547/assets/SandboxSettingsPage-t39OpXi4.js — net::ERR_NETWORK_CHANGED | 1 |
| 6 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/50cb1ed0-b0ea-4782-bd32-18990c993804 → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 7 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/8202bb60-fab9-4c52-98c4-7b61f01b0ef4 → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 8 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/17ecff14-c7c3-4130-899e-c405fc510138 → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 9 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/2c570edd-c9d1-42a5-b77b-5ac3e42eae58 → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 10 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/5719624c-a12c-441f-977d-d066f8c9c203 → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 11 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/5e2e6f63-b843-4fc8-b48e-0c0e3f297464 → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 12 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/ca451c7a-b61f-45af-a7f5-6c2995034823 → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 13 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/0a1fccac-5e9a-42f5-a668-923685ac0785 → net::ERR_NETWORK_CHANGED (212ms) | 1 |
| 14 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/7a131c68-535d-44ee-8572-48d56aea2542 → net::ERR_NETWORK_CHANGED (212ms) | 1 |
| 15 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/95ca7f56-6f7a-41fd-8165-d2b7502f99c8 → net::ERR_NETWORK_CHANGED (212ms) | 1 |
| 16 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/e8120ee5-373f-4dba-9792-e9e5a1ca585a → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 17 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/ee88219b-e506-4ed2-868b-2e276b2d445a → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 18 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects/by-conversation/d84feeb1-36f7-42de-8567-7d8743f86569 → net::ERR_NETWORK_CHANGED (211ms) | 1 |
| 19 | 🔴 | network | `settings-mcp-servers` | network failure: GET /api/projects → net::ERR_NETWORK_CHANGED (189ms) | 1 |
| 20 | 🔴 | real-infra | `(preflight) (flow-level)` | STREAMING UNAVAILABLE for the driving user "admin": /api/chat/stream → 429 before any audit load. Generative flows cannot receive a reply as this user; any chat surface audited in this run i | 1 |

## Full inventory — grouped by dimension, then surface

# Dimension: bug (5)

## bug · `settings-user (flow-level)` (4)

### 🔴 HIGH · `console-error`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(console)` at desktop/light

### 🔴 HIGH · `console-error`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** Failed to load resource: net::ERR_NETWORK_CHANGED
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(console)` at desktop/light

### 🔴 HIGH · `request-failed`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** GET http://127.0.0.1:1547/assets/FileViewPage-C0Ig3kBk.js — net::ERR_NETWORK_CHANGED
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(request)` at desktop/light

### 🔴 HIGH · `request-failed`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** GET http://127.0.0.1:1547/assets/SandboxSettingsPage-t39OpXi4.js — net::ERR_NETWORK_CHANGED
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(request)` at desktop/light

## bug · `home (flow-level)` (1)

### 🔴 HIGH · `console-error`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** Failed to load resource: the server responded with a status of 429 (Too Many Requests)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(console)` at desktop/light

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

# Dimension: network (115)

## network · `settings-mcp-servers` (34)

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/50cb1ed0-b0ea-4782-bd32-18990c993804 → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/8202bb60-fab9-4c52-98c4-7b61f01b0ef4 → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/17ecff14-c7c3-4130-899e-c405fc510138 → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/2c570edd-c9d1-42a5-b77b-5ac3e42eae58 → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/5719624c-a12c-441f-977d-d066f8c9c203 → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/5e2e6f63-b843-4fc8-b48e-0c0e3f297464 → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/ca451c7a-b61f-45af-a7f5-6c2995034823 → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/0a1fccac-5e9a-42f5-a668-923685ac0785 → net::ERR_NETWORK_CHANGED (212ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/7a131c68-535d-44ee-8572-48d56aea2542 → net::ERR_NETWORK_CHANGED (212ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/95ca7f56-6f7a-41fd-8165-d2b7502f99c8 → net::ERR_NETWORK_CHANGED (212ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/e8120ee5-373f-4dba-9792-e9e5a1ca585a → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/ee88219b-e506-4ed2-868b-2e276b2d445a → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects/by-conversation/d84feeb1-36f7-42de-8567-7d8743f86569 → net::ERR_NETWORK_CHANGED (211ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🔴 HIGH · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/projects → net::ERR_NETWORK_CHANGED (189ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (63ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (986ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (50cb1ed0-b0ea-4782-bd32-18990c993804, 8202bb60-fab9-4c52-98c4-7b61f01b0ef4, 17ecff14-c7c3-4130-899e-c405fc510138…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 8 sequential dependent /api requests (453ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
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

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/50cb1ed0-b0ea-4782-bd32-18990c993804 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/8202bb60-fab9-4c52-98c4-7b61f01b0ef4 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/17ecff14-c7c3-4130-899e-c405fc510138 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/2c570edd-c9d1-42a5-b77b-5ac3e42eae58 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/5719624c-a12c-441f-977d-d066f8c9c203 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/5e2e6f63-b843-4fc8-b48e-0c0e3f297464 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/ca451c7a-b61f-45af-a7f5-6c2995034823 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/0a1fccac-5e9a-42f5-a668-923685ac0785 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/7a131c68-535d-44ee-8572-48d56aea2542 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/95ca7f56-6f7a-41fd-8165-d2b7502f99c8 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/e8120ee5-373f-4dba-9792-e9e5a1ca585a fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/ee88219b-e506-4ed2-868b-2e276b2d445a fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects/by-conversation/d84feeb1-36f7-42de-8567-7d8743f86569 fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/projects fired 2× within step "settings-mcp-servers" (net::ERR_NETWORK_CHANGED,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-mcp-servers` at desktop/light

## network · `home (flow-level)` (9)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (126ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (62ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
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
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3f60332f-37e8-4e0e-a719-6689c303ecff, 902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** waterfall: 22 sequential dependent /api requests (354ms serial) that could be parallelized — /api/conversations → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff → /api/projects/by-conversation/902f8ffd-0fdf-4363-8d98-0cd7391e0d82 → /api/projects/by-conversation/0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Open app — land on new-chat home (persona: normal)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "(load)" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `home` → step `(load)` at desktop/light

## network · `settings-user (flow-level)` (8)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (100ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/chat/stream → 429 (63ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (55ms)
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

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 15 sequential dependent /api requests (1272ms serial) that could be parallelized — /api/mcp/defaults → /api/llm-models → /api/memory/admin-settings → /api/llm-models
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "(load)" (429,429)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/chat/stream fired 2× within step "(load)" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `(load)` at desktop/light

## network · `settings-root` (7)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (93ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (727ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (67beb314-1bb2-4239-9fec-616f3f43ae9a, 902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 3f60332f-37e8-4e0e-a719-6689c303ecff…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-root` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 13 sequential dependent /api requests (794ms serial) that could be parallelized — /api/sync/subscribe → /api/projects/by-conversation/67beb314-1bb2-4239-9fec-616f3f43ae9a → /api/projects/by-conversation/902f8ffd-0fdf-4363-8d98-0cd7391e0d82 → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff
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

## network · `settings-profile` (7)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (71ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (57ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 67beb314-1bb2-4239-9fec-616f3f43ae9a, 0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-profile` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 10 sequential dependent /api requests (855ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
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

## network · `settings-memory` (7)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (119ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3f60332f-37e8-4e0e-a719-6689c303ecff, 67beb314-1bb2-4239-9fec-616f3f43ae9a, 79f8ab98-1d27-42c7-91ea-f4109fda3696…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 21 sequential dependent /api requests (630ms serial) that could be parallelized — /api/sync/subscribe → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff → /api/projects/by-conversation/79f8ab98-1d27-42c7-91ea-f4109fda3696 → /api/projects/by-conversation/0b4ec2e5-c7d6-4cce-ada0-f6e4ef311ba2
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

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/llm-models fired 2× within step "settings-memory" (200,200)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-memory` at desktop/light

## network · `settings-workflows` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (61ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (979ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (79f8ab98-1d27-42c7-91ea-f4109fda3696, 3d5e26a4-6079-4e9e-a16b-7eef4024f740, 3f60332f-37e8-4e0e-a719-6689c303ecff…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-workflows` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 23 sequential dependent /api requests (765ms serial) that could be parallelized — /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress
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

## network · `settings-citations` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (71ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (1215ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 3f60332f-37e8-4e0e-a719-6689c303ecff, 67beb314-1bb2-4239-9fec-616f3f43ae9a…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-citations` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 24 sequential dependent /api requests (2188ms serial) that could be parallelized — /api/server-update/status → /api/citations → /api/conversations → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff
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

## network · `settings-web-search-keys` (6)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (80ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (858ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3f60332f-37e8-4e0e-a719-6689c303ecff, 67beb314-1bb2-4239-9fec-616f3f43ae9a, 902f8ffd-0fdf-4363-8d98-0cd7391e0d82…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-web-search-keys` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 20 sequential dependent /api requests (397ms serial) that could be parallelized — /api/notifications → /api/web-search/user-keys → /api/conversations → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff
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

## network · `settings-general` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (125ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (67beb314-1bb2-4239-9fec-616f3f43ae9a, 902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 79f8ab98-1d27-42c7-91ea-f4109fda3696…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 16 sequential dependent /api requests (404ms serial) that could be parallelized — /api/server-update/status → /api/llm-models/downloads → /api/conversations → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-general") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-general" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-general` at desktop/light

## network · `settings-assistants` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (111ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (67beb314-1bb2-4239-9fec-616f3f43ae9a, 3f60332f-37e8-4e0e-a719-6689c303ecff, 79f8ab98-1d27-42c7-91ea-f4109fda3696…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-assistants` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 16 sequential dependent /api requests (394ms serial) that could be parallelized — /api/assistants → /api/conversations → /api/projects/by-conversation/67beb314-1bb2-4239-9fec-616f3f43ae9a → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff
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

## network · `settings-user-llm-providers` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (95ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (67beb314-1bb2-4239-9fec-616f3f43ae9a, 902f8ffd-0fdf-4363-8d98-0cd7391e0d82, 3f60332f-37e8-4e0e-a719-6689c303ecff…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 18 sequential dependent /api requests (388ms serial) that could be parallelized — /api/notifications → /api/user-llm-providers/api-keys → /api/user-llm-providers → /api/conversations
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-user-llm-providers") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-user-llm-providers" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-user-llm-providers` at desktop/light

## network · `settings-skills` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (109ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (67beb314-1bb2-4239-9fec-616f3f43ae9a, 79f8ab98-1d27-42c7-91ea-f4109fda3696, 902f8ffd-0fdf-4363-8d98-0cd7391e0d82…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 19 sequential dependent /api requests (432ms serial) that could be parallelized — /api/onboarding/progress → /api/notifications → /api/server-update/status → /api/llm-models/downloads
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-skills") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-skills" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-skills` at desktop/light

## network · `settings-literature-keys` (5)

### 🟡 MEDIUM · `network/failure`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** network failure: GET /api/sync/subscribe → 429 (78ms)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/n+1`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** N+1 pattern: 19 distinct requests to template GET /api/projects/by-conversation/{id} in one step (3f60332f-37e8-4e0e-a719-6689c303ecff, 67beb314-1bb2-4239-9fec-616f3f43ae9a, 79f8ab98-1d27-42c7-91ea-f4109fda3696…)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/waterfall`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** waterfall: 16 sequential dependent /api requests (417ms serial) that could be parallelized — /api/llm-models/downloads → /api/lit-search/user-keys → /api/conversations → /api/projects/by-conversation/3f60332f-37e8-4e0e-a719-6689c303ecff
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### 🟡 MEDIUM · `network/irrelevant`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** irrelevant fetch for this page: GET /api/conversations — "List conversations". Flow "settings-user" (step "settings-literature-keys") has no use for the `conversations` domain; likely eager over-fetch of unrelated data.
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

### ⚪ LOW · `network/duplicate`
- **JTBD:** Configure user-scoped settings (persona: normal)
- **Signal:** duplicate request: GET /api/sync/subscribe fired 2× within step "settings-literature-keys" (429,net::ERR_ABORTED)
- **Cells (viewport/theme):** desktop/light
- **Repro:** login admin → flow `settings-user` → step `settings-literature-keys` at desktop/light

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
