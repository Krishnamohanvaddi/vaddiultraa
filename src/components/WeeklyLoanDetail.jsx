import { useState } from "react";
import { db } from "../firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { formatCurrency, formatDate, isOverdue } from "../utils/calc";

const PAGE_SIZE = 8;

/* ─── helpers ────────────────────────────────────────── */

// Week is allowed to pay if its due date has passed (i.e. dueDate <= today+1day for current week)
function isWeekAllowedToPay(slot) {
  if (slot.paid) return true;
  if (!slot.dueDate) return true; // fallback: allow if no dueDate
  // allow paying if the week has started (dueDate - 6 days <= today), i.e. week started
  const weekStart = new Date(slot.dueDate);
  weekStart.setDate(weekStart.getDate() - 6); // week start = dueDate - 6
  return new Date() >= weekStart;
}

/* ─── popups ─────────────────────────────────────────── */

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

function DeleteLoanConfirm({ hasOverdue, onConfirm, onCancel }) {
  return (
    <div style={pp.overlay}>
      <div style={pp.box}>
        <div style={pp.icon}>🗑</div>
        <div style={pp.title}>Delete This Weekly Finance?</div>
        {hasOverdue && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#fca5a5", textAlign: "center" }}>
            Warning: This finance has overdue payments.
          </div>
        )}
        <div style={{ ...pp.sub, color: "#64748b" }}>This action cannot be undone.</div>
        <button style={{ ...pp.greenBtn, background: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.35)", color: "#ef4444" }} onClick={onConfirm}>
          Yes, Delete
        </button>
        <button style={pp.skipBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Edit remaining weekly amount popup
// Example: 9k given, 10 weeks at 1k/week = 10k total. 1 week paid (1k). 
// Client wants to pay 2k/week for 4 weeks + 1k last week = 9k outstanding in 5 weeks instead of 9.
// New weekly amount entered → auto-calculate how many weeks needed to cover outstanding.
function EditWeeklyAmountPopup({ loan, slots, onConfirm, onCancel }) {
  const paidSlots = slots.filter(s => s.paid);
  const unpaidSlots = slots.filter(s => !s.paid);
  const paidCount = paidSlots.length;
  const unpaidCount = unpaidSlots.length;
  const currentWeeklyAmt = loan.weeklyAmount;
  const alreadyCollected = paidSlots.reduce((sum, s) =>
    sum + (s.customAmt !== undefined ? s.customAmt : currentWeeklyAmt), 0);
  const outstanding = unpaidSlots.reduce((sum, s) =>
    sum + (s.customAmt !== undefined ? s.customAmt : currentWeeklyAmt), 0);

  const [newAmt, setNewAmt] = useState(String(currentWeeklyAmt));
  const parsedAmt = parseInt(newAmt) || 0;

  // How many full weeks of parsedAmt to cover outstanding?
  const fullWeeks = parsedAmt > 0 ? Math.floor(outstanding / parsedAmt) : 0;
  const lastWeekRemainder = parsedAmt > 0 ? outstanding % parsedAmt : 0;
  // Total new weeks = full weeks + (1 if there's a remainder)
  const newTotalWeeks = parsedAmt > 0 ? (lastWeekRemainder > 0 ? fullWeeks + 1 : fullWeeks) : 0;
  const newTotalPayable = parsedAmt > 0 ? (fullWeeks * parsedAmt + lastWeekRemainder) : 0; // = outstanding exactly
  const newGrandTotal = alreadyCollected + newTotalPayable;
  const newInterest = newGrandTotal - loan.principal;
  const weeksSaved = unpaidCount - newTotalWeeks;

  const isValid = parsedAmt > 0 && parsedAmt !== currentWeeklyAmt && newTotalWeeks > 0;

  return (
    <div style={pp.overlay}>
      <div style={pp.box}>
        <div style={pp.icon}>✏️</div>
        <div style={pp.title}>Edit Remaining Weekly Amount</div>
        <div style={pp.sub}>Change how much the client pays per week. Weeks are recalculated to collect the exact outstanding amount.</div>

        <div style={pp.infoGrid}>
          <div style={pp.infoItem}>
            <span style={pp.infoLabel}>Principal Given</span>
            <span style={pp.infoVal}>Rs {loan.principal?.toLocaleString("en-IN")}</span>
          </div>
          <div style={pp.infoItem}>
            <span style={pp.infoLabel}>Outstanding to collect</span>
            <span style={{ ...pp.infoVal, color: "#f59e0b" }}>Rs {outstanding.toLocaleString("en-IN")}</span>
          </div>
          <div style={pp.infoItem}>
            <span style={pp.infoLabel}>Weeks paid (locked)</span>
            <span style={{ ...pp.infoVal, color: "#10b981" }}>{paidCount}</span>
          </div>
          <div style={pp.infoItem}>
            <span style={pp.infoLabel}>Current weekly amt</span>
            <span style={pp.infoVal}>Rs {currentWeeklyAmt.toLocaleString("en-IN")}</span>
          </div>
        </div>

        <div>
          <label style={pp.label}>New weekly collection amount (Rs)</label>
          <input
            style={pp.input}
            type="number"
            value={newAmt}
            onChange={e => setNewAmt(e.target.value)}
            placeholder={String(currentWeeklyAmt)}
            autoFocus
          />
        </div>

        {parsedAmt > 0 && outstanding > 0 && (
          <div style={pp.calcBox}>
            <div style={pp.calcRow}>
              <span style={pp.calcLabel}>Outstanding remaining</span>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>Rs {outstanding.toLocaleString("en-IN")}</span>
            </div>
            <div style={pp.calcRow}>
              <span style={pp.calcLabel}>New weekly amount</span>
              <span style={{ color: "#818cf8", fontWeight: 700 }}>Rs {parsedAmt.toLocaleString("en-IN")}</span>
            </div>
            <div style={{ ...pp.calcRow, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, marginTop: 4 }}>
              <span style={pp.calcLabel}>Weeks needed</span>
              <span style={{ color: "white", fontWeight: 700 }}>
                {newTotalWeeks} week{newTotalWeeks !== 1 ? "s" : ""}
                {lastWeekRemainder > 0 && <span style={{ color: "#64748b", fontSize: 11 }}> (last: Rs {lastWeekRemainder.toLocaleString("en-IN")})</span>}
              </span>
            </div>
            {weeksSaved > 0 && (
              <div style={pp.calcRow}>
                <span style={pp.calcLabel}>Weeks saved (early payoff)</span>
                <span style={{ color: "#10b981", fontWeight: 700 }}>{weeksSaved} week{weeksSaved !== 1 ? "s" : ""} earlier</span>
              </div>
            )}
            <div style={{ ...pp.calcRow, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, marginTop: 4 }}>
              <span style={pp.calcLabel}>Grand total collected</span>
              <span style={{ color: "#06b6d4", fontWeight: 700 }}>Rs {newGrandTotal.toLocaleString("en-IN")}</span>
            </div>
            <div style={pp.calcRow}>
              <span style={pp.calcLabel}>Net interest earned</span>
              <span style={{ color: newInterest >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                Rs {newInterest.toLocaleString("en-IN")}
              </span>
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, color: "#475569", textAlign: "center" }}>
          Already paid {paidCount} week(s) are not affected. Dates for remaining weeks update from today.
        </div>

        <button
          style={{ ...pp.greenBtn, opacity: isValid ? 1 : 0.4 }}
          disabled={!isValid}
          onClick={() => onConfirm({ newWeeklyAmt: parsedAmt, newTotalWeeks, lastWeekRemainder, newGrandTotal, newInterest, outstanding })}
        >
          Update — Pay in {newTotalWeeks} Weeks
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
  infoVal: { fontSize: 13, fontWeight: 700, color: "white" },
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
  preview: { background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#94a3b8", whiteSpace: "pre-wrap", maxHeight: 150, overflowY: "auto", lineHeight: 1.6 },
};

/* ─── main component ─────────────────────────────────── */

export default function WeeklyLoanDetail({ client, loan, loanIndex, onBack, onEdit, onDelete }) {
  const [slots, setSlots] = useState(loan.weekSlots || []);
  const [history, setHistory] = useState(loan.paymentHistory || []);
  const [loanData, setLoanData] = useState(loan);
  const [loading, setLoading] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [page, setPage] = useState(0);
  const [receiptPopup, setReceiptPopup] = useState(null);
  const [reminderPopup, setReminderPopup] = useState(null);
  const [showEditWeekly, setShowEditWeekly] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCollected, setShowCollected] = useState(false);

  const totalPages = Math.ceil(slots.length / PAGE_SIZE);
  const pageSlots = slots.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const paidCount = slots.filter(s => s.paid).length;
  const weeklyAmount = loanData.weeklyAmount;

  // Collected = sum of paid slot amounts (slots may have customAmt after edit)
  const totalCollected = slots.filter(s => s.paid).reduce((sum, s) =>
    sum + (s.customAmt !== undefined ? s.customAmt : weeklyAmount), 0);
  // Outstanding = sum of unpaid slot amounts
  const totalOutstanding = slots.filter(s => !s.paid).reduce((sum, s) =>
    sum + (s.customAmt !== undefined ? s.customAmt : weeklyAmount), 0);
  const totalPayable = totalCollected + totalOutstanding;

  const progress = slots.length > 0 ? Math.round((paidCount / slots.length) * 100) : 0;
  const overdueSlots = slots.filter(s => isOverdue(s, "weekly"));
  const allPaid = paidCount === slots.length;

  async function persistLoan(updatedSlots, updatedHistory, updatedLoanData) {
    const weeklyLoans = [...(client?.weeklyLoans || [])];
    // Each paid slot should have customAmt locked at time of payment.
    // Fall back to the ORIGINAL loan weeklyAmount (from loanData, before this edit),
    // NOT updatedLoanData.weeklyAmount which may be the new edited value.
    const originalWeeklyAmt = loanData.weeklyAmount;
    const newCollected = updatedSlots.filter(s => s.paid).reduce((sum, s) =>
      sum + (s.customAmt !== undefined ? s.customAmt : originalWeeklyAmt), 0);
    weeklyLoans[loanIndex] = { ...updatedLoanData, weekSlots: updatedSlots, paymentHistory: updatedHistory, totalCollected: newCollected };
    await updateDoc(doc(db, "clients", client.id), { weeklyLoans, updatedAt: serverTimestamp() });
  }

  async function togglePaid(idx) {
    const realIdx = page * PAGE_SIZE + idx;
    const slot = slots[realIdx];
    if (!isWeekAllowedToPay(slot) && !slot.paid) return;
    setLoading(realIdx);
    const slotAmt = slot.customAmt !== undefined ? slot.customAmt : weeklyAmount;
    const nowPaid = !slot.paid;
    const updated = slots.map((s, i) => {
      if (i !== realIdx) return s;
      if (nowPaid) {
        // Stamp the amount at time of payment so it's locked even if weeklyAmount changes later
        return { ...s, paid: true, paidDate: new Date().toISOString(), customAmt: slotAmt };
      } else {
        // Un-marking paid: if customAmt equals the current weeklyAmount, remove it (clean)
        const { customAmt, ...rest } = s;
        return { ...rest, paid: false, paidDate: null };
      }
    });
    const entry = {
      action: nowPaid ? "PAID" : "UNPAID",
      week: "Week #" + (realIdx + 1),
      weekNum: realIdx + 1,
      amount: slotAmt,
      date: new Date().toISOString(),
    };
    const newHistory = [entry, ...history];
    try {
      await persistLoan(updated, newHistory, loanData);
      setSlots(updated);
      setHistory(newHistory);
      if (nowPaid) {
        const nextUnpaid = updated.find((s, i) => i > realIdx && !s.paid);
        const nextAmt = nextUnpaid?.customAmt !== undefined ? nextUnpaid.customAmt : weeklyAmount;
        const nextNum = nextUnpaid ? slots.findIndex(s2 => s2.id === nextUnpaid.id) + 1 : null;
        const msgEn = "✅ Payment Receipt\n\nDear " + client?.name + ",\n\nWeekly payment confirmed:\n🗓 Week #" + (realIdx + 1) + "\n💰 Amount: Rs " + slotAmt?.toLocaleString("en-IN") + "\n📆 Date: " + new Date().toLocaleDateString("en-IN") + (nextUnpaid ? "\n⏭ Next Due: Week #" + nextNum + " — Rs " + nextAmt?.toLocaleString("en-IN") : "\n🎉 All payments complete! Thank you.") + "\n\nThank you! 🙏";
        const msgTe = "✅ చెల్లింపు రసీదు\n\nప్రియమైన " + client?.name + " గారికి,\n\nవారపు చెల్లింపు స్వీకరించబడింది:\n🗓 వారం #" + (realIdx + 1) + "\n💰 మొత్తం: రూ " + slotAmt?.toLocaleString("en-IN") + "\n📆 తేదీ: " + new Date().toLocaleDateString("en-IN") + (nextUnpaid ? "\n⏭ తదుపరి వాయిదా: వారం #" + nextNum + " — రూ " + nextAmt?.toLocaleString("en-IN") : "\n🎉 అన్ని చెల్లింపులు పూర్తయ్యాయి!") + "\n\nధన్యవాదాలు! 🙏";
        setReceiptPopup({ en: msgEn, te: msgTe });
      }
    } catch (err) { alert(err.message); }
    setLoading(null);
  }

  function buildReminderMsgs() {
    const now = new Date();
    const overdue = slots.filter(s => isOverdue(s, "weekly"));
    const currentWeek = slots.find(s => !s.paid && isWeekAllowedToPay(s));

    let linesEn = [], linesTe = [], totalDue = 0;

    overdue.forEach(s => {
      const num = slots.findIndex(sl => sl.id === s.id) + 1;
      const amt = s.customAmt !== undefined ? s.customAmt : weeklyAmount;
      const daysLate = s.dueDate ? Math.floor((now - new Date(s.dueDate)) / (1000 * 60 * 60 * 24)) : 0;
      const daysTextEn = daysLate > 0 ? " (" + daysLate + " days overdue)" : "";
      const daysTextTe = daysLate > 0 ? " (" + daysLate + " రోజులు ఆలస్యం)" : "";
      linesEn.push("  ⚠️ OVERDUE - వారం #" + num + " — Rs " + amt.toLocaleString("en-IN") + daysTextEn);
      linesTe.push("  ⚠️ బాకీ వారం #" + num + " — రూ " + amt.toLocaleString("en-IN") + daysTextTe);
      totalDue += amt;
    });

    if (currentWeek && !overdue.find(s => s.id === currentWeek.id)) {
      const num = slots.findIndex(sl => sl.id === currentWeek.id) + 1;
      const amt = currentWeek.customAmt !== undefined ? currentWeek.customAmt : weeklyAmount;
      const daysSinceDue = currentWeek.dueDate ? Math.floor((now - new Date(currentWeek.dueDate)) / (1000 * 60 * 60 * 24)) : 0;
      const daysMsgEn = daysSinceDue > 0 ? " — " + daysSinceDue + " day" + (daysSinceDue > 1 ? "s" : "") + " since due" : "";
      const daysMsgTe = daysSinceDue > 0 ? " — " + daysSinceDue + " రోజులైంది" : "";
      linesEn.push("  📅 ఈ వారం వాయిదా #" + num + " — Rs " + amt.toLocaleString("en-IN") + daysMsgEn);
      linesTe.push("  📅 ఈ వారం వాయిదా #" + num + " — రూ " + amt.toLocaleString("en-IN") + daysMsgTe);
      totalDue += amt;
    }

    if (linesEn.length === 0) return null;
    return {
      en: "🔔 Payment Reminder\n\nDear " + client?.name + ",\n\nThe following weekly EMI payments require your attention:\n\n" + linesEn.join("\n") + "\n\n💰 Total Due: Rs " + totalDue.toLocaleString("en-IN") + "\n\nKindly pay at the earliest. Thank you! 🙏",
      te: "🔔 వాయిదా రిమైండర్\n\nప్రియమైన " + client?.name + " గారికి,\n\nదిగువ వారపు వాయిదాలు వెంటనే చెల్లించవలసి ఉంది:\n\n" + linesTe.join("\n") + "\n\n💰 మొత్తం బాకీ: రూ " + totalDue.toLocaleString("en-IN") + "\n\nత్వరగా చెల్లించగలరు. ధన్యవాదాలు! 🙏",
    };
  }

  async function handleEditWeeklyAmount({ newWeeklyAmt, newTotalWeeks, lastWeekRemainder, newGrandTotal, newInterest }) {
    // Lock paid slots: stamp customAmt on any paid slot that doesn't already have it,
    // using loanData.weeklyAmount (the ORIGINAL amount before this edit)
    const originalWeeklyAmt = loanData.weeklyAmount;
    const lockedPaidSlots = slots
      .filter(s => s.paid)
      .map(s => ({
        ...s,
        // If no customAmt yet, lock it now at the original rate so future edits don't corrupt it
        customAmt: s.customAmt !== undefined ? s.customAmt : originalWeeklyAmt,
      }));
    const paidCount = lockedPaidSlots.length;

    // Due dates based on loan start date — same formula as original generation
    const startDate = new Date(loanData.startDate);
    const newUnpaidSlots = [];
    for (let i = 0; i < newTotalWeeks; i++) {
      const globalWeekNum = paidCount + i + 1;
      const due = new Date(startDate);
      due.setDate(due.getDate() + globalWeekNum * 7);
      const isLastWeek = i === newTotalWeeks - 1 && lastWeekRemainder > 0;
      const slotAmt = isLastWeek ? lastWeekRemainder : newWeeklyAmt;
      const slot = {
        id: "week-" + globalWeekNum,
        label: "Week " + globalWeekNum + " — due " + due.toLocaleDateString("en-IN"),
        dueDate: due.toISOString(),
        paid: false,
        paidDate: null,
      };
      // Only set customAmt when it differs from new base (i.e. the last remainder week)
      if (slotAmt !== newWeeklyAmt) slot.customAmt = slotAmt;
      newUnpaidSlots.push(slot);
    }

    const updatedSlots = [...lockedPaidSlots, ...newUnpaidSlots];
    const updatedLoanData = {
      ...loanData,
      weeklyAmount: newWeeklyAmt,
      totalWeeks: paidCount + newTotalWeeks,
      interestEarned: newInterest,
    };
    const logEntry = {
      action: "WEEKLY_EDITED",
      week: "-",
      weekNum: 0,
      amount: newWeeklyAmt,
      note: "Weekly amount updated: Rs " + originalWeeklyAmt.toLocaleString("en-IN") +
        " → Rs " + newWeeklyAmt.toLocaleString("en-IN") +
        " | Remaining weeks: " + newTotalWeeks +
        (lastWeekRemainder > 0 ? " (last week: Rs " + lastWeekRemainder.toLocaleString("en-IN") + ")" : "") +
        " | New total: Rs " + newGrandTotal.toLocaleString("en-IN"),
      date: new Date().toISOString(),
    };
    const newHistory = [logEntry, ...history];
    await persistLoan(updatedSlots, newHistory, updatedLoanData);
    setSlots(updatedSlots);
    setHistory(newHistory);
    setLoanData(updatedLoanData);
    setShowEditWeekly(false);
  }

  function sendWhatsApp(msg) {
    window.open("https://wa.me/91" + client?.phone?.replace(/\D/g, "") + "?text=" + encodeURIComponent(msg), "_blank");
  }

  async function deleteHistoryEntry(idx) {
    if (!window.confirm("Delete this entry?")) return;
    const newHistory = history.filter((_, i) => i !== idx);
    await persistLoan(slots, newHistory, loanData);
    setHistory(newHistory);
  }

  async function clearHistory() {
    if (!window.confirm("Clear all history?")) return;
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
      {showEditWeekly && (
        <EditWeeklyAmountPopup loan={loanData} slots={slots} onConfirm={handleEditWeeklyAmount} onCancel={() => setShowEditWeekly(false)} />
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

      {allPaid && (
        <div style={s.settledBanner}>✅ All weekly payments collected!</div>
      )}

      {/* Header */}
      <div style={s.header}>
        <div style={s.badge}>Weekly Finance #{loanIndex + 1}</div>
        <div style={s.title}>Rs {loanData.principal?.toLocaleString("en-IN")} — Rs {weeklyAmount}/week × {loanData.totalWeeks} weeks</div>
        {loanData.notes && <div style={s.notes}>{loanData.notes}</div>}
        {overdueSlots.length > 0 && !allPaid && (
          <div style={s.overdueBadge}>⚠️ {overdueSlots.length} week(s) overdue</div>
        )}
      </div>

      {/* Stats — show principal + outstanding */}
      <div style={s.statsGrid}>
        <Stat label="Principal Given" value={formatCurrency(loanData.principal)} color="#94a3b8" />
        <Stat label="Outstanding" value={formatCurrency(totalOutstanding)} color={totalOutstanding > 0 ? "#f59e0b" : "#10b981"} />
        <Stat label="Weekly Amount" value={formatCurrency(weeklyAmount)} color="#818cf8" highlight />
        <Stat label="Collected ↗" value={formatCurrency(totalCollected)} color="#10b981" clickable onClick={() => setShowCollected(v => !v)} />
      </div>

      {/* Collected panel — paid weeks in last 12 months */}
      {showCollected && (() => {
        const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const recentPaid = slots.filter(s => s.paid && s.paidDate && new Date(s.paidDate) >= oneYearAgo)
          .sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
        const recentTotal = recentPaid.reduce((sum, s) => sum + (s.customAmt !== undefined ? s.customAmt : weeklyAmount), 0);
        return (
          <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.18)", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: 1 }}>📅 Collected (Last 12 Months)</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981" }}>Total: {formatCurrency(recentTotal)}</span>
            </div>
            {recentPaid.length === 0
              ? <div style={{ fontSize: 12, color: "#475569" }}>No payments collected in the last 12 months.</div>
              : recentPaid.map((sl, i) => {
                const amt = sl.customAmt !== undefined ? sl.customAmt : weeklyAmount;
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
                    <span style={{ color: "#94a3b8" }}>{sl.label}</span>
                    <span style={{ color: "#10b981", fontWeight: 700 }}>{formatCurrency(amt)}</span>
                    <span style={{ color: "#475569", fontSize: 11 }}>{formatDate(sl.paidDate)}</span>
                  </div>
                );
              })
            }
          </div>
        );
      })()}

      {/* Edit remaining weekly amount */}
      {!allPaid && (
        <div style={s.editWeeklyBox}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>
              {slots.filter(s => !s.paid).length} week(s) remaining · outstanding Rs {totalOutstanding.toLocaleString("en-IN")}
            </div>
            <div style={{ fontSize: 12, color: "#475569" }}>
              Interest earned so far: Rs {(totalCollected - loanData.principal > 0 ? totalCollected - loanData.principal : loanData.interestEarned || 0).toLocaleString("en-IN")}
            </div>
          </div>
          <button style={s.editWeeklyBtn} onClick={() => setShowEditWeekly(true)}>
            ✏️ Edit Weekly Amount
          </button>
        </div>
      )}

      {/* Progress */}
      <div style={s.progressBox}>
        <div style={s.progressRow}>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>Progress</span>
          <span style={{ color: "white", fontWeight: 700 }}>{paidCount}/{slots.length} weeks ({progress}%)</span>
        </div>
        <div style={s.progressTrack}>
          <div style={{ ...s.progressFill, width: progress + "%" }} />
        </div>
      </div>

      {/* Weekly slots */}
      <div style={s.pageHeader}>
        <div style={s.sectionTitle}>Weekly Payments</div>
        {totalPages > 1 && (
          <div style={s.pageControls}>
            <button style={s.pageBtn} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>◀</button>
            <span style={{ color: "#64748b", fontSize: 12 }}>{page + 1}/{totalPages}</span>
            <button style={s.pageBtn} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>▶</button>
          </div>
        )}
      </div>

      <div style={s.slotsGrid}>
        {pageSlots.map((slot, idx) => {
          const realIdx = page * PAGE_SIZE + idx;
          const over = isOverdue(slot, "weekly");
          const allowed = isWeekAllowedToPay(slot);
          const isFuture = !allowed && !slot.paid;
          const slotAmt = slot.customAmt !== undefined ? slot.customAmt : weeklyAmount;
          const isEdited = slot.customAmt !== undefined && slot.customAmt !== loan.weeklyAmount;
          return (
            <div key={slot.id} style={{ ...s.slot, ...(slot.paid ? s.slotPaid : over ? s.slotOverdue : isFuture ? s.slotFuture : {}) }}>
              <div style={s.slotWeek}>Week #{realIdx + 1}</div>
              <div style={s.slotDate}>{slot.dueDate ? new Date(slot.dueDate).toLocaleDateString("en-IN") : ""}</div>
              <div style={{ ...s.slotAmt, color: isFuture ? "#334155" : "white" }}>
                {formatCurrency(slotAmt)}
                {isEdited && <span style={{ fontSize: 9, color: "#818cf8", marginLeft: 3 }}>*</span>}
              </div>
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
        <div style={{ display: "flex", gap: 8 }}>
          {history.length > 0 && (
            <button style={s.clearBtn} onClick={e => { e.stopPropagation(); clearHistory(); }}>Clear</button>
          )}
          <span style={{ color: "#475569" }}>{showHistory ? "▲" : "▼"}</span>
        </div>
      </div>
      {showHistory && (
        <div style={s.historyBox}>
          {history.length === 0
            ? <div style={{ color: "#475569", fontSize: 13, padding: 14 }}>No history yet.</div>
            : history.map((h, i) => {
              const actionColor = h.action === "PAID" ? "#10b981" : h.action === "WEEKLY_EDITED" ? "#818cf8" : "#ef4444";
              const actionBg = h.action === "PAID" ? "rgba(16,185,129,0.15)" : h.action === "WEEKLY_EDITED" ? "rgba(99,102,241,0.15)" : "rgba(239,68,68,0.15)";
              const label = h.action === "WEEKLY_EDITED" ? "EDITED" : h.action;
              return (
                <div key={i} style={s.historyRow}>
                  <span style={{ ...s.hbadge, background: actionBg, color: actionColor }}>{label}</span>
                  <span style={{ color: "#94a3b8", fontSize: 12, flex: 1, minWidth: 0 }}>
                    {h.note || h.week + (h.weekNum > 0 ? " (#" + h.weekNum + ")" : "")}
                  </span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>{formatCurrency(h.amount)}</span>
                  <span style={{ color: "#334155", fontSize: 11 }}>{formatDate(h.date)}</span>
                  <button style={s.delBtn} onClick={() => deleteHistoryEntry(i)}>✕</button>
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
    <div onClick={onClick} style={{ background: highlight ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)", border: "1px solid " + (highlight ? "rgba(99,102,241,0.25)" : clickable ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)"), borderRadius: 12, padding: "11px 13px", cursor: clickable ? "pointer" : "default" }}>
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
  header: { marginBottom: 16 },
  badge: { fontSize: 10, color: "#f59e0b", background: "rgba(245,158,11,0.12)", padding: "3px 10px", borderRadius: 20, display: "inline-block", marginBottom: 5, letterSpacing: 1 },
  title: { fontSize: 16, fontWeight: 800, color: "white", marginBottom: 4 },
  notes: { fontSize: 12, color: "#475569" },
  overdueBadge: { display: "inline-block", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.28)", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#fca5a5", fontWeight: 700, marginTop: 5 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 10 },
  editWeeklyBox: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 12, padding: "12px 15px", marginBottom: 10, gap: 10, flexWrap: "wrap" },
  editWeeklyBtn: { padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.14)", color: "#818cf8", cursor: "pointer", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  progressBox: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 13, marginBottom: 18 },
  progressRow: { display: "flex", justifyContent: "space-between", marginBottom: 7 },
  progressTrack: { height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", background: "linear-gradient(90deg, #f59e0b, #10b981)", borderRadius: 4, transition: "width 0.4s" },
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1 },
  pageControls: { display: "flex", gap: 6, alignItems: "center" },
  pageBtn: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#64748b", padding: "3px 9px", cursor: "pointer", fontSize: 12 },
  slotsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8, marginBottom: 22 },
  slot: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 11, padding: 10, display: "flex", flexDirection: "column", gap: 3 },
  slotPaid: { background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.22)" },
  slotOverdue: { background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.28)" },
  slotFuture: { opacity: 0.4, background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" },
  slotWeek: { fontSize: 11, fontWeight: 700, color: "#f59e0b" },
  slotDate: { fontSize: 10, color: "#334155" },
  slotAmt: { fontSize: 15, fontWeight: 800, color: "white" },
  paidDate: { fontSize: 10, color: "#10b981" },
  overdueTag: { fontSize: 9, color: "#ef4444", fontWeight: 700, letterSpacing: 0.8 },
  slotBtn: { marginTop: 3, padding: "5px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700 },
  btnPaid: { background: "rgba(16,185,129,0.18)", color: "#10b981" },
  btnUnpaid: { background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  btnOverdue: { background: "rgba(239,68,68,0.18)", color: "#ef4444" },
  btnFuture: { background: "rgba(255,255,255,0.03)", color: "#334155", cursor: "not-allowed" },
  historyToggle: { display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: 7 },
  clearBtn: { fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "none", borderRadius: 5, padding: "3px 8px", cursor: "pointer" },
  historyBox: { background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 11, overflow: "hidden" },
  historyRow: { display: "flex", alignItems: "center", gap: 8, padding: "9px 13px", borderBottom: "1px solid rgba(255,255,255,0.03)", flexWrap: "wrap" },
  hbadge: { fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: 0.8, flexShrink: 0 },
  delBtn: { background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 13, marginLeft: "auto" },
};
