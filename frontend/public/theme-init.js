// Apply the saved theme before the first paint (dark is the default), so reloads never flash light.
// A separate file, not an inline <script>, so the Content-Security-Policy can forbid inline scripts.
(function () {
  var t = "dark";
  try { t = localStorage.getItem("acc-theme") || "dark"; } catch (e) {}
  var dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
