# Hospital Price Transparency Explorer

A tool for comparing hospital standard charges at the payer, plan, and billing code level — built to the CMS Hospital Price Transparency rule (45 CFR 180.50).

---

## Overview

This project started as an iterative prototype in claude.ai and is being migrated to a production application. The goal is to let payer contracting leads and healthcare analysts quickly answer questions like:

- What is Aetna HMO/PPO paying vs. Blue Shield HMO/PPO for HCPCS code 10005 at Sutter Davis Hospital?
- Which payers use a percentage of Medicare vs. a fixed dollar rate for a given DRG?
- How does the negotiated rate for a service compare across inpatient vs. outpatient settings?

**Current status:** UI prototype validated. Migrating to production stack (React + Vite + DuckDB).

---

## Production Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React + Vite | Component code carries over 1:1 from the claude.ai artifact |
| Backend | DuckDB | Reads CSVs directly; analytical queries across multiple hospital files |
| API | Express or FastAPI | Serves query results to the React frontend |
| Data | CMS MRF CSVs | One file per hospital, version 3.0.0 format |

---

## Data Model

Source files follow the CMS machine-readable file (MRF) format. Each file has:

- **Row 1–2:** Hospital metadata (name, NPI, license, attestation)
- **Row 3:** Column headers
- **Rows 4+:** One row per service × payer/plan combination

### Key columns

| Column | Description |
|---|---|
| `description` | Plain-language service name |
| `code\|1` – `code\|4` | Billing codes (up to 4 per row, different coding systems) |
| `code\|1\|type` – `code\|4\|type` | Code type for each code (HCPCS, APC, MS-DRG, RC, NDC, CDM) |
| `modifiers` | CPT/HCPCS modifier(s), e.g. `25`, `50`, `LT,RT` |
| `setting` | `inpatient`, `outpatient`, or `both` |
| `billing_class` | `facility` or `professional` |
| `payer_name` | Insurance company |
| `plan_name` | Specific plan within the payer |
| `standard_charge\|gross` | Full undiscounted list price |
| `standard_charge\|discounted_cash` | Self-pay / uninsured cash price |
| `standard_charge\|negotiated_dollar` | Contracted dollar amount (payer-specific) |
| `standard_charge\|negotiated_percentage` | Contracted rate as % of a base (e.g. Medicare) |
| `standard_charge\|negotiated_algorithm` | Formula-based rate reference |
| `standard_charge\|methodology` | `fee schedule` or `other` |
| `standard_charge\|min` / `\|max` | Range across all payers for this service |
| `median_amount` | Median negotiated amount |
| `10th_percentile` / `90th_percentile` | Distribution stats |

---

## Billing Code Hierarchy

Each row can carry up to four codes from different coding systems. This is a **cross-reference system** — all codes on the same row point to the same service.

### Code types in scope

| Type | Description | Role |
|---|---|---|
| HCPCS / CPT | Standardized clinical procedure code | **Primary** — drives negotiated rates in contracts |
| APC | Ambulatory Payment Classification | **Primary** — outpatient grouping |
| MS-DRG | Medicare Severity DRG | **Primary** — inpatient grouping |
| RC | Revenue Code (UB-04) | **Context** — site of service; may split rates |
| NDC | National Drug Code | **Detail** — drug formulation/manufacturer |
| CDM | Hospital internal charge master ID | **Suppressed** — internal only, not displayed |

### Display hierarchy

```
HCPCS / APC / MS-DRG          ← primary search and display key
  └── Revenue Code (RC)        ← shown as context; separate row only when rates differ
        └── NDC                ← expandable detail for drugs (collapsed by default)
```

### Multi-code search behavior

When a user searches by code, all four code columns are checked. A match on any column returns the row.

---

## Charge Type Display

The three negotiated charge columns are mutually exclusive — a row populates exactly one:

| Column | Display |
|---|---|
| `negotiated_dollar` | `$3,456.00` |
| `negotiated_percentage` | `142% of Medicare` (shown verbatim — enables direct cross-hospital comparison) |
| `negotiated_algorithm` | `Algorithm (fee schedule)` with a note that the dollar amount is contract-dependent |

Percentage-based rates are **never converted to dollars** in the UI. A contracting lead comparing hospitals needs to see `120% of Medicare vs. 150% of Medicare` directly.

---

## Filtering Logic

| Filter | Behavior |
|---|---|
| Setting | `inpatient`, `outpatient`, `both` are independent options. Rows where `setting = 'both'` appear **only** when "Both" is explicitly selected — not in the inpatient or outpatient filtered views. |
| Payer | Filters to rows where `payer_name` matches. Results remain at `payer_name + plan_name` granularity — never aggregated. |
| Code type | Filters to rows containing at least one code of the selected type across any of the four code columns. |
| Modifier | Surfaced as a visible field alongside the billing code. Not merged into the code string. |

---

## Edge Cases & Design Decisions

### RC + HCPCS on the same row

When a row has both a Revenue Code and a HCPCS, the negotiated rate is driven by the HCPCS. The RC is a billing classifier, not a pricing key — **except** when the same HCPCS appears with different RCs and different negotiated amounts (a payer carve-out by site of service). In that case, each RC generates a separate row in the UI.

### HCPCS + NDC (drug pricing)

When multiple NDCs exist under the same HCPCS (e.g., brand vs. generic), they are grouped under the HCPCS as a parent row and are expandable on demand.

### CDM codes

CDM codes are suppressed from all UI display. They are internal hospital identifiers that never appear in payer contracts.

### Plan name normalization

Plan name strings vary in capitalization and formatting across payers in the source file. The following normalization is applied at load time:

| Raw values | Normalized |
|---|---|
| `HMO/PPO`, `Hmo/Ppo`, `HMO / PPO`, `Hmo / Ppo` | `HMO/PPO` |
| `Medicare Adv_ HMO / PPO`, `Medicare Adv_ Hmo / Ppo` | `Medicare Advantage HMO/PPO` |
| `Medi-Cal` | `Medi-Cal` |
| `Individual` | `Individual` |

---

## Multi-Hospital Support (Planned)

The tool is designed to support side-by-side comparison across hospitals. Conventions established for the production build:

- Hospital identity is carried by `hospital_name` and `type_2_npi` from the metadata rows of each file.
- When multiple files are loaded, results are grouped by hospital.
- Percentage-based rates are displayed as-is to enable direct cross-hospital comparison without resolving the Medicare base.
- DuckDB schema: `hospital` is a dimension column, enabling queries like:

```sql
SELECT hospital_name, payer_name, plan_name, standard_charge_negotiated_dollar
FROM charges
WHERE code_1 = '10005'
  AND setting = 'outpatient'
ORDER BY hospital_name, payer_name;
```

---

## Migration: Prototype → Production

### What the prototype validated

- Billing code hierarchy (HCPCS → RC → NDC)
- Charge type display (dollar / percentage / algorithm)
- Setting filter behavior (`both` opt-in)
- Payer + plan granularity
- CDM suppression
- Multi-code search across all four code columns

### What changes in production

| Prototype (claude.ai artifact) | Production (Claude Code) |
|---|---|
| Data loaded in-memory from uploaded CSV | DuckDB reads CSVs directly from disk |
| ~200–8,800 records in JS memory | Unlimited rows, multi-hospital |
| No persistence across sessions | Query results via API layer |
| React component code inline in HTML | React + Vite project (same component code) |

### Migration prompt for Claude Code

When the UI is finalized, paste this into Claude Code:

```
I have a React price transparency UI built as a claude.ai artifact. 
Scaffold a Vite + DuckDB project around it.

Schema: CMS MRF v3.0.0 (skip rows 1–2, headers on row 3).
Key columns: description, code|1–4, code|1|type–code|4|type, modifiers,
setting, billing_class, payer_name, plan_name,
standard_charge|gross, standard_charge|discounted_cash,
standard_charge|negotiated_dollar, standard_charge|negotiated_percentage,
standard_charge|negotiated_algorithm, standard_charge|methodology,
standard_charge|min, standard_charge|max, median_amount.

Replace the hardcoded JS data array with a /api/search endpoint 
that queries DuckDB. Support filters: code (search all 4 code columns),
setting, payer_name, code type.

CDM codes are suppressed from display.
Percentage rates are shown verbatim (e.g. "142% of Medicare").
Setting "both" appears only when explicitly selected.
Results at payer_name + plan_name granularity.
```

---

## Open Questions

| Question | Status |
|---|---|
| Should `% of Medicare` rates optionally resolve to a dollar amount using the CMS fee schedule? | Deferred to v2 |
| When multiple NDCs exist under one HCPCS, group by drug name or list individually? | Deferred — depends on name standardization across hospitals |
| Add a code type selector to the search bar to prevent false-positive matches? | Revisit after v1 user testing |
| Export filtered results to CSV / Excel? | Planned for v2 (trivial with DuckDB) |
| Include professional billing alongside facility billing? | Planned for v2 |

---

## Initial Hospital

| Field | Value |
|---|---|
| Hospital | Sutter Davis Hospital |
| NPI | 1770532608 |
| File updated | 2026-04-01 |
| Format version | 3.0.0 |
| Total data rows | 41,736 |
| Grouped service records | 8,800 |
| Payers | Aetna, Anthem, Blue Shield, Central Health Plan, Cigna, Health Net, United |

---

*This document is the source of truth for design decisions made during the iterative prototype phase. Update it whenever a new assumption is locked in.*
