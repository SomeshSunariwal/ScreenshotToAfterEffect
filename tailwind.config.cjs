module.exports = {
  content: ["./panel/index.html"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        surface: "var(--surface)",
        raised: "var(--raised)",
        well: "var(--well)",
        line: "var(--line)",
        ink: "var(--text)",
        muted: "var(--muted)"
      }
    }
  }
};
