# REPRO — observed BEFORE evidence

Both defects are reproduced here **before** any fix, so the red→green transition
is attributable.

---

## §2 kit combobox addon overflow (measured first — no build needed)

Gallery served from this worktree, backend-free:

```
cd /data/pbya/ziee/tmp/wfresid-wt/src-app/ui
CHOKIDAR_USEPOLLING=1 npx vite --port 5397 --strictPort
```

(`CHOKIDAR_USEPOLLING=1` because this box's `fs.inotify.max_user_instances` is
128 and ~20 sibling worktrees hold vite watchers — a plain start dies with
`EMFILE: too many open files, watch …`. It is a watcher-transport choice only.)

Probe (throwaway, run from `src-app/ui` so `@playwright/test` resolves): for every
`[data-slot="input-group"]` on `/gallery.html?theme=light&accent=blue`, report
`scrollWidth - clientWidth` and the inline-end addon's right edge relative to the
group's border box.

### BEFORE — 390 × 844

```
total input-groups: 9   overflowing(>1): 9
{ "over": 5, "scrollWidth": 227, "clientWidth": 222,
  "groupRight": "265.00", "addonRight": "268.80", "pastBorder": 3.8,
  "label": "gallery-case-combobox-default" }
… identical `over: 5 / pastBorder: 3.8` on all 9 groups
  (gallery-case-combobox-default ×2, filerag-rerank-form, memory-semantic-form,
   memory-extraction-form, summ-settings-form, …)
```

### BEFORE — 1280 × 900

```
total input-groups: 9   overflowing(>1): 9
{ "over": 5, "pastBorder": 3.8, … }   # identical
```

So the overflow is **not** a breakpoint effect: the negative margin
(`has-[>button]:mr-[-0.3rem]` = −4.8px) puts the addon's border box 3.8px past the
group's border box at every width. `over` reads 5 rather than 3.8 because
`clientWidth` excludes the group's 1px borders.

AFTER measurements are recorded in `TEST_RESULTS.md` (TEST-7 is the permanent
form of this probe).

---

## §1 validate-green / run-red split

Recorded in `TEST_RESULTS.md` and `DRIFT-1.md`: the red-first run of TEST-1
(the agreement matrix) against unmodified `validate.rs` + `dispatch.rs`.
