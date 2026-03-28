import { useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";

export default function ClientModal({ onClose, editClient = null }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: editClient?.name || "",
    phone: editClient?.phone || "",
    altPhone: editClient?.altPhone || "",
    address: editClient?.address || "",
    notes: editClient?.notes || "",
  });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(editClient?.photoURL || null);
  const [docFiles, setDocFiles] = useState([null, null, null]);
  const [docNames, setDocNames] = useState(editClient?.documents?.map(d => d?.name) || ["", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(f, v) { setForm(p => ({ ...p, [f]: v })); }

  // Phone: only allow digits, max 10
  function handlePhone(field, val) {
    const digits = val.replace(/\D/g, "").slice(0, 10);
    set(field, digits);
  }

  function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Photo must be under 5MB"); return; }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleDoc(idx, e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("Document " + (idx + 1) + " must be under 10MB"); return; }
    const newFiles = [...docFiles];
    newFiles[idx] = file;
    setDocFiles(newFiles);
    const newNames = [...docNames];
    newNames[idx] = file.name;
    setDocNames(newNames);
  }

  async function handleSave() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!form.phone) { setError("Phone number is required."); return; }
    if (form.phone.length !== 10) { setError("Phone number must be exactly 10 digits."); return; }
    if (form.altPhone && form.altPhone.length !== 10) { setError("Alternative number must be exactly 10 digits."); return; }
    setLoading(true);
    setError("");
    try {
      const photoURL = editClient?.photoURL || null;
      const documents = editClient?.documents || [null, null, null];
      const data = {
        ...form,
        photoURL,
        documents,
        adminId: user.uid,
        updatedAt: serverTimestamp(),
        loans: editClient?.loans || [],
        weeklyLoans: editClient?.weeklyLoans || [],
      };
      if (editClient) {
        await updateDoc(doc(db, "clients", editClient.id), data);
      } else {
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, "clients"), data);
      }
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div style={s.overlay} onClick={() => onClose(false)}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <h2 style={s.title}>{editClient ? "Edit Client" : "Add New Client"}</h2>
          <button style={s.close} onClick={() => onClose(false)}>x</button>
        </div>
        <div style={s.body}>
          {/* Photo */}
          <div style={s.photoSection}>
            <div style={s.photoCircle}>
              {photoPreview ? <img src={photoPreview} alt="profile" style={s.photoImg} /> : <span style={{ fontSize: 36 }}>?</span>}
            </div>
            <div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>Profile Photo</div>
              <label style={s.uploadBtn}>
                Upload Photo
                <input type="file" accept="image/*" onChange={handlePhoto} style={{ display: "none" }} />
              </label>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Preview only — storage coming soon</div>
            </div>
          </div>

          {/* Name */}
          <Field label="Full Name *" value={form.name} onChange={v => set("name", v)} placeholder="Ramesh Kumar" />

          {/* Phone row */}
          <div style={s.grid2}>
            <PhoneField
              label="Phone Number *"
              value={form.phone}
              onChange={v => handlePhone("phone", v)}
              placeholder="10-digit mobile number"
            />
            <PhoneField
              label="Alternative Number"
              value={form.altPhone}
              onChange={v => handlePhone("altPhone", v)}
              placeholder="Optional"
            />
          </div>

          <Field label="Address" value={form.address} onChange={v => set("address", v)} placeholder="Door no, Street, City, Pincode" multiline />
          <Field label="Notes" value={form.notes} onChange={v => set("notes", v)} placeholder="Any additional info..." />

          {/* Documents */}
          <div style={{ marginBottom: 14 }}>
            <label style={s.label}>Documents (Aadhaar, PAN, Agreement etc.)</label>
            <div style={s.docGrid}>
              {[0, 1, 2].map(i => (
                <label key={i} style={s.docBox}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{docNames[i] ? "D" : "+"}</div>
                  <div style={{ fontSize: 11, color: "#64748b", textAlign: "center", wordBreak: "break-all" }}>
                    {docNames[i] || editClient?.documents?.[i]?.name || "Document " + (i + 1)}
                  </div>
                  {editClient?.documents?.[i]?.url && !docFiles[i] && (
                    <a href={editClient.documents[i].url} target="_blank" rel="noreferrer"
                      style={{ fontSize: 10, color: "#818cf8", marginTop: 4 }}
                      onClick={e => e.stopPropagation()}>View</a>
                  )}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => handleDoc(i, e)} style={{ display: "none" }} />
                </label>
              ))}
            </div>
          </div>

          {error && <div style={s.error}>{error}</div>}
          <div style={s.footer}>
            <button style={s.cancelBtn} onClick={() => onClose(false)}>Cancel</button>
            <button style={s.saveBtn} onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : editClient ? "Update Client" : "Add Client"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={s.label}>{label}</label>
      {multiline
        ? <textarea style={{ ...s.input, height: 70, resize: "vertical" }} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        : <input style={s.input} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      }
    </div>
  );
}

function PhoneField({ label, value, onChange, placeholder }) {
  const isValid = value.length === 0 || value.length === 10;
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={s.label}>{label}</label>
      <input
        style={{ ...s.input, borderColor: !isValid ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)" }}
        type="tel"
        inputMode="numeric"
        maxLength={10}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
      {!isValid && <div style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>{value.length}/10 digits</div>}
      {value.length === 10 && <div style={{ fontSize: 11, color: "#10b981", marginTop: 4 }}>Valid</div>}
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#1e2130", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: 18, fontWeight: 800, color: "white" },
  close: { background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" },
  body: { padding: "18px 22px", overflowY: "auto" },
  photoSection: { display: "flex", alignItems: "center", gap: 16, marginBottom: 20, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" },
  photoCircle: { width: 72, height: 72, borderRadius: "50%", background: "rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  photoImg: { width: "100%", height: "100%", objectFit: "cover" },
  uploadBtn: { padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.1)", color: "#818cf8", fontSize: 13, cursor: "pointer", display: "inline-block" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "white", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" },
  docGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 },
  docBox: { border: "1px dashed rgba(255,255,255,0.15)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", background: "rgba(255,255,255,0.02)", minHeight: 80 },
  error: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#fca5a5", marginBottom: 12 },
  footer: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 },
  cancelBtn: { padding: "10px 20px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 },
};
