"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";

type Lang = "es" | "en";
const tt = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

interface Plan {
  id: string; name: { es: string; en: string }; tagline: { es: string; en: string };
  priceMonthly: number; popular: boolean; limits: { agents: number; numbers: number };
  features: { es: string; en: string }[];
}
const PLANS: Plan[] = [
  {
    id: "inicio", name: { es: "Inicio", en: "Starter" }, tagline: { es: "Para un negocio que se está organizando.", en: "For a single shop getting organized." },
    priceMonthly: 499, popular: false, limits: { agents: 3, numbers: 1 },
    features: [
      { es: "Bandeja de WhatsApp unificada", en: "Unified WhatsApp inbox" },
      { es: "Pedidos y tablero Kanban", en: "Orders & Kanban board" },
      { es: "Plantillas de mensajes", en: "Message templates" },
      { es: "Soporte por correo", en: "Email support" },
    ],
  },
  {
    id: "pro", name: { es: "Pro", en: "Pro" }, tagline: { es: "Para equipos que rutean el trabajo.", en: "For growing teams that route work." },
    priceMonthly: 999, popular: true, limits: { agents: 10, numbers: 2 },
    features: [
      { es: "Todo lo de Inicio", en: "Everything in Starter" },
      { es: "Áreas y ruteo inteligente", en: "Areas & smart routing" },
      { es: "Roles y permisos", en: "Roles & permissions" },
      { es: "Métricas y reportes", en: "Metrics & reports" },
      { es: "Soporte prioritario", en: "Priority support" },
    ],
  },
  {
    id: "negocio", name: { es: "Negocio", en: "Business" }, tagline: { es: "Para operaciones multi-sucursal a escala.", en: "For multi-branch operations at scale." },
    priceMonthly: 1999, popular: false, limits: { agents: -1, numbers: 5 },
    features: [
      { es: "Todo lo de Pro", en: "Everything in Pro" },
      { es: "Agentes ilimitados", en: "Unlimited agents" },
      { es: "API y webhooks", en: "API & webhooks" },
      { es: "Bitácora de auditoría", en: "Audit log" },
      { es: "Onboarding dedicado y SLA", en: "Dedicated onboarding & SLA" },
    ],
  },
];

const FAQ = [
  { q: { es: "¿WhatsApp es oficial?", en: "Is the WhatsApp connection official?" }, a: { es: "Usamos una conexión tipo WhatsApp Web: vinculas tu propio número escaneando un QR. Es no oficial, por eso mostramos siempre el estado de conexión y te avisamos si se cae.", en: "We use a WhatsApp Web-style connection: you link your own number by scanning a QR. It is unofficial, so we always show the connection status and alert you if it drops." } },
  { q: { es: "¿Puedo conectar varios números?", en: "Can I connect multiple numbers?" }, a: { es: "Sí. Desde el plan Pro puedes conectar 2 números y en Negocio hasta 5, cada uno con su propia bandeja.", en: "Yes. From the Pro plan you can connect 2 numbers and up to 5 on Business, each with its own inbox." } },
  { q: { es: "¿Hay prueba gratis?", en: "Is there a free trial?" }, a: { es: "Todos los planes incluyen 14 días gratis, sin tarjeta. Al terminar eliges el plan que mejor te quede.", en: "Every plan includes a 14-day free trial, no card required. When it ends you pick the plan that fits best." } },
  { q: { es: "¿Puedo cambiar o cancelar mi plan?", en: "Can I change or cancel my plan?" }, a: { es: "Cuando quieras, desde Ajustes. Los cambios se aplican en tu siguiente factura sin penalización.", en: "Anytime, from Settings. Changes apply on your next invoice with no penalty." } },
  { q: { es: "¿Cómo funciona la facturación anual?", en: "How does annual billing work?" }, a: { es: "Pagas 10 meses y obtienes 12: dos meses gratis al elegir facturación anual.", en: "You pay for 10 months and get 12: two months free when you choose annual billing." } },
  { q: { es: "¿Mis datos están seguros?", en: "Is my data safe?" }, a: { es: "Tus conversaciones y pedidos viven en tu cuenta con roles y permisos. Cada cambio queda en la bitácora de auditoría.", en: "Your conversations and orders live in your account with roles and permissions. Every change is kept in the audit log." } },
];

function money(n: number) { return "$" + Math.round(n).toLocaleString("es-MX"); }

function Window({ src, addr, alt }: { src: string; addr?: string; alt: string }) {
  const [err, setErr] = useState(false);
  return (
    <div className="window">
      <div className="window-bar"><span className="dot" style={{ background: "#ff5f57" }} /><span className="dot" style={{ background: "#febc2e" }} /><span className="dot" style={{ background: "#28c840" }} />{addr && <span className="addr">{addr}</span>}</div>
      {err ? <div className="shot-ph">{alt}</div> : <img src={src} alt={alt} onError={() => setErr(true)} />}
    </div>
  );
}

export function Landing() {
  const [lang, setLang] = useState<Lang>("es");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    try {
      const l = JSON.parse(localStorage.getItem("ht_lang") || '"es"');
      const t = JSON.parse(localStorage.getItem("ht_theme") || '"light"');
      setLang(l === "en" ? "en" : "es");
      setTheme(t === "dark" ? "dark" : "light");
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("ht_theme", JSON.stringify(theme)); } catch { /* */ } }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; try { localStorage.setItem("ht_lang", JSON.stringify(lang)); } catch { /* */ } }, [lang]);

  const t = (es: string, en: string) => tt(lang, es, en);

  return (
    <div className="landing">
      {/* announce */}
      <div className="announce">
        <span>{t("🎉 14 días gratis · sin tarjeta de crédito", "🎉 14-day free trial · no credit card")}</span>
        <span className="sep">·</span>
        <span>{t("Conecta tu WhatsApp en 2 minutos", "Connect your WhatsApp in 2 minutes")}</span>
      </div>

      {/* nav */}
      <nav className="lnav"><div className="lwrap lnav-inner">
        <Link className="brand" href="/"><span className="mark">H</span>Hiraticket</Link>
        <div className="lnav-links">
          <a href="#features">{t("Producto", "Product")}</a>
          <a href="#pricing">{t("Precios", "Pricing")}</a>
          <a href="#faq">FAQ</a>
        </div>
        <span style={{ flex: 1 }} />
        <div className="seg" style={{ height: 34 }}>
          <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
          <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
        </div>
        <button className="iconbtn" aria-label="theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><Icon name={theme === "dark" ? "sun" : "moon"} size={19} /></button>
        <Link className="btn btn-ghost" href="/login">{t("Iniciar sesión", "Sign in")}</Link>
        <Link className="btn btn-primary" href="/login">{t("Prueba gratis", "Start free")}</Link>
      </div></nav>

      {/* hero */}
      <section className="hero"><div className="lwrap hero-grid">
        <div>
          <span className="hero-badge"><Icon name="whatsapp" size={14} /><span>{t("WhatsApp + Pedidos", "WhatsApp + Orders")}</span></span>
          <h1 dangerouslySetInnerHTML={{ __html: t('TODO TU NEGOCIO POR <span class="y">WHATSAPP</span>', 'RUN YOUR SHOP ON <span class="y">WHATSAPP</span>') }} />
          <p className="hero-sub">{t("Atiende cada chat de WhatsApp, rutea pedidos entre áreas y guarda todo el historial del cliente. La bandeja y el back-office de tu negocio, juntos.", "Handle every WhatsApp chat, route orders across areas, and keep every customer's history. Your inbox and back-office, together.")}</p>
          <div className="hero-cta">
            <Link className="btn btn-primary btn-lg" href="/login">{t("Empieza gratis", "Start for free")}</Link>
            <Link className="btn btn-lg" href="/login" style={{ background: "rgba(255,255,255,.1)", color: "#fff" }}>{t("Ver demo en vivo", "See live demo")} →</Link>
          </div>
          <div className="hero-trust">
            <span className="it"><Icon name="check" size={15} /><span>{t("Sin tarjeta", "No credit card")}</span></span>
            <span className="it"><Icon name="check" size={15} /><span>{t("Conexión en 2 min", "2-min setup")}</span></span>
            <span className="it"><Icon name="check" size={15} /><span>{t("Cancela cuando quieras", "Cancel anytime")}</span></span>
          </div>
        </div>
        <Window src="/screenshots/chat.png" addr="app.hiraticket.com" alt={t("captura del producto", "product screenshot")} />
      </div></section>

      {/* logos */}
      <section className="logos"><div className="lwrap">
        <div style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 13, fontWeight: 600, marginBottom: 20 }}>{t("Negocios de todo México ya venden por WhatsApp con Hiraticket", "Businesses across Mexico already sell on WhatsApp with Hiraticket")}</div>
        <div className="logos-row">
          {["Hirata", "Boutique Lunaria", "TecnoCelular", "IronFit", "La Espiga"].map((l) => <span className="lg" key={l}>{l}</span>)}
        </div>
      </div></section>

      {/* features */}
      <section className="sec" id="features"><div className="lwrap">
        <div className="sec-head">
          <div className="sec-eyebrow">{t("Todo en un lugar", "All in one place")}</div>
          <h2>{t("Deja de saltar entre apps", "Stop jumping between apps")}</h2>
          <p>{t("Chats, pedidos y equipo en una sola pantalla pensada para negocios que venden por WhatsApp.", "Chats, orders and team on a single screen built for businesses selling on WhatsApp.")}</p>
        </div>
        <div className="feat-grid">
          {[
            { ic: "chat", t: t("Bandeja unificada", "Unified inbox"), d: t("Todos los chats de WhatsApp de tu negocio en una bandeja, con filtros, asignación y estados.", "Every WhatsApp chat in one inbox, with filters, assignment and statuses.") },
            { ic: "orders", t: t("Pedidos vinculados", "Linked orders"), d: t("Crea pedidos desde el chat y mira el cliente, sus compras y su historial lado a lado.", "Create orders from the chat and see the customer, their purchases and history side by side.") },
            { ic: "kanban", t: t("Tablero Kanban", "Kanban board"), d: t("Arrastra pedidos por etapas o por áreas: Ventas, Diseño, Producción y Envíos.", "Drag orders across stages or areas: Sales, Design, Production and Shipping.") },
            { ic: "swap", t: t("Áreas y ruteo", "Areas & routing"), d: t("Transfiere chats y pedidos entre agentes y áreas con bitácora completa de cada cambio.", "Transfer chats and orders between agents and areas with a full audit trail.") },
            { ic: "sparkles", t: t("Plantillas rápidas", "Quick templates"), d: t("Respuestas listas con variables como {{name}} y {{order_number}} que se llenan solas.", "Ready replies with variables like {{name}} and {{order_number}} that auto-fill.") },
            { ic: "bolt", t: t("En tiempo real", "Real-time"), d: t("Mensajes, transferencias y estados se actualizan al instante para todo el equipo.", "Messages, transfers and statuses update instantly for the whole team.") },
          ].map((f) => (
            <div className="feat" key={f.t}>
              <div className="feat-ic"><Icon name={f.ic} size={25} /></div>
              <h3>{f.t}</h3><p>{f.d}</p>
            </div>
          ))}
        </div>
      </div></section>

      {/* split */}
      <section className="sec bg-soft"><div className="lwrap split">
        <div>
          <div className="sec-eyebrow">{t("Cliente 360", "Customer 360")}</div>
          <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em", marginTop: 10, lineHeight: 1.1 }}>{t("Todo el contexto del cliente, sin buscar", "Full customer context, no searching")}</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 16, marginTop: 14, lineHeight: 1.55 }}>{t("Abre una conversación y ve sus pedidos, notas internas e historial completo. Atiende mejor, sin pedir el número de pedido tres veces.", "Open a conversation and see their orders, internal notes and full history. Serve better, without asking for the order number three times.")}</p>
          <div className="split-list">
            {[
              { ic: "orders", t: t("Pedidos e historial", "Orders & history"), d: t("Cada compra, estado y monto del cliente en una vista expandible.", "Every purchase, status and amount in an expandable view.") },
              { ic: "agents", t: t("Notas internas", "Internal notes"), d: t("Comparte contexto con tu equipo sin que lo vea el cliente.", "Share context with your team without the customer seeing it.") },
              { ic: "clock", t: t("Bitácora de cambios", "Change log"), d: t("Quién transfirió, quién cambió el estado y cuándo. Todo queda registrado.", "Who transferred, who changed the status and when. It is all recorded.") },
            ].map((s) => (
              <div className="split-item" key={s.t}><span className="ic"><Icon name={s.ic} size={15} /></span><div><h4>{s.t}</h4><p>{s.d}</p></div></div>
            ))}
          </div>
        </div>
        <Window src="/screenshots/cust360.png" alt={t("cliente 360", "customer 360")} />
      </div></section>

      {/* pricing */}
      <section className="sec" id="pricing"><div className="lwrap">
        <div className="sec-head">
          <div className="sec-eyebrow">{t("Precios", "Pricing")}</div>
          <h2>{t("Planes simples, en pesos", "Simple plans, in pesos")}</h2>
          <p>{t("Empieza con 14 días gratis. Cambia o cancela tu plan cuando quieras.", "Start with a 14-day free trial. Change or cancel anytime.")}</p>
        </div>
        <div style={{ textAlign: "center" }}>
          <div className="pricing-toggle">
            <span style={{ fontWeight: 600, color: annual ? "var(--text-muted)" : "var(--text)" }}>{t("Mensual", "Monthly")}</span>
            <button className={"switch" + (annual ? " on" : "")} onClick={() => setAnnual((a) => !a)} aria-label="billing" />
            <span style={{ fontWeight: 600, color: annual ? "var(--text)" : "var(--text-muted)" }}>{t("Anual", "Annual")}</span>
            <span className="pill pill-brand">{t("2 meses gratis", "2 months free")}</span>
          </div>
        </div>
        <div className="price-grid">
          {PLANS.map((p) => {
            const eff = annual ? Math.round(p.priceMonthly * 10 / 12) : p.priceMonthly;
            const lim = (p.limits.agents < 0 ? t("Agentes ilimitados", "Unlimited agents") : t("Hasta", "Up to") + " " + p.limits.agents + " " + t("agentes", "agents")) + " · " + p.limits.numbers + " " + t("números", "numbers");
            return (
              <div className={"price-card" + (p.popular ? " pop" : "")} key={p.id}>
                {p.popular && <span className="pill pill-brand" style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)" }}>★ {t("Más popular", "Most popular")}</span>}
                <div className="pname">{p.name[lang]}</div>
                <div className="ptag">{p.tagline[lang]}</div>
                <div className="price-amt"><span className="amt">{money(eff)}</span><span className="per">MXN {t("/mes", "/mo")}</span></div>
                <div className="price-billed">{annual ? `${t("facturado anual", "billed annually")} · ${money(p.priceMonthly * 10)} MXN/${t("año", "yr")}` : " "}</div>
                <div className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{lim}</div>
                <Link className={"btn btn-lg btn-block " + (p.popular ? "btn-primary" : "btn-outline")} href="/login">{t("Empezar gratis", "Start free")}</Link>
                <div className="price-feats">
                  {p.features.map((f) => <div className="price-feat" key={f.es}><span className="ck"><Icon name="check" size={13} /></span>{f[lang]}</div>)}
                </div>
              </div>
            );
          })}
        </div>
      </div></section>

      {/* quote */}
      <section className="sec bg-soft"><div className="lwrap quote">
        <div className="sec-eyebrow" style={{ textAlign: "center" }}>{t("Historias reales", "Real stories")}</div>
        <blockquote style={{ marginTop: 16 }}>{t("“Antes perdíamos pedidos en mensajes sin contestar. Con Hiraticket todo el equipo ve el mismo chat y nada se cae.”", "“We used to lose orders in unanswered messages. With Hiraticket the whole team sees the same chat and nothing slips.”")}</blockquote>
        <div className="by"><span style={{ width: 44, height: 44, borderRadius: "50%", background: "#C99A04", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>MO</span><div style={{ textAlign: "left" }}><div style={{ fontWeight: 700 }}>Mariana Ortiz</div><div className="muted" style={{ fontSize: 13 }}>{t("Hirata · Impresión Digital", "Hirata · Digital Printing")}</div></div></div>
      </div></section>

      {/* faq */}
      <section className="sec" id="faq"><div className="lwrap">
        <div className="sec-head"><div className="sec-eyebrow">FAQ</div><h2>{t("Preguntas frecuentes", "Frequently asked questions")}</h2></div>
        <div className="faq">
          {FAQ.map((f, i) => (
            <div className={"faq-item" + (openFaq === i ? " open" : "")} key={i}>
              <button className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>{f.q[lang]}<span className="chev"><Icon name="chevd" size={18} /></span></button>
              <div className="faq-a"><div className="faq-a-inner">{f.a[lang]}</div></div>
            </div>
          ))}
        </div>
      </div></section>

      {/* cta */}
      <section className="sec" style={{ paddingTop: 0 }}><div className="lwrap"><div className="cta-band">
        <h2>{t("Empieza hoy", "Start today")}</h2>
        <p>{t("Conecta tu WhatsApp y organiza tus pedidos en minutos. 14 días gratis.", "Connect your WhatsApp and organize your orders in minutes. 14 days free.")}</p>
        <Link className="btn btn-primary btn-lg" href="/login" style={{ position: "relative" }}>{t("Crear cuenta gratis", "Create a free account")} →</Link>
      </div></div></section>

      {/* footer */}
      <footer className="footer"><div className="lwrap">
        <div className="footer-grid">
          <div>
            <Link className="brand" href="/"><span className="mark">H</span>Hiraticket</Link>
            <p className="muted" style={{ fontSize: 14, marginTop: 12, maxWidth: 260 }}>{t("La bandeja de WhatsApp y los pedidos de tu negocio, en un solo lugar.", "Your business's WhatsApp inbox and orders, in one place.")}</p>
          </div>
          <div><h5>{t("Producto", "Product")}</h5><a href="#features">{t("Producto", "Product")}</a><a href="#pricing">{t("Precios", "Pricing")}</a></div>
          <div><h5>{t("Empresa", "Company")}</h5><a href="#faq">FAQ</a><Link href="/login">{t("Iniciar sesión", "Sign in")}</Link></div>
          <div><h5>{t("Legal", "Legal")}</h5><a href="#">{t("Privacidad", "Privacy")}</a><a href="#">{t("Términos", "Terms")}</a></div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Hiraticket</span><span className="sep">·</span><span>{t("Hecho en México 🇲🇽", "Made in Mexico 🇲🇽")}</span>
          <span style={{ flex: 1 }} />
          <span>{t("Integración no oficial vía WhatsApp Web.", "Unofficial integration via WhatsApp Web.")}</span>
        </div>
      </div></footer>
    </div>
  );
}
