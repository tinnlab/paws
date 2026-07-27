# HUMAN_FEEDBACK

No human feedback received yet — the feature is awaiting human review.

## Author-surfaced finding requiring a human decision (per the audit-vs-premise rule)

The task's stated premise was that the ~16 render specs fail SOLELY due to a
static-chunk-drop in `vite preview` (`highlighted-body-*.js`), and that a
serving fix would make them pass 10×/10 under load. Reproducing literally
(B9) established:

1. The static-chunk-drop IS real and IS fixed by this change — BASE drops 60–75
   concurrent lazy chunks serving html-iframe-render at `--workers=1`; NEW drops
   0. (Evidence in TEST_RESULTS.md.)
2. BUT the target specs still fail on NEW (with 0 drops) because of a SEPARATE,
   pre-existing product bug — streamdown v2 `plugins.renderers`/`code` do not
   apply (```html → plain `code-block`, not `html-block`; shiki colors absent) —
   plus one stale KaTeX test (asserts no-math while the app wires math). Both
   reproduce on BASE, independent of this change and of chunk delivery.

**Decision needed from the human:** whether to (a) land this serving fix as-is
(it achieves the render-serving robustness goal and does not regress anything —
16-smart-loading 3/3, chat-basic 6/7, npm check green), and (b) open a separate
follow-up for the chat-render product bug (streamdown-plugin application) +
the stale KaTeX assertion, which are outside the "render-serving" scope this
task defined ("NOT product bugs"). This is surfaced, not silently reversed.
