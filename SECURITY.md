# Security Policy

## Supported versions

| Version | Supported |
|--------|----|
| 0.1.x  | ✅ |
| 0.0.x  | ❌ scaffold only |

## Reporting a vulnerability

**Please do not open a public issue for security problems.** Use GitHub's
private security advisory channel:

→ https://github.com/SysAdminDoc/TsunamiSimulator/security/advisories/new

Include:

- A description of the vulnerability and its impact.
- The version (`v0.x.y`) and platform (Win/macOS/Linux) you found it on.
- Steps to reproduce or a proof of concept.
- Any suggested mitigation.

I'll acknowledge within 7 days and try to ship a fix within 30 days for
exploitable issues.

## What's in scope

- Code-execution / privilege-escalation via the Tauri runtime, IPC
  commands, or `shell:allow-open` allowlist bypass.
- Settings store leakage (e.g. Cesium ion tokens being readable outside
  the user's `app_data_dir`).
- CSP / WebView sandbox escape.
- Malicious preset / deep-link payloads.
- Supply-chain risk in pinned npm / Cargo dependencies (please prefer
  filing via [GitHub Dependabot alerts](https://github.com/SysAdminDoc/TsunamiSimulator/security/dependabot)
  if the vuln is published in an advisory database).

## What's NOT in scope

- Cesium ion token quota exhaustion (free-tier limit) — that's a UX issue,
  please open a regular bug.
- Inaccurate physics predictions — those are scientific issues, please open
  a `Physics correctness` issue.
- DoS from supplying absurd scenario parameters (we already clamp inputs,
  but if you find a regression in clamping, that's an in-scope bug).

## Trust signals

This project is for **education and hazard awareness only** and explicitly
must not be used for evacuation decisions. The first-run disclaimer surfaces
that in-app. If a security claim weakens that posture (for example, by making
the app appear authoritative to users), we treat it as a security-grade
trust issue.
