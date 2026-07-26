# DESIGN_FIDELITY — background-in-conversation

One verdict per `INV-N` in `PLAN.md` § Invariants, against `DESIGN.md` §1–§3.

- **INV-1** — fidelity: UPHELD — the plan puts a conversation's sub-agents in
  exactly the two surfaces the design names and nowhere else: ITEM-5 is the
  right-panel "Tasks" tab, ITEM-6 the end-of-conversation footer that opens it, and
  ITEM-7 binds both to the conversation via the chat-extension seam (panel renderer
  + `message_list_footer`), pane-scoped so the tab opens in the pane the user
  clicked. The scheduled-task half of the disjunction is upheld by NOT touching the
  Scheduled Tasks run history — it remains that owner's surface — and by ITEM-2
  making conversation-bound runs invisible to the unfiltered list, so the two
  scopes cannot double-report the same run. Pinned by TEST-9 (`[acceptance]`),
  which proves conversation A's run appears in A's Tasks panel via the footer AND
  does not appear in conversation B's.
- **INV-2** — fidelity: UPHELD — ITEM-9 deletes the "Background tasks"
  `sidebarNavigation` entry AND its `/background-tasks` route AND the now-orphaned
  page; ITEM-10 deletes the `agent-inbox` "Background results" `sidebarNavigation`
  entry. The design's stated replacement — "results surface via the central
  notification bell, whose click navigates to the conversation" — is preserved
  because ITEM-10 explicitly keeps the `sidebarBottom` bell widget and the
  `/notifications/background` deep-link route that the bell targets; only the nav
  chrome goes. Pinned by TEST-10 (`[acceptance]`), which asserts absence for an
  ADMIN holding `*` — so the absence is proven to be by design, not a permission
  filter (a test that only checked a restricted user would pass even if the entries
  were merely gated, and would therefore prove nothing about this invariant).
- **INV-3** — fidelity: UPHELD — ITEM-1 adds the `conversation_id` query param and
  ITEM-2 implements literally the two-state disjunction the design states:
  `(($n::uuid IS NULL AND conversation_id IS NULL) OR conversation_id = $n)`,
  applied to the list AND the count query so `total` cannot contradict the page.
  Pinned by TEST-3 (`[acceptance]`), which asserts BOTH directions of the
  disjunction (unfiltered ⇒ conversation-less only; filtered ⇒ that conversation
  only) — it would fail if the filter degraded to the common "ignore NULL when the
  param is absent" form, which is the exact way this invariant would get silently
  reframed.
