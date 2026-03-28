import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, query, where, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import ClientModal from "../components/ClientModal";
import ClientDetail from "../components/ClientDetail";
import { formatCurrency, isOverdue } from "../utils/calc";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const [clients, setClients] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showOverduePanel, setShowOverduePanel] = useState(false);
  const [showMonthlyCollected, setShowMonthlyCollected] = useState(false);
  const [showWeeklyCollected, setShowWeeklyCollected] = useState(false);
  const [overduePage, setOverduePage] = useState(false);
  const [collectedPage, setCollectedPage] = useState(null); // "monthly" | "weekly" | null
  const [adminName, setAdminName] = useState(() => localStorage.getItem("adminName") || "");
  const [adminPhone, setAdminPhone] = useState(() => localStorage.getItem("adminPhone") || "");
  const [showAdminSettings, setShowAdminSettings] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "clients"), where("adminId", "==", user.uid));
    const unsub = onSnapshot(q, snap => {
      setClients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [user.uid]);

  useEffect(() => {
    if (!selectedClient) return;
    if (clients.length === 0) return; // still loading
    const updated = clients.find(c => c.id === selectedClient.id);
    if (updated) {
      setSelectedClient(prev => prev ? { ...updated, _openLoanIdx: prev._openLoanIdx } : null);
    } else {
      setSelectedClient(null);
    }
  }, [clients]);

  const totalPrincipal = clients.reduce((s, c) =>
    s + ((c.loans || []).reduce((a, l) => a + l.principal, 0) +
    (c.weeklyLoans || []).reduce((a, l) => a + l.principal, 0)), 0);

  const totalOwed = clients.reduce((s, c) =>
    s + ((c.loans || []).reduce((a, l) => a + l.totalPayable - (l.totalCollected || 0), 0) +
    (c.weeklyLoans || []).reduce((a, l) => a + l.totalWeeks * l.weeklyAmount - (l.totalCollected || 0), 0)), 0);

  // Always compute collected from actual slots — never from stored totalCollected (can drift after top-up)
  const totalCollected = clients.reduce((s, c) => {
    const monthlyCol = (c.loans || []).reduce((a, l) =>
      a + (l.monthSlots || []).filter(sl => sl.paid)
        .reduce((ss, sl) => ss + (sl.customEmi !== undefined ? sl.customEmi : l.monthlyInterest), 0), 0);
    const weeklyCol = (c.weeklyLoans || []).reduce((a, l) =>
      a + (l.weekSlots || []).filter(sl => sl.paid)
        .reduce((ss, sl) => ss + (sl.customAmt !== undefined ? sl.customAmt : l.weeklyAmount), 0), 0);
    return s + monthlyCol + weeklyCol;
  }, 0);

  const overdueClients = clients.filter(c =>
    (c.loans || []).some(l => (l.monthSlots || []).some(sl => isOverdue(sl))) ||
    (c.weeklyLoans || []).some(l => (l.weekSlots || []).some(sl => isOverdue(sl, "weekly")))
  );

  // This month collected (monthly loans — slots with paidDate in current calendar month)
  const now = new Date();
  const currentMonthId = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const thisMonthCollected = clients.reduce((sum, c) =>
    sum + (c.loans || []).reduce((ls, l) =>
      ls + (l.monthSlots || []).filter(sl => sl.paid && sl.id === currentMonthId)
        .reduce((ss, sl) => ss + (sl.customEmi !== undefined ? sl.customEmi : l.monthlyInterest), 0), 0), 0);

  // This week collected (weekly loans — slots with paidDate in current week Mon-Sun)
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - dayOfWeek); weekStart.setHours(0,0,0,0);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
  const thisWeekCollected = clients.reduce((sum, c) =>
    sum + (c.weeklyLoans || []).reduce((ls, l) =>
      ls + (l.weekSlots || []).filter(sl => {
        if (!sl.paid || !sl.paidDate) return false;
        const pd = new Date(sl.paidDate);
        return pd >= weekStart && pd < weekEnd;
      }).reduce((ss, sl) => ss + (sl.customAmt !== undefined ? sl.customAmt : l.weeklyAmount), 0), 0), 0);

  const filtered = clients
    .filter(c => {
      const m = c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search);
      if (filter === "overdue") return m && overdueClients.find(o => o.id === c.id);
      return m;
    })
    // sort: overdue clients first, then alphabetical
    .sort((a, b) => {
      const aOver = overdueClients.some(o => o.id === a.id);
      const bOver = overdueClients.some(o => o.id === b.id);
      if (aOver && !bOver) return -1;
      if (!aOver && bOver) return 1;
      return a.name?.localeCompare(b.name);
    });

  async function handleDelete(id) {
    if (!window.confirm("Delete this client and all their data?")) return;
    await deleteDoc(doc(db, "clients", id));
  }

  function openEdit(client) {
    setEditClient(client);
    setShowModal(true);
    setSelectedClient(null);
  }

  const mainPadding = isMobile ? "70px 14px 24px" : "24px";

  // ── OVERDUE FULL PAGE ─────────────────────────────────────────
  if (overduePage) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "#0f1117", fontFamily: "'Segoe UI', sans-serif" }}>
        {!isMobile && <Sidebar user={user} logout={logout} />}
        {isMobile && <MobileTopBar user={user} logout={logout} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />}
        <main style={{ flex: 1, padding: isMobile ? "70px 14px 24px" : "24px", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <button onClick={() => setOverduePage(false)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", padding: "7px 14px", cursor: "pointer", fontSize: 13 }}>← Dashboard</button>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "white" }}>⚠️ Overdue Clients</h2>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{overdueClients.length} client{overdueClients.length !== 1 ? "s" : ""} with overdue payments</div>
            </div>
            {/* WA Report button */}
            <button
              onClick={() => {
                if (!adminPhone) { setShowAdminSettings(true); return; }
                // Build overdue summary message
                const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
                let msg = "📊 *InterestPro Overdue Report*\n" + today + "\n\n";
                let grandTotal = 0;
                overdueClients.forEach(c => {
                  const oLoanIdx = (c.loans || []).findIndex(l => (l.monthSlots || []).some(sl => isOverdue(sl)));
                  const oLoan = c.loans?.[oLoanIdx];
                  const oMonths = (oLoan?.monthSlots || []).filter(sl => isOverdue(sl));
                  const oWeeklyIdx = (c.weeklyLoans || []).findIndex(l => (l.weekSlots || []).some(sl => isOverdue(sl, "weekly")));
                  const oWeekly = c.weeklyLoans?.[oWeeklyIdx];
                  const oWeeks = (oWeekly?.weekSlots || []).filter(sl => isOverdue(sl, "weekly"));
                  let clientTotal = 0;
                  const lines = [];
                  oMonths.forEach(m => {
                    const emi = m.customEmi !== undefined ? m.customEmi : (oLoan?.monthlyInterest || 0);
                    const [sy, sm] = m.id.split("-").map(Number);
                    const daysLate = Math.floor((new Date() - new Date(sy, sm - 1, m.billingDay || 1)) / 86400000);
                    lines.push("  • EMI " + m.label + " — Rs " + emi.toLocaleString("en-IN") + " (" + daysLate + "d late)");
                    clientTotal += emi;
                  });
                  oWeeks.forEach(w => {
                    const amt = w.customAmt !== undefined ? w.customAmt : (oWeekly?.weeklyAmount || 0);
                    const daysLate = w.dueDate ? Math.floor((new Date() - new Date(w.dueDate)) / 86400000) : 0;
                    const wNum = (oWeekly?.weekSlots || []).findIndex(s => s.id === w.id) + 1;
                    lines.push("  • Week #" + wNum + " — Rs " + amt.toLocaleString("en-IN") + " (" + daysLate + "d late)");
                    clientTotal += amt;
                  });
                  if (lines.length > 0) {
                    msg += "👤 *" + c.name + "* (" + (c.phone || "-") + ")\n" + lines.join("\n") + "\n  Total: Rs " + clientTotal.toLocaleString("en-IN") + "\n\n";
                    grandTotal += clientTotal;
                  }
                });
                msg += "━━━━━━━━━━━━━━━━\n💰 *Grand Total: Rs " + grandTotal.toLocaleString("en-IN") + "*\n— Sent by " + (adminName || "Admin") + " via InterestPro";
                window.open("https://wa.me/91" + adminPhone.replace(/\D/g, "") + "?text=" + encodeURIComponent(msg), "_blank");
              }}
              style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(37,211,102,0.3)", background: "rgba(37,211,102,0.12)", color: "#25d366", cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}
            >
              📲 Send WA Report
            </button>
            <button onClick={() => setShowAdminSettings(v => !v)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#64748b", cursor: "pointer", fontSize: 12 }}>⚙️</button>
          </div>

          {/* Admin settings inline */}
          {showAdminSettings && (
            <div style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#818cf8", fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>⚙️ Admin WA Settings</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>Your Name</div>
                  <input value={adminName} onChange={e => { setAdminName(e.target.value); localStorage.setItem("adminName", e.target.value); }}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: 13, boxSizing: "border-box" }}
                    placeholder="Shivaram" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>Your WhatsApp Number</div>
                  <input value={adminPhone} onChange={e => { setAdminPhone(e.target.value); localStorage.setItem("adminPhone", e.target.value); }}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: 13, boxSizing: "border-box" }}
                    placeholder="9876543210" type="tel" />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>Saved automatically. The WA report sends to this number.</div>
            </div>
          )}
          {overdueClients.map(c => {
            const overdueLoanIdx = (c.loans || []).findIndex(l => (l.monthSlots || []).some(sl => isOverdue(sl)));
            const overdueLoan = c.loans?.[overdueLoanIdx];
            const overdueMonths = (overdueLoan?.monthSlots || []).filter(sl => isOverdue(sl));
            const overdueWeeklyIdx = (c.weeklyLoans || []).findIndex(l => (l.weekSlots || []).some(sl => isOverdue(sl, "weekly")));
            const overdueWeekly = c.weeklyLoans?.[overdueWeeklyIdx];
            const overdueWeeks = (overdueWeekly?.weekSlots || []).filter(sl => isOverdue(sl, "weekly"));
            const totalOverdue = overdueMonths.reduce((sum, m) => {
              const emi = m.customEmi !== undefined ? m.customEmi : (overdueLoan?.monthlyInterest || 0);
              return sum + emi;
            }, 0) + overdueWeeks.reduce((sum, w) => {
              return sum + (w.customAmt !== undefined ? w.customAmt : (overdueWeekly?.weeklyAmount || 0));
            }, 0);
            return (
              <div key={c.id} style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(239,68,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#ef4444" }}>{c.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "white" }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "#475569" }}>{c.phone}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#ef4444" }}>{formatCurrency(totalOverdue)}</div>
                    <div style={{ fontSize: 10, color: "#475569" }}>total overdue</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {overdueMonths.map(m => {
                    const emiNum = (overdueLoan.monthSlots || []).findIndex(sl => sl.id === m.id) + 1;
                    const emi = m.customEmi !== undefined ? m.customEmi : (overdueLoan?.monthlyInterest || 0);
                    const [sy, sm] = m.id.split("-").map(Number);
                    const billingDay = m.billingDay || 1;
                    const billingDate = new Date(sy, sm - 1, billingDay);
                    const daysLate = Math.floor((new Date() - billingDate) / (1000 * 60 * 60 * 24));
                    return (
                      <span key={m.id} style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#fca5a5" }}>
                        ⚠️ EMI #{emiNum} — {m.label} — {formatCurrency(emi)}{daysLate > 0 ? " · " + daysLate + "d late" : ""}
                      </span>
                    );
                  })}
                  {overdueWeeks.map(w => {
                    const weekNum = (overdueWeekly.weekSlots || []).findIndex(sl => sl.id === w.id) + 1;
                    const amt = w.customAmt !== undefined ? w.customAmt : (overdueWeekly?.weeklyAmount || 0);
                    const daysLate = w.dueDate ? Math.floor((new Date() - new Date(w.dueDate)) / (1000 * 60 * 60 * 24)) : 0;
                    return (
                      <span key={w.id} style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#fbbf24" }}>
                        ⚠️ Week #{weekNum} — {formatCurrency(amt)}{daysLate > 0 ? " · " + daysLate + "d late" : ""}
                      </span>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {overdueLoanIdx >= 0 && (
                    <button onClick={() => { setSelectedClient({ ...c, _openLoanIdx: overdueLoanIdx }); setOverduePage(false); }}
                      style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "rgba(239,68,68,0.15)", color: "#fca5a5", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                      → Open Loan
                    </button>
                  )}
                  {overdueWeeklyIdx >= 0 && (
                    <button onClick={() => { setSelectedClient({ ...c, _openWeeklyIdx: overdueWeeklyIdx }); setOverduePage(false); }}
                      style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "rgba(245,158,11,0.12)", color: "#fbbf24", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                      → Open Weekly
                    </button>
                  )}
                  <button onClick={() => { setSelectedClient(c); setOverduePage(false); }}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12 }}>
                    View Client
                  </button>
                </div>
              </div>
            );
          })}
        </main>
      </div>
    );
  }

  // ── COLLECTED HISTORY PAGE ────────────────────────────────────
  if (collectedPage) {
    const isMonthly = collectedPage === "monthly";
    const pageTitle = isMonthly ? "📅 Monthly Collections — Last 12 Months" : "🗓 Weekly Collections — Last 3 Months";
    let rows = [];
    if (isMonthly) {
      // Build months latest → oldest (i=0 is current month, i=11 is 12 months ago)
      for (let i = 0; i <= 11; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthId = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        const label = d.toLocaleString("default", { month: "long", year: "numeric" });
        let total = 0; const details = [];
        clients.forEach(c => {
          (c.loans || []).forEach(l => {
            (l.monthSlots || []).forEach(sl => {
              if (sl.paid && sl.id === monthId) {
                const amt = sl.customEmi !== undefined ? sl.customEmi : l.monthlyInterest;
                total += amt;
                details.push({ clientName: c.name, amount: amt, paidDate: sl.paidDate });
              }
            });
          });
        });
        // Sort details by paidDate newest first
        details.sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
        rows.push({ id: monthId, label, total, details });
      }
    } else {
      const threeAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      const buckets = {};
      clients.forEach(c => {
        (c.weeklyLoans || []).forEach(l => {
          (l.weekSlots || []).forEach(sl => {
            if (sl.paid && sl.paidDate) {
              const pd = new Date(sl.paidDate);
              if (pd >= threeAgo) {
                const key = pd.getFullYear() + "-" + String(pd.getMonth() + 1).padStart(2, "0");
                const lbl = pd.toLocaleString("default", { month: "long", year: "numeric" });
                if (!buckets[key]) buckets[key] = { label: lbl, total: 0, details: [] };
                const amt = sl.customAmt !== undefined ? sl.customAmt : l.weeklyAmount;
                buckets[key].total += amt;
                buckets[key].details.push({ clientName: c.name, amount: amt, paidDate: sl.paidDate });
              }
            }
          });
        });
      });
      // Sort latest first
      rows = Object.entries(buckets).sort((a, b) => b[0].localeCompare(a[0])).map(([id, v]) => {
        v.details.sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
        return { id, ...v };
      });
    }
    const grandTotal = rows.reduce((s, r) => s + r.total, 0);
    const accentColor = isMonthly ? "#818cf8" : "#f59e0b";
    const accentBg    = isMonthly ? "rgba(99,102,241,0.06)" : "rgba(245,158,11,0.06)";
    const accentBorder = isMonthly ? "rgba(99,102,241,0.18)" : "rgba(245,158,11,0.18)";
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "#0f1117", fontFamily: "'Segoe UI', sans-serif" }}>
        {!isMobile && <Sidebar user={user} logout={logout} />}
        {isMobile && <MobileTopBar user={user} logout={logout} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />}
        <main style={{ flex: 1, padding: isMobile ? "70px 14px 24px" : "24px", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <button onClick={() => setCollectedPage(null)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", padding: "7px 14px", cursor: "pointer", fontSize: 13 }}>← Dashboard</button>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "white" }}>{pageTitle}</h2>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Grand Total: <strong style={{ color: accentColor }}>{formatCurrency(grandTotal)}</strong></div>
            </div>
          </div>
          {rows.length === 0
            ? <div style={{ color: "#475569", fontSize: 13, textAlign: "center", marginTop: 40 }}>No collections found for this period.</div>
            : rows.map(row => (
              <div key={row.id} style={{ background: accentBg, border: "1px solid " + accentBorder, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                {/* Month header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: row.details.length > 0 ? 8 : 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: accentColor }}>{row.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: row.total > 0 ? accentColor : "#334155" }}>
                    {row.total > 0 ? formatCurrency(row.total) : "—"}
                  </span>
                </div>
                {/* Detail rows — fixed columns */}
                {row.details.length > 0 && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6 }}>
                    {row.details.map((d, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 12px", alignItems: "center", padding: "4px 0 4px 10px", borderLeft: "2px solid rgba(255,255,255,0.07)" }}>
                        <span style={{ color: "#64748b", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.clientName}</span>
                        <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>{formatCurrency(d.amount)}</span>
                        <span style={{ color: "#334155", fontSize: 11, textAlign: "right", whiteSpace: "nowrap" }}>{new Date(d.paidDate).toLocaleDateString("en-IN")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          }
        </main>
      </div>
    );
  }

  if (selectedClient && selectedClient.id) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "#0f1117", fontFamily: "'Segoe UI', sans-serif" }}>
        {!isMobile && <Sidebar user={user} logout={logout} />}
        {isMobile && <MobileTopBar user={user} logout={logout} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />}
        <main style={{ flex: 1, padding: mainPadding, overflowY: "auto" }}>
          <ClientDetail
            client={selectedClient}
            onBack={() => setSelectedClient(null)}
            onEdit={() => openEdit(selectedClient)}
            openLoanIdx={selectedClient._openLoanIdx}
            openWeeklyIdx={selectedClient._openWeeklyIdx}
          />
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0f1117", fontFamily: "'Segoe UI', sans-serif" }}>
      {!isMobile && <Sidebar user={user} logout={logout} />}
      {isMobile && <MobileTopBar user={user} logout={logout} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />}

      <main style={{ flex: 1, padding: mainPadding, overflowY: "auto" }}>
        <div style={s.pageHeader}>
          <div>
            <h1 style={{ ...s.pageTitle, fontSize: isMobile ? 20 : 24 }}>Dashboard</h1>
            <p style={s.pageSub}>{clients.length} clients</p>
          </div>
          <button style={s.addBtn} onClick={() => { setEditClient(null); setShowModal(true); }}>
            + Add Client
          </button>
        </div>

        {/* Stats — 6 cards in 3-col grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
          <StatCard icon="💰" label="Total Out" value={formatCurrency(totalPrincipal)} color="#6366f1" />
          <StatCard icon="📈" label="Total Owed" value={formatCurrency(totalOwed)} color="#f59e0b" />
          <StatCard icon="✅" label="Collected" value={formatCurrency(totalCollected)} color="#10b981" />
          <StatCard
            icon="⚠️" label="Overdue" value={overdueClients.length} color="#ef4444"
            alert={overdueClients.length > 0}
            clickable={overdueClients.length > 0}
            onClick={() => overdueClients.length > 0 && setOverduePage(true)}
          />
          <StatCard
            icon="📅" label="This Month" value={formatCurrency(thisMonthCollected)} color="#818cf8"
            clickable onClick={() => setCollectedPage("monthly")}
          />
          <StatCard
            icon="🗓" label="This Week" value={formatCurrency(thisWeekCollected)} color="#f59e0b"
            clickable onClick={() => setCollectedPage("weekly")}
          />
        </div>

        {/* Search + filter */}
        <div style={s.controls}>
          <input style={s.search} placeholder="Search name or phone..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <div style={s.filters}>
            {["all", "overdue"].map(f => (
              <button key={f}
                style={{ ...s.filterBtn, ...(filter === f ? s.filterActive : {}) }}
                onClick={() => setFilter(f)}>
                {f === "all" ? "All" : "Overdue"}
              </button>
            ))}
          </div>
        </div>

        {/* Client list */}
        {loading
          ? <div style={s.empty}>Loading...</div>
          : filtered.length === 0
            ? <div style={s.empty}>
                {clients.length === 0 ? "No clients yet. Click + Add Client to get started." : "No clients found."}
              </div>
            : filtered.map(client => (
              <ClientCard key={client.id} client={client}
                onView={() => setSelectedClient(client)}
                onEdit={() => openEdit(client)}
                onDelete={() => handleDelete(client.id)}
              />
            ))
        }
      </main>

      {showModal && (
        <ClientModal
          editClient={editClient}
          onClose={() => { setShowModal(false); setEditClient(null); }}
        />
      )}
    </div>
  );
}

// Mobile Top Bar
function MobileTopBar({ user, logout, menuOpen, setMenuOpen }) {
  return (
    <>
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 56,
        background: "#0a0d14", borderBottom: "1px solid rgba(255,255,255,0.08)",
        zIndex: 200, display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "white" }}>
            ₹
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: "white" }}>InterestPro</span>
        </div>
        <button onClick={() => setMenuOpen(!menuOpen)}
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "white", fontSize: 18, cursor: "pointer", padding: "6px 14px" }}>
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>
      {menuOpen && (
        <div style={{
          position: "fixed", top: 56, right: 0, left: 0,
          background: "#0d1117", borderBottom: "1px solid rgba(255,255,255,0.08)",
          zIndex: 199, padding: "16px",
        }}>
          <div style={{ fontSize: 12, color: "#475569", marginBottom: 12 }}>
            Signed in as: {user.email}
          </div>
          <button onClick={logout}
            style={{ width: "100%", padding: "13px", borderRadius: 10, border: "none", background: "rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer", fontSize: 15, fontWeight: 700 }}>
            Sign Out
          </button>
          <div style={{ fontSize: 10, color: "#1e2535", textAlign: "center", marginTop: 12 }}>
            © Shivaram Dasari
          </div>
        </div>
      )}
    </>
  );
}

// Desktop Sidebar
function Sidebar({ user, logout }) {
  return (
    <aside style={s.sidebar}>
      <div style={s.sidebarTop}>
        <div style={s.logo}>₹</div>
        <div>
          <div style={s.logoText}>InterestPro</div>
          <div style={s.logoSub}>Loan Manager</div>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={s.sidebarBottom}>
        <div style={s.userEmail}>{user.email}</div>
        <button style={s.logoutBtn} onClick={logout}>Sign Out</button>
        <div style={{ fontSize: 10, color: "#1e2535", textAlign: "center", marginTop: 10, letterSpacing: 0.5 }}>
          © Shivaram Dasari
        </div>
      </div>
    </aside>
  );
}

// Client Card
function ClientCard({ client, onView, onEdit, onDelete }) {
  const loans = client.loans || [];
  const weeklyLoans = client.weeklyLoans || [];
  const isOver = loans.some(l => (l.monthSlots || []).some(sl => isOverdue(sl))) ||
    weeklyLoans.some(l => (l.weekSlots || []).some(sl => isOverdue(sl, "weekly")));
  const totalRemaining =
    loans.reduce((s, l) => s + l.totalPayable - (l.totalCollected || 0), 0) +
    weeklyLoans.reduce((s, l) => s + l.totalWeeks * l.weeklyAmount - (l.totalCollected || 0), 0);

  const [waPopup, setWaPopup] = useState(null); // { en, te }
  const [waLang, setWaLang] = useState("en");

  function handleWaClick(e) {
    e.stopPropagation();
    const msgEn = "🔔 Payment Reminder\n\nDear " + client.name + ",\n\nYou have pending payments.\n💰 Total Remaining: Rs " + totalRemaining.toLocaleString("en-IN") + "\n\nKindly contact us to clear dues. Thank you! 🙏";
    const msgTe = "🔔 చెల్లింపు రిమైండర్\n\nప్రియమైన " + client.name + " గారికి,\n\nమీకు పెండింగ్ చెల్లింపులు ఉన్నాయి.\n💰 మొత్తం బాకీ: రూ " + totalRemaining.toLocaleString("en-IN") + "\n\nదయచేసి సంప్రదించండి. ధన్యవాదాలు! 🙏";
    setWaLang("en");
    setWaPopup({ en: msgEn, te: msgTe });
  }

  function sendWa() {
    const text = waLang === "te" ? waPopup.te : waPopup.en;
    window.open("https://wa.me/91" + client.phone?.replace(/\D/g, "") + "?text=" + encodeURIComponent(text), "_blank");
    setWaPopup(null);
  }

  return (
    <>
      {waPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={() => setWaPopup(null)}>
          <div style={{ background: "#1a1d2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "22px 20px", width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 10 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 24, textAlign: "center" }}>📱</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "white", textAlign: "center" }}>Send Reminder to {client.name}?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={() => setWaLang("en")} style={{ padding: "5px 14px", borderRadius: 8, border: "1px solid " + (waLang === "en" ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)"), background: waLang === "en" ? "rgba(99,102,241,0.2)" : "transparent", color: waLang === "en" ? "#818cf8" : "#475569", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🇬🇧 English</button>
              <button onClick={() => setWaLang("te")} style={{ padding: "5px 14px", borderRadius: 8, border: "1px solid " + (waLang === "te" ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)"), background: waLang === "te" ? "rgba(99,102,241,0.2)" : "transparent", color: waLang === "te" ? "#818cf8" : "#475569", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🇮🇳 Telugu</button>
            </div>
            <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#94a3b8", whiteSpace: "pre-wrap", maxHeight: 130, overflowY: "auto", lineHeight: 1.6 }}>
              {waLang === "te" ? waPopup.te : waPopup.en}
            </div>
            <button onClick={sendWa} style={{ padding: "13px", borderRadius: 10, border: "1px solid rgba(37,211,102,0.3)", background: "rgba(37,211,102,0.12)", color: "#25d366", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>📲 Send via WhatsApp</button>
            <button onClick={() => setWaPopup(null)} style={{ padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ ...s.card, ...(isOver ? s.cardOverdue : {}) }} onClick={onView}>
        <div style={s.cardLeft}>
          {client.photoURL
            ? <img src={client.photoURL} alt={client.name} style={s.cardPhoto} />
            : <div style={s.cardAvatar}>{client.name?.[0]}</div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.cardName}>
              {client.name}
              {isOver && <span style={s.overduePill}>OVERDUE</span>}
            </div>
            <div style={s.cardPhone}>{client.phone}{client.altPhone && <span style={{ color: "#334155", marginLeft: 8 }}>/ {client.altPhone}</span>}</div>
            {client.address && <div style={s.cardAddress}>{client.address}</div>}
            <div style={s.cardStats}>
              {loans.length > 0 && (
                <span style={s.pill}>{loans.length} loan{loans.length > 1 ? "s" : ""}</span>
              )}
              {weeklyLoans.length > 0 && (
                <span style={{ ...s.pill, background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                  {weeklyLoans.length} weekly
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={s.cardRight} onClick={e => e.stopPropagation()}>
          <div style={s.cardAmount}>{formatCurrency(totalRemaining)}</div>
          <div style={s.cardAmountLabel}>remaining</div>
          <div style={s.cardBtns}>
            <button style={s.waBtn} onClick={handleWaClick}>WA</button>
            <button style={s.editCardBtn} onClick={e => { e.stopPropagation(); onEdit(); }}>Edit</button>
            <button style={s.delCardBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>Del</button>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({ icon, label, value, color, alert, clickable, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        ...s.stat,
        ...(alert ? { border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" } : {}),
        ...(clickable ? { cursor: "pointer" } : {}),
      }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginTop: 3 }}>{label}</div>
      {clickable && <div style={{ fontSize: 10, color: "#ef4444", marginTop: 4 }}>tap to view</div>}
    </div>
  );
}

const s = {
  sidebar: { width: 220, background: "#0a0d14", borderRight: "1px solid rgba(255,255,255,0.06)", padding: "24px 16px", display: "flex", flexDirection: "column", flexShrink: 0 },
  sidebarTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 32 },
  logo: { width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: "white" },
  logoText: { fontSize: 15, fontWeight: 800, color: "white" },
  logoSub: { fontSize: 10, color: "#475569", letterSpacing: 1 },
  sidebarBottom: { borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 16 },
  userEmail: { fontSize: 11, color: "#475569", marginBottom: 8, wordBreak: "break-all" },
  logoutBtn: { width: "100%", padding: "9px", borderRadius: 8, border: "none", background: "rgba(239,68,68,0.1)", color: "#f87171", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  pageTitle: { margin: 0, fontWeight: 800, color: "white", letterSpacing: -0.5 },
  pageSub: { margin: "4px 0 0", fontSize: 12, color: "#475569" },
  addBtn: { padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14, flexShrink: 0 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 10, marginBottom: 16 },
  stat: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px" },
  overduePanel: { background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 14, padding: "16px", marginBottom: 16 },
  overduePanelHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  overduePanelTitle: { fontSize: 14, fontWeight: 700, color: "#fca5a5" },
  overduePanelClose: { background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16, padding: "0 4px" },
  overdueRow: { display: "flex", alignItems: "flex-start", gap: 12, padding: "12px", background: "rgba(0,0,0,0.2)", borderRadius: 10, marginBottom: 8, cursor: "pointer", border: "1px solid rgba(239,68,68,0.15)" },
  overdueAvatar: { width: 36, height: 36, borderRadius: "50%", background: "rgba(239,68,68,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fca5a5", flexShrink: 0 },
  overdueClientName: { fontSize: 14, fontWeight: 700, color: "white", marginBottom: 2 },
  overdueDetail: { fontSize: 12, color: "#64748b", marginBottom: 6 },
  overdueMonths: { display: "flex", gap: 6, flexWrap: "wrap" },
  overdueMonthPill: { fontSize: 11, background: "rgba(239,68,68,0.15)", color: "#fca5a5", padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)" },
  overdueArrow: { color: "#ef4444", fontSize: 18, paddingTop: 6, flexShrink: 0 },
  controls: { display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" },
  search: { flex: 1, minWidth: 160, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "white", fontSize: 14, outline: "none" },
  filters: { display: "flex", gap: 6 },
  filterBtn: { padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12 },
  filterActive: { background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8" },
  empty: { textAlign: "center", padding: "50px 20px", color: "#334155", fontSize: 14 },
  card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "14px 16px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" },
  cardOverdue: { background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" },
  cardLeft: { display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0 },
  cardPhoto: { width: 46, height: 46, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  cardAvatar: { width: 46, height: 46, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "white", flexShrink: 0 },
  cardName: { fontSize: 15, fontWeight: 700, color: "white", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  overduePill: { fontSize: 9, background: "rgba(239,68,68,0.2)", color: "#fca5a5", padding: "2px 6px", borderRadius: 4, fontWeight: 700, letterSpacing: 1 },
  cardPhone: { fontSize: 12, color: "#475569", marginTop: 2 },
  cardAddress: { fontSize: 11, color: "#334155", marginTop: 2 },
  cardStats: { display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" },
  pill: { fontSize: 10, padding: "2px 8px", borderRadius: 12, background: "rgba(99,102,241,0.1)", color: "#818cf8" },
  cardRight: { textAlign: "right", flexShrink: 0, marginLeft: 12 },
  cardAmount: { fontSize: 18, fontWeight: 800, color: "white" },
  cardAmountLabel: { fontSize: 10, color: "#475569", letterSpacing: 1, textTransform: "uppercase" },
  cardBtns: { display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 },
  waBtn: { padding: "5px 9px", borderRadius: 7, border: "none", background: "rgba(37,211,102,0.15)", color: "#25d366", cursor: "pointer", fontSize: 11, fontWeight: 700 },
  editCardBtn: { padding: "5px 9px", borderRadius: 7, border: "none", background: "rgba(99,102,241,0.15)", color: "#818cf8", cursor: "pointer", fontSize: 11, fontWeight: 700 },
  delCardBtn: { padding: "5px 9px", borderRadius: 7, border: "none", background: "rgba(239,68,68,0.1)", color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 700 },
};
