import { useState } from "react";
import { calcMonthlyInterest, calcTotalPayable, generateMonthSlots } from "../utils/calc";

export default function LoanModal({ onClose, onSave, editLoan = null }) {
  const isTopUpMode = editLoan && (editLoan?.monthSlots || []).filter(s => s.paid).length > 0;

  const [form, setForm] = useState({
    // In top-up mode: topUpAmount = additional amount to lend
    // In normal mode: principal = total principal
    principal:      !isTopUpMode ? (editLoan?.principal || "") : "",
    topUpAmount:    "",
    ratePerHundred: editLoan?.ratePerHundred || "",
    durationMonths: editLoan?.durationMonths || "",
    startDate:      editLoan?.startDate || new Date().toISOString().split("T")[0],
    notes:          editLoan?.notes || "",
  });
  const [error, setError] = useState("");
  const [screen, setScreen] = useState("none"); // "none"|"topup_preview"|"reset_confirm"

  const paidSlots    = (editLoan?.monthSlots || []).filter(s => s.paid);
  const paidCount    = paidSlots.length;
  const hasPaidMonths = paidCount > 0;

  // Current outstanding = original principal - principalReturned (what client still owes back)
  const currentOutstanding = editLoan
    ? editLoan.principal - (editLoan.principalReturned || 0)
    : 0;

  // In top-up mode: new EMI is based on (outstanding + topUpAmount) × rate
  // In normal mode: new EMI is based on newPrincipal × rate
  const topUpAmt   = Number(form.topUpAmount) || 0;
  const newRate    = Number(form.ratePerHundred) || 0;
  const newDuration = Number(form.durationMonths) || 0;

  // Effective principal for EMI calculation
  const emiPrincipal = isTopUpMode
    ? currentOutstanding + topUpAmt          // outstanding + new money
    : (Number(form.principal) || 0);

  const monthly = emiPrincipal && newRate ? calcMonthlyInterest(emiPrincipal, newRate) : 0;
  const total   = monthly && newDuration   ? calcTotalPayable(emiPrincipal, newRate, newDuration) : 0;

  // For saved loan: principal = original principal + topUpAmount (total money ever given)
  const savedPrincipal = isTopUpMode
    ? (editLoan?.principal || 0) + topUpAmt
    : (Number(form.principal) || 0);

  const firstUnpaidSlot = (editLoan?.monthSlots || []).find(s => !s.paid);
  const newEmiFromLabel = firstUnpaidSlot?.label || "next month";

  // Non-top-up edit: detect changes
  const rateChanged      = !isTopUpMode && editLoan && newRate !== editLoan.ratePerHundred;
  const startDateChanged = !isTopUpMode && editLoan && form.startDate !== editLoan.startDate;
  const hasHistory       = (editLoan?.paymentHistory || []).length > 0 ||
    (editLoan?.monthSlots || []).some(s => s.customEmi !== undefined) ||
    (editLoan?.principalReturned || 0) > 0 || editLoan?.fullySettled;

  const coreChangedNormal = !isTopUpMode && editLoan && (
    savedPrincipal !== editLoan.principal ||
    newRate !== editLoan.ratePerHundred ||
    newDuration !== editLoan.durationMonths ||
    startDateChanged
  );

  function set(f, v) { setForm(p => ({ ...p, [f]: v })); }

  function handleSave() {
    if (isTopUpMode) {
      // Top-up validation
      if (!form.topUpAmount || !form.ratePerHundred || !form.durationMonths) {
        setError("Please fill additional amount, rate and duration."); return;
      }
      if (topUpAmt <= 0) { setError("Additional amount must be positive."); return; }
      if (newDuration <= paidCount) {
        setError("Duration must be greater than paid months (" + paidCount + ")."); return;
      }
      setError("");
      setScreen("topup_preview");
      return;
    }
    // Normal save
    if (!form.principal || !form.ratePerHundred || !form.durationMonths || !form.startDate) {
      setError("Please fill all required fields."); return;
    }
    setError("");
    if (!coreChangedNormal) { doSave("normal"); return; }
    if (!hasHistory && !hasPaidMonths) { doSave("reset"); return; }
    setScreen("reset_confirm");
  }

  function doSave(mode) {
    if (mode === "topup") {
      const newEmi = monthly;
      const allExisting = editLoan.monthSlots || [];
      const fullSlots = generateMonthSlots(editLoan.startDate, newDuration, allExisting);
      // For paid slots: return exact original BUT stamp customEmi if not already set.
      // This locks the amount at the rate that was in force when it was paid,
      // preventing recalculation after the new monthlyInterest is stored.
      const oldEmiRate = editLoan.monthlyInterest;
      const updatedSlots = fullSlots.map(slot => {
        const originalPaid = paidSlots.find(p => p.id === slot.id);
        if (originalPaid) {
          // Lock the paid amount: use existing customEmi if set, else stamp old monthlyInterest
          if (originalPaid.customEmi !== undefined) return originalPaid;
          return { ...originalPaid, customEmi: oldEmiRate }; // stamp to freeze it
        }
        const { customEmi, ...base } = slot;
        return base; // unpaid: clear customEmi, new base rate applies
      });
      const note = "Top-up: +" + topUpAmt.toLocaleString("en-IN") +
        " | Outstanding was Rs " + currentOutstanding.toLocaleString("en-IN") +
        " | New EMI principal: Rs " + emiPrincipal.toLocaleString("en-IN") +
        " @ " + newRate + "%" +
        " | Old EMI: Rs " + (editLoan.currentEmi || editLoan.monthlyInterest).toLocaleString("en-IN") +
        " → New EMI: Rs " + newEmi.toLocaleString("en-IN") +
        " from " + newEmiFromLabel +
        " | " + paidCount + " paid month" + (paidCount > 1 ? "s" : "") + " preserved";
      onSave({
        id: editLoan.id,
        principal: savedPrincipal,              // original + topUp = total ever given
        ratePerHundred: newRate,
        durationMonths: newDuration,
        startDate: editLoan.startDate,           // NEVER change startDate
        notes: form.notes || editLoan.notes,
        monthlyInterest: newEmi,
        totalPayable: total,
        totalCollected: editLoan.totalCollected || 0,
        monthSlots: updatedSlots,
        paymentHistory: [
          { action: "TOP_UP", month: "-", monthNum: 0, amount: topUpAmt, note, date: new Date().toISOString() },
          ...(editLoan.paymentHistory || [])
        ],
        principalReturned: editLoan.principalReturned || 0,
        currentEmi: newEmi,
        fullySettled: false,
        createdAt: editLoan.createdAt || new Date().toISOString(),
      });
      return;
    }

    if (mode === "reset") {
      onSave({
        id: editLoan?.id || Date.now().toString(),
        principal: savedPrincipal, ratePerHundred: newRate, durationMonths: newDuration,
        startDate: form.startDate, notes: form.notes,
        monthlyInterest: monthly, totalPayable: total, totalCollected: 0,
        monthSlots: generateMonthSlots(form.startDate, newDuration, []),
        paymentHistory: [], principalReturned: 0, currentEmi: monthly, fullySettled: false,
        createdAt: editLoan?.createdAt || new Date().toISOString(),
      });
      return;
    }

    // normal (no reset)
    const existingSlots = editLoan?.monthSlots || [];
    const cleanSlots = existingSlots.map(s => { const { customEmi, ...r } = s; return r; });
    onSave({
      id: editLoan?.id || Date.now().toString(),
      principal: savedPrincipal, ratePerHundred: newRate, durationMonths: newDuration,
      startDate: form.startDate, notes: form.notes,
      monthlyInterest: monthly, totalPayable: total,
      totalCollected: editLoan?.totalCollected || 0,
      monthSlots: generateMonthSlots(form.startDate, newDuration, cleanSlots),
      paymentHistory: editLoan?.paymentHistory || [],
      principalReturned: editLoan?.principalReturned || 0,
      currentEmi: editLoan?.currentEmi || monthly,
      fullySettled: editLoan?.fullySettled || false,
      createdAt: editLoan?.createdAt || new Date().toISOString(),
    });
  }

  // ── TOP-UP PREVIEW ─────────────────────────────────────────────
  if (screen === "topup_preview") {
    const oldEmi = editLoan?.currentEmi || editLoan?.monthlyInterest || 0;
    const remainingUnpaid = newDuration - paidCount;
    return (
      <div style={s.overlay} onClick={() => setScreen("none")}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.header}>
            <h3 style={{ ...s.title, color: "#10b981" }}>💰 Top-Up Preview</h3>
            <button style={s.close} onClick={() => setScreen("none")}>✕</button>
          </div>
          <div style={s.body}>
            <div style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 13, color: "#6ee7b7", lineHeight: 1.7 }}>
              <strong style={{ color: "#10b981" }}>✅ {paidCount} paid month{paidCount > 1 ? "s" : ""} locked — untouched.</strong><br />
              New EMI of <strong>Rs {monthly.toLocaleString("en-IN")}</strong> applies from <strong>{newEmiFromLabel}</strong> ({remainingUnpaid} month{remainingUnpaid > 1 ? "s" : ""}).
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <SummaryItem label="Original Principal" value={"Rs " + (editLoan?.principal || 0).toLocaleString("en-IN")} />
              <SummaryItem label="Additional Amount" value={"+ Rs " + topUpAmt.toLocaleString("en-IN")} color="#10b981" />
              <SummaryItem label="Outstanding (before)" value={"Rs " + currentOutstanding.toLocaleString("en-IN")} color="#f59e0b" />
              <SummaryItem label="EMI Principal (new)" value={"Rs " + emiPrincipal.toLocaleString("en-IN")} color="#818cf8" />
              <SummaryItem label="Old EMI" value={"Rs " + oldEmi.toLocaleString("en-IN")} />
              <SummaryItem label="New EMI" value={"Rs " + monthly.toLocaleString("en-IN")} color="#818cf8" />
              <SummaryItem label="Paid Months (locked)" value={paidCount + " month" + (paidCount > 1 ? "s" : "")} color="#f59e0b" />
              <SummaryItem label="Remaining Months" value={remainingUnpaid + " month" + (remainingUnpaid > 1 ? "s" : "")} />
            </div>
            <div style={s.footer}>
              <button style={s.cancelBtn} onClick={() => setScreen("none")}>← Back</button>
              <button style={{ ...s.saveBtn, background: "linear-gradient(135deg, #059669, #10b981)" }}
                onClick={() => doSave("topup")}>✅ Apply Top-Up</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── RESET CONFIRM ──────────────────────────────────────────────
  if (screen === "reset_confirm") {
    return (
      <div style={s.overlay} onClick={() => setScreen("none")}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.header}>
            <h3 style={{ ...s.title, color: "#f59e0b" }}>⚠️ Full Reset Required</h3>
            <button style={s.close} onClick={() => setScreen("none")}>✕</button>
          </div>
          <div style={s.body}>
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 13, color: "#fca5a5", lineHeight: 1.7 }}>
              <strong>This change requires a full reset.</strong><br />
              {startDateChanged && <span>• Start date changed<br /></span>}
              {rateChanged && <span>• Interest rate changed<br /></span>}
              <br />All payment history and records will be cleared.
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 14 }}>
              For top-up (keep paid months), use this modal when paid months exist — it will show the top-up form automatically.
            </div>
            <div style={s.footer}>
              <button style={s.cancelBtn} onClick={() => setScreen("none")}>← Back</button>
              <button style={{ ...s.saveBtn, background: "linear-gradient(135deg, #dc2626, #ef4444)" }}
                onClick={() => doSave("reset")}>Reset &amp; Save</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── TOP-UP FORM (when paid months exist) ──────────────────────
  if (isTopUpMode) {
    return (
      <div style={s.overlay} onClick={onClose}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.header}>
            <h3 style={{ ...s.title, color: "#10b981" }}>💰 Top-Up Loan</h3>
            <button style={s.close} onClick={onClose}>✕</button>
          </div>
          <div style={s.body}>
            <div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#6ee7b7", lineHeight: 1.6 }}>
              💰 Top-up adds new money on top of outstanding balance.<br />
              <strong>New EMI = (Outstanding Rs {currentOutstanding.toLocaleString("en-IN")} + Additional Amount) × New Rate</strong><br />
              {paidCount} paid month{paidCount > 1 ? "s" : ""} (locked) · From <strong>{newEmiFromLabel}</strong> onwards.
            </div>

            {/* Read-only summary */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "9px 11px" }}>
                <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>Original Principal</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>Rs {(editLoan?.principal || 0).toLocaleString("en-IN")}</div>
              </div>
              <div style={{ background: "rgba(245,158,11,0.06)", borderRadius: 8, padding: "9px 11px" }}>
                <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>Outstanding Now</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>Rs {currentOutstanding.toLocaleString("en-IN")}</div>
              </div>
            </div>

            <div style={s.grid2}>
              <Field label="Additional Amount (₹)*" value={form.topUpAmount} onChange={v => set("topUpAmount", v)} placeholder="50000" type="number" />
              <Field label="New Rate (₹ per ₹100)*" value={form.ratePerHundred} onChange={v => set("ratePerHundred", v)} placeholder="5" type="number" step="0.1" />
            </div>
            <div style={s.grid2}>
              <Field label="Total Months*" value={form.durationMonths} onChange={v => set("durationMonths", v)} placeholder={String((editLoan?.durationMonths || 0) + 6)} type="number" />
              <div style={{ marginBottom: 14 }}>
                <label style={s.label}>Start Date 🔒</label>
                <input style={{ ...s.input, opacity: 0.5, cursor: "not-allowed" }} type="date" value={editLoan?.startDate || ""} readOnly />
                <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>Locked — {paidCount} month{paidCount > 1 ? "s" : ""} paid</div>
              </div>
            </div>
            <Field label="Notes (optional)" value={form.notes} onChange={v => set("notes", v)} placeholder="Top-up reason..." />

            {monthly > 0 && (
              <div style={s.calcBox}>
                <div style={s.calcTitle}>📊 New EMI Calculation</div>
                <div style={s.calcGrid}>
                  <CalcItem label="EMI Principal" value={`₹${emiPrincipal.toLocaleString("en-IN")}`} />
                  <CalcItem label="New Monthly EMI" value={`₹${monthly.toLocaleString("en-IN")}`} highlight />
                  <CalcItem label="Remaining Months" value={`${newDuration - paidCount}`} />
                  <CalcItem label="New Total Interest" value={`₹${total.toLocaleString("en-IN")}`} />
                </div>
              </div>
            )}

            {error && <div style={s.error}>{error}</div>}
            <div style={s.footer}>
              <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
              <button style={{ ...s.saveBtn, background: "linear-gradient(135deg, #059669, #10b981)" }}
                onClick={handleSave}>Review Top-Up →</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── NORMAL ADD / EDIT FORM ─────────────────────────────────────
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <h3 style={s.title}>{editLoan ? "Edit Loan" : "Add New Loan"}</h3>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>
        <div style={s.body}>
          <div style={s.grid2}>
            <Field label="Principal Amount (₹)*" value={form.principal} onChange={v => set("principal", v)} placeholder="50000" type="number" />
            <Field label="Rate (₹ per ₹100/month)*" value={form.ratePerHundred} onChange={v => set("ratePerHundred", v)} placeholder="3" type="number" step="0.1" />
          </div>
          <div style={s.grid2}>
            <Field label="Duration (months)*" value={form.durationMonths} onChange={v => set("durationMonths", v)} placeholder="12" type="number" />
            <Field label="Start Date*" value={form.startDate} onChange={v => set("startDate", v)} type="date" />
          </div>
          <Field label="Notes (optional)" value={form.notes} onChange={v => set("notes", v)} placeholder="Purpose, remarks..." />

          {coreChangedNormal && hasHistory && (
            <div style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#f59e0b" }}>
              ⚠️ This change will require a full reset — all payment history will be cleared.
            </div>
          )}

          {monthly > 0 && (
            <div style={s.calcBox}>
              <div style={s.calcTitle}>📊 Calculation</div>
              <div style={s.calcGrid}>
                <CalcItem label="Monthly Interest" value={`₹${monthly.toLocaleString("en-IN")}`} highlight />
                <CalcItem label="Total Payable" value={`₹${total.toLocaleString("en-IN")}`} />
                <CalcItem label="Duration" value={`${form.durationMonths} months`} />
                <CalcItem label="Principal" value={`₹${savedPrincipal.toLocaleString("en-IN")}`} />
              </div>
            </div>
          )}

          {error && <div style={s.error}>{error}</div>}
          <div style={s.footer}>
            <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
            <button style={s.saveBtn} onClick={handleSave}>{editLoan ? "Update Loan" : "Add Loan"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "9px 11px" }}>
      <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || "white" }}>{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", step }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={s.label}>{label}</label>
      <input style={s.input} type={type} value={value} step={step} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function CalcItem({ label, value, highlight }) {
  return (
    <div style={{ ...s.calcItem, ...(highlight ? s.calcHighlight : {}) }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "white" }}>{value}</div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#1e2130", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, width: "100%", maxWidth: 540, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: 16, fontWeight: 800, color: "white" },
  close: { background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" },
  body: { padding: "18px 22px", overflowY: "auto" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "white", fontSize: 14, outline: "none", boxSizing: "border-box" },
  calcBox: { background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 12, padding: 14, marginBottom: 14 },
  calcTitle: { fontSize: 12, fontWeight: 700, color: "#818cf8", marginBottom: 10 },
  calcGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  calcItem: { background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "10px 12px" },
  calcHighlight: { background: "rgba(99,102,241,0.25)", border: "1px solid rgba(99,102,241,0.4)" },
  error: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#fca5a5", marginBottom: 12 },
  footer: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 },
  cancelBtn: { padding: "10px 20px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 },
};
