import { useState } from "react";
import { generateWeekSlots } from "../utils/calc";

export default function WeeklyLoanModal({ onClose, onSave, editLoan = null }) {
  const [form, setForm] = useState({
    principal: editLoan?.principal || "",
    weeklyAmount: editLoan?.weeklyAmount || "",
    totalWeeks: editLoan?.totalWeeks || "",
    startDate: editLoan?.startDate || new Date().toISOString().split("T")[0],
    notes: editLoan?.notes || "",
  });
  const [error, setError] = useState("");

  function set(f, v) { setForm(p => ({ ...p, [f]: v })); }

  const totalReceivable = form.weeklyAmount && form.totalWeeks
    ? Number(form.weeklyAmount) * Number(form.totalWeeks) : 0;
  const interestEarned = totalReceivable - Number(form.principal || 0);

  function handleSave() {
    if (!form.principal || !form.weeklyAmount || !form.totalWeeks || !form.startDate) {
      setError("Please fill all required fields."); return;
    }
    if (Number(form.totalWeeks) < 1) { setError("Total weeks must be at least 1."); return; }
    if (Number(form.weeklyAmount) < 1) { setError("Weekly amount must be at least 1."); return; }

    const newTotal = Number(form.totalWeeks);

    // Smart slot merge: regenerate all slots from new startDate/totalWeeks
    // but PRESERVE paid status from existing slots matched by week number
    const existingSlots = editLoan?.weekSlots || [];
    const freshSlots = generateWeekSlots(form.startDate, newTotal, []);

    const mergedSlots = freshSlots.map((freshSlot, i) => {
      const existing = existingSlots[i]; // match by position (week number)
      if (existing && existing.paid) {
        // Keep paid slot but update label/dueDate to new dates
        return {
          ...freshSlot,
          paid: true,
          paidDate: existing.paidDate,
        };
      }
      return freshSlot;
    });

    onSave({
      id: editLoan?.id || Date.now().toString(),
      principal: Number(form.principal),
      weeklyAmount: Number(form.weeklyAmount),
      totalWeeks: newTotal,
      startDate: form.startDate,
      notes: form.notes,
      interestEarned,
      totalCollected: mergedSlots.filter(s => s.paid).length * Number(form.weeklyAmount),
      weekSlots: mergedSlots,
      paymentHistory: editLoan?.paymentHistory || [],
      principalReturned: editLoan?.principalReturned || 0,
      fullySettled: editLoan?.fullySettled || false,
      createdAt: editLoan?.createdAt || new Date().toISOString(),
    });
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <h3 style={s.title}>{editLoan ? "Edit Weekly Finance" : "Add Weekly Finance"}</h3>
          <button style={s.close} onClick={onClose}>x</button>
        </div>
        <div style={s.body}>
          <div style={s.infoBox}>
            Weekly finance: Give a lump sum, collect fixed weekly installments.
            E.g. Give Rs 9,000 and collect Rs 1,000/week x 10 weeks = Rs 10,000 (Rs 1,000 interest)
          </div>

          <div style={s.grid2}>
            <Field label="Amount Given (Rs)*" value={form.principal} onChange={v => set("principal", v)} type="number" placeholder="9000" />
            <Field label="Weekly Collection (Rs)*" value={form.weeklyAmount} onChange={v => set("weeklyAmount", v)} type="number" placeholder="1000" />
          </div>
          <div style={s.grid2}>
            <Field label="Total Weeks*" value={form.totalWeeks} onChange={v => set("totalWeeks", v)} type="number" placeholder="10" />
            <Field label="Start Date*" value={form.startDate} onChange={v => set("startDate", v)} type="date" />
          </div>
          <Field label="Notes (optional)" value={form.notes} onChange={v => set("notes", v)} placeholder="Purpose, remarks..." />

          {totalReceivable > 0 && (
            <div style={s.calcBox}>
              <div style={s.calcTitle}>Calculation Preview</div>
              <div style={s.calcGrid}>
                <CalcItem label="Weekly Collection" value={"Rs " + Number(form.weeklyAmount).toLocaleString("en-IN")} highlight />
                <CalcItem label="Total Receivable" value={"Rs " + totalReceivable.toLocaleString("en-IN")} />
                <CalcItem label="Amount Given" value={"Rs " + Number(form.principal).toLocaleString("en-IN")} />
                <CalcItem label="Interest Earned" value={"Rs " + interestEarned.toLocaleString("en-IN")} green />
              </div>
            </div>
          )}

          {editLoan && (
            <div style={s.editNote}>
              Note: Paid weeks will be preserved. Only dates will update based on new start date.
            </div>
          )}

          {error && <div style={s.error}>{error}</div>}
          <div style={s.footer}>
            <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
            <button style={s.saveBtn} onClick={handleSave}>
              {editLoan ? "Update Weekly Finance" : "Add Weekly Finance"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={s.label}>{label}</label>
      <input style={s.input} type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function CalcItem({ label, value, highlight, green }) {
  return (
    <div style={{ ...s.calcItem, ...(highlight ? s.calcHighlight : green ? s.calcGreen : {}) }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: green ? "#10b981" : "white" }}>{value}</div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#1e2130", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: 16, fontWeight: 800, color: "white" },
  close: { background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" },
  body: { padding: "18px 22px", overflowY: "auto" },
  infoBox: { background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#d97706", marginBottom: 16, lineHeight: 1.6 },
  editNote: { background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#818cf8", marginBottom: 12 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "white", fontSize: 14, outline: "none", boxSizing: "border-box" },
  calcBox: { background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 12, padding: 14, marginBottom: 14 },
  calcTitle: { fontSize: 12, fontWeight: 700, color: "#f59e0b", marginBottom: 10 },
  calcGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  calcItem: { background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "10px 12px" },
  calcHighlight: { background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.3)" },
  calcGreen: { background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" },
  error: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#fca5a5", marginBottom: 12 },
  footer: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 },
  cancelBtn: { padding: "10px 20px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 },
};
