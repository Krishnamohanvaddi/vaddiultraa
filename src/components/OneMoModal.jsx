import { useState } from "react";
import { calcMonthlyInterest, generateMonthSlots } from "../utils/calc";

export default function OneMoModal({ onClose, onSave, editLoan = null }) {
  const [principal, setPrincipal] = useState(editLoan?.principal || "");
  const [rate, setRate] = useState(editLoan?.ratePerHundred || "");
  const [startDate, setStartDate] = useState(editLoan?.startDate || new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState(editLoan?.notes || "");
  const [error, setError] = useState("");

  const p = Number(principal) || 0;
  const r = Number(rate) || 0;
  const emi = p && r ? calcMonthlyInterest(p, r) : 0;

  // Due date = same day next month (e.g. taken 14 March → due 14 April)
  const dueDate = (() => {
    if (!startDate) return null;
    const d = new Date(startDate);
    return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
  })();

  function handleSave() {
    if (!principal || !rate || !startDate) { setError("Please fill all required fields."); return; }
    if (p <= 0 || r <= 0) { setError("Principal and rate must be positive."); return; }
    setError("");
    // 1-month slot: use the DUE month (startDate + 1 month) as the slot id
    // so isOverdue fires correctly when today > same day next month
    const slotMonth = dueDate;
    const slotId = slotMonth.getFullYear() + "-" + String(slotMonth.getMonth() + 1).padStart(2, "0");
    const slotLabel = slotMonth.toLocaleString("default", { month: "long", year: "numeric" });
    const billingDay = slotMonth.getDate(); // = same day as start date
    const slot = {
      id: slotId,
      label: slotLabel,
      paid: editLoan?.monthSlots?.[0]?.paid || false,
      paidDate: editLoan?.monthSlots?.[0]?.paidDate || null,
      billingDay,
    };
    onSave({
      id: editLoan?.id || Date.now().toString(),
      loanType: "oneMonth",
      principal: p,
      ratePerHundred: r,
      durationMonths: 1,
      startDate,
      notes,
      monthlyInterest: emi,
      totalPayable: emi,
      totalCollected: editLoan?.totalCollected || 0,
      monthSlots: [slot],
      paymentHistory: editLoan?.paymentHistory || [],
      principalReturned: 0,
      currentEmi: emi,
      fullySettled: false,
      createdAt: editLoan?.createdAt || new Date().toISOString(),
    });
    onClose(); // ← close modal after save
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <h3 style={s.title}>⚡ {editLoan ? "Edit" : "Add"} 1 Month Loan</h3>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>
        <div style={s.body}>
          <div style={s.info}>
            Single-month EMI. Due on <strong>{dueDate ? dueDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—"}</strong>. Overdue if not paid after that date.
          </div>
          <div style={s.grid2}>
            <Field label="Principal (₹)*" value={principal} onChange={setPrincipal} placeholder="50000" type="number" />
            <Field label="Rate (₹ per ₹100)*" value={rate} onChange={setRate} placeholder="3" type="number" step="0.1" />
          </div>
          <Field label="Start Date (taken date)*" value={startDate} onChange={setStartDate} type="date" />
          <Field label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Purpose, remarks..." />

          {emi > 0 && (
            <div style={s.calcBox}>
              <div style={s.calcRow}>
                <span style={s.calcLabel}>Monthly EMI</span>
                <span style={s.calcVal}>₹{emi.toLocaleString("en-IN")}</span>
              </div>
              <div style={s.calcRow}>
                <span style={s.calcLabel}>Principal</span>
                <span style={{ color: "#94a3b8", fontWeight: 700 }}>₹{p.toLocaleString("en-IN")}</span>
              </div>
              <div style={s.calcRow}>
                <span style={s.calcLabel}>Due Date</span>
                <span style={{ color: "#06b6d4", fontWeight: 700 }}>
                  {dueDate?.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>
              <div style={s.calcRow}>
                <span style={s.calcLabel}>Overdue after</span>
                <span style={{ color: "#ef4444", fontSize: 12 }}>
                  {dueDate?.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>
            </div>
          )}

          {error && <div style={s.error}>{error}</div>}
          <div style={s.footer}>
            <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
            <button style={s.saveBtn} onClick={handleSave}>{editLoan ? "Update" : "Add"} 1 Month Loan</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", step }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={s.label}>{label}</label>
      <input style={s.input} type={type} value={value} step={step}
        placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#1e2130", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 20, width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: 16, fontWeight: 800, color: "#06b6d4" },
  close: { background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" },
  body: { padding: "18px 22px", overflowY: "auto" },
  info: { background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#67e8f9", marginBottom: 16, lineHeight: 1.6 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "white", fontSize: 14, outline: "none", boxSizing: "border-box" },
  calcBox: { background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 },
  calcRow: { display: "flex", justifyContent: "space-between", fontSize: 13, alignItems: "center" },
  calcLabel: { color: "#64748b" },
  calcVal: { fontSize: 18, fontWeight: 900, color: "#06b6d4" },
  error: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#fca5a5", marginBottom: 12 },
  footer: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 },
  cancelBtn: { padding: "10px 20px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #0891b2, #06b6d4)", color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 },
};
