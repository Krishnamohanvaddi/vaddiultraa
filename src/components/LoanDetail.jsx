import { useState } from "react";
import { db } from "../firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { isOverdue, formatCurrency, formatDate, calcMonthlyInterest, daysSince } from "../utils/calc";

const PAGE_SIZE = 6;

/* ─── helpers ─────────────────────────────────────────── */

// Is this month slot in the past or current month? (allowed to mark paid)
function isAllowedToPay(slot) {
  const [year, month] = slot.id.split("-").map(Number);
  const now = new Date();
  const slotDate = new Date(year, month - 1, 1); // 1st of that month
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return slotDate <= thisMonth;
}

/* ─── popups ───────────────────────────────────────────── */

function ReceiptPopup({ onSend, onSkip, msg, msgTe }) {
  const [lang, setLang] = useState("en");
  const text = lang === "te" ? msgTe : msg;
  return (
    <div style={pp.overlay}>
      <div style={pp.box}>
        <div style={pp.icon}>✅</div>
        <div style={pp.title}>Send Payment Receipt?</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 4 }}>
          <button onClick={() => setLang("en")} style={{ ...pp.langBtn, ...(lang === "en" ? pp.langActive : {}) }}>🇬🇧 English</button>
          <button onClick={() => setLang("te")} style={{ ...pp.langBtn, ...(lang === "te" ? pp.langActive : {}) }}>🇮🇳 Telugu</button>
        </div>
        <div style={pp.preview}>{text}</div>
        <button style={pp.greenBtn} onClick={() => onSend(text)}>📲 Send via WhatsApp</button>
        <button style={pp.skipBtn} onClick={onSkip}>Skip</button>
      </div>
    </div>
  );
}

function ReminderPopup({ onSend, onSkip, msg, msgTe }) {
  const [lang, setLang] = useState("en");
  const text = lang === "te" ? msgTe : msg;
  return (
    <div style={pp.overlay}>
      <div style={pp.box}>
        <div style={pp.icon}>🔔</div>
        <div style={pp.title}>Send Payment Reminder?</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 4 }}>
          <button onClick={() => setLang("en")} style={{ ...pp.langBtn, ...(lang === "en" ? pp.langActive : {}) }}>🇬🇧 English</button>
          <button onClick={() => setLang("te")} style={{ ...pp.langBtn, ...(lang === "te" ? pp.langActive : {}) }}>🇮🇳 Telugu</button>
        </div>
        <div style={pp.preview}>{text}</div>
        <button style={pp.amberBtn} onClick={() => onSend(text)}>📲 Send via WhatsApp</button>
        <button style={pp.skipBtn} onClick={onSkip}>Cancel</button>
      </div>
    </div>
  );
}

// Record return popup — includes return date, no checkbox, always recalculates future EMIs
// based on the return date: the month AFTER the return date gets new EMI
function RecordReturnPopup({ loan, currentOutstanding, currentReturned, onConfirm, onCancel }) {
  const today = new Date().toISOString().split("T")[0];
  const [amount, setAmount] = useState("");
  const [returnDate, setReturnDate] = useState(today);
  const parsed = parseInt(amount) || 0;
  const newOutstanding = currentOutstanding - parsed;
  const newEmi = parsed > 0 && newOutstanding > 0
    ? calcMonthlyInterest(newOutstanding, loan.ratePerHundred) : null;
  const isValid = parsed > 0 && parsed <= currentOutstanding && returnDate;

  // Billing day = day of month the loan was started (e.g. if started on 15th, billing is 15th each month)
  const billingDay = new Date(loan.startDate).getDate();
  const retDate = new Date(returnDate);
  let newEmiFromMonthId = null;
  if (newOutstanding > 0 && returnDate) {
    // If return happened on or before billing day → new EMI applies this month
    // If after billing day → new EMI applies next month
    const retYear = retDate.getFullYear();
    const retMonth = retDate.getMonth() + 1; // 1-indexed
    let applyYear, applyMonth;
    if (retDate.getDate() <= billingDay) {
      applyYear = retYear;
      applyMonth = retMonth;
    } else {
      applyMonth = retMonth + 1;
      applyYear = applyMonth > 12 ? retYear + 1 : retYear;
      if (applyMonth > 12) applyMonth = 1;
    }
    newEmiFromMonthId = applyYear + "-" + String(applyMonth).padStart(2, "0");
  }

  return (
    <div style={pp.overlay}>
      <div style={pp.box}>
        <div style={pp.icon}>💰</div>
        <div style={pp.title}>Record Principal Return</div>

        <div style={pp.infoGrid}>
          <div style={pp.infoItem}>
            <span style={pp.infoLabel}>Principal (fixed)</span>
            <span style={pp.infoVal}>Rs {loan.principal?.toLocaleString("en-IN")}</span>
          </div>
          <div style={pp.infoItem}>
            <span style={pp.infoLabel}>Outstanding</span>
            <span style={{ ...pp.infoVal, color: "#f59e0b" }}>Rs {currentOutstanding.toLocaleString("en-IN")}</span>
          </div>
          {currentReturned > 0 && (
            <div style={{ ...pp.infoItem, gridColumn: "span 2" }}>
              <span style={pp.infoLabel}>Already Returned</span>
              <span style={{ ...pp.infoVal, color: "#10b981" }}>Rs {currentReturned.toLocaleString("en-IN")}</span>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={pp.label}>Amount returned</label>
            <input
              style={{ ...pp.input, borderColor: amount && !isValid ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.12)" }}
              type="number"
              placeholder={"Max Rs " + currentOutstanding.toLocaleString("en-IN")}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label style={pp.label}>Return date</label>
            <input
              style={pp.input}
              type="date"
              value={returnDate}
              onChange={e => setReturnDate(e.target.value)}
            />
          </div>
        </div>

        {parsed > 0 && parsed <= currentOutstanding && (
          <div style={pp.calcBox}>
            <div style={pp.calcRow}>
              <span style={pp.calcLabel}>Amount Returned Now</span>
              <span style={{ color: "#10b981", fontWeight: 700 }}>Rs {parsed.toLocaleString("en-IN")}</span>
            </div>
            <div style={pp.calcRow}>
              <span style={pp.calcLabel}>New Outstanding</span>
              <span style={{ color: newOutstanding > 0 ? "#f59e0b" : "#10b981", fontWeight: 700 }}>
                {newOutstanding > 0 ? "Rs " + newOutstanding.toLocaleString("en-IN") : "Fully Returned"}
              </span>
            </div>
            {newEmi && newEmiFromMonthId && (
              <>
                <div style={{ ...pp.calcRow, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, marginTop: 4 }}>
                  <span style={pp.calcLabel}>New Monthly EMI</span>
                  <span style={{ color: "#818cf8", fontWeight: 700 }}>Rs {newEmi.toLocaleString("en-IN")}</span>
                </div>
                <div style={pp.calcRow}>
                  <span style={pp.calcLabel}>Applied from</span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    {new Date(newEmiFromMonthId + "-01").toLocaleString("default", { month: "long", year: "numeric" })} onwards
                    <div style={{ fontSize: 10, color: "#475569" }}>(billing day: {billingDay}{billingDay === 1 ? "st" : billingDay === 2 ? "nd" : billingDay === 3 ? "rd" : "th"} of each month — loan start date)</div>
                  </span>
                </div>
              </>
            )}
            {newOutstanding <= 0 && (
              <div style={{ color: "#10b981", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
                Loan will be marked fully settled
              </div>
            )}
          </div>
        )}

        {parsed > currentOutstanding && parsed > 0 && (
          <div style={{ color: "#ef4444", fontSize: 12, textAlign: "center" }}>
            Cannot exceed outstanding (Rs {currentOutstanding.toLocaleString("en-IN")})
          </div>
        )}

        <button
          style={{ ...pp.greenBtn, opacity: isValid ? 1 : 0.4 }}
          disabled={!isValid}
          onClick={() => onConfirm({ amount: parsed, newOutstanding, newEmi, fullReturn: newOutstanding <= 0, returnDate, newEmiFromMonthId })}
        >
          Confirm Return
        </button>
        <button style={pp.skipBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Edit return popup — allows correcting amount AND return date
function EditReturnPopup({ loan, entryAmount, entryReturnDate, currentReturned, onConfirm, onCancel }) {
  const outstandingBeforeThisEntry = loan.principal - (currentReturned - entryAmount);
  const [amount, setAmount] = useState(String(entryAmount));
  const [returnDate, setReturnDate] = useState(
    entryReturnDate ? new Date(entryReturnDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]
  );
  const parsed = parseInt(amount) || 0;
  const newOutstanding = outstandingBeforeThisEntry - parsed;
  const newEmi = parsed > 0 && newOutstanding > 0
    ? calcMonthlyInterest(newOutstanding, loan.ratePerHundred) : null;
  const isValid = parsed > 0 && parsed <= outstandingBeforeThisEntry && returnDate;

  // Calculate which month new EMI applies from (based on return date + billing day)
  const billingDay = new Date(loan.startDate).getDate();
  let newEmiFromMonthId = null;
  if (newEmi && returnDate) {
    const retDate = new Date(returnDate);
    const retYear = retDate.getFullYear();
    const retMonth = retDate.getMonth() + 1;
    let applyYear, applyMonth;
    if (retDate.getDate() <= billingDay) {
      applyYear = retYear; applyMonth = retMonth;
    } else {
      applyMonth = retMonth + 1;
      applyYear = applyMonth > 12 ? retYear + 1 : retYear;
      if (applyMonth > 12) applyMonth = 1;
    }
    newEmiFromMonthId = applyYear + "-" + String(applyMonth).padStart(2, "0");
  }

  return (
    <div style={pp.overlay}>
      <div style={pp.box}>
        <div style={pp.icon}>✏️</div>
        <div style={pp.title}>Edit Return Record</div>

        <div style={pp.infoGrid}>
          <div style={pp.infoItem}>
            <span style={pp.infoLabel}>Principal (fixed)</span>
            <span style={pp.infoVal}>Rs {loan.principal?.toLocaleString("en-IN")}</span>
          </div>
          <div style={pp.infoItem}>
            <span style={pp.infoLabel}>Outstanding (before this)</span>
            <span style={{ ...pp.infoVal, color: "#f59e0b" }}>Rs {outstandingBeforeThisEntry.toLocaleString("en-IN")}</span>
          </div>
        </div>

        <div>
          <label style={pp.label}>Correct the returned amount</label>
          <input
            style={pp.input}
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label style={pp.label}>Return date (determines EMI apply month)</label>
          <input
            style={pp.input}
            type="date"
            value={returnDate}
            max={new Date().toISOString().split("T")[0]}
            onChange={e => setReturnDate(e.target.value)}
          />
        </div>

        {parsed > 0 && parsed <= outstandingBeforeThisEntry && (
          <div style={pp.calcBox}>
            <div style={pp.calcRow}>
              <span style={pp.calcLabel}>New Outstanding After</span>
              <span style={{ color: newOutstanding > 0 ? "#f59e0b" : "#10b981", fontWeight: 700 }}>
                {newOutstanding > 0 ? "Rs " + newOutstanding.toLocaleString("en-IN") : "Fully Returned"}
              </span>
            </div>
            {newEmi && newEmiFromMonthId && (
              <>
                <div style={pp.calcRow}>
                  <span style={pp.calcLabel}>New EMI</span>
                  <span style={{ color: "#818cf8", fontWeight: 700 }}>Rs {newEmi.toLocaleString("en-IN")}</span>
                </div>
                <div style={pp.calcRow}>
                  <span style={pp.calcLabel}>Applied from</span>
                  <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 12 }}>
                    {new Date(newEmiFromMonthId + "-01").toLocaleString("default", { month: "long", year: "numeric" })} onwards
                    <div style={{ fontSize: 10, color: "#475569" }}>(billing day: {billingDay}{billingDay===1?"st":billingDay===2?"nd":billingDay===3?"rd":"th"} of each month)</div>
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        <button
          style={{ ...pp.greenBtn, opacity: isValid ? 1 : 0.4 }}
          disabled={!isValid}
          onClick={() => onConfirm({ amount: parsed, newOutstanding, newEmi, fullReturn: newOutstanding <= 0, returnDate, newEmiFromMonthId })}
        >
          Save Changes
        </button>
        <button style={pp.skipBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DeleteLoanConfirm({ hasOverdue, onConfirm, onCancel }) {
  return (
    <div style={pp.overlay}>
      <div style={pp.box}>
        <div style={pp.icon}>🗑</div>
        <div style={pp.title}>Delete This Loan?</div>
        {hasOverdue && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#fca5a5", textAlign: "center" }}>
            Warning: This loan has overdue payments. Deleting will remove all records permanently.
          </div>
        )}
        <div style={{ ...pp.sub, color: "#94a3b8" }}>This action cannot be undone.</div>
        <button style={{ ...pp.greenBtn, background: "rgba(239,68,68,0.15)", borderColor: "rgba(239,68,68,0.4)", color: "#ef4444" }} onClick={onConfirm}>
          Yes, Delete Loan
        </button>
        <button style={pp.skipBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const pp = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  box: { background: "#1a1d2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "24px 22px", width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 12 },
  icon: { fontSize: 28, textAlign: "center" },
  title: { fontSize: 17, fontWeight: 800, color: "white", textAlign: "center" },
  sub: { fontSize: 13, color: "#64748b", textAlign: "center", lineHeight: 1.6 },
  infoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  infoItem: { background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 },
  infoLabel: { fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 0.8 },
  infoVal: { fontSize: 14, fontWeight: 700, color: "white" },
  label: { fontSize: 12, color: "#64748b", display: "block", marginBottom: 6 },
  input: { width: "100%", padding: "11px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" },
  calcBox: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 },
  calcRow: { display: "flex", justifyContent: "space-between", fontSize: 13, alignItems: "center" },
  calcLabel: { color: "#64748b" },
  greenBtn: { padding: "13px", borderRadius: 10, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.12)", color: "#10b981", cursor: "pointer", fontSize: 14, fontWeight: 700 },
  amberBtn: { padding: "13px", borderRadius: 10, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.1)", color: "#f59e0b", cursor: "pointer", fontSize: 14, fontWeight: 700 },
  skipBtn: { padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 13 },
  langBtn: { padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  langActive: { background: "rgba(99,102,241,0.2)", borderColor: "rgba(99,102,241,0.4)", color: "#818cf8" },
  preview: { background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#94a3b8", whiteSpace: "pre-wrap", maxHeight: 160, overflowY: "auto", lineHeight: 1.6 },
};

/* ─── main component ───────────────────────────────────── */

export default function LoanDetail({ client, loan, loanIndex, onBack, onEdit, onDelete }) {
  const [slots, setSlots] = useState(loan.monthSlots || []);
  const [history, setHistory] = useState(loan.paymentHistory || []);
  const [loanData, setLoanData] = useState(loan); // live loan data (outstanding, emi)
  const [loading, setLoading] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [page, setPage] = useState(0);
  const [receiptPopup, setReceiptPopup] = useState(null);
  const [reminderPopup, setReminderPopup] = useState(null);
  const [showRecordReturn, setShowRecordReturn] = useState(false);
  const [editReturnEntry, setEditReturnEntry] = useState(null); // { idx, amount }
  const [showCollected, setShowCollected] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Outstanding = principal - principalReturned (never changes principal)
  const currentOutstanding = loanData.principal - (loanData.principalReturned || 0);
  const currentReturned = loanData.principalReturned || 0;
  // Current EMI = stored on loanData.currentEmi (updated on each return), falls back to original
  const currentEmi = loanData.currentEmi || loanData.monthlyInterest;
  const fullySettled = loanData.fullySettled || false;

  const totalPages = Math.ceil(slots.length / PAGE_SIZE);
  const pageSlots = slots.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const paidCount = slots.filter(s => s.paid).length;
  const allInterestPaid = paidCount === slots.length;

  const totalCollected = slots.filter(s => s.paid).reduce((sum, s) =>
    sum + (s.customEmi !== undefined ? s.customEmi : loanData.monthlyInterest), 0);
  const totalPayable = slots.reduce((sum, s) =>
    sum + (s.customEmi !== undefined ? s.customEmi : loanData.monthlyInterest), 0);
  const totalRemaining = totalPayable - totalCollected;
  const progress = slots.length > 0 ? Math.round((paidCount / slots.length) * 100) : 0;
  const overdueSlots = slots.filter(s => isOverdue(s));
  const returnedPct = loanData.principal > 0 ? Math.round((currentReturned / loanData.principal) * 100) : 0;

  async function persistLoan(updatedSlots, updatedHistory, updatedLoanData) {
    const loans = [...(client?.loans || [])];
    const newCollected = updatedSlots.filter(s => s.paid).reduce((sum, s) =>
      sum + (s.customEmi !== undefined ? s.customEmi : updatedLoanData.monthlyInterest), 0);
    loans[loanIndex] = { ...updatedLoanData, monthSlots: updatedSlots, paymentHistory: updatedHistory, totalCollected: newCollected };
    await updateDoc(doc(db, "clients", client.id), { loans, updatedAt: serverTimestamp() });
  }

  async function togglePaid(idx) {
    const realIdx = page * PAGE_SIZE + idx;
    if (!isAllowedToPay(slots[realIdx]) && !slots[realIdx].paid) return;
    setLoading(realIdx);
    const slot = slots[realIdx];
    const emi = slot.customEmi !== undefined ? slot.customEmi : loanData.monthlyInterest;
    const nowPaid = !slot.paid;
    const updated = slots.map((s, i) =>
      i !== realIdx ? s : { ...s, paid: nowPaid, paidDate: nowPaid ? new Date().toISOString() : null }
    );
    const entry = {
      action: nowPaid ? "PAID" : "UNPAID",
      month: slot.label,
      monthNum: realIdx + 1,
      amount: emi,
      date: new Date().toISOString(),
    };
    const newHistory = [entry, ...history];
    try {
      await persistLoan(updated, newHistory, loanData);
      setSlots(updated);
      setHistory(newHistory);
      if (nowPaid) {
        const nextUnpaid = updated.find((s, i) => i > realIdx && !s.paid);
        const msgEn = "✅ Payment Receipt\n\nDear " + client?.name + ",\n\nPayment confirmed:\n📅 Month: " + slot.label + "\n🔢 EMI #" + (realIdx + 1) + "\n💰 Amount: Rs " + emi?.toLocaleString("en-IN") + "\n📆 Date: " + new Date().toLocaleDateString("en-IN") + (nextUnpaid ? "\n⏭ Next Due: " + nextUnpaid.label : "\n🎉 All interest payments complete!") + "\n\nThank you! 🙏";
        const msgTe = "✅ చెల్లింపు రసీదు\n\nప్రియమైన " + client?.name + " గారికి,\n\nమీ చెల్లింపు స్వీకరించబడింది:\n📅 నెల: " + slot.label + "\n🔢 వాయిదా #" + (realIdx + 1) + "\n💰 మొత్తం: రూ " + emi?.toLocaleString("en-IN") + "\n📆 తేదీ: " + new Date().toLocaleDateString("en-IN") + (nextUnpaid ? "\n⏭ తదుపరి వాయిదా: " + nextUnpaid.label : "\n🎉 అన్ని వడ్డీ చెల్లింపులు పూర్తయ్యాయి!") + "\n\nధన్యవాదాలు! 🙏";
        setReceiptPopup({ en: msgEn, te: msgTe });
      }
    } catch (err) { alert(err.message); }
    setLoading(null);
  }

  function buildReminderMsgs() {
    const overdue = slots.filter(s => isOverdue(s));
    const now = new Date();
    const currentMonthId = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const currentSlot = slots.find(s => s.id === currentMonthId && !s.paid);
    const loanStartDate = loanData.startDate;
    const billingDay = loanStartDate ? new Date(loanStartDate).getDate() : 1;

    let linesEn = [], linesTe = [], totalDue = 0;

    if (overdue.length > 0) {
      overdue.forEach(s => {
        const num = slots.findIndex(sl => sl.id === s.id) + 1;
        const emi = s.customEmi !== undefined ? s.customEmi : loanData.monthlyInterest;
        // How many days since billing day of that slot
        const [slotYear, slotMonth] = s.id.split("-").map(Number);
        const billingDate = new Date(slotYear, slotMonth - 1, billingDay);
        const daysLate = Math.floor((now - billingDate) / (1000 * 60 * 60 * 24));
        const daysText = daysLate > 0 ? " (" + daysLate + " days overdue)" : "";
        const daysTextTe = daysLate > 0 ? " (" + daysLate + " రోజులు ఆలస్యం)" : "";
        linesEn.push("  ⚠️ OVERDUE - వాయిదా #" + num + " " + s.label + " — Rs " + emi?.toLocaleString("en-IN") + daysText);
        linesTe.push("  ⚠️ బాకీ వాయిదా #" + num + " " + s.label + " — రూ " + emi?.toLocaleString("en-IN") + daysTextTe);
        totalDue += emi;
      });
    }
    if (currentSlot && !overdue.find(s => s.id === currentSlot.id)) {
      const emi = currentSlot.customEmi !== undefined ? currentSlot.customEmi : loanData.monthlyInterest;
      // Days since billing date of this month
      const [cy, cm] = currentSlot.id.split("-").map(Number);
      const billingDate = new Date(cy, cm - 1, billingDay);
      const daysPast = Math.floor((now - billingDate) / (1000 * 60 * 60 * 24));
      const daysMsgEn = daysPast > 0 ? " — " + daysPast + " day" + (daysPast > 1 ? "s" : "") + " since due date" : "";
      const daysMsgTe = daysPast > 0 ? " — " + daysPast + " రోజులైంది" : "";
      linesEn.push("  📅 ఈ నెల వాయిదా " + currentSlot.label + " — Rs " + emi?.toLocaleString("en-IN") + daysMsgEn);
      linesTe.push("  📅 ఈ నెల వాయిదా " + currentSlot.label + " — రూ " + emi?.toLocaleString("en-IN") + daysMsgTe);
      totalDue += emi;
    }

    if (linesEn.length === 0) {
      const next = slots.find(s => !s.paid);
      if (!next) return null;
      const emi = next.customEmi !== undefined ? next.customEmi : loanData.monthlyInterest;
      return {
        en: "🔔 Payment Reminder\n\nDear " + client?.name + ",\n\nReminder for your upcoming EMI:\n\n  📅 " + next.label + " — Rs " + emi?.toLocaleString("en-IN") + "\n\nPlease ensure timely payment. Thank you! 🙏",
        te: "🔔 చెల్లింపు రిమైండర్\n\nప్రియమైన " + client?.name + " గారికి,\n\nమీ రాబోయే వాయిదా చెల్లింపు రిమైండర్:\n\n  📅 " + next.label + " — రూ " + emi?.toLocaleString("en-IN") + "\n\nసమయానికి చెల్లించగలరు. ధన్యవాదాలు! 🙏",
      };
    }

    return {
      en: "🔔 Payment Reminder\n\nDear " + client?.name + ",\n\nThe following EMI payments require your attention:\n\n" + linesEn.join("\n") + "\n\n💰 Total Due: Rs " + totalDue.toLocaleString("en-IN") + "\n\nKindly clear at the earliest. Thank you! 🙏",
      te: "🔔 వాయిదా రిమైండర్\n\nప్రియమైన " + client?.name + " గారికి,\n\nదిగువ వాయిదాలు వెంటనే చెల్లించవలసి ఉంది:\n\n" + linesTe.join("\n") + "\n\n💰 మొత్తం బాకీ: రూ " + totalDue.toLocaleString("en-IN") + "\n\nత్వరగా చెల్లించగలరు. ధన్యవాదాలు! 🙏",
    };
  }

  async function handleRecordReturn({ amount, newOutstanding, newEmi, fullReturn, returnDate, newEmiFromMonthId }) {
    const newReturned = currentReturned + amount;
    const newLoanData = {
      ...loanData,
      principalReturned: newReturned,
      currentEmi: fullReturn ? loanData.monthlyInterest : (newEmi || loanData.monthlyInterest),
      fullySettled: fullReturn,
    };

    // Update slots from newEmiFromMonthId onwards (only unpaid ones)
    let updatedSlots = slots;
    if (!fullReturn && newEmi && newEmiFromMonthId) {
      updatedSlots = slots.map(s => {
        if (s.paid) return s; // never touch paid slots
        // only apply new EMI to slots >= newEmiFromMonthId
        if (s.id >= newEmiFromMonthId) return { ...s, customEmi: newEmi };
        return s;
      });
    }

    const logEntry = {
      action: "PRINCIPAL_RETURN",
      month: "-",
      monthNum: 0,
      amount,
      note: "Returned: Rs " + amount.toLocaleString("en-IN") + " on " + new Date(returnDate).toLocaleDateString("en-IN") + " | Total returned: Rs " + newReturned.toLocaleString("en-IN") + " | Outstanding: Rs " + Math.max(0, newOutstanding).toLocaleString("en-IN") + (newEmi && newEmiFromMonthId ? " | New EMI: Rs " + newEmi.toLocaleString("en-IN") + " from " + new Date(newEmiFromMonthId + "-01").toLocaleString("default", { month: "short", year: "numeric" }) : fullReturn ? " | FULLY SETTLED" : ""),
      date: returnDate ? new Date(returnDate).toISOString() : new Date().toISOString(),
    };
    const newHistory = [logEntry, ...history];

    await persistLoan(updatedSlots, newHistory, newLoanData);
    setSlots(updatedSlots);
    setHistory(newHistory);
    setLoanData(newLoanData);
    setShowRecordReturn(false);
  }

  async function handleEditReturn({ amount, newOutstanding, newEmi, fullReturn, returnDate, newEmiFromMonthId }) {
    const { idx: entryIdx, amount: oldAmount } = editReturnEntry;
    const diff = amount - oldAmount;
    const newReturned = currentReturned + diff;
    const newLoanData = {
      ...loanData,
      principalReturned: newReturned,
      currentEmi: fullReturn ? loanData.monthlyInterest : (newEmi || loanData.monthlyInterest),
      fullySettled: fullReturn,
    };

    // Apply new EMI to ALL slots from newEmiFromMonthId onwards (including paid ones —
    // this is a correction of historical data, so paid slots must also reflect it)
    let updatedSlots = slots;
    if (!fullReturn && newEmi && newEmiFromMonthId) {
      updatedSlots = slots.map(s => {
        if (s.id >= newEmiFromMonthId) return { ...s, customEmi: newEmi };
        // Clear customEmi on slots BEFORE the apply month (in case a previous edit set it)
        if (s.id < newEmiFromMonthId && s.customEmi !== undefined) {
          const { customEmi, ...rest } = s;
          return rest;
        }
        return s;
      });
    } else if (fullReturn) {
      // Full return: clear all customEmi overrides — loan is settled, EMI is irrelevant
      updatedSlots = slots.map(s => {
        if (s.customEmi !== undefined) { const { customEmi, ...rest } = s; return rest; }
        return s;
      });
    }

    // Update the original history entry + add an edit log
    const updatedEntry = {
      ...history[entryIdx],
      amount,
      date: returnDate ? new Date(returnDate).toISOString() : history[entryIdx].date,
      note: "Returned (edited): Rs " + amount.toLocaleString("en-IN") +
        " on " + new Date(returnDate || history[entryIdx].date).toLocaleDateString("en-IN") +
        " | Total returned: Rs " + newReturned.toLocaleString("en-IN") +
        " | Outstanding: Rs " + Math.max(0, newOutstanding).toLocaleString("en-IN") +
        (newEmi && newEmiFromMonthId ? " | New EMI: Rs " + newEmi.toLocaleString("en-IN") +
          " from " + new Date(newEmiFromMonthId + "-01").toLocaleString("default", { month: "short", year: "numeric" })
          : fullReturn ? " | FULLY SETTLED" : ""),
    };
    const editLog = {
      action: "RETURN_EDITED",
      month: "-",
      monthNum: 0,
      amount,
      note: "Return record edited: was Rs " + oldAmount.toLocaleString("en-IN") + " → now Rs " + amount.toLocaleString("en-IN") +
        (newEmiFromMonthId ? " | EMI Rs " + newEmi?.toLocaleString("en-IN") + " from " +
          new Date(newEmiFromMonthId + "-01").toLocaleString("default", { month: "short", year: "numeric" }) : ""),
      date: new Date().toISOString(),
    };
    const newHistory = [editLog, ...history.map((h, i) => i === entryIdx ? updatedEntry : h)];

    await persistLoan(updatedSlots, newHistory, newLoanData);
    setSlots(updatedSlots);
    setHistory(newHistory);
    setLoanData(newLoanData);
    setEditReturnEntry(null);
  }

  function sendWhatsApp(msg) {
    window.open("https://wa.me/91" + client?.phone?.replace(/\D/g, "") + "?text=" + encodeURIComponent(msg), "_blank");
  }

  async function deleteHistoryEntry(idx) {
    if (!window.confirm("Delete this history entry?")) return;
    const newHistory = history.filter((_, i) => i !== idx);
    await persistLoan(slots, newHistory, loanData);
    setHistory(newHistory);
  }

  async function clearAllHistory() {
    if (!window.confirm("Delete ALL history?")) return;
    await persistLoan(slots, [], loanData);
    setHistory([]);
  }

  return (
    <div style={s.wrap}>
      {receiptPopup && (
        <ReceiptPopup
          msg={receiptPopup.en} msgTe={receiptPopup.te}
          onSend={(text) => { sendWhatsApp(text); setReceiptPopup(null); }}
          onSkip={() => setReceiptPopup(null)}
        />
      )}
      {reminderPopup && (
        <ReminderPopup
          msg={reminderPopup.en} msgTe={reminderPopup.te}
          onSend={(text) => { sendWhatsApp(text); setReminderPopup(null); }}
          onSkip={() => setReminderPopup(null)}
        />
      )}
      {showRecordReturn && (
        <RecordReturnPopup
          loan={loanData}
          currentOutstanding={currentOutstanding}
          currentReturned={currentReturned}
          onConfirm={handleRecordReturn}
          onCancel={() => setShowRecordReturn(false)}
        />
      )}
      {editReturnEntry && (
        <EditReturnPopup
          loan={loanData}
          entryAmount={editReturnEntry.amount}
          entryReturnDate={editReturnEntry.returnDate}
          currentReturned={currentReturned}
          onConfirm={handleEditReturn}
          onCancel={() => setEditReturnEntry(null)}
        />
      )}
      {showDeleteConfirm && (
        <DeleteLoanConfirm
          hasOverdue={overdueSlots.length > 0}
          onConfirm={() => { setShowDeleteConfirm(false); onDelete(); }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Top bar */}
      <div style={s.topBar}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <div style={s.topBtns}>
          <button style={s.waBtn} onClick={() => {
            const msgs = buildReminderMsgs();
            if (msgs) setReminderPopup(msgs);
          }}>📱 Remind</button>
          <button style={s.editBtn} onClick={onEdit}>✏️ Edit</button>
          <button style={s.deleteBtn} onClick={() => setShowDeleteConfirm(true)}>🗑</button>
        </div>
      </div>

      {fullySettled && (
        <div style={s.settledBanner}>✅ Loan Fully Settled — Principal returned & all interest collected</div>
      )}

      {/* Header */}
      <div style={s.loanHeader}>
        <div style={s.loanBadge}>{loanData.loanType === "oneMonth" ? "⚡ 1 Month Loan" : `Loan #${loanIndex + 1}`}</div>
        <div style={s.loanTitle}>Rs {loanData.principal?.toLocaleString("en-IN")} · {loanData.durationMonths} months</div>
        {loanData.notes && <div style={s.loanNotes}>{loanData.notes}</div>}
        {overdueSlots.length > 0 && !fullySettled && (
          <div style={s.overdueBadge}>⚠️ {overdueSlots.length} month(s) overdue</div>
        )}
      </div>

      {/* Stats */}
      <div style={s.statsGrid}>
        <Stat label="Principal (fixed)" value={formatCurrency(loanData.principal)} color="#94a3b8" />
        <Stat label="Outstanding" value={formatCurrency(currentOutstanding)} color={currentOutstanding > 0 ? "#f59e0b" : "#10b981"} />
        <Stat label="Current EMI" value={formatCurrency(currentEmi)} color="#818cf8" highlight />
        <Stat label="Collected ↗" value={formatCurrency(totalCollected)} color="#10b981" clickable onClick={() => setShowCollected(v => !v)} />
      </div>

      {/* Collected panel — paid months in last 12 months */}
      {showCollected && (() => {
        const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const recentPaid = slots.filter(s => s.paid && s.paidDate && new Date(s.paidDate) >= oneYearAgo)
          .sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
        const recentTotal = recentPaid.reduce((sum, s) => sum + (s.customEmi !== undefined ? s.customEmi : loanData.monthlyInterest), 0);
        return (
          <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.18)", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: 1 }}>📅 Collected (Last 12 Months)</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981" }}>Total: {formatCurrency(recentTotal)}</span>
            </div>
            {recentPaid.length === 0
              ? <div style={{ fontSize: 12, color: "#475569" }}>No payments collected in the last 12 months.</div>
              : recentPaid.map((s, i) => {
                const emi = s.customEmi !== undefined ? s.customEmi : loanData.monthlyInterest;
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
                    <span style={{ color: "#94a3b8" }}>{s.label}</span>
                    <span style={{ color: "#10b981", fontWeight: 700 }}>{formatCurrency(emi)}</span>
                    <span style={{ color: "#475569", fontSize: 11 }}>{formatDate(s.paidDate)}</span>
                  </div>
                );
              })
            }
          </div>
        );
      })()}

      {/* Principal / Return section — hidden for 1-month loans (no principal tracking needed) */}
      {loanData.loanType !== "oneMonth" && (
        <div style={{ ...s.principalBox, ...(fullySettled ? s.principalSettled : currentReturned > 0 ? s.principalPartial : {}) }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: fullySettled ? "#10b981" : currentReturned > 0 ? "#f59e0b" : "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>
              {fullySettled ? "Principal Fully Returned" : currentReturned > 0 ? "Principal Partially Returned" : "Principal Pending"}
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ color: "#475569" }}>
                Principal: <strong style={{ color: "#94a3b8" }}>Rs {loanData.principal?.toLocaleString("en-IN")}</strong>
              </span>
              {currentReturned > 0 && (
                <span style={{ color: "#475569" }}>
                  Returned: <strong style={{ color: "#10b981" }}>Rs {currentReturned.toLocaleString("en-IN")}</strong>
                </span>
              )}
              <span style={{ color: "#475569" }}>
                Outstanding: <strong style={{ color: currentOutstanding > 0 ? "#f59e0b" : "#10b981" }}>
                  Rs {currentOutstanding.toLocaleString("en-IN")}
                </strong>
              </span>
            </div>
            {currentReturned > 0 && currentOutstanding > 0 && (
              <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden", marginTop: 8 }}>
                <div style={{ height: "100%", width: returnedPct + "%", background: "linear-gradient(90deg, #10b981, #06b6d4)", borderRadius: 4 }} />
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {currentReturned > 0 && !fullySettled && (
              <button style={s.editReturnBtn} onClick={() => {
                const lastReturnIdx = history.findIndex(h => h.action === "PRINCIPAL_RETURN");
                if (lastReturnIdx >= 0) {
                  setEditReturnEntry({ idx: lastReturnIdx, amount: history[lastReturnIdx].amount, returnDate: history[lastReturnIdx].date });
                }
              }}>✏️ Edit</button>
            )}
            {!fullySettled && (
              <button style={s.principalBtn} onClick={() => setShowRecordReturn(true)}>+ Record Return</button>
            )}
          </div>
        </div>
      )}

      {allInterestPaid && !fullySettled && loanData.loanType !== "oneMonth" && (
        <div style={s.infoBox}>All interest collected — waiting for principal (Rs {currentOutstanding.toLocaleString("en-IN")}) to be returned.</div>
      )}

      {/* Progress */}
      <div style={s.progressBox}>
        <div style={s.progressRow}>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>Interest Progress</span>
          <span style={{ color: "white", fontWeight: 700 }}>{paidCount}/{slots.length} months ({progress}%)</span>
        </div>
        <div style={s.progressTrack}>
          <div style={{ ...s.progressFill, width: progress + "%", background: fullySettled ? "#10b981" : "linear-gradient(90deg, #6366f1, #10b981)" }} />
        </div>
      </div>

      {/* Monthly slots */}
      <div style={s.pageHeader}>
        <div style={s.sectionTitle}>Monthly Payments</div>
        <div style={s.pageControls}>
          <button style={s.pageBtn} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>◀</button>
          <span style={{ color: "#64748b", fontSize: 12 }}>{page + 1} / {totalPages}</span>
          <button style={s.pageBtn} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>▶</button>
        </div>
      </div>

      <div style={s.slotsGrid}>
        {pageSlots.map((slot, idx) => {
          const realIdx = page * PAGE_SIZE + idx;
          const over = isOverdue(slot);
          const allowed = isAllowedToPay(slot);
          const emi = slot.customEmi !== undefined ? slot.customEmi : loanData.monthlyInterest;
          const isRecalc = slot.customEmi !== undefined && slot.customEmi !== loanData.monthlyInterest;
          const isFuture = !allowed && !slot.paid;
          return (
            <div key={slot.id} style={{ ...s.slot, ...(slot.paid ? s.slotPaid : over ? s.slotOverdue : isFuture ? s.slotFuture : {}) }}>
              <div style={s.slotMonth}>{slot.label}</div>
              <div style={s.slotEmi}>EMI #{realIdx + 1}{isRecalc && <span style={{ color: "#f59e0b", marginLeft: 3 }}>*</span>}</div>
              <div style={{ ...s.slotAmt, color: isFuture ? "#334155" : "white" }}>{formatCurrency(emi)}</div>
              {isRecalc && !slot.paid && <div style={{ fontSize: 9, color: "#f59e0b", letterSpacing: 0.5 }}>RECALCULATED</div>}
              {slot.paid && <div style={s.paidDate}>✓ {formatDate(slot.paidDate)}</div>}
              {over && !slot.paid && <div style={s.overdueTag}>OVERDUE</div>}
              {isFuture && <div style={{ fontSize: 9, color: "#334155", letterSpacing: 0.5 }}>FUTURE</div>}
              <button
                style={{ ...s.slotBtn, ...(slot.paid ? s.btnPaid : over ? s.btnOverdue : isFuture ? s.btnFuture : s.btnUnpaid) }}
                onClick={() => !isFuture && togglePaid(idx)}
                disabled={loading === realIdx || isFuture}
              >
                {loading === realIdx ? "..." : slot.paid ? "✓ Paid" : isFuture ? "Future" : "Mark Paid"}
              </button>
            </div>
          );
        })}
      </div>

      {/* History */}
      <div style={s.historyToggle} onClick={() => setShowHistory(!showHistory)}>
        <span style={s.sectionTitle}>📋 History ({history.length})</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {history.length > 0 && (
            <button style={s.clearBtn} onClick={e => { e.stopPropagation(); clearAllHistory(); }}>Clear</button>
          )}
          <span style={{ color: "#475569", fontSize: 13 }}>{showHistory ? "▲" : "▼"}</span>
        </div>
      </div>
      {showHistory && (
        <div style={s.historyBox}>
          {history.length === 0
            ? <div style={{ color: "#475569", fontSize: 13, padding: 16 }}>No history yet.</div>
            : history.map((h, i) => {
              const actionColor = h.action === "PAID" ? "#10b981" : h.action === "PRINCIPAL_RETURN" ? "#818cf8" : h.action === "RETURN_EDITED" ? "#f59e0b" : "#ef4444";
              const actionBg = h.action === "PAID" ? "rgba(16,185,129,0.15)" : h.action === "PRINCIPAL_RETURN" ? "rgba(99,102,241,0.15)" : h.action === "RETURN_EDITED" ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)";
              const label = h.action === "PRINCIPAL_RETURN" ? "RETURN" : h.action === "RETURN_EDITED" ? "EDITED" : h.action;
              return (
                <div key={i} style={s.historyRow}>
                  <span style={{ ...s.badge, background: actionBg, color: actionColor }}>{label}</span>
                  <span style={{ color: "#94a3b8", fontSize: 12, flex: 1, minWidth: 0 }}>
                    {h.note || (h.month && h.monthNum > 0 ? h.month + " #" + h.monthNum : h.month)}
                  </span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>{formatCurrency(h.amount)}</span>
                  <span style={{ color: "#334155", fontSize: 11 }}>{formatDate(h.date)}</span>
                  <button style={s.delHistBtn} onClick={() => deleteHistoryEntry(i)}>✕</button>
                </div>
              );
            })
          }
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, highlight, clickable, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ background: highlight ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)", border: "1px solid " + (highlight ? "rgba(99,102,241,0.25)" : clickable ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)"), borderRadius: 12, padding: "11px 13px", cursor: clickable ? "pointer" : "default" }}
    >
      <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

const s = {
  wrap: { fontFamily: "'Segoe UI', sans-serif", paddingBottom: 32 },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  backBtn: { background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", padding: "7px 14px", cursor: "pointer", fontSize: 13 },
  topBtns: { display: "flex", gap: 8 },
  waBtn: { padding: "7px 13px", borderRadius: 8, border: "none", background: "rgba(37,211,102,0.18)", color: "#25d366", fontWeight: 700, cursor: "pointer", fontSize: 12 },
  editBtn: { padding: "7px 13px", borderRadius: 8, border: "none", background: "rgba(99,102,241,0.18)", color: "#818cf8", fontWeight: 700, cursor: "pointer", fontSize: 12 },
  deleteBtn: { padding: "7px 11px", borderRadius: 8, border: "none", background: "rgba(239,68,68,0.12)", color: "#f87171", cursor: "pointer", fontSize: 14 },
  settledBanner: { background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 12, padding: "11px 16px", marginBottom: 14, fontSize: 13, color: "#6ee7b7", fontWeight: 600 },
  loanHeader: { marginBottom: 16 },
  loanBadge: { fontSize: 10, color: "#818cf8", background: "rgba(99,102,241,0.15)", padding: "3px 10px", borderRadius: 20, display: "inline-block", marginBottom: 5, letterSpacing: 1 },
  loanTitle: { fontSize: 17, fontWeight: 800, color: "white", marginBottom: 4 },
  loanNotes: { fontSize: 12, color: "#64748b", marginBottom: 5 },
  overdueBadge: { display: "inline-block", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#fca5a5", fontWeight: 700 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 10 },
  principalBox: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "13px 15px", marginBottom: 10, gap: 10, flexWrap: "wrap" },
  principalSettled: { background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" },
  principalPartial: { background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.18)" },
  principalBtn: { padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.14)", color: "#818cf8", cursor: "pointer", fontSize: 12, fontWeight: 700 },
  editReturnBtn: { padding: "7px 12px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.1)", color: "#f59e0b", cursor: "pointer", fontSize: 12, fontWeight: 700 },
  infoBox: { background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 10, padding: "9px 13px", marginBottom: 10, fontSize: 13, color: "#f59e0b" },
  progressBox: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 13, marginBottom: 18 },
  progressRow: { display: "flex", justifyContent: "space-between", marginBottom: 7 },
  progressTrack: { height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4, transition: "width 0.4s" },
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1 },
  pageControls: { display: "flex", gap: 6, alignItems: "center" },
  pageBtn: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#64748b", padding: "3px 9px", cursor: "pointer", fontSize: 12 },
  slotsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))", gap: 8, marginBottom: 22 },
  slot: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 11, padding: 11, display: "flex", flexDirection: "column", gap: 4 },
  slotPaid: { background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.22)" },
  slotOverdue: { background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.28)" },
  slotFuture: { background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", opacity: 0.5 },
  slotMonth: { fontSize: 11, fontWeight: 700, color: "#64748b" },
  slotEmi: { fontSize: 10, color: "#334155", display: "flex", alignItems: "center" },
  slotAmt: { fontSize: 15, fontWeight: 800, color: "white" },
  paidDate: { fontSize: 10, color: "#10b981" },
  overdueTag: { fontSize: 9, color: "#ef4444", fontWeight: 700, letterSpacing: 0.8 },
  slotBtn: { marginTop: 3, padding: "5px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700 },
  btnPaid: { background: "rgba(16,185,129,0.18)", color: "#10b981" },
  btnUnpaid: { background: "rgba(99,102,241,0.18)", color: "#818cf8" },
  btnOverdue: { background: "rgba(239,68,68,0.18)", color: "#ef4444" },
  btnFuture: { background: "rgba(255,255,255,0.03)", color: "#334155", cursor: "not-allowed" },
  historyToggle: { display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: 7 },
  clearBtn: { fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "none", borderRadius: 5, padding: "3px 8px", cursor: "pointer" },
  historyBox: { background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 11, overflow: "hidden", marginBottom: 20 },
  historyRow: { display: "flex", alignItems: "center", gap: 8, padding: "9px 13px", borderBottom: "1px solid rgba(255,255,255,0.03)", flexWrap: "wrap" },
  badge: { fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: 0.8, flexShrink: 0 },
  delHistBtn: { background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 13, padding: "0 2px", marginLeft: "auto" },
};
