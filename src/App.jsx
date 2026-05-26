import { useState, useRef, useCallback, useMemo } from "react";
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

const CODE_TYPES = [
  { id: "all",    label: "All" },
  { id: "HCPCS",  label: "HCPCS / CPT" },
  { id: "APC",    label: "APC" },
  { id: "MS-DRG", label: "MS-DRG" },
  { id: "RC",     label: "Revenue Code" },
];

const SETTINGS = [
  { id: "All",       label: "All" },
  { id: "outpatient",label: "Outpatient" },
  { id: "inpatient", label: "Inpatient" },
  { id: "both",      label: "Both" },
];

// ── Parse helpers ─────────────────────────────────────────────────────────────

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

  if (dollar) {
    const n = parseFloat(dollar);
    if (!isNaN(n)) return {
      type: "dollar",
      display: "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      raw: dollar,
    };
  }
  if (pct) return { type: "pct", display: `${pct}% of Medicare`, raw: pct };
  if (algo) return { type: "algo", display: "Algorithm", raw: algo };
  return null;
}

async function parseHospitalFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: ({ data }) => {
        try {
          const [metaKeys, metaVals, headerRow, ...dataArrays] = data;

          // Row 1 = metadata keys, Row 2 = metadata values
          const meta = {};
          metaKeys.forEach((k, i) => {
            meta[k.trim().replace(/^﻿/, "")] = metaVals[i]?.trim() ?? "";
          });

          const hospitalName = meta["hospital_name"] || file.name.replace(/\.csv$/i, "");
          const lastUpdated  = meta["last_updated_on"] || "";
          const npi          = meta["type_2_npi"] || "";
          const headers      = headerRow.map(h => h.trim());

          // Convert each data array into an object keyed by header
          const rows = dataArrays
            .filter(arr => arr.some(Boolean))
            .map(arr => {
              const obj = {};
              headers.forEach((h, i) => { obj[h] = arr[i]?.trim() ?? ""; });
              obj.__plan = normalizePlan(obj["plan_name"]);
              return obj;
            });

          // Build search index: normalised code string → row[]
          const codeIndex = new Map();
          const descMap   = new Map(); // code → first non-empty description

          rows.forEach(row => {
            for (let n = 1; n <= 4; n++) {
              const code = row[`code|${n}`]?.toUpperCase().trim();
              if (!code) continue;
              if (!codeIndex.has(code)) {
                codeIndex.set(code, []);
                if (row["description"]) descMap.set(code, row["description"]);
              }
              codeIndex.get(code).push(row);
            }
          });

          resolve({
            id: Math.random().toString(36).slice(2),
            hospitalName,
            lastUpdated,
            npi,
            rowCount: rows.length,
            codeIndex,
            descMap,
          });
        } catch (err) { reject(err); }
      },
      error: reject,
    });
  });
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 26, height: 26, background: T.text, borderRadius: 6,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.2">
          <path d="M3 12.5L8 3.5L13 12.5" />
          <line x1="5.3" y1="9" x2="10.7" y2="9" />
        </svg>
      </div>
      <span style={{ fontSize: 14, fontWeight: 600, color: T.text, letterSpacing: "-0.02em" }}>
        ClearRate
      </span>
    </div>
  );
}

function Pill({ active, onClick, children, size = "md" }) {
  return (
    <button onClick={onClick} style={{
      padding: size === "sm" ? "3px 10px" : "5px 13px",
      borderRadius: 6,
      fontSize: size === "sm" ? 11 : 12,
      fontWeight: 500,
      cursor: "pointer",
      fontFamily: FONT,
      transition: "all .12s",
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

function Spinner() {
  return (
    <div style={{
      width: 13, height: 13,
      border: `2px solid ${T.border}`,
      borderTopColor: T.text,
      borderRadius: "50%",
      animation: "spin .65s linear infinite",
    }} />
  );
}

function GlobalStyles() {
  return (
    <style>{`
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: ${FONT}; background: ${T.bg}; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      .result-section { animation: fadein .2s ease; }
    `}</style>
  );
}

// ── Upload view ───────────────────────────────────────────────────────────────

function FileRow({ entry, onRemove }) {
  const { file, status, hospital } = entry;
  const iconBg = status === "done" ? "#f0fdf4" : status === "error" ? "#fef2f2" : T.light;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px", background: T.surface,
      border: `1px solid ${T.border}`, borderRadius: 10,
    }}>
      {/* Status icon */}
      <div style={{
        width: 34, height: 34, borderRadius: 8, background: iconBg, flexShrink: 0,
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
        <div style={{
          fontSize: 13, fontWeight: 500, color: T.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {hospital?.hospitalName ?? file.name}
        </div>
        <div style={{ fontSize: 11, color: T.subtle, fontFamily: "monospace", marginTop: 2 }}>
          {status === "parsing" && "Parsing…"}
          {status === "error"   && "Failed to parse — check file format"}
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

function UploadView({ onReady }) {
  const [entries, setEntries] = useState([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const processFiles = useCallback(async (files) => {
    const existingNames = new Set(entries.map(e => e.file.name));
    const fresh = files.filter(f => !existingNames.has(f.name));
    if (!fresh.length) return;

    setEntries(prev => [...prev, ...fresh.map(f => ({ file: f, status: "parsing", hospital: null }))]);

    for (const file of fresh) {
      try {
        const hospital = await parseHospitalFile(file);
        setEntries(prev => prev.map(e => e.file === file ? { ...e, status: "done", hospital } : e));
      } catch {
        setEntries(prev => prev.map(e => e.file === file ? { ...e, status: "error" } : e));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const onDrop = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".csv"));
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
        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: T.text, letterSpacing: "-0.04em", marginBottom: 10 }}>
            Hospital Price Lookup
          </h1>
          <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.7, maxWidth: 420 }}>
            Upload CMS machine-readable files to search negotiated rates by payer, plan, and billing code.
          </p>
        </div>

        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          style={{
            width: "100%", padding: "40px 32px", textAlign: "center",
            cursor: "pointer", borderRadius: 12, transition: "all .15s",
            border: `2px dashed ${dragging ? T.text : "#d4d4d8"}`,
            background: dragging ? T.light : T.surface,
            marginBottom: entries.length ? 12 : 0,
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
            Drop CMS price transparency files here
          </div>
          <div style={{ fontSize: 12, color: T.subtle, marginBottom: 14 }}>
            CMS MRF v3.0.0 · CSV · Multiple hospitals supported
          </div>
          <span style={{
            display: "inline-block", padding: "6px 14px",
            borderRadius: 6, background: T.light, border: `1px solid ${T.border}`,
            fontSize: 12, color: T.muted, fontWeight: 500,
          }}>
            Browse files
          </span>
          <input ref={inputRef} type="file" accept=".csv" multiple onChange={onInput} style={{ display: "none" }} />
        </div>

        {/* File list */}
        {entries.length > 0 && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {entries.map(entry => (
              <FileRow
                key={entry.file.name}
                entry={entry}
                onRemove={() => setEntries(prev => prev.filter(e => e.file !== entry.file))}
              />
            ))}
          </div>
        )}

        {/* CTA */}
        {doneHospitals.length > 0 && !anyParsing && (
          <button
            onClick={() => onReady(doneHospitals)}
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

// ── Search view ───────────────────────────────────────────────────────────────

function ResultsTable({ rows, hospitalId }) {
  const [expandedAlgo, setExpandedAlgo] = useState(null);

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 10, overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,.04)",
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
            {["Payer", "Plan", "Negotiated Rate", "Setting", "Billing Class", "Methodology"].map(h => (
              <th key={h} style={{
                padding: "9px 16px", textAlign: "left",
                fontSize: 11, fontWeight: 600, color: T.muted,
                letterSpacing: "0.02em", whiteSpace: "nowrap",
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
              const rate    = parseRate(row);
              const colors  = rate ? T[rate.type] : null;
              const isLast  = i === arr.length - 1;
              const algoKey = `${hospitalId}-${i}`;
              const isExpanded = expandedAlgo === algoKey;

              return [
                <tr
                  key={i}
                  style={{ borderBottom: isLast && !isExpanded ? "none" : `1px solid ${T.border}` }}
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
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{
                          padding: "3px 9px", borderRadius: 5,
                          fontSize: 12, fontWeight: 600,
                          fontFamily: rate.type === "dollar" ? "monospace" : FONT,
                          background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}`,
                          whiteSpace: "nowrap",
                        }}>
                          {rate.display}
                        </span>
                        {rate.type === "algo" && (
                          <button
                            onClick={() => setExpandedAlgo(isExpanded ? null : algoKey)}
                            style={{
                              fontSize: 11, padding: "2px 7px", borderRadius: 4,
                              border: `1px solid ${T.border}`, background: T.light,
                              cursor: "pointer", color: T.muted, fontFamily: FONT,
                            }}
                          >
                            {isExpanded ? "Hide" : "Details"}
                          </button>
                        )}
                      </div>
                    ) : <span style={{ color: T.subtle }}>—</span>}
                  </td>
                  <td style={{ padding: "11px 16px" }}>
                    <Tag>{row["setting"] || "—"}</Tag>
                  </td>
                  <td style={{ padding: "11px 16px" }}>
                    <Tag>{row["billing_class"] || "—"}</Tag>
                  </td>
                  <td style={{ padding: "11px 16px", color: T.muted, fontSize: 12 }}>
                    {row["standard_charge|methodology"] || "—"}
                  </td>
                </tr>,

                isExpanded && (
                  <tr key={`algo-${i}`} style={{ background: "#faf5ff", borderBottom: isLast ? "none" : `1px solid ${T.border}` }}>
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

function SearchView({ hospitals, onReset }) {
  const [codeType,  setCodeType]  = useState("all");
  const [query,     setQuery]     = useState("");
  const [committed, setCommitted] = useState("");
  const [setting,   setSetting]   = useState("All");

  const submit = () => { if (query.trim()) setCommitted(query.trim()); };

  const results = useMemo(() => {
    if (!committed) return null;
    const q = committed.toUpperCase().trim();

    return hospitals.flatMap(hospital => {
      // Start with all rows matching this code, skip aggregate (no-payer) rows
      let rows = (hospital.codeIndex.get(q) || []).filter(r => r["payer_name"]);

      // Filter by code type
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

      // Filter by setting
      if (setting !== "All") {
        rows = rows.filter(r => r["setting"] === setting || r["setting"] === "both");
      }

      if (!rows.length) return [];

      // Deduplicate by payer + plan + setting + billing class
      const seen   = new Set();
      const unique = rows.filter(row => {
        const k = `${row["payer_name"]}|${row.__plan}|${row["setting"]}|${row["billing_class"]}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const description = hospital.descMap.get(q) || rows[0]?.["description"] || "";
      return [{ hospital, rows: unique, description }];
    });
  }, [committed, codeType, setting, hospitals]);

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
            border: "none", cursor: "pointer", color: T.muted,
            fontFamily: FONT, fontSize: 13, padding: "4px 0",
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
          {hospitals.map(h => (
            <span key={h.id} style={{
              fontSize: 11, padding: "3px 9px", borderRadius: 5,
              background: T.light, color: T.muted, border: `1px solid ${T.border}`,
              fontFamily: "monospace", whiteSpace: "nowrap",
            }}>
              {h.hospitalName}
            </span>
          ))}
        </div>
      </header>

      <main style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
        {/* Search card */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 12, padding: "20px 20px 16px",
          boxShadow: "0 1px 4px rgba(0,0,0,.04)", marginBottom: 32,
        }}>
          {/* Code type tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
            {CODE_TYPES.map(ct => (
              <Pill key={ct.id} active={codeType === ct.id} onClick={() => setCodeType(ct.id)}>
                {ct.label}
              </Pill>
            ))}
          </div>

          {/* Input row */}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder={
                codeType === "all"
                  ? "e.g. 10005, 5021, MS-DRG 470…"
                  : `Enter ${CODE_TYPES.find(c => c.id === codeType)?.label} code…`
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

          {/* Setting filter */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: T.subtle, fontWeight: 500 }}>Setting</span>
            {SETTINGS.map(s => (
              <Pill key={s.id} size="sm" active={setting === s.id} onClick={() => setSetting(s.id)}>
                {s.label}
              </Pill>
            ))}
          </div>
        </div>

        {/* Empty / no-results states */}
        {results === null && (
          <div style={{ textAlign: "center", padding: "72px 0", color: T.subtle }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ marginBottom: 16 }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div style={{ fontSize: 14, color: T.muted }}>Enter a billing code above to look up negotiated rates</div>
          </div>
        )}

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
              Try a different code, or change the code type / setting filter
            </div>
          </div>
        )}

        {/* Results */}
        {results && results.map(({ hospital, rows, description }) => (
          <div key={hospital.id} className="result-section" style={{ marginBottom: 36 }}>
            {/* Hospital label (multi-hospital mode) */}
            {hospitals.length > 1 && (
              <div style={{ fontSize: 12, color: T.muted, marginBottom: 10, display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{
                  fontFamily: "monospace", fontSize: 10, padding: "2px 6px",
                  background: T.light, borderRadius: 4, border: `1px solid ${T.border}`, color: T.subtle,
                }}>
                  {hospital.npi}
                </span>
                <span style={{ fontWeight: 600, color: T.text }}>{hospital.hospitalName}</span>
              </div>
            )}

            {/* Code + description */}
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
                  {totalRows} result{totalRows !== 1 ? "s" : ""}
                </span>
              </div>
              {description && (
                <div style={{
                  fontSize: 16, fontWeight: 600, color: T.text,
                  letterSpacing: "-0.015em", lineHeight: 1.4,
                }}>
                  {description}
                </div>
              )}
            </div>

            <ResultsTable rows={rows} hospitalId={hospital.id} />
          </div>
        ))}
      </main>

      <GlobalStyles />
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [hospitals, setHospitals] = useState(null);
  return hospitals
    ? <SearchView hospitals={hospitals} onReset={() => setHospitals(null)} />
    : <UploadView onReady={setHospitals} />;
}
