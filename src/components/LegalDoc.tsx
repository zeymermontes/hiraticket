"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";

// Shared shell for public legal pages (/privacy, /terms). Mirrors the landing's look and its
// ES/EN language handling (localStorage "ht_lang") so toggling language on the landing carries over.
type Lang = "es" | "en";

export function LegalDoc({
  title,
  children,
}: {
  title: { es: string; en: string };
  children: (t: (es: string, en: string) => string) => React.ReactNode;
}) {
  const [lang, setLang] = useState<Lang>("es");
  useEffect(() => {
    try {
      const l = JSON.parse(localStorage.getItem("ht_lang") || '"es"');
      setLang(l === "en" ? "en" : "es");
      const th = JSON.parse(localStorage.getItem("ht_theme") || '"light"');
      document.documentElement.dataset.theme = th === "dark" ? "dark" : "light";
    } catch {
      /* defaults */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("ht_lang", JSON.stringify(lang));
    } catch {
      /* ignore */
    }
  }, [lang]);
  const t = (es: string, en: string) => (lang === "es" ? es : en);

  return (
    <div className="landing">
      <style>{`
        .legal { max-width: 760px; margin: 0 auto; padding: 48px 20px 80px; }
        .legal h1 { font-size: 32px; font-weight: 800; letter-spacing: -.02em; }
        .legal .updated { color: var(--text-faint); font-size: 13px; margin-top: 6px; }
        .legal h2 { font-size: 20px; font-weight: 700; margin-top: 36px; }
        .legal p, .legal li { color: var(--text-muted); font-size: 15px; line-height: 1.65; margin-top: 12px; }
        .legal ul { padding-left: 22px; }
        .legal li { margin-top: 6px; }
        .legal a { color: inherit; }
      `}</style>

      <nav className="lnav">
        <div className="lwrap lnav-inner">
          <Link className="brand" href="/">
            <span className="mark">H</span>Hiraticket
          </Link>
          <span style={{ flex: 1 }} />
          <div className="seg" style={{ marginRight: 12 }}>
            <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </div>
          <Link className="btn btn-ghost" href="/">
            {t("Volver al inicio", "Back to home")}
          </Link>
        </div>
      </nav>

      <main className="legal">
        <h1>{t(title.es, title.en)}</h1>
        <div className="updated">
          {t("Última actualización: 14 de julio de 2026", "Last updated: July 14, 2026")}
        </div>
        {children(t)}
      </main>

      <footer className="footer">
        <div className="lwrap">
          <div className="footer-bottom">
            <span>© 2026 Hiraticket</span>
            <span className="sep">·</span>
            <span>{t("Hecho en México 🇲🇽", "Made in Mexico 🇲🇽")}</span>
            <span style={{ flex: 1 }} />
            <Link href="/privacy" style={{ color: "inherit" }}>
              {t("Privacidad", "Privacy")}
            </Link>
            <span className="sep">·</span>
            <Link href="/terms" style={{ color: "inherit" }}>
              {t("Términos", "Terms")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
