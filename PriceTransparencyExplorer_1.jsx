import { useState, useEffect, useRef, useCallback } from "react";

// ─── Data ────────────────────────────────────────────────────────────────────

const HOSPITALS = [
  {
    id: "ucsf-med",
    name: "UCSF Medical Center",
    addr: "505 Parnassus Ave, SF",
    npi: "1234567890",
    dist: "0.4 mi",
    payers: 7,
    services: 8200,
    x: 110,
    y: 230,
    dominant: "dollar",
    rateType: "mix",
  },
  {
    id: "zuckerberg",
    name: "Zuckerberg SF General",
    addr: "1001 Potrero Ave, SF",
    npi: "2345678901",
    dist: "1.2 mi",
    payers: 6,
    services: 6100,
    x: 290,
    y: 310,
    dominant: "pct",
    rateType: "pct",
  },
  {
    id: "cpmc-van",
    name: "CPMC Van Ness Campus",
    addr: "1101 Van Ness Ave, SF",
    npi: "3456789012",
    dist: "0.8 mi",
    payers: 7,
    services: 7400,
    x: 180,
    y: 175,
    dominant: "dollar",
    rateType: "mix",
  },
  {
    id: "sutter-sf",
    name: "Sutter Medical Center SF",
    addr: "45 Castro St, SF",
    npi: "4567890123",
    dist: "1.5 mi",
    payers: 7,
    services: 9100,
    x: 135,
    y: 285,
    dominant: "dollar",
    rateType: "dollar",
  },
  {
    id: "st-francis",
    name: "St. Francis Memorial",
    addr: "900 Hyde St, SF",
    npi: "5678901234",
    dist: "1.1 mi",
    payers: 5,
    services: 4800,
    x: 195,
    y: 130,
    dominant: "algo",
    rateType: "algo",
  },
  {
    id: "sutter-davis",
    name: "Sutter Davis Hospital",
    addr: "2000 Sutter Place, Davis, CA",
    npi: "1770532608",
    dist: "72 mi",
    payers: 7,
    services: 8800,
    x: 430,
    y: 390,
    dominant: "dollar",
    rateType: "dollar",
    loaded: true,
  },
];

const RATE_DATA = {
  "ucsf-med": [
    { payer: "Aetna", plan: "HMO/PPO", val: "$3,200.00", type: "dollar", method: "fee schedule" },
    { payer: "Anthem", plan: "HMO/PPO", val: "$3,450.00", type: "dollar", method: "fee schedule" },
    { payer: "Blue Shield", plan: "HMO/PPO", val: "$2,980.00", type: "dollar", method: "fee schedule" },
    { payer: "Cigna", plan: "HMO/PPO", val: "142% of Medicare", type: "pct", method: "other" },
    { payer: "Health Net", plan: "Medi-Cal", val: "Algorithm (other)", type: "algo", method: "other" },
  ],
  "sutter-davis": [
    { payer: "Aetna", plan: "HMO/PPO", val: "$3,456.00", type: "dollar", method: "fee schedule" },
    { payer: "Blue Shield", plan: "HMO/PPO", val: "$3,610.00", type: "dollar", method: "fee schedule" },
    { payer: "Blue Shield", plan: "Individual", val: "$3,185.00", type: "dollar", method: "fee schedule" },
    { payer: "Cigna", plan: "HMO/PPO", val: "$2,977.00", type: "dollar", method: "fee schedule" },
    { payer: "Anthem", plan: "Medicare Adv.", val: "Algorithm (other)", type: "algo", method: "other" },
  ],
  zuckerberg: [
    { payer: "Aetna", plan: "HMO/PPO", val: "118% of Medicare", type: "pct", method: "other" },
    { payer: "Anthem", plan: "Medi-Cal", val: "Algorithm (other)", type: "algo", method: "other" },
    { payer: "Health Net", plan: "Medi-Cal", val: "Algorithm (other)", type: "algo", method: "other" },
  ],
};

const PAYER_COLORS = {
  dollar: "#16a34a",
  pct: "#d97706",
  algo: "#7c3aed",
  mix: "#2563eb",
};

const BOT_REPLIES = {
  "compare aetna vs blue shield":
    "For HCPCS 10005 (FNA biopsy) at Sutter Davis:\n• Aetna HMO/PPO: $3,456\n• Blue Shield HMO/PPO: $3,610\n• Blue Shield Individual: $3,185\n\nBlue Shield Individual is the lowest fixed rate.",
  "look up hcpcs 10005":
    "HCPCS 10005 = Fine needle aspiration biopsy w/ ultrasound guidance, 1st lesion.\n\nAt Sutter Davis (outpatient):\nAetna $3,456 · Blue Shield HMO $3,610 · Cigna $2,977\n\nWant to compare across hospitals?",
  "which hospital is cheapest":
    "For HCPCS 10005 based on loaded data:\n• Cigna at Sutter Davis: $2,977 (lowest)\n• Aetna at UCSF: $3,200\n\nSome payers use % of Medicare — I can resolve those if you share the fee schedule.",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <div style={{
        width: 28, height: 28, background: "#18181b", borderRadius: 7,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.8">
          <path d="M8 2C5.24 2 3 4.24 3 7c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" />
          <circle cx="8" cy="7" r="1.5" fill="white" stroke="none" />
        </svg>
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", color: "#1c1917" }}>
        ClearRate
      </span>
      <span style={{
        marginLeft: "auto", fontFamily: "monospace", fontSize: 9, padding: "2px 6px",
        borderRadius: 4, background: "#f5f5f4", color: "#a8a29e",
        border: "1px solid #e7e5e4", letterSpacing: "0.04em",
      }}>
        BETA
      </span>
    </div>
  );
}

function LocationBar({ location, onChangeLocation }) {
  return (
    <div
      onClick={onChangeLocation}
      style={{
        background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 6,
        padding: "8px 10px", display: "flex", alignItems: "center", gap: 8,
        marginBottom: 12, cursor: "pointer", transition: "border-color 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#d6d3d1"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#e7e5e4"}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#a8a29e" strokeWidth="1.8">
        <path d="M8 2C5.24 2 3 4.24 3 7c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" />
        <circle cx="8" cy="7" r="1.5" fill="#a8a29e" stroke="none" />
      </svg>
      <span style={{ fontSize: 12, color: "#57534e", flex: 1 }}>
        <strong style={{ color: "#1c1917", fontWeight: 500 }}>{location}</strong>
        {" · 8 hospitals nearby"}
      </span>
      <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 500, whiteSpace: "nowrap" }}>
        Change
      </span>
    </div>
  );
}

function FilterLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 500, color: "#a8a29e", letterSpacing: "0.06em",
      textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 6,
    }}>
      {children}
      <div style={{ flex: 1, height: 1, background: "#e7e5e4" }} />
    </div>
  );
}

function SettingToggle({ value, onChange }) {
  const options = ["inpatient", "outpatient", "both"];
  const labels = { inpatient: "Inpatient", outpatient: "Outpatient", both: "Both" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            padding: "6px 4px", borderRadius: 6, fontSize: 11, fontWeight: 500,
            cursor: "pointer", textAlign: "center", transition: "all 0.15s",
            border: value === opt ? "1px solid #18181b" : "1px solid #e7e5e4",
            background: value === opt ? "#18181b" : "#ffffff",
            color: value === opt ? "#ffffff" : "#57534e",
            fontFamily: "inherit",
          }}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

function PillGroup({ options, value, onChange, multi = false }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {options.map(opt => {
        const isOn = multi ? value.includes(opt) : value === opt;
        return (
          <button
            key={opt}
            onClick={() => {
              if (multi) {
                onChange(isOn && value.length > 1 ? value.filter(v => v !== opt) : [...new Set([...value, opt])]);
              } else {
                onChange(opt);
              }
            }}
            style={{
              fontSize: 11, padding: "4px 9px", borderRadius: 20, cursor: "pointer",
              fontWeight: 500, whiteSpace: "nowrap", transition: "all 0.15s",
              border: isOn ? "1px solid #18181b" : "1px solid #e7e5e4",
              background: isOn ? "#18181b" : "#ffffff",
              color: isOn ? "#ffffff" : "#57534e",
              fontFamily: "inherit",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function HospitalCard({ hospital, selected, onClick }) {
  const col = PAYER_COLORS[hospital.dominant];
  const rateLabel = {
    dollar: "Fixed rates", pct: "% Medicare", algo: "Algorithm", mix: "Mixed",
  }[hospital.rateType];

  return (
    <div
      onClick={() => onClick(hospital.id)}
      style={{
        border: selected ? "1px solid #2563eb" : "1px solid #e7e5e4",
        borderRadius: 10, padding: "10px 12px", cursor: "pointer",
        transition: "all 0.15s",
        background: selected ? "#eff6ff" : "#ffffff",
        boxShadow: selected ? "0 0 0 3px rgba(37,99,235,0.08)" : "none",
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", background: col, marginTop: 4, flexShrink: 0,
          boxShadow: `0 0 0 3px ${col}33`,
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1c1917", lineHeight: 1.3 }}>
            {hospital.name}
            {hospital.loaded && (
              <span style={{
                marginLeft: 6, fontSize: 9, padding: "1px 5px", background: "#eff6ff",
                color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 3,
                fontFamily: "monospace", fontWeight: 400,
              }}>
                DATA LOADED
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 1 }}>{hospital.addr}</div>
        </div>
        <div style={{ fontSize: 10, color: "#a8a29e", fontFamily: "monospace", whiteSpace: "nowrap" }}>
          {hospital.dist}
        </div>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {[
          `${hospital.payers} payers`,
          `${hospital.services.toLocaleString()} services`,
        ].map(tag => (
          <span key={tag} style={{
            fontFamily: "monospace", fontSize: 9, padding: "2px 6px", borderRadius: 3,
            border: "1px solid #e7e5e4", color: "#a8a29e", background: "#f5f5f4",
          }}>{tag}</span>
        ))}
        <span style={{
          fontFamily: "monospace", fontSize: 9, padding: "2px 6px", borderRadius: 3,
          border: `1px solid ${col}44`, color: col, background: `${col}11`,
        }}>{rateLabel}</span>
      </div>
    </div>
  );
}

function RateRow({ rate }) {
  const colors = { dollar: "#16a34a", pct: "#d97706", algo: "#a8a29e" };
  return (
    <div style={{
      padding: "11px 14px", borderBottom: "1px solid #f5f5f4",
      display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center",
      transition: "background 0.1s",
    }}
      onMouseEnter={e => e.currentTarget.style.background = "#fafaf9"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#1c1917" }}>{rate.payer}</div>
        <div style={{ fontSize: 10, color: "#a8a29e", fontFamily: "monospace", marginTop: 1 }}>{rate.plan}</div>
      </div>
      <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: colors[rate.type], letterSpacing: "-0.02em" }}>
        {rate.val}
      </span>
      <span style={{
        fontSize: 9, padding: "2px 6px", borderRadius: 4,
        background: "#f5f5f4", color: "#a8a29e", border: "1px solid #e7e5e4", fontFamily: "monospace",
        whiteSpace: "nowrap",
      }}>
        {rate.method}
      </span>
    </div>
  );
}

function RatesPanel({ hospital, code }) {
  const rates = RATE_DATA[hospital?.id];
  if (!hospital) return null;
  const displayCode = code || "HCPCS 10005";
  const rateTypeCount = rates
    ? Object.entries(
        rates.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {})
      )
    : [];

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ height: 1, background: "#e7e5e4", margin: "14px 0" }} />

      {/* Prominent header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1c1917", letterSpacing: "-0.01em" }}>
            {hospital.name.split(" ").slice(0, 3).join(" ")}
          </span>
          {rates && (
            <span style={{ fontSize: 10, color: "#a8a29e", fontFamily: "monospace" }}>
              {rates.length} payers
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 11, fontFamily: "monospace", fontWeight: 600,
            background: "#f0f9ff", color: "#0369a1", padding: "2px 8px",
            borderRadius: 4, border: "1px solid #bae6fd",
          }}>
            {displayCode}
          </span>
          {rates && rateTypeCount.map(([type, count]) => {
            const cfg = { dollar: ["#dcfce7", "#16a34a", "$"], pct: ["#fef9c3", "#a16207", "%"], algo: ["#f5f3ff", "#7c3aed", "≈"] };
            const [bg, fg, icon] = cfg[type] || ["#f5f5f4", "#a8a29e", "?"];
            return (
              <span key={type} style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 4,
                background: bg, color: fg, fontFamily: "monospace", fontWeight: 600,
              }}>
                {icon} {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* Rate table */}
      <div style={{
        border: "1px solid #e7e5e4", borderRadius: 10, overflow: "hidden",
        background: "#ffffff", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}>
        {rates ? (
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {rates.map((r, i) => <RateRow key={i} rate={r} />)}
          </div>
        ) : (
          <div style={{
            padding: "20px 16px", textAlign: "center", color: "#a8a29e", fontSize: 12, lineHeight: 1.8,
          }}>
            Upload this hospital's MRF file<br />to compare rates
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Hospital Selector Overlay (top-left of map) ─────────────────────────────

function HospitalSelector({ hospitals, activeIds, onToggle }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "absolute", top: 16, left: 16, zIndex: 15 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          background: "#ffffff", border: "1px solid #e7e5e4", borderRadius: 8,
          padding: "7px 12px", cursor: "pointer", fontFamily: "inherit",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)", transition: "box-shadow 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)"}
        onMouseLeave={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#57534e" strokeWidth="1.8">
          <path d="M8 2C5.24 2 3 4.24 3 7c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" />
          <circle cx="8" cy="7" r="1.5" fill="#57534e" stroke="none" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#1c1917" }}>Hospitals</span>
        <span style={{
          fontSize: 10, fontFamily: "monospace", background: "#18181b", color: "#fff",
          padding: "1px 6px", borderRadius: 10, fontWeight: 600,
        }}>
          {activeIds.length}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#a8a29e" strokeWidth="1.8"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2,3 5,7 8,3" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          background: "#ffffff", border: "1px solid #e7e5e4", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,.12)", minWidth: 248, overflow: "hidden",
        }}>
          <div style={{
            padding: "8px 12px", borderBottom: "1px solid #f0f0f0",
            fontSize: 10, fontWeight: 600, color: "#a8a29e",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            Select hospitals to compare
          </div>
          {hospitals.map(h => {
            const col = PAYER_COLORS[h.dominant];
            const isOn = activeIds.includes(h.id);
            return (
              <div
                key={h.id}
                onClick={() => onToggle(h.id)}
                style={{
                  padding: "9px 12px", display: "flex", alignItems: "center", gap: 10,
                  cursor: "pointer", transition: "background 0.1s",
                  background: isOn ? "#fafaf9" : "#ffffff",
                  borderBottom: "1px solid #f5f5f4",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#f5f5f4"}
                onMouseLeave={e => e.currentTarget.style.background = isOn ? "#fafaf9" : "#ffffff"}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  border: isOn ? `2px solid ${col}` : "2px solid #d6d3d1",
                  background: isOn ? col : "#ffffff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}>
                  {isOn && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.8">
                      <polyline points="1,4 3,6 7,2" />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#1c1917" }}>{h.name}</div>
                  <div style={{ fontSize: 10, color: "#a8a29e" }}>{h.addr}</div>
                </div>
                {h.loaded && (
                  <span style={{
                    fontSize: 8, padding: "1px 5px", background: "#eff6ff",
                    color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 3,
                    fontFamily: "monospace", whiteSpace: "nowrap",
                  }}>
                    LOADED
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Map Component ────────────────────────────────────────────────────────────

function MapCanvas({ selectedId, onSelect, activeIds, onToggleHosp }) {
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const areaRef = useRef(null);

  const getPixel = useCallback((h) => {
    if (!areaRef.current) return { px: 0, py: 0 };
    const { offsetWidth: W, offsetHeight: H } = areaRef.current;
    return { px: (h.x / 800) * W, py: (h.y / 600) * H };
  }, []);

  const handleMouseEnter = (e, h) => {
    const rect = areaRef.current.getBoundingClientRect();
    let tx = e.clientX - rect.left + 16;
    let ty = e.clientY - rect.top - 12;
    if (tx + 200 > rect.width) tx = e.clientX - rect.left - 216;
    setTooltipPos({ x: tx, y: ty });
    setTooltip(h);
  };

  return (
    <div ref={areaRef} style={{ position: "relative", overflow: "hidden", background: "#f0ede8", flex: 1 }}>
      {/* SVG base map */}
      <svg
        style={{ width: "100%", height: "100%", display: "block" }}
        viewBox="0 0 800 600"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e8e5e0" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="800" height="600" fill="#f0ede8" />
        <rect width="800" height="600" fill="url(#grid)" />
        {/* Bay water */}
        <path
          d="M 480 0 L 500 80 L 520 160 L 510 240 L 490 300 L 460 360 L 430 400 L 410 440 L 400 500 L 390 560 L 380 600 L 800 600 L 800 0 Z"
          fill="#dbeafe" opacity=".5"
        />
        <path
          d="M 480 0 L 500 80 L 520 160 L 510 240 L 490 300 L 460 360 L 430 400 L 410 440 L 400 500 L 390 560 L 380 600"
          fill="none" stroke="#93c5fd" strokeWidth="1"
        />
        {/* Land */}
        <path
          d="M 0 0 L 480 0 L 500 80 L 520 160 L 510 240 L 490 300 L 460 360 L 430 400 L 410 440 L 400 500 L 380 600 L 0 600 Z"
          fill="#e8e4de"
        />
        {/* Streets */}
        {[200, 300, 400].map(y => <line key={y} x1="0" y1={y} x2="490" y2={y} stroke="#f5f2ee" strokeWidth="2.5" />)}
        {[100, 200, 300].map(x => <line key={x} x1={x} y1="0" x2={x} y2="600" stroke="#f5f2ee" strokeWidth="2" />)}
        {[50, 150, 250, 350].map(x => <line key={x} x1={x} y1="0" x2={x} y2="600" stroke="#f5f2ee" strokeWidth="1.2" />)}
        {[100, 150, 250, 350, 450].map(y => <line key={y} x1="0" y1={y} x2="510" y2={y} stroke="#f5f2ee" strokeWidth="1.2" />)}
        {/* Market St diagonal */}
        <line x1="0" y1="320" x2="460" y2="180" stroke="#ece8e2" strokeWidth="3" />
        {/* Parks */}
        <rect x="10" y="180" width="80" height="120" rx="4" fill="#d1fae5" opacity=".6" />
        <rect x="20" y="440" width="60" height="80" rx="4" fill="#d1fae5" opacity=".5" />
        {/* Labels */}
        <text x="590" y="195" fontFamily="serif" fontSize="16" fill="#93c5fd" opacity=".7" transform="rotate(-18,590,195)">San Francisco Bay</text>
        {[
          [120, 240, "MISSION"], [220, 160, "SOMA"], [55, 140, "HAYES"],
          [35, 320, "NOE VALLEY"], [305, 320, "POTRERO"],
        ].map(([x, y, label]) => (
          <text key={label} x={x} y={y} fontFamily="sans-serif" fontSize="9" fill="#a8a29e" letterSpacing="1">{label}</text>
        ))}
      </svg>

      {/* Markers — only show active hospitals */}
      {HOSPITALS.filter(h => activeIds.includes(h.id)).map(h => {
        const { px, py } = getPixel(h);
        const col = PAYER_COLORS[h.dominant];
        const isSel = selectedId === h.id;
        return (
          <div
            key={h.id}
            onMouseEnter={e => handleMouseEnter(e, h)}
            onMouseLeave={() => setTooltip(null)}
            onClick={() => onSelect(h.id)}
            style={{
              position: "absolute", left: px, top: py,
              transform: "translate(-50%, -100%)",
              cursor: "pointer",
              transition: "transform 0.15s",
              filter: isSel ? `drop-shadow(0 4px 8px ${col}66)` : "none",
            }}
            onMouseOver={e => e.currentTarget.style.transform = "translate(-50%, -100%) scale(1.15)"}
            onMouseOut={e => e.currentTarget.style.transform = "translate(-50%, -100%) scale(1)"}
          >
            <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
              <path
                d="M14 2C8.48 2 4 6.48 4 12c0 7.5 10 22 10 22s10-14.5 10-22c0-5.52-4.48-10-10-10z"
                fill={col}
              />
              <circle cx="14" cy="12" r="4" fill="white" opacity=".9" />
              {isSel && (
                <circle cx="14" cy="12" r="7" fill={col} opacity=".25"
                  style={{ animation: "pulse 2s infinite" }}
                />
              )}
            </svg>
          </div>
        );
      })}

      {/* Hospital selector overlay — top left */}
      <HospitalSelector hospitals={HOSPITALS} activeIds={activeIds} onToggle={onToggleHosp} />

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute", left: tooltipPos.x, top: tooltipPos.y,
          background: "#ffffff", border: "1px solid #e7e5e4", borderRadius: 10,
          padding: "10px 12px", boxShadow: "0 12px 32px rgba(0,0,0,.1)",
          minWidth: 190, zIndex: 10, pointerEvents: "none",
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1c1917", marginBottom: 2 }}>{tooltip.name}</div>
          <div style={{ fontSize: 11, color: "#a8a29e", marginBottom: 8 }}>{tooltip.addr}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
            {[["Payers", tooltip.payers], ["Services", (tooltip.services / 1000).toFixed(1) + "k"]].map(([label, val]) => (
              <div key={label} style={{ background: "#f5f5f4", borderRadius: 6, padding: "5px 7px" }}>
                <div style={{ fontSize: 9, color: "#a8a29e", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1c1917", fontFamily: "monospace" }}>{val}</div>
              </div>
            ))}
          </div>
          {RATE_DATA[tooltip.id] && (
            <div style={{ borderTop: "1px solid #f5f5f4", paddingTop: 8 }}>
              {RATE_DATA[tooltip.id].slice(0, 2).map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2, fontSize: 10 }}>
                  <span style={{ color: "#57534e" }}>{r.payer}</span>
                  <span style={{
                    fontFamily: "monospace", fontWeight: 500,
                    color: r.type === "dollar" ? "#16a34a" : r.type === "pct" ? "#d97706" : "#a8a29e",
                  }}>{r.val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div style={{ position: "absolute", top: 16, right: 16, display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          { label: "+", title: "Zoom in" },
          { label: "−", title: "Zoom out" },
        ].map(btn => (
          <button key={btn.label} title={btn.title} style={{
            width: 32, height: 32, background: "#ffffff", border: "1px solid #e7e5e4",
            borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: 16, color: "#57534e", fontFamily: "inherit",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 16, left: 16,
        background: "#ffffff", border: "1px solid #e7e5e4", borderRadius: 10,
        padding: "10px 12px", boxShadow: "0 4px 12px rgba(0,0,0,.08)", minWidth: 160,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 600, color: "#a8a29e", letterSpacing: "0.06em",
          textTransform: "uppercase", marginBottom: 8,
        }}>Rate Type</div>
        {[
          ["#16a34a", "Fixed dollar rate"],
          ["#d97706", "% of Medicare"],
          ["#7c3aed", "Algorithm / formula"],
          ["#6b7280", "No rate data"],
        ].map(([color, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, fontSize: 11, color: "#57534e" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
            {label}
          </div>
        ))}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.5)} }`}</style>
    </div>
  );
}

// ─── Chat Component ───────────────────────────────────────────────────────────

function ChatPanel({ isOpen, onClose }) {
  const [messages, setMessages] = useState([
    {
      id: 0, who: "bot",
      text: "👋 I'm your price transparency assistant. Ask me to compare rates, look up a code, or find the best payer for a specific procedure.",
      time: "Just now",
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [showSugs, setShowSugs] = useState(true);
  const msgsRef = useRef(null);

  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const addMsg = (text, who) => {
    setMessages(prev => [...prev, { id: Date.now(), who, text, time: now() }]);
    setTimeout(() => { if (msgsRef.current) msgsRef.current.scrollTop = 9999; }, 50);
  };

  const botReply = (q) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      const key = Object.keys(BOT_REPLIES).find(k => q.toLowerCase().includes(k));
      addMsg(key ? BOT_REPLIES[key] : "I can help you compare rates by code, payer, or hospital. Try asking about a specific HCPCS code.", "bot");
    }, 1200);
  };

  const send = (text) => {
    if (!text.trim()) return;
    setShowSugs(false);
    addMsg(text, "user");
    setInput("");
    botReply(text);
  };

  const SUGS = ["Compare Aetna vs Blue Shield", "Look up HCPCS 10005", "Which hospital is cheapest?"];

  return (
    <div style={{
      position: "absolute", bottom: 74, right: 20, width: 320,
      background: "#ffffff", border: "1px solid #e7e5e4", borderRadius: 14,
      boxShadow: "0 12px 32px rgba(0,0,0,.1)", display: "flex", flexDirection: "column",
      overflow: "hidden", zIndex: 20,
      transform: isOpen ? "scale(1) translateY(0)" : "scale(0.95) translateY(10px)",
      opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "all" : "none",
      transition: "all 0.2s", transformOrigin: "bottom right",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 14px", borderBottom: "1px solid #e7e5e4",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, background: "#18181b", borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.8">
            <path d="M8 2C5.24 2 3 4.24 3 7c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" />
            <circle cx="8" cy="7" r="1.5" fill="white" stroke="none" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1c1917" }}>ClearRate Assistant</div>
          <div style={{ fontSize: 10, color: "#16a34a", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 5, height: 5, background: "#16a34a", borderRadius: "50%" }} />
            Online
          </div>
        </div>
        <button onClick={onClose} style={{
          width: 24, height: 24, borderRadius: 6, border: "1px solid #e7e5e4",
          background: "#f5f5f4", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "#a8a29e",
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8">
            <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={msgsRef} style={{ height: 200, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.map(m => (
          <div key={m.id} style={{ maxWidth: "85%", alignSelf: m.who === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              padding: "8px 11px", fontSize: 12, lineHeight: 1.5,
              borderRadius: m.who === "bot" ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
              background: m.who === "bot" ? "#f5f5f4" : "#18181b",
              color: m.who === "bot" ? "#1c1917" : "#ffffff",
              whiteSpace: "pre-line",
            }}>
              {m.text}
            </div>
            <div style={{
              fontSize: 9, color: "#a8a29e", marginTop: 3, fontFamily: "monospace",
              textAlign: m.who === "user" ? "right" : "left",
            }}>
              {m.time}
            </div>
          </div>
        ))}
        {typing && (
          <div style={{ alignSelf: "flex-start" }}>
            <div style={{
              padding: "10px 14px", background: "#f5f5f4", borderRadius: "4px 12px 12px 12px",
              display: "flex", gap: 4, alignItems: "center",
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 5, height: 5, background: "#a8a29e", borderRadius: "50%",
                  animation: `bounce 0.9s ${i * 0.15}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Suggestions */}
      {showSugs && (
        <div style={{ padding: "0 12px 8px", display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SUGS.map(s => (
            <button key={s} onClick={() => send(s)} style={{
              fontSize: 10, padding: "4px 8px", borderRadius: 20,
              border: "1px solid #e7e5e4", background: "#ffffff", color: "#57534e",
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#2563eb"; e.currentTarget.style.color = "#2563eb"; e.currentTarget.style.background = "#eff6ff"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#e7e5e4"; e.currentTarget.style.color = "#57534e"; e.currentTarget.style.background = "#ffffff"; }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderTop: "1px solid #e7e5e4" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send(input)}
          placeholder="Ask about rates, codes, payers…"
          style={{
            flex: 1, border: "1px solid #e7e5e4", borderRadius: 6, padding: "6px 9px",
            fontSize: 12, color: "#1c1917", background: "#f5f5f4", outline: "none", fontFamily: "inherit",
          }}
          onFocus={e => { e.target.style.borderColor = "#2563eb"; e.target.style.background = "#ffffff"; }}
          onBlur={e => { e.target.style.borderColor = "#e7e5e4"; e.target.style.background = "#f5f5f4"; }}
        />
        <button onClick={() => send(input)} style={{
          width: 28, height: 28, background: "#18181b", border: "none", borderRadius: 6,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2">
            <line x1="1" y1="11" x2="11" y2="1" /><polyline points="5,1 11,1 11,7" />
          </svg>
        </button>
      </div>

      <style>{`@keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }`}</style>
    </div>
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────

export default function PriceTransparencyExplorer() {
  const [location, setLocation] = useState("San Francisco, CA");
  const [setting, setSetting] = useState("outpatient");
  const [codeType, setCodeType] = useState("All");
  const [payer, setPayer] = useState("All");
  const [planType, setPlanType] = useState("All");
  const [codeQuery, setCodeQuery] = useState("");
  const [selectedHosp, setSelectedHosp] = useState("sutter-davis");
  const [activeHosps, setActiveHosps] = useState(HOSPITALS.map(h => h.id));
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(true);

  const selectedHospObj = HOSPITALS.find(h => h.id === selectedHosp) || null;

  const handleSelectHosp = (id) => setSelectedHosp(prev => prev === id ? null : id);

  const handleToggleHosp = (id) => {
    setActiveHosps(prev =>
      prev.includes(id)
        ? prev.length > 1 ? prev.filter(x => x !== id) : prev
        : [...prev, id]
    );
  };

  const handleChatToggle = () => {
    setChatOpen(prev => !prev);
    if (!chatOpen) setChatUnread(false);
  };

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "340px 1fr", height: "100vh", overflow: "hidden",
      fontFamily: "'Instrument Sans', 'Segoe UI', system-ui, sans-serif",
      fontSize: 14, color: "#1c1917", background: "#fafaf9",
    }}>

      {/* ── Sidebar ── */}
      <div style={{
        background: "#ffffff", borderRight: "1px solid #e7e5e4",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
          <Logo />
          <LocationBar location={location} onChangeLocation={() => setLocation("San Francisco, CA")} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
          <div style={{ marginBottom: 14 }}>
            <FilterLabel>Setting</FilterLabel>
            <SettingToggle value={setting} onChange={setSetting} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <FilterLabel>Code Type</FilterLabel>
            <PillGroup
              options={["All", "HCPCS", "APC", "MS-DRG", "RC", "NDC"]}
              value={codeType}
              onChange={setCodeType}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <FilterLabel>Code Lookup</FilterLabel>
            <input
              value={codeQuery}
              onChange={e => setCodeQuery(e.target.value)}
              placeholder="Search code or description…"
              style={{
                width: "100%", border: "1px solid #e7e5e4", borderRadius: 6,
                padding: "7px 10px", fontFamily: "monospace", fontSize: 12,
                color: "#1c1917", background: "#ffffff", outline: "none",
                transition: "border-color 0.15s",
              }}
              onFocus={e => { e.target.style.borderColor = "#2563eb"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.08)"; }}
              onBlur={e => { e.target.style.borderColor = "#e7e5e4"; e.target.style.boxShadow = "none"; }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <FilterLabel>Payer</FilterLabel>
            <PillGroup
              options={["All", "Aetna", "Anthem", "Blue Shield", "Cigna", "Health Net", "United"]}
              value={payer}
              onChange={setPayer}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <FilterLabel>Plan Type</FilterLabel>
            <PillGroup
              options={["All", "HMO/PPO", "Medicare Adv.", "Medi-Cal", "Individual"]}
              value={planType}
              onChange={setPlanType}
            />
          </div>

          <RatesPanel
            hospital={selectedHospObj}
            code={codeQuery ? `Code: ${codeQuery.toUpperCase()}` : ""}
          />
        </div>
      </div>

      {/* ── Map ── */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
        <MapCanvas
          selectedId={selectedHosp}
          onSelect={handleSelectHosp}
          activeIds={activeHosps}
          onToggleHosp={handleToggleHosp}
        />

        {/* Chat FAB */}
        <button
          onClick={handleChatToggle}
          style={{
            position: "absolute", bottom: 20, right: 20, width: 44, height: 44,
            background: "#18181b", borderRadius: "50%", display: "flex",
            alignItems: "center", justifyContent: "center",
            cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
            transition: "all 0.2s", zIndex: 20, border: "none",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.2)"; }}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="white">
            <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H9l-4 3v-3H4a2 2 0 01-2-2V5z" />
          </svg>
          {chatUnread && (
            <div style={{
              position: "absolute", top: -2, right: -2, width: 14, height: 14,
              background: "#ef4444", borderRadius: "50%", border: "2px solid #fafaf9",
              fontSize: 8, color: "#ffffff", display: "flex", alignItems: "center",
              justifyContent: "center", fontWeight: 600,
            }}>1</div>
          )}
        </button>

        <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      </div>
    </div>
  );
}
