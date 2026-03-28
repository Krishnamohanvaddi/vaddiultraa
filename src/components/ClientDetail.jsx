import { useState, useEffect } from "react";
import { db } from "../firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { formatCurrency, formatDate, calcMonthlyInterest } from "../utils/calc";
import LoanDetail from "./LoanDetail";
import LoanModal from "./LoanModal";
import WeeklyLoanDetail from "./WeeklyLoanDetail";
import WeeklyLoanModal from "./WeeklyLoanModal";
import OneMoModal from "./OneMoModal";

export default function ClientDetail({ client, onBack, openLoanIdx, openWeeklyIdx }) {
  const [view, setView] = useState(
    openLoanIdx !== undefined && openLoanIdx >= 0 ? { type: "loan", idx: openLoanIdx } :
    openWeeklyIdx !== undefined && openWeeklyIdx >= 0 ? { type: "weekly", idx: openWeeklyIdx } :
    { type: "main" }
  );
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showWeeklyModal, setShowWeeklyModal] = useState(false);
  const [editingLoan, setEditingLoan] = useState(null);
  const [editingWeekly, setEditingWeekly] = useState(null);
  const [showOneMoModal, setShowOneMoModal] = useState(false);
  const loans = client?.loans || [];
  const weeklyLoans = client?.weeklyLoans || [];

  const totalMonthlyOwed = loans.reduce((s, l) => s + (l.totalPayable - (l.totalCollected || 0)), 0);
  const totalWeeklyOwed = weeklyLoans.reduce((s, l) => s + ((l.totalWeeks * l.weeklyAmount) - (l.totalCollected || 0)), 0);

  async function saveLoan(loan) {
    const updated = editingLoan !== null
      ? loans.map((l, i) => i === editingLoan ? loan : l)
      : [...loans, loan];
    await updateDoc(doc(db, "clients", client.id), { loans: updated, updatedAt: serverTimestamp() });
    setShowLoanModal(false);
    setEditingLoan(null);
  }

  async function saveWeekly(loan) {
    const updated = editingWeekly !== null
      ? weeklyLoans.map((l, i) => i === editingWeekly ? loan : l)
      : [...weeklyLoans, loan];
    await updateDoc(doc(db, "clients", client.id), { weeklyLoans: updated, updatedAt: serverTimestamp() });
    setShowWeeklyModal(false);
    setEditingWeekly(null);
  }

  async function deleteLoan(idx) {
    const updated = loans.filter((_, i) => i !== idx);
    await updateDoc(doc(db, "clients", client.id), { loans: updated, updatedAt: serverTimestamp() });
    setView({ type: "main" });
  }

  async function deleteWeekly(idx) {
    const updated = weeklyLoans.filter((_, i) => i !== idx);
    await updateDoc(doc(db, "clients", client.id), { weeklyLoans: updated, updatedAt: serverTimestamp() });
    setView({ type: "main" });
  }

  // Loan or weekly detail view
  // Guard: if loan at view.idx was deleted (Firestore update beats setView), go to main
  useEffect(() => {
    if (view.type === "loan" && !loans[view.idx]) setView({ type: "main" });
    if (view.type === "weekly" && !weeklyLoans[view.idx]) setView({ type: "main" });
  }, [loans, weeklyLoans, view]);

  const loanMissing = view.type === "loan" && !loans[view.idx];
  const weeklyMissing = view.type === "weekly" && !weeklyLoans[view.idx];
  if (loanMissing || weeklyMissing) return null;

  if (view.type === "loan") {
    const isOneMo = loans[view.idx]?.loanType === "oneMonth";
    return (
      <div style={s.page}>
        <LoanDetail
          client={client}
          loan={loans[view.idx]}
          loanIndex={view.idx}
          onBack={() => setView({ type: "main" })}
          onEdit={() => {
            setEditingLoan(view.idx);
            if (isOneMo) setShowOneMoModal(true);
            else { setShowLoanModal(true); setView({ type: "main" }); }
          }}
          onDelete={() => deleteLoan(view.idx)}
        />
        {showLoanModal && !isOneMo && (
          <LoanModal
            editLoan={editingLoan !== null ? loans[editingLoan] : null}
            onClose={() => { setShowLoanModal(false); setEditingLoan(null); }}
            onSave={saveLoan}
          />
        )}
        {showOneMoModal && isOneMo && (
          <OneMoModal
            editLoan={editingLoan !== null ? loans[editingLoan] : null}
            onClose={() => { setShowOneMoModal(false); setEditingLoan(null); }}
            onSave={saveLoan}
          />
        )}
      </div>
    );
  }

  if (view.type === "weekly") {
    return (
      <div style={s.page}>
        <WeeklyLoanDetail
          client={client}
          loan={weeklyLoans[view.idx]}
          loanIndex={view.idx}
          onBack={() => setView({ type: "main" })}
          onEdit={() => { setEditingWeekly(view.idx); setShowWeeklyModal(true); setView({ type: "main" }); }}
          onDelete={() => deleteWeekly(view.idx)}
        />
        {showWeeklyModal && (
          <WeeklyLoanModal
            editLoan={editingWeekly !== null ? weeklyLoans[editingWeekly] : null}
            onClose={() => { setShowWeeklyModal(false); setEditingWeekly(null); }}
            onSave={saveWeekly}
          />
        )}
      </div>
    );
  }

  // Main client view
  return (
    <div style={s.page}>
      <button style={s.backBtn} onClick={onBack}>← All Clients</button>

      {/* Profile */}
      <div style={s.profile}>
        <div style={s.photoWrap}>
          {client?.photoURL
            ? <img src={client?.photoURL} alt={client?.name} style={s.photo} />
            : <div style={s.photoPlaceholder}>{client?.name[0]}</div>
          }
        </div>
        <div style={s.profileInfo}>
          <h2 style={s.clientName}>{client?.name}</h2>
          <div style={s.clientMeta}>📞 {client?.phone}</div>
          {client?.address && <div style={s.clientMeta}>📍 {client?.address}</div>}
          {client?.altPhone && <div style={s.clientMeta}>📞 Alt: {client?.altPhone}</div>}
          {client?.notes && <div style={s.clientMeta}>📝 {client?.notes}</div>}
        </div>
      </div>

      {/* Documents */}
      {client?.documents?.some(d => d) && (
        <div style={s.docsRow}>
          {client?.documents.map((d, i) => d && (
            <a key={i} href={d.url} target="_blank" rel="noreferrer" style={s.docLink}>
              📄 {d.name || `Document ${i + 1}`}
            </a>
          ))}
        </div>
      )}

      {/* Summary */}
      <div style={s.summaryGrid}>
        <SumCard label="Monthly Loans" value={loans.length} sub={`${formatCurrency(totalMonthlyOwed)} remaining`} color="#6366f1" />
        <SumCard label="Weekly Finance" value={weeklyLoans.length} sub={`${formatCurrency(totalWeeklyOwed)} remaining`} color="#f59e0b" />
      </div>

      {/* Monthly Loans */}
      <div style={s.sectionHeader}>
        <div style={s.sectionTitle}>💰 Monthly Loans</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={s.addBtn} onClick={() => { setEditingLoan(null); setShowLoanModal(true); }}>+ Add Loan</button>
          <button style={{ ...s.addBtn, background: "rgba(6,182,212,0.12)", color: "#06b6d4", border: "1px solid rgba(6,182,212,0.3)" }}
            onClick={() => {
              // Create 1-month loan directly: open modal with loanType flag
              setEditingLoan(null);
              setShowOneMoModal(true);
            }}>+ 1 Month</button>
        </div>
      </div>

      {loans.length === 0
        ? <div style={s.empty}>No monthly loans yet. Click '+ Add Loan' to add one.</div>
        : loans.map((loan, idx) => {
          const paid = (loan.monthSlots || []).filter(s => s.paid).length;
          const progress = Math.round((paid / loan.durationMonths) * 100);
          const remaining = loan.totalPayable - (loan.totalCollected || 0);
          return (
            <div key={loan.id} style={s.loanCard} onClick={() => setView({ type: "loan", idx })}>
              <div style={s.loanTop}>
                <div>
                  <div style={{ ...s.loanBadge, ...(loan.loanType === "oneMonth" ? { color: "#06b6d4", background: "rgba(6,182,212,0.1)" } : {}) }}>
                    {loan.loanType === "oneMonth" ? "1 Month Loan" : `Loan #${idx + 1}`}
                  </div>
                  <div style={s.loanTitle}>₹{loan.principal?.toLocaleString("en-IN")} @ ₹{loan.ratePerHundred}/₹100</div>
                  <div style={s.loanSub}>{formatCurrency(loan.monthlyInterest)}/month · {loan.durationMonths} months · Started {formatDate(loan.startDate)}</div>
                  {loan.notes && <div style={s.loanNotes}>{loan.notes}</div>}
                </div>
                <div style={s.loanRight}>
                  <div style={s.loanRemaining}>{formatCurrency(remaining)}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>remaining</div>
                </div>
              </div>
              <div style={s.miniBar}><div style={{ ...s.miniBarFill, width: `${progress}%` }} /></div>
              <div style={s.loanProgress}>{paid}/{loan.durationMonths} months paid</div>
            </div>
          );
        })
      }

      {/* Weekly Finance */}
      <div style={{ ...s.sectionHeader, marginTop: 24 }}>
        <div style={s.sectionTitle}>📅 Weekly Finance</div>
        <button style={{ ...s.addBtn, background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }} onClick={() => { setEditingWeekly(null); setShowWeeklyModal(true); }}>+ Add Weekly</button>
      </div>

      {weeklyLoans.length === 0
        ? <div style={s.empty}>No weekly finance yet. Click '+ Add Weekly' to add one.</div>
        : weeklyLoans.map((wl, idx) => {
          const paid = (wl.weekSlots || []).filter(s => s.paid).length;
          const progress = Math.round((paid / wl.totalWeeks) * 100);
          const totalRec = wl.totalWeeks * wl.weeklyAmount;
          const remaining = totalRec - (wl.totalCollected || 0);
          return (
            <div key={wl.id} style={{ ...s.loanCard, borderColor: "rgba(245,158,11,0.2)" }} onClick={() => setView({ type: "weekly", idx })}>
              <div style={s.loanTop}>
                <div>
                  <div style={{ ...s.loanBadge, color: "#f59e0b", background: "rgba(245,158,11,0.1)" }}>Weekly #{idx + 1}</div>
                  <div style={s.loanTitle}>₹{wl.principal?.toLocaleString("en-IN")} → ₹{wl.weeklyAmount}/week × {wl.totalWeeks} weeks</div>
                  <div style={s.loanSub}>Interest: ₹{wl.interestEarned?.toLocaleString("en-IN")} · Started {formatDate(wl.startDate)}</div>
                </div>
                <div style={s.loanRight}>
                  <div style={{ ...s.loanRemaining, color: "#f59e0b" }}>{formatCurrency(remaining)}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>remaining</div>
                </div>
              </div>
              <div style={s.miniBar}><div style={{ ...s.miniBarFill, width: `${progress}%`, background: "linear-gradient(90deg, #f59e0b, #10b981)" }} /></div>
              <div style={s.loanProgress}>{paid}/{wl.totalWeeks} weeks paid</div>
            </div>
          );
        })
      }

      {showLoanModal && (
        <LoanModal
          editLoan={editingLoan !== null ? loans[editingLoan] : null}
          onClose={() => { setShowLoanModal(false); setEditingLoan(null); }}
          onSave={saveLoan}
        />
      )}
      {showOneMoModal && (
        <OneMoModal
          onClose={() => setShowOneMoModal(false)}
          onSave={saveLoan}
        />
      )}
      {showWeeklyModal && (
        <WeeklyLoanModal
          editLoan={editingWeekly !== null ? weeklyLoans[editingWeekly] : null}
          onClose={() => { setShowWeeklyModal(false); setEditingWeekly(null); }}
          onSave={saveWeekly}
        />
      )}
    </div>
  );
}

function SumCard({ label, value, sub, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 28, fontWeight: 900, color, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

const s = {
  page: { fontFamily: "'Segoe UI', sans-serif", paddingBottom: 40 },
  backBtn: { background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", padding: "7px 14px", cursor: "pointer", fontSize: 13, marginBottom: 20 },
  profile: { display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 18 },
  photoWrap: { flexShrink: 0 },
  photo: { width: 72, height: 72, borderRadius: "50%", objectFit: "cover" },
  photoPlaceholder: { width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, color: "white" },
  profileInfo: { flex: 1 },
  clientName: { margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: "white" },
  clientMeta: { fontSize: 13, color: "#64748b", marginBottom: 3 },
  docsRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 },
  docLink: { padding: "6px 12px", borderRadius: 8, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", color: "#818cf8", fontSize: 12, textDecoration: "none" },
  summaryGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 },
  addBtn: { padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.15)", color: "#818cf8", cursor: "pointer", fontSize: 12, fontWeight: 700 },
  empty: { color: "#334155", fontSize: 13, padding: "14px 0", textAlign: "center" },
  loanCard: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "14px 16px", marginBottom: 10, cursor: "pointer" },
  loanTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  loanBadge: { fontSize: 10, color: "#818cf8", background: "rgba(99,102,241,0.1)", padding: "2px 8px", borderRadius: 20, display: "inline-block", marginBottom: 4, letterSpacing: 1 },
  loanTitle: { fontSize: 15, fontWeight: 700, color: "white", marginBottom: 3 },
  loanSub: { fontSize: 12, color: "#64748b" },
  loanNotes: { fontSize: 11, color: "#475569", marginTop: 3 },
  loanRight: { textAlign: "right" },
  loanRemaining: { fontSize: 18, fontWeight: 800, color: "#6366f1" },
  miniBar: { height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden", marginBottom: 6 },
  miniBarFill: { height: "100%", background: "linear-gradient(90deg, #6366f1, #10b981)", borderRadius: 2 },
  loanProgress: { fontSize: 11, color: "#475569" },
};
