/**
 * FitSync Date Utilities - Standardized for IST (Asia/Kolkata)
 */

// Format options for YYYY-MM-DD in IST
const IST_DATE_OPTIONS = {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

/**
 * Returns today's date string in YYYY-MM-DD format based on IST.
 */
exports.getTodayString = () => {
  // en-CA locale natively returns YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

/**
 * Returns a date string in YYYY-MM-DD format for a given relative offset in days from today (IST).
 * @param {number} offset - Number of days to offset (e.g., -1 for yesterday)
 */
exports.getISTDateString = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

/**
 * Returns the day of the week (0-6) for the current moment in IST.
 */
exports.getISTDay = () => {
  const istString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  return new Date(istString).getDay();
};

/**
 * Returns the current hour (0-23) in IST.
 */
exports.getISTHour = () => {
  const istString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  return new Date(istString).getHours();
};

/**
 * Parses an ISO date string or local date string and returns the date part.
 */
exports.formatDate = (input) => {
  if (!input) return exports.getTodayString();
  return new Date(input).toISOString().split("T")[0];
};
