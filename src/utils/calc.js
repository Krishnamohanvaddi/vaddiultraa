export function calcMonthlyInterest(principal, ratePerHundred) {
  return Math.round((principal * ratePerHundred) / 100);
}

export function calcTotalPayable(principal, ratePerHundred, months) {
  return calcMonthlyInterest(principal, ratePerHundred) * months;
}

// billingDay = day of month loan was started (stored on each slot)
// Used by isOverdue to know when that month's payment is past due
export function generateMonthSlots(startDate, durationMonths, existingSlots = []) {
  const slots = [];
  const start = new Date(startDate);
  const billingDay = start.getDate();
  for (let i = 0; i < durationMonths; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const existing = existingSlots.find(s => s.id === id);
    slots.push(existing
      ? { ...existing, billingDay }
      : { id, label: d.toLocaleString("default", { month: "long", year: "numeric" }), paid: false, paidDate: null, billingDay }
    );
  }
  return slots;
}

// Week due date = startDate + (i+1)*7 days
export function generateWeekSlots(startDate, totalWeeks, existingSlots = []) {
  const slots = [];
  const start = new Date(startDate);
  for (let i = 0; i < totalWeeks; i++) {
    const due = new Date(start);
    due.setDate(due.getDate() + (i + 1) * 7);
    const id = `week-${i + 1}`;
    const existing = existingSlots.find(s => s.id === id);
    slots.push(existing || {
      id,
      label: `Week ${i + 1} — due ${due.toLocaleDateString("en-IN")}`,
      dueDate: due.toISOString(),
      paid: false,
      paidDate: null,
    });
  }
  return slots;
}

// Monthly: overdue when today is past billing day of the slot's own month
// e.g. loan started 3rd → slot "2026-03" overdue after 3rd March
export function isOverdue(slot, type = "monthly") {
  if (slot.paid) return false;
  if (type === "weekly") {
    if (!slot.dueDate) return false;
    return new Date() > new Date(slot.dueDate);
  }
  const [year, month] = slot.id.split("-").map(Number);
  const billingDay = slot.billingDay || 1;
  // Overdue starts the day AFTER billing day of that same month
  const dueDate = new Date(year, month - 1, billingDay + 1);
  return new Date() > dueDate;
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function formatDate(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-IN");
}

// Helper: how many days since a given date (positive = past)
export function daysSince(dateStr) {
  if (!dateStr) return 0;
  const diff = new Date() - new Date(dateStr);
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
