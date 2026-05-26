# ClearRate — Hospital Price Transparency Explorer

A browser-based tool for comparing hospital negotiated rates at the payer, plan, and billing code level — built to the CMS Hospital Price Transparency rule (45 CFR 180.50).

---

## What It Does

 The goal is to let payer contracting leads and healthcare analysts quickly answer questions like:

- What is Aetna HMO/PPO paying vs. Blue Shield HMO/PPO for HCPCS code 45378 at Stanford vs. UCSF?
- Which payers use a percentage of Medicare vs. a fixed dollar rate for a given DRG?
- How does the negotiated rate for a service compare across inpatient vs. outpatient settings?

No backend required. All parsing and filtering runs in the browser.

---

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Upload one or more `.csv` or `.json` MRF files, select a billing class and setting, then search by billing code.

**Other commands:**

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server with hot reload |
| `npm run build` | Compile production bundle to `dist/` |
| `npm run preview` | Serve the compiled `dist/` build locally |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Parsing | PapaParse (streaming CSV) |
| Data | CMS MRF v3.0.0 — CSV and JSON |
| Styling | Inline styles, no CSS framework |

Everything runs client-side. No server, no database, no build-time data.

---

## Supported File Formats

ClearRate handles all three CMS MRF file shapes found in the wild:

| Format | Example hospitals | Detection |
|---|---|---|
| **Tall CSV** | Sutter Davis, NorthBay | `payer_name` column present — one row per payer/service |
| **Wide CSV (bracket ID)** | Stanford | Column headers like `standard_charge\|Aetna [10200]\|Aetna\|negotiated_dollar` |
| **Wide CSV (no bracket)** | UCSF | Column headers like `standard_charge\|Blue Shield\|Hmo/Pos\|negotiated_dollar` |
| **JSON** | Any CMS MRF v3.0.0 JSON | Detected by file content, not extension |

Format is detected automatically at parse time. Up to 3 hospitals can be loaded simultaneously.

### CSV structure (CMS MRF v3.0.0)

| Row | Content |
|---|---|
| Row 1 | Metadata keys (`hospital_name`, `type_2_npi`, `last_updated_on`, …) |
| Row 2 | Metadata values |
| Row 3 | Column headers |
| Rows 4+ | One data row per service × payer/plan combination |

---

## Using the App

### Step 1 — Upload files

Drop one or more `.csv` or `.json` MRF files onto the upload zone, or paste a direct URL. The parser streams large files to avoid memory pressure. Each file shows its hospital name, NPI, last-updated date, and row count once parsed.

### Step 2 — Select billing class and setting

Before searching, choose:

- **Billing class** — Facility (UB-04, institutional claims) or Professional (CMS-1500, physician claims). Rates differ significantly between the two.
- **Setting** — Inpatient (IP) or Outpatient (OP). This also determines which code types are available to filter on.

### Step 3 — Search by billing code

Enter a billing code in the search bar. All four code columns in the MRF are checked — a match on any one returns the row. Results are filtered to the selected billing class and setting.

**Code type filters by setting:**

| Setting | Available code types |
|---|---|
| Inpatient (IP) | MS-DRG, Revenue Code |
| Outpatient (OP) | HCPCS / CPT, APC, Revenue Code |

### Step 4 — Compare results

**Single hospital:** Results appear as a table sorted by payer name, showing rate, setting, billing class, and methodology.

**Two or three hospitals:** Results appear as a pivot table — payer/plan pairs as rows, hospitals as columns. Each hospital column has a distinct accent color. Rates that don't exist at a given hospital show `—`.

---

## Rate Display

Each negotiated rate falls into exactly one of three types:

| Type | Display | Color |
|---|---|---|
| Dollar amount | `$3,456.00` | Green |
| Percentage of Medicare | `142% of Medicare` | Amber |
| Algorithm / formula | Full algorithm text, block-formatted | Hospital accent color |

Percentage-based rates are **never converted to dollars**. A contracting lead comparing hospitals needs to see `120% of Medicare vs. 150% of Medicare` directly — resolving to a dollar amount requires the Medicare base rate, inclusive of geographical / DSH / IME adjustments.

---

## Source Citations

Every rate badge shows its source row number directly below it in small monospace text. Hovering that label reveals the exact column header from the CSV (e.g. `standard_charge|Blue Shield|Hmo/Pos|negotiated_dollar`), so any value can be verified against the raw file without guessing.

- **CSV files:** absolute 1-indexed line number (row 4 = first data row)
- **JSON files:** `item N, payer M` index path within `standard_charge_information`

---

## Data Model

### Key columns

| Column | Description |
|---|---|
| `description` | Plain-language service name |
| `code\|1` – `code\|4` | Billing codes (up to 4 per row, different coding systems) |
| `code\|1\|type` – `code\|4\|type` | Code type: HCPCS, APC, MS-DRG, RC, NDC, CDM |
| `modifiers` | CPT/HCPCS modifier(s), e.g. `25`, `50`, `LT,RT` |
| `setting` | `inpatient`, `outpatient`, or `both` |
| `billing_class` | `facility` or `professional` |
| `payer_name` | Insurance company |
| `plan_name` | Specific plan within the payer |
| `standard_charge\|gross` | Full undiscounted list price |
| `standard_charge\|discounted_cash` | Self-pay / uninsured cash price |
| `standard_charge\|negotiated_dollar` | Contracted dollar amount |
| `standard_charge\|negotiated_percentage` | Contracted rate as % of Medicare |
| `standard_charge\|negotiated_algorithm` | Formula-based rate reference |
| `standard_charge\|methodology` | `fee schedule` or `other` |
| `standard_charge\|min` / `\|max` | Rate range across all payers for this service |

### Billing code hierarchy

Each row can carry up to four codes from different systems. All codes on the same row are cross-references to the same service.

| Code type | Description | Role |
|---|---|---|
| HCPCS / CPT | Standardized procedure code | **Primary** — drives negotiated rates |
| APC | Ambulatory Payment Classification | **Primary** — outpatient grouping |
| MS-DRG | Medicare Severity DRG | **Primary** — inpatient grouping |
| RC | Revenue Code (UB-04) | **Context** — site of service; may split rates |
| NDC | National Drug Code | **Detail** — drug formulation/manufacturer |
| CDM | Hospital charge master ID | **Suppressed** — internal only, not shown |

---

## Filtering Logic

| Filter | Behavior |
|---|---|
| Billing class | Rows with no `billing_class` value are included as a safe fallback |
| Setting | `inpatient` and `outpatient` are exclusive. Rows tagged `both` appear in either view |
| Code type | Filters to rows where the searched code matches a column of the selected type |
| Payer | Results remain at `payer_name + plan_name` granularity — never aggregated |

---

## Edge Cases & Design Decisions

### RC + HCPCS on the same row

When a row has both a Revenue Code and a HCPCS, the negotiated rate is driven by the HCPCS. The RC is a billing classifier, not a pricing key — **except** when the same HCPCS appears with different RCs and different negotiated amounts (a payer carve-out by site of service). In that case, each RC generates a separate row in the UI.

### Wide-format column parsing

Stanford's MRF uses two column subtypes that require different payer/plan assignment:

- **Type A (bracket ID):** `standard_charge|Aetna Choice POS [10270]|Aetna|negotiated_dollar` — `m[2]` is the payer, `m[1]` stripped of the ID is the plan
- **Type B (no bracket):** `standard_charge|Aetna|All Commercial Plans|negotiated_dollar` — `m[1]` is the payer, `m[2]` is the plan

UCSF uses Type B exclusively. Detection is by presence of a `[\d+]` bracket in `m[1]`.

### Plan name normalization

Plan name strings vary in capitalization and formatting across hospitals. Normalization is applied at load time:

| Raw values | Normalized |
|---|---|
| `HMO/PPO`, `Hmo/Ppo`, `HMO / PPO` | `HMO/PPO` |
| `Medicare Adv_ HMO / PPO` | `Medicare Advantage HMO/PPO` |
| `Medi-Cal` | `Medi-Cal` |

### CDM suppression

CDM codes are internal hospital charge master identifiers. They are stripped from all display — they never appear in payer contracts and add noise to search results.
