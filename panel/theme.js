"use strict";

(() => {
  const toggle = document.getElementById("theme");
  const system = matchMedia("(prefers-color-scheme: dark)");
  const cep = window.__adobe_cep__;
  const themeKey = "screenshot2ae.theme";
  let preference;
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === "light" || saved === "dark") preference = saved;
  } catch (error) {}

  function hostTheme() {
    try {
      const skin = JSON.parse(cep.getHostEnvironment()).appSkinInfo;
      const { red, green, blue } = skin.panelBackgroundColor.color;
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue >= 135
        ? "light"
        : "dark";
    } catch (error) {
      return system.matches ? "dark" : "light";
    }
  }

  function applyTheme() {
    const theme = preference || hostTheme();
    document.documentElement.dataset.theme = theme;
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
    toggle.title =
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  }

  toggle.addEventListener("click", () => {
    preference =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(themeKey, preference);
    } catch (error) {}
    applyTheme();
  });
  system.addEventListener("change", applyTheme);
  if (cep)
    cep.addEventListener("com.adobe.csxs.events.ThemeColorChanged", applyTheme);
  applyTheme();
})();
