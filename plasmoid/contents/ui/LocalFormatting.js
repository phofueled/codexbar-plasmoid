.pragma library
function money(value, code, locale, rate) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    var amount = Number(value);
    var currency = code || "USD";
    if (currency === "USD") return "CAD " + (amount * rate).toLocaleString(locale, "f", 2);
    return currency + " " + amount.toLocaleString(locale, "f", 2);
}
function tokens(value, locale) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
    var count = Number(value);
    return count >= 1000000 ? (count / 1000000).toLocaleString(locale, "f", 2) + "M" : Math.round(count).toLocaleString(locale, "f", 0);
}
