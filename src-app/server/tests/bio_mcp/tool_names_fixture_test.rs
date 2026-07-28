//! TEST-34 — the committed BioMCP `tools/list` fixture (DEC-10 / ITEM-28).
//!
//! `bio_mcp/handlers.rs` is a pure reverse proxy, so no bio tool name exists in
//! the tree; the names arrive from the external sidecar at runtime. DEC-10's
//! resolution is to probe a live sidecar ONCE, commit what it returned as a
//! fixture, and derive the frontend rail contribution from that — which keeps
//! the contribution testable offline (a live-probe-at-test-time would not).
//!
//! These assertions pin the fixture's CONTRACT — parses, non-empty names, no
//! duplicates — so a re-probe after a `BIOMCP_VERSION` bump cannot land a
//! malformed or ambiguous list. They deliberately do NOT assert a specific tool
//! name or count: that would freeze an external vendor's surface into ziee's
//! test suite, and any name the fixture omits already degrades to a name-only
//! rail row (ITEM-6).

use std::collections::HashSet;

const FIXTURE: &str = include_str!("tool_names_fixture.json");

fn tool_names() -> Vec<String> {
    let doc: serde_json::Value =
        serde_json::from_str(FIXTURE).expect("tool_names_fixture.json must be valid JSON");
    doc.get("tools")
        .and_then(|t| t.as_array())
        .expect("fixture must carry a `tools` array")
        .iter()
        .map(|t| {
            t.get("name")
                .and_then(|n| n.as_str())
                .expect("every fixture tool must carry a string `name`")
                .to_string()
        })
        .collect()
}

/// The fixture parses and describes a non-empty tool surface.
#[test]
fn fixture_parses_and_is_non_empty() {
    let names = tool_names();
    assert!(
        !names.is_empty(),
        "the fixture must list at least one observed tool — an empty list would \
         silently disable the bio rail contribution"
    );
}

/// Every observed name is a usable tool id: non-empty and untrimmed-whitespace-free.
/// A blank name would produce a rail row with no label at all.
#[test]
fn fixture_names_are_non_empty() {
    for name in tool_names() {
        assert!(
            !name.trim().is_empty(),
            "fixture tool name must not be blank"
        );
        assert_eq!(
            name.trim(),
            name,
            "fixture tool name '{name}' has leading/trailing whitespace — it would \
             never match the wire tool name"
        );
    }
}

/// Names are unique. Two entries with the same name would make the frontend's
/// name→label lookup ambiguous (last-wins) with no way to tell which is right.
#[test]
fn fixture_names_are_unique() {
    let names = tool_names();
    let mut seen: HashSet<&str> = HashSet::new();
    for name in &names {
        assert!(
            seen.insert(name.as_str()),
            "duplicate tool name '{name}' in tool_names_fixture.json"
        );
    }
    assert_eq!(seen.len(), names.len());
}

/// The probe metadata is recorded honestly: the fixture states whether the live
/// sidecar probe actually ran. A fixture claiming `ran: false` must say why, so a
/// reader can tell "observed" from "assumed" without digging through history.
#[test]
fn fixture_records_probe_provenance() {
    let doc: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    let probe = doc
        .get("probe")
        .expect("fixture must record how its names were obtained");
    let ran = probe
        .get("ran")
        .and_then(|v| v.as_bool())
        .expect("probe.ran must be a bool");
    if ran {
        assert!(
            probe.get("server_info").is_some(),
            "a probe that ran must record the sidecar's serverInfo"
        );
    } else {
        assert!(
            probe
                .get("failure_reason")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.trim().is_empty()),
            "a probe that did NOT run must record a non-empty `failure_reason`"
        );
    }
}
