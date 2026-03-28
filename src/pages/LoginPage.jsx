import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      const msg = err.code === "auth/user-not-found" || err.code === "auth/wrong-password"
        ? "Invalid email or password."
        : err.code === "auth/too-many-requests"
        ? "Too many attempts. Please try again later."
        : "Login failed. Please check your credentials.";
      setError(msg);
    }
    setLoading(false);
  }

  return (
    <div style={s.bg}>
      <div style={s.card}>
        <div style={s.logo}>₹</div>
        <h1 style={s.title}>VADDIULTRAA</h1>
        <p style={s.sub}>Loan & Interest Management</p>
        <p style={s.inviteNote}>🔐 Access by invite only</p>
        <form onSubmit={handleSubmit} style={s.form}>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
          <label style={s.label}>Password</label>
          <input style={s.input} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <div style={s.error}>{error}</div>}
          <button style={s.btn} disabled={loading}>{loading ? "Signing in..." : "Sign In"}</button>
        </form>
        <p style={s.contact}>Don't have access? Contact your administrator.</p>
      </div>
    </div>
  );
}

const s = {
  bg: { minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif", padding: 16 },
  card: { background: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "40px 36px", width: "100%", maxWidth: 400, textAlign: "center", boxShadow: "0 25px 50px rgba(0,0,0,0.5)" },
  logo: { width: 64, height: 64, borderRadius: 20, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 900, color: "white", margin: "0 auto 16px" },
  title: { margin: 0, fontSize: 28, fontWeight: 800, color: "white", letterSpacing: -1 },
  sub: { margin: "6px 0 4px", color: "#94a3b8", fontSize: 13 },
  inviteNote: { fontSize: 12, color: "#6366f1", background: "rgba(99,102,241,0.1)", padding: "6px 12px", borderRadius: 20, display: "inline-block", marginBottom: 20 },
  form: { display: "flex", flexDirection: "column", gap: 8, textAlign: "left" },
  label: { fontSize: 12, fontWeight: 600, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase" },
  input: { padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "white", fontSize: 14, outline: "none", marginBottom: 8, width: "100%", boxSizing: "border-box" },
  btn: { marginTop: 8, padding: 14, borderRadius: 10, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  error: { background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#fca5a5" },
  contact: { marginTop: 20, fontSize: 12, color: "#475569" },
};
