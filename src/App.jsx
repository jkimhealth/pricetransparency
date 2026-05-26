import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Papa from "papaparse";

// ── Design tokens ─────────────────────────────────────────────────────────────

const T = {
  bg:      "#fafafa",
  surface: "#ffffff",
  border:  "#e4e4e7",
  text:    "#18181b",
  muted:   "#71717a",
  subtle:  "#a1a1aa",
  light:   "#f4f4f5",
  dollar:  { bg: "#f0fdf4", fg: "#16a34a", border: "#bbf7d0" },
  pct:     { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
  algo:    { bg: "#f5f3ff", fg: "#7c3aed", border: "#ddd6fe" },
};

const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Code types available per setting — RC appears in both (carve-outs in IP; site-of-service in OP)
const CODE_TYPES_IP = [
  { id: "all",    label: "All" },
  { id: "MS-DRG", label: "MS-DRG" },
  { id: "RC",     label: "Revenue Code" },
];

const CODE_TYPES_OP = [
  { id: "all",    label: "All" },
  { id: "HCPCS",  label: "HCPCS / CPT" },
  { id: "APC",    label: "APC" },
  { id: "RC",     label: "Revenue Code" },
];

// One accent per hospital column — chosen to avoid clashing with rate-type colors
// (green=dollar, amber=pct, purple=algo)
const HOSP_COLORS = [
  { fg: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" }, // blue
  { fg: "#0f766e", bg: "#f0fdfa", border: "#99f6e4" }, // teal
  { fg: "#9f1239", bg: "#fff1f2", border: "#fecdd3" }, // rose
];

// ── Parsing helpers ────────────────────────────────────────────────────────────

function normalizePlan(raw = "") {
  const s = raw.trim();
  const l = s.toLowerCase().replace(/[\s_]+/g, " ");
  if (l.includes("medicare adv")) return "Medicare Advantage HMO/PPO";
  if (l === "medi-cal") return "Medi-Cal";
  if (/hmo\s*\/\s*ppo/.test(l)) return "HMO/PPO";
  return s || raw;
}

function parseRate(row) {
  const dollar = row["standard_charge|negotiated_dollar"];
  const pct    = row["standard_charge|negotiated_percentage"];
  const algo   = row["standard_charge|negotiated_algorithm"];
  const source = { row: row.__sourceRow, col: row.__sourceCol };
  if (dollar) {
    const n = parseFloat(dollar);
    if (!isNaN(n)) return {
      type: "dollar",
      display: "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      raw: dollar, source,
    };
  }
  if (pct)  return { type: "pct",  display: `${pct}% of Medicare`, raw: pct,  source };
  if (algo) return { type: "algo", display: "Algorithm",            raw: algo, source };
  return null;
}

// Peek at the first 512 bytes to decide CSV vs JSON
async function detectFormat(file) {
  const buf  = await file.slice(0, 512).arrayBuffer();
  const text = new TextDecoder().decode(buf).replace(/^﻿/, "").trimStart();
  return (text.startsWith("{") || text.startsWith("[")) ? "json" : "csv";
}

// ── CSV streaming parser (CMS MRF v3.0.0 CSV) ────────────────────────────────
// Handles both tall format (one row per payer, `payer_name` column present)
// and wide format (one row per service, payer data encoded in column headers).
// Processes one row at a time — never holds the full file in memory.

function parseCsvStreaming(file) {
  return new Promise((resolve, reject) => {
    let phase = "metaKeys"; // metaKeys → metaVals → headers → data
    let colIdx = {};
    let hospitalName = "", lastUpdated = "", npi = "";
    let rowCount = 0, payerRowCount = 0;
    let csvRowNum = 0; // absolute 1-indexed CSV line number (row 1=metaKeys, 2=metaVals, 3=headers, 4+=data)
    let isTallFormat = true;
    let payerCols = []; // wide format: [{payer, plan, dollarIdx, pctIdx, algoIdx, methodIdx, dollarCol, pctCol, algoCol}]
    const codeIndex = new Map();
    const descMap   = new Map();

    const get = (row, col) => (colIdx[col] !== undefined ? row[colIdx[col]] || "" : "").trim();

    Papa.parse(file, {
      skipEmptyLines: true,
      step: ({ data: row, errors }) => {
        csvRowNum++;
        if (errors.length) return;

        if (phase === "metaKeys") {
          colIdx.__metaKeys = row.map(k => k.trim().replace(/^﻿/, ""));
          phase = "metaVals";
          return;
        }
        if (phase === "metaVals") {
          colIdx.__metaKeys.forEach((k, i) => {
            const v = (row[i] || "").trim();
            if (k === "hospital_name")   hospitalName = v;
            if (k === "last_updated_on") lastUpdated  = v;
            if (k === "type_2_npi")      npi          = v;
          });
          phase = "headers";
          return;
        }
        if (phase === "headers") {
          row.forEach((h, i) => { colIdx[h.trim()] = i; });
          isTallFormat = colIdx["payer_name"] !== undefined;

          if (!isTallFormat) {
            // Wide format: parse payer/plan from column headers like
            // "standard_charge|Aetna [10200]|Aetna|negotiated_dollar"
            const payerMap = new Map();
            row.forEach((h, i) => {
              const m = h.trim().match(
                /^standard_charge\|(.+)\|(.+)\|(negotiated_dollar|negotiated_percentage|negotiated_algorithm|methodology)$/
              );
              if (!m) return;
              const m1full  = m[1].trim();
              const m1clean = m1full.replace(/\s*\[\d+\]\s*$/, "").trim();
              const m2      = m[2].trim();
              // Type A (bracket ID): "Aetna Choice POS [10270]|Aetna|..."
              //   → m[2] is the insurer short name (payer), m[1] stripped is the plan product
              // Type B (no bracket): "Aetna|All Commercial Plans|..." or "Blue Shield|Hmo/Pos|..."
              //   → m[1] is the insurer (payer), m[2] is the plan category
              const hasBracket = /\[\d+\]/.test(m1full);
              const payerDisp  = hasBracket ? m2      : m1clean;
              const planDisp   = hasBracket ? m1clean : m2;
              const key = `${m1full}|||${m2}`;
              if (!payerMap.has(key)) {
                payerMap.set(key, { payer: payerDisp, plan: normalizePlan(planDisp), dollarIdx: -1, pctIdx: -1, algoIdx: -1, methodIdx: -1, dollarCol: null, pctCol: null, algoCol: null });
              }
              const e = payerMap.get(key);
              if (m[3] === "negotiated_dollar")    { e.dollarIdx = i; e.dollarCol = h.trim(); }
              if (m[3] === "negotiated_percentage"){ e.pctIdx    = i; e.pctCol    = h.trim(); }
              if (m[3] === "negotiated_algorithm") { e.algoIdx   = i; e.algoCol   = h.trim(); }
              if (m[3] === "methodology")            e.methodIdx = i;
            });
            payerCols = Array.from(payerMap.values());
          }
          phase = "data";
          return;
        }

        // Data rows
        rowCount++;

        const desc = get(row, "description");
        for (let n = 1; n <= 4; n++) {
          const code = get(row, `code|${n}`).toUpperCase();
          if (code && desc && !descMap.has(code)) descMap.set(code, desc);
        }

        if (isTallFormat) {
          const payer = get(row, "payer_name");
          if (!payer) return;

          const obj = {
            payer_name:    payer,
            __plan:        normalizePlan(get(row, "plan_name")),
            setting:       get(row, "setting"),
            billing_class: get(row, "billing_class"),
            "standard_charge|negotiated_dollar":    get(row, "standard_charge|negotiated_dollar"),
            "standard_charge|negotiated_percentage": get(row, "standard_charge|negotiated_percentage"),
            "standard_charge|negotiated_algorithm":  get(row, "standard_charge|negotiated_algorithm"),
            "standard_charge|methodology":           get(row, "standard_charge|methodology"),
            __sourceRow: csvRowNum,
          };
          obj.__sourceCol = obj["standard_charge|negotiated_dollar"]    ? "standard_charge|negotiated_dollar"
                          : obj["standard_charge|negotiated_percentage"] ? "standard_charge|negotiated_percentage"
                          : obj["standard_charge|negotiated_algorithm"]  ? "standard_charge|negotiated_algorithm"
                          : null;

          for (let n = 1; n <= 4; n++) {
            const code = get(row, `code|${n}`).toUpperCase();
            if (!code) continue;
            obj[`code|${n}`]      = code;
            obj[`code|${n}|type`] = get(row, `code|${n}|type`);
            if (!codeIndex.has(code)) codeIndex.set(code, []);
            codeIndex.get(code).push(obj);
          }
          payerRowCount++;
        } else {
          // Wide format: one row contains rates for many payers across columns.
          // Share the per-row base (setting, billing_class, codes) via prototype
          // to avoid duplicating it across every payer object.
          const setting       = get(row, "setting");
          const billing_class = get(row, "billing_class");
          const codes = [];
          for (let n = 1; n <= 4; n++) {
            const code = get(row, `code|${n}`).toUpperCase();
            if (code) codes.push({ n, code, type: get(row, `code|${n}|type`) });
          }

          for (const pc of payerCols) {
            const dollar = pc.dollarIdx >= 0 ? (row[pc.dollarIdx] || "").trim() : "";
            const pct    = pc.pctIdx    >= 0 ? (row[pc.pctIdx]    || "").trim() : "";
            const algo   = pc.algoIdx   >= 0 ? (row[pc.algoIdx]   || "").trim() : "";
            const method = pc.methodIdx >= 0 ? (row[pc.methodIdx] || "").trim() : "";
            if (!dollar && !pct && !algo) continue;

            const obj = {
              payer_name:    pc.payer,
              __plan:        pc.plan,
              setting,
              billing_class,
              "standard_charge|negotiated_dollar":    dollar,
              "standard_charge|negotiated_percentage": pct,
              "standard_charge|negotiated_algorithm":  algo,
              "standard_charge|methodology":           method,
              __sourceRow: csvRowNum,
              __sourceCol: dollar ? pc.dollarCol : pct ? pc.pctCol : algo ? pc.algoCol : null,
            };

            for (const { n, code, type } of codes) {
              obj[`code|${n}`]      = code;
              obj[`code|${n}|type`] = type;
              if (!codeIndex.has(code)) codeIndex.set(code, []);
              codeIndex.get(code).push(obj);
            }
            payerRowCount++;
          }
        }
      },
      complete: () => resolve({
        hospitalName, lastUpdated, npi,
        rowCount, codeIndex, descMap,
        hasNegotiatedRates: payerRowCount > 0,
      }),
      error: reject,
    });
  });
}

// ── JSON parser (CMS MRF v3.0.0 JSON) ────────────────────────────────────────
// Stores only the fields the UI needs — same minimal footprint as the CSV path.

function parseJsonMRF(data) {
  const hospitalName = [].concat(data.hospital_name || [])[0] || "";
  const npi          = [].concat(data.type_2_npi    || [])[0] || "";
  const lastUpdated  = data.last_updated_on || "";

  const codeIndex = new Map();
  const descMap   = new Map();
  let rowCount = 0, payerRowCount = 0;
  let itemIdx = 0;

  for (const item of (data.standard_charge_information || data.standard_charges || [])) {
    itemIdx++;
    const codes = (item.code_information || []).slice(0, 4);
    const desc  = item.description || "";

    // Capture descriptions
    codes.forEach(c => {
      const code = (c.code || "").toUpperCase().trim();
      if (code && desc && !descMap.has(code)) descMap.set(code, desc);
    });

    for (const charge of (item.standard_charges || [])) {
      const payers = charge.payers_information || [];
      rowCount++;

      if (!payers.length) continue; // gross/cash only — skip

      let payerIdx = 0;
      for (const pi of payers) {
        payerIdx++;
        const srcDollar = pi.standard_charge_dollar     != null ? String(pi.standard_charge_dollar)     : "";
        const srcPct    = pi.standard_charge_percentage != null ? String(pi.standard_charge_percentage)  : "";
        const srcAlgo   = pi.standard_charge_algorithm  != null ? String(pi.standard_charge_algorithm)   : "";
        const obj = {
          payer_name:   pi.payer_name || "",
          __plan:       normalizePlan(pi.plan_name || ""),
          setting:      charge.setting || "",
          billing_class: charge.billing_class || "",
          "standard_charge|negotiated_dollar":     srcDollar,
          "standard_charge|negotiated_percentage":  srcPct,
          "standard_charge|negotiated_algorithm":   srcAlgo,
          "standard_charge|methodology":            pi.methodology || "",
          __sourceRow: `item ${itemIdx}, payer ${payerIdx}`,
          __sourceCol: srcDollar ? "standard_charge_dollar"
                     : srcPct    ? "standard_charge_percentage"
                     : srcAlgo   ? "standard_charge_algorithm"
                     : null,
        };

        codes.forEach((c, i) => {
          obj[`code|${i + 1}`]      = (c.code || "").toUpperCase().trim();
          obj[`code|${i + 1}|type`] = (c.type || "").trim();
          const code = obj[`code|${i + 1}`];
          if (code) {
            if (!codeIndex.has(code)) codeIndex.set(code, []);
            codeIndex.get(code).push(obj);
          }
        });

        payerRowCount++;
      }
    }
  }

  return { hospitalName, npi, lastUpdated, rowCount, codeIndex, descMap, hasNegotiatedRates: payerRowCount > 0 };
}

// ── Main file parser (format-agnostic) ────────────────────────────────────────

async function parseHospitalFile(file) {
  const fmt = await detectFormat(file);

  if (fmt === "json") {
    const text = await file.text();
    const json = JSON.parse(text.replace(/^﻿/, ""));
    return { ...parseJsonMRF(json), id: Math.random().toString(36).slice(2), detectedFormat: "json" };
  }

  // CSV — streaming path
  const result = await parseCsvStreaming(file);
  return { ...result, id: Math.random().toString(36).slice(2), detectedFormat: "csv" };
}


// ── Remote URL loader ─────────────────────────────────────────────────────────

async function fetchRemoteFile(url) {
  let resp;
  try {
    resp = await fetch(url);
  } catch {
    throw new Error("Network error — the server may block cross-origin requests. Try downloading the file and uploading it instead.");
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const blob = await resp.blob();
  const filename = url.split("/").pop().split("?")[0] || "remote-file";
  return new File([blob], filename, { type: blob.type });
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        width: 36, height: 36, background: "#0F7B6C", borderRadius: 10,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <rect x="2"  y="20" width="7" height="10" rx="2" fill="white" opacity="0.5"/>
          <rect x="12" y="13" width="7" height="17" rx="2" fill="white" opacity="0.75"/>
          <rect x="22" y="6"  width="7" height="24" rx="2" fill="white"/>
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: "-0.02em", lineHeight: 1 }}>
          Clear<span style={{ fontWeight: 400 }}>Rate</span>
        </span>
        <span style={{ fontSize: 11, color: T.secondary || "#6B7280" }}>
          Price transparency, simplified
        </span>
      </div>
    </div>
  );
}

function Pill({ active, onClick, children, size = "md" }) {
  return (
    <button onClick={onClick} style={{
      padding: size === "sm" ? "3px 10px" : "5px 13px",
      borderRadius: 6, fontSize: size === "sm" ? 11 : 12, fontWeight: 500,
      cursor: "pointer", fontFamily: FONT, transition: "all .12s",
      border: `1px solid ${active ? T.text : T.border}`,
      background: active ? T.text : T.surface,
      color: active ? "#fff" : T.muted,
    }}>
      {children}
    </button>
  );
}

function Tag({ children }) {
  return (
    <span style={{
      display: "inline-block", fontSize: 11, padding: "2px 7px", borderRadius: 4,
      background: T.light, color: T.muted, border: `1px solid ${T.border}`,
    }}>
      {children}
    </span>
  );
}

function Spinner({ size = 13 }) {
  return (
    <div style={{
      width: size, height: size,
      border: `2px solid ${T.border}`, borderTopColor: T.text,
      borderRadius: "50%", animation: "spin .65s linear infinite",
      flexShrink: 0,
    }} />
  );
}

// iOS-style segmented control — used for binary/small-N choices in the search card
function SegmentedControl({ value, options, onChange, label }) {
  return (
    <div>
      {label && (
        <div style={{ fontSize: 10, fontWeight: 600, color: T.subtle, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
          {label}
        </div>
      )}
      <div style={{ display: "flex", background: T.light, borderRadius: 8, padding: 3, gap: 2 }}>
        {options.map(opt => (
          <button key={opt.id} onClick={() => onChange(opt.id)} style={{
            flex: 1, padding: "5px 14px", borderRadius: 6, border: "none",
            cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 500,
            whiteSpace: "nowrap", transition: "all .12s",
            background: value === opt.id ? T.surface : "transparent",
            color: value === opt.id ? T.text : T.muted,
            boxShadow: value === opt.id ? "0 1px 3px rgba(0,0,0,.1)" : "none",
          }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Large selectable tile used on the upload "configure" step
function ChoiceTile({ selected, onClick, label, description }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "14px 16px", textAlign: "left",
      border: `1.5px solid ${selected ? T.text : T.border}`,
      borderRadius: 10, background: selected ? T.text : T.surface,
      cursor: "pointer", fontFamily: FONT, transition: "all .14s",
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: selected ? "#fff" : T.text, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: selected ? "rgba(255,255,255,.55)" : T.subtle, lineHeight: 1.4 }}>
        {description}
      </div>
    </button>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: ${FONT}; background: ${T.bg}; }
      @keyframes spin    { to { transform: rotate(360deg); } }
      @keyframes fadein  { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
      .fadein { animation: fadein .2s ease; }
    `}</style>
  );
}

// ── Upload view ───────────────────────────────────────────────────────────────

function FormatBadge({ fmt }) {
  const styles = {
    json: { bg: "#eff6ff", fg: "#2563eb", border: "#bfdbfe" },
    csv:  { bg: "#f0fdf4", fg: "#16a34a", border: "#bbf7d0" },
  };
  const s = styles[fmt] || styles.csv;
  return (
    <span style={{
      fontSize: 9, padding: "1px 5px", borderRadius: 3, fontFamily: "monospace",
      fontWeight: 700, letterSpacing: "0.04em",
      background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
    }}>
      {fmt.toUpperCase()}
    </span>
  );
}

function FileRow({ entry, onRemove }) {
  const { file, status, hospital, error } = entry;
  const fmt = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
    }}>
      {/* Status icon */}
      <div style={{
        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
        background: status === "done" ? "#f0fdf4" : status === "error" ? "#fef2f2" : T.light,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {status === "done" && (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#16a34a" strokeWidth="2.2">
            <polyline points="2,8 6,12 14,4" />
          </svg>
        )}
        {status === "error" && (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#ef4444" strokeWidth="2.2">
            <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        )}
        {status === "parsing" && <Spinner />}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{
            fontSize: 13, fontWeight: 500, color: T.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {hospital?.hospitalName ?? file.name}
          </span>
          <FormatBadge fmt={hospital?.detectedFormat ?? fmt} />
          {status === "done" && !hospital?.hasNegotiatedRates && (
            <span style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 3, fontFamily: "monospace",
              background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a", fontWeight: 600,
            }}>
              GROSS ONLY
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: T.subtle, fontFamily: "monospace" }}>
          {status === "parsing" && "Parsing…"}
          {status === "error"   && (error || "Failed to parse — check file format")}
          {status === "done"    && `Updated ${hospital.lastUpdated} · ${hospital.rowCount.toLocaleString()} rows · NPI ${hospital.npi}`}
        </div>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        style={{
          width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
          border: `1px solid ${T.border}`, borderRadius: 5, background: T.light,
          cursor: "pointer", color: T.subtle, flexShrink: 0,
        }}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
        </svg>
      </button>
    </div>
  );
}

function UrlLoader({ onFile }) {
  const [url,     setUrl]     = useState("");
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");

  const load = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setErr("");
    try {
      const file = await fetchRemoteFile(trimmed);
      onFile(file);
      setUrl("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={url}
          onChange={e => { setUrl(e.target.value); setErr(""); }}
          onKeyDown={e => e.key === "Enter" && load()}
          placeholder="Or paste a URL to a .csv or .json MRF file…"
          style={{
            flex: 1, height: 38, padding: "0 12px",
            border: `1px solid ${err ? "#fca5a5" : T.border}`, borderRadius: 7,
            fontSize: 13, color: T.text, background: T.surface, outline: "none",
            fontFamily: FONT, transition: "border-color .15s",
          }}
          onFocus={e  => { e.target.style.borderColor = T.text; }}
          onBlur={e   => { e.target.style.borderColor = err ? "#fca5a5" : T.border; }}
        />
        <button
          onClick={load}
          disabled={loading || !url.trim()}
          style={{
            height: 38, padding: "0 16px", background: T.text, color: "#fff",
            border: "none", borderRadius: 7, fontSize: 13, fontWeight: 500,
            cursor: loading || !url.trim() ? "not-allowed" : "pointer",
            fontFamily: FONT, opacity: loading || !url.trim() ? 0.5 : 1,
            display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
            transition: "opacity .15s",
          }}
        >
          {loading ? <Spinner size={12} /> : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 2v8M5 7l3 4 3-4" />
              <path d="M2 12h12" />
            </svg>
          )}
          Load URL
        </button>
      </div>
      {err && (
        <div style={{
          marginTop: 8, fontSize: 12, color: "#dc2626", lineHeight: 1.5,
          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px",
        }}>
          {err}
        </div>
      )}
    </div>
  );
}

function UploadView({ onReady }) {
  const [entries,      setEntries]      = useState([]);
  const [dragging,     setDragging]     = useState(false);
  const [billingClass, setBillingClass] = useState(null); // "facility" | "professional"
  const [ipOp,         setIpOp]         = useState(null); // "ip" | "op"
  const inputRef = useRef(null);

  const processFiles = useCallback(async (files) => {
    const existingNames = new Set(entries.map(e => e.file.name));
    const fresh = files.filter(f => !existingNames.has(f.name));
    if (!fresh.length) return;

    setEntries(prev => [
      ...prev,
      ...fresh.map(f => ({ file: f, status: "parsing", hospital: null, error: null })),
    ]);

    for (const file of fresh) {
      try {
        const hospital = await parseHospitalFile(file);
        // Annotate with detected format
        const fmt = await detectFormat(file);
        hospital.detectedFormat = fmt;
        setEntries(prev => prev.map(e => e.file === file ? { ...e, status: "done", hospital } : e));
      } catch (err) {
        setEntries(prev => prev.map(e => e.file === file
          ? { ...e, status: "error", error: err.message }
          : e
        ));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const onDrop = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files)
      .filter(f => /\.(csv|json)$/i.test(f.name));
    if (files.length) processFiles(files);
  }, [processFiles]);

  const onInput = e => {
    const files = Array.from(e.target.files);
    if (files.length) processFiles(files);
    e.target.value = "";
  };

  const doneHospitals = entries.filter(e => e.status === "done").map(e => e.hospital);
  const anyParsing    = entries.some(e => e.status === "parsing");

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: FONT }}>
      <header style={{
        height: 56, background: T.surface, borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", padding: "0 28px",
      }}>
        <Logo />
      </header>

      <main style={{
        maxWidth: 560, margin: "0 auto", padding: "72px 24px 64px",
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: T.text, letterSpacing: "-0.04em", marginBottom: 10 }}>
            Hospital Price Transparency Comparison Tool
          </h1>
          <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.7, maxWidth: 420 }}>
            Upload machine-readable files to search negotiated rates by payer, plan, and billing code.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            {[".csv", ".json"].map(ext => (
              <span key={ext} style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 4, fontFamily: "monospace",
                background: T.light, color: T.muted, border: `1px solid ${T.border}`,
              }}>
                {ext}
              </span>
            ))}
          </div>
        </div>

        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          style={{
            width: "100%", padding: "36px 32px", textAlign: "center",
            cursor: "pointer", borderRadius: 12, transition: "all .15s",
            border: `2px dashed ${dragging ? T.text : "#d4d4d8"}`,
            background: dragging ? T.light : T.surface,
            marginBottom: 8,
          }}
        >
          <div style={{
            width: 46, height: 46, background: T.light, borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="1.8">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: T.text, marginBottom: 5 }}>
            Drop price transparency files here
          </div>
          <div style={{ fontSize: 12, color: T.subtle, marginBottom: 14 }}>
            CSV and JSON accepted
          </div>
          <span style={{
            display: "inline-block", padding: "6px 14px", borderRadius: 6,
            background: T.light, border: `1px solid ${T.border}`,
            fontSize: 12, color: T.muted, fontWeight: 500,
          }}>
            Browse files
          </span>
          <input ref={inputRef} type="file" accept=".csv,.json" multiple onChange={onInput} style={{ display: "none" }} />
        </div>

        {/* URL loader */}
        <UrlLoader onFile={file => processFiles([file])} />

        {/* File list */}
        {entries.length > 0 && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, marginTop: 16, marginBottom: 24 }}>
            {entries.map(entry => (
              <FileRow
                key={entry.file.name}
                entry={entry}
                onRemove={() => setEntries(prev => prev.filter(e => e.file !== entry.file))}
              />
            ))}
          </div>
        )}

        {/* Configure step — shown once files finish parsing */}
        {doneHospitals.length > 0 && !anyParsing && (
          <div style={{ width: "100%", marginTop: 4 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.subtle, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
                Charge type
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <ChoiceTile
                  selected={billingClass === "facility"}
                  onClick={() => setBillingClass("facility")}
                  label="Facility"
                  description="UB-04 institutional claims · DRG & APC reimbursement"
                />
                <ChoiceTile
                  selected={billingClass === "professional"}
                  onClick={() => setBillingClass("professional")}
                  label="Professional"
                  description="CMS-1500 physician claims · Fee schedule"
                />
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.subtle, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
                Setting
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <ChoiceTile
                  selected={ipOp === "ip"}
                  onClick={() => setIpOp("ip")}
                  label="Inpatient (IP)"
                  description="MS-DRG · Revenue codes · Implant carve-outs"
                />
                <ChoiceTile
                  selected={ipOp === "op"}
                  onClick={() => setIpOp("op")}
                  label="Outpatient (OP)"
                  description="CPT / HCPCS · APC · Revenue codes"
                />
              </div>
            </div>
          </div>
        )}

        {/* CTA — active once both choices are made */}
        {doneHospitals.length > 0 && !anyParsing && billingClass && ipOp && (
          <button
            onClick={() => onReady(doneHospitals, billingClass, ipOp)}
            style={{
              padding: "10px 22px", background: T.text, color: "#fff",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500,
              cursor: "pointer", fontFamily: FONT, transition: "opacity .15s",
              display: "flex", alignItems: "center", gap: 8,
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = ".82"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            Search rates
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="7" x2="13" y2="7" /><polyline points="7,1 13,7 7,13" />
            </svg>
          </button>
        )}
      </main>

      <GlobalStyles />
    </div>
  );
}

// ── Results table ─────────────────────────────────────────────────────────────

function ResultsTable({ rows, hospitalId }) {
  const [expandedAlgo, setExpandedAlgo] = useState(null);

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.04)",
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
            {["Payer", "Plan", "Negotiated Rate", "Setting", "Billing Class", "Methodology"].map(h => (
              <th key={h} style={{
                padding: "9px 16px", textAlign: "left",
                fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: "0.02em", whiteSpace: "nowrap",
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => a["payer_name"].localeCompare(b["payer_name"]))
            .flatMap((row, i, arr) => {
              const rate      = parseRate(row);
              const colors    = rate ? T[rate.type] : null;
              const isLast    = i === arr.length - 1;
              const algoKey   = `${hospitalId}-${i}`;
              const expanded  = expandedAlgo === algoKey;

              return [
                <tr
                  key={i}
                  style={{ borderBottom: isLast && !expanded ? "none" : `1px solid ${T.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = T.bg}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={{ padding: "11px 16px", fontWeight: 500, color: T.text }}>
                    {row["payer_name"] || "—"}
                  </td>
                  <td style={{ padding: "11px 16px", color: T.muted }}>
                    {row.__plan || "—"}
                  </td>
                  <td style={{ padding: "11px 16px" }}>
                    {rate ? (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{
                            padding: "3px 9px", borderRadius: 5, fontSize: 12, fontWeight: 600,
                            fontFamily: rate.type === "dollar" ? "monospace" : FONT,
                            background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}`,
                            whiteSpace: "nowrap",
                          }}>
                            {rate.display}
                          </span>
                          {rate.type === "algo" && (
                            <button
                              onClick={() => setExpandedAlgo(expanded ? null : algoKey)}
                              style={{
                                fontSize: 11, padding: "2px 7px", borderRadius: 4,
                                border: `1px solid ${T.border}`, background: T.light,
                                cursor: "pointer", color: T.muted, fontFamily: FONT,
                              }}
                            >
                              {expanded ? "Hide" : "Details"}
                            </button>
                          )}
                        </div>
                        <SourceCite source={rate.source} />
                      </div>
                    ) : <span style={{ color: T.subtle }}>—</span>}
                  </td>
                  <td style={{ padding: "11px 16px" }}><Tag>{row["setting"] || "—"}</Tag></td>
                  <td style={{ padding: "11px 16px" }}><Tag>{row["billing_class"] || "—"}</Tag></td>
                  <td style={{ padding: "11px 16px", color: T.muted, fontSize: 12 }}>
                    {row["standard_charge|methodology"] || "—"}
                  </td>
                </tr>,

                expanded && (
                  <tr key={`algo-${i}`} style={{
                    background: "#faf5ff",
                    borderBottom: isLast ? "none" : `1px solid ${T.border}`,
                  }}>
                    <td colSpan={6} style={{ padding: "10px 16px 14px" }}>
                      <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginBottom: 5 }}>
                        Algorithm detail
                      </div>
                      <div style={{
                        fontSize: 12, color: T.muted, lineHeight: 1.7,
                        fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word",
                      }}>
                        {rate?.raw}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
        </tbody>
      </table>
    </div>
  );
}

// ── Rate badge (used in pivot table) ─────────────────────────────────────────

// Parse "[Block A | Sub 1] [Block B]" notation into [[line, line], [line]]
function parseAlgoBlocks(raw) {
  if (!raw) return [["Algorithm"]];
  const blocks = raw
    .split(/\]\s*\[/)
    .map(s => s.replace(/^\[|\]$/g, "").trim())
    .filter(Boolean);
  if (blocks.length === 0) return [[raw.trim()]];
  return blocks.map(b => b.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean));
}

// Small citation shown below a rate badge — row number always visible, full column name on hover.
function SourceCite({ source }) {
  if (!source?.row) return null;
  const rowLabel = typeof source.row === "number"
    ? source.row.toLocaleString()
    : source.row;
  return (
    <span
      title={source.col ? `col: ${source.col}` : undefined}
      style={{
        display: "block", fontSize: 10, color: T.subtle, fontFamily: "monospace",
        marginTop: 3, lineHeight: 1.3, cursor: source.col ? "help" : "default",
        userSelect: "text",
      }}
    >
      row {rowLabel}
    </span>
  );
}

// hospColor: when provided, algorithm badges use the hospital accent color instead of purple
// so each hospital column has a consistent color identity.
function RateBadge({ rate, hospColor }) {
  if (!rate) return <span style={{ color: T.subtle }}>—</span>;

  if (rate.type === "algo") {
    const c = hospColor || T.algo;
    const blocks = parseAlgoBlocks(rate.raw);
    return (
      <div>
        <div style={{
          background: c.bg, border: `1px solid ${c.border}`,
          borderRadius: 6, padding: "5px 9px",
          fontSize: 11, lineHeight: 1.55, color: c.fg,
        }}>
          {blocks.map((block, bi) => (
            <div key={bi} style={{
              borderTop: bi > 0 ? `1px dashed ${c.border}` : "none",
              paddingTop: bi > 0 ? 4 : 0, marginTop: bi > 0 ? 3 : 0,
            }}>
              {block.map((line, li) => (
                <div key={li}>{line}</div>
              ))}
            </div>
          ))}
        </div>
        <SourceCite source={rate.source} />
      </div>
    );
  }

  const c = T[rate.type];
  return (
    <div style={{ display: "inline-block" }}>
      <span style={{
        display: "inline-block", padding: "3px 9px", borderRadius: 5,
        fontSize: 12, fontWeight: 600,
        fontFamily: rate.type === "dollar" ? "monospace" : FONT,
        background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
      }}>
        {rate.display}
      </span>
      <SourceCite source={rate.source} />
    </div>
  );
}

// ── Pivot table (multi-hospital comparison) ───────────────────────────────────

function PivotTable({ results, committed }) {
  // Build pivot: row key = "payer|plan", one column per hospital
  const payerPlanMap = new Map(); // key -> { payer_name, __plan }
  const hospitalMaps = results.map(() => new Map()); // hospitalMaps[i]: key -> row

  results.forEach(({ rows }, hi) => {
    rows.forEach(row => {
      const key = `${row.payer_name}|${row.__plan}`;
      if (!payerPlanMap.has(key)) {
        payerPlanMap.set(key, { payer_name: row.payer_name, __plan: row.__plan });
      }
      if (!hospitalMaps[hi].has(key)) hospitalMaps[hi].set(key, row);
    });
  });

  const sortedKeys = [...payerPlanMap.entries()]
    .sort(([, a], [, b]) => a.payer_name.localeCompare(b.payer_name) || a.__plan.localeCompare(b.__plan));

  const description = results[0]?.description || "";
  if (sortedKeys.length === 0 && results.every(r => r.grossOnly)) {
    return (
      <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {results.map(({ hospital }) => <GrossOnlyNotice key={hospital.id} hospital={hospital} />)}
      </div>
    );
  }

  return (
    <div className="fadein">
      {/* Code badge + description */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: description ? 5 : 0, flexWrap: "wrap" }}>
          <span style={{
            fontFamily: "monospace", fontSize: 12, fontWeight: 700,
            background: "#eff6ff", color: "#2563eb",
            padding: "3px 9px", borderRadius: 5, border: "1px solid #bfdbfe",
          }}>
            {committed}
          </span>
          <span style={{ fontSize: 12, color: T.subtle }}>
            {sortedKeys.length} payer{sortedKeys.length !== 1 ? "s" : ""} · {results.length} hospitals
          </span>
        </div>
        {description && (
          <div style={{ fontSize: 16, fontWeight: 600, color: T.text, letterSpacing: "-0.015em", lineHeight: 1.4 }}>
            {description}
          </div>
        )}
      </div>

      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 10, overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,.04)",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th style={{
                  padding: "10px 16px", textAlign: "left",
                  fontSize: 11, fontWeight: 600, color: T.muted,
                  background: T.bg, width: "22%",
                }}>Payer</th>
                <th style={{
                  padding: "10px 16px", textAlign: "left",
                  fontSize: 11, fontWeight: 600, color: T.muted,
                  background: T.bg, width: "18%",
                }}>Plan</th>
                {results.map(({ hospital, grossOnly }, i) => {
                  const c = HOSP_COLORS[i % HOSP_COLORS.length];
                  return (
                    <th key={hospital.id} style={{
                      padding: "10px 16px", textAlign: "left",
                      fontSize: 11, fontWeight: 600,
                      background: c.bg, color: c.fg,
                      borderLeft: `2px solid ${c.border}`,
                      whiteSpace: "nowrap",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{hospital.hospitalName}</span>
                        {grossOnly && (
                          <span style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 3,
                            background: "#fffbeb", color: "#b45309",
                            border: "1px solid #fde68a",
                            fontWeight: 700, letterSpacing: "0.04em", fontFamily: "monospace",
                          }}>GROSS ONLY</span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedKeys.map(([key, { payer_name, __plan }], i) => {
                const isLast = i === sortedKeys.length - 1;
                return (
                  <tr
                    key={key}
                    style={{ borderBottom: isLast ? "none" : `1px solid ${T.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = T.bg}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "10px 16px", fontWeight: 500, color: T.text, verticalAlign: "top" }}>{payer_name}</td>
                    <td style={{ padding: "10px 16px", color: T.muted, verticalAlign: "top" }}>{__plan || "—"}</td>
                    {results.map(({ hospital }, hi) => {
                      const row = hospitalMaps[hi].get(key);
                      const rate = row ? parseRate(row) : null;
                      const c = HOSP_COLORS[hi % HOSP_COLORS.length];
                      return (
                        <td key={hospital.id} style={{
                          padding: "10px 16px",
                          borderLeft: `2px solid ${c.border}`,
                          verticalAlign: "top",
                        }}>
                          <RateBadge rate={rate} hospColor={c} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
    </div>
  );
}

// ── Gross-only notice ─────────────────────────────────────────────────────────

function GrossOnlyNotice({ hospital }) {
  return (
    <div style={{
      padding: "14px 16px", background: "#fffbeb", border: "1px solid #fde68a",
      borderRadius: 10, fontSize: 13, color: "#92400e", lineHeight: 1.6,
    }}>
      <strong>{hospital.hospitalName}</strong> publishes gross and cash prices but no payer-specific negotiated rates in this file.
    </div>
  );
}

// ── Search view ───────────────────────────────────────────────────────────────

function SearchView({ hospitals, billingClass: initBillingClass, ipOp: initIpOp, onReset }) {
  const [billingClass, setBillingClass] = useState(initBillingClass); // "facility" | "professional"
  const [ipOp,         setIpOp]         = useState(initIpOp);         // "ip" | "op"
  const [codeType,     setCodeType]     = useState("all");
  const [query,        setQuery]        = useState("");
  const [committed,    setCommitted]    = useState("");

  // Reset code type when setting flips so a stale type (e.g. MS-DRG) isn't left active in OP
  useEffect(() => {
    const valid = ipOp === "ip"
      ? CODE_TYPES_IP.map(c => c.id)
      : CODE_TYPES_OP.map(c => c.id);
    if (!valid.includes(codeType)) setCodeType("all");
  }, [ipOp]);

  const codeTypes = ipOp === "ip" ? CODE_TYPES_IP : CODE_TYPES_OP;

  const submit = () => { if (query.trim()) setCommitted(query.trim()); };

  const results = useMemo(() => {
    if (!committed) return null;
    const q = committed.toUpperCase().trim();
    const settingVal = ipOp === "ip" ? "inpatient" : "outpatient";

    return hospitals.flatMap(hospital => {
      let rows = (hospital.codeIndex.get(q) || []).filter(r => r["payer_name"]);

      // Billing class — include rows with no billing_class as a safe fallback
      rows = rows.filter(r => !r.billing_class || r.billing_class === billingClass);

      // Setting — binary IP/OP; rows tagged "both" appear in either view
      rows = rows.filter(r => !r.setting || r.setting === settingVal || r.setting === "both");

      // Code type — RC is valid for both IP and OP (carve-outs and site-of-service)
      if (codeType !== "all") {
        rows = rows.filter(row => {
          for (let n = 1; n <= 4; n++) {
            const code = row[`code|${n}`]?.toUpperCase().trim();
            const type = row[`code|${n}|type`]?.trim().toUpperCase();
            if (code !== q) continue;
            if (codeType === "HCPCS" && (type === "HCPCS" || type === "CPT")) return true;
            if (type === codeType) return true;
          }
          return false;
        });
      }

      const hasCode       = (hospital.codeIndex.get(q) || []).length > 0;
      const hasNegotiated = rows.length > 0;
      const grossOnly     = hasCode && !hasNegotiated && !hospital.hasNegotiatedRates;

      if (!hasCode) return [];

      // Deduplicate on payer + plan + setting + billing_class
      const seen = new Set();
      const unique = rows.filter(row => {
        const k = `${row["payer_name"]}|${row.__plan}|${row["setting"]}|${row["billing_class"]}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const description = hospital.descMap.get(q) || "";
      return [{ hospital, rows: unique, description, grossOnly }];
    });
  }, [committed, codeType, billingClass, ipOp, hospitals]);

  const totalRows = results?.reduce((s, r) => s + r.rows.length, 0) ?? 0;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: FONT }}>
      {/* Sticky header */}
      <header style={{
        height: 56, background: T.surface, borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", padding: "0 28px", gap: 14,
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <button
          onClick={onReset}
          style={{
            display: "flex", alignItems: "center", gap: 5, background: "none",
            border: "none", cursor: "pointer", color: T.muted, fontFamily: FONT,
            fontSize: 13, padding: "4px 0",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
            <line x1="13" y1="7" x2="1" y2="7" /><polyline points="7,1 1,7 7,13" />
          </svg>
          Upload
        </button>
        <div style={{ width: 1, height: 20, background: T.border }} />
        <Logo />
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {hospitals.map((h, i) => {
            const c = hospitals.length >= 2 ? HOSP_COLORS[i % HOSP_COLORS.length] : null;
            return (
              <span key={h.id} style={{
                fontSize: 11, padding: "3px 9px", borderRadius: 5,
                background: c ? c.bg : T.light,
                color: c ? c.fg : T.muted,
                border: `1px solid ${c ? c.border : T.border}`,
                fontFamily: "monospace", whiteSpace: "nowrap", fontWeight: c ? 600 : 400,
              }}>
                {h.hospitalName}
              </span>
            );
          })}
        </div>
      </header>

      <main style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
        {/* Search card */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
          padding: "18px 20px 16px", boxShadow: "0 1px 4px rgba(0,0,0,.04)", marginBottom: 32,
        }}>
          {/* Charge type + setting toggles */}
          <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
            <SegmentedControl
              label="Charge type"
              value={billingClass}
              options={[{ id: "facility", label: "Facility" }, { id: "professional", label: "Professional" }]}
              onChange={setBillingClass}
            />
            <SegmentedControl
              label="Setting"
              value={ipOp}
              options={[{ id: "ip", label: "Inpatient (IP)" }, { id: "op", label: "Outpatient (OP)" }]}
              onChange={setIpOp}
            />
          </div>

          <div style={{ height: 1, background: T.border, margin: "0 -20px 14px" }} />

          {/* Code type pills — options change based on setting */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
            {codeTypes.map(ct => (
              <Pill key={ct.id} active={codeType === ct.id} onClick={() => setCodeType(ct.id)}>
                {ct.label}
              </Pill>
            ))}
          </div>

          {/* Search input + button */}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder={
                ipOp === "ip"
                  ? "e.g. 470, 871, 291… or Revenue Code 278"
                  : "e.g. 10005, 99213, 0001U… or APC 5641"
              }
              autoFocus
              style={{
                flex: 1, height: 42, padding: "0 14px",
                border: `1px solid ${T.border}`, borderRadius: 8,
                fontSize: 15, fontFamily: "monospace", color: T.text,
                background: T.bg, outline: "none",
                transition: "border-color .15s, box-shadow .15s",
              }}
              onFocus={e => {
                e.target.style.borderColor = T.text;
                e.target.style.background  = T.surface;
                e.target.style.boxShadow   = "0 0 0 3px rgba(24,24,27,.06)";
              }}
              onBlur={e => {
                e.target.style.borderColor = T.border;
                e.target.style.background  = T.bg;
                e.target.style.boxShadow   = "none";
              }}
            />
            <button
              onClick={submit}
              style={{
                height: 42, padding: "0 18px", background: T.text, color: "#fff",
                border: "none", borderRadius: 8, fontSize: 13, fontWeight: 500,
                cursor: "pointer", fontFamily: FONT, transition: "opacity .15s",
                display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = ".82"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="9" r="6" />
                <line x1="14.5" y1="14.5" x2="19" y2="19" />
              </svg>
              Search
            </button>
          </div>
        </div>

        {/* Empty state */}
        {results === null && (
          <div style={{ textAlign: "center", padding: "72px 0", color: T.subtle }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ marginBottom: 16 }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div style={{ fontSize: 14, color: T.muted }}>Enter a billing code above to look up negotiated rates</div>
          </div>
        )}

        {/* No results */}
        {results !== null && results.length === 0 && (
          <div style={{ textAlign: "center", padding: "72px 0" }}>
            <div style={{ fontSize: 14, color: T.text, marginBottom: 6 }}>
              No results for{" "}
              <code style={{
                fontFamily: "monospace", background: T.light,
                padding: "2px 8px", borderRadius: 5, fontSize: 13,
              }}>
                {committed}
              </code>
            </div>
            <div style={{ fontSize: 13, color: T.subtle }}>
              Try a different code or change the code type / setting filter
            </div>
          </div>
        )}

        {/* Results — pivot table when 2+ hospitals match, single-hospital view otherwise */}
        {results && results.length >= 2 && (
          <PivotTable results={results} committed={committed} />
        )}

        {results && results.length === 1 && results.map(({ hospital, rows, description, grossOnly }) => (
          <div key={hospital.id} className="fadein" style={{ marginBottom: 36 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: description ? 5 : 0, flexWrap: "wrap" }}>
                <span style={{
                  fontFamily: "monospace", fontSize: 12, fontWeight: 700,
                  background: "#eff6ff", color: "#2563eb",
                  padding: "3px 9px", borderRadius: 5, border: "1px solid #bfdbfe",
                }}>
                  {committed}
                </span>
                {!grossOnly && (
                  <span style={{ fontSize: 12, color: T.subtle }}>
                    {totalRows} result{totalRows !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {description && (
                <div style={{ fontSize: 16, fontWeight: 600, color: T.text, letterSpacing: "-0.015em", lineHeight: 1.4 }}>
                  {description}
                </div>
              )}
            </div>
            {grossOnly
              ? <GrossOnlyNotice hospital={hospital} />
              : <ResultsTable rows={rows} hospitalId={hospital.id} />
            }
          </div>
        ))}
      </main>

      <GlobalStyles />
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(null); // { hospitals, billingClass, ipOp }
  return session
    ? <SearchView
        hospitals={session.hospitals}
        billingClass={session.billingClass}
        ipOp={session.ipOp}
        onReset={() => setSession(null)}
      />
    : <UploadView onReady={(hospitals, billingClass, ipOp) => setSession({ hospitals, billingClass, ipOp })} />;
}
