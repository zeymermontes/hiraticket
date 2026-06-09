/* ============================================================
   HIRATICKET — Login / agent auth
   ============================================================ */
function LoginView() {
  const { state, dispatch } = useApp(); const t = useT(); const lang = state.lang;
  const [email, setEmail] = useState('mariana@hirata.mx');
  const [pwd, setPwd] = useState('hirata2026');
  const [remember, setRemember] = useState(true);
  const submit = (e) => { e && e.preventDefault(); dispatch({ type:'signIn' }); };

  return (
    <div style={{ height:'100%', display:'grid', gridTemplateColumns:'1.05fr 1fr' }} className="login-grid">
      {/* brand panel */}
      <div style={{ background:'var(--ink)', color:'#fff', padding:'48px 56px', display:'flex', flexDirection:'column', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', width:520, height:520, borderRadius:'50%', background:'radial-gradient(circle, rgba(245,197,24,.16), transparent 70%)', right:-160, top:-120 }} />
        <div className="row gap-3" style={{ position:'relative' }}>
          <div className="rail-logo" style={{ margin:0 }}>H</div>
          <div><div style={{ fontWeight:900, fontSize:20, letterSpacing:'-.02em' }} className="display">Hiraticket</div><div style={{ fontSize:12, color:'rgba(255,255,255,.6)' }}>by Hirata · Impresión Digital</div></div>
        </div>
        <div style={{ marginTop:'auto', position:'relative' }}>
          <div style={{ fontFamily:"'Archivo Expanded','Archivo',sans-serif", fontWeight:900, fontSize:40, lineHeight:1.04, letterSpacing:'-.02em', textTransform:'uppercase' }}>
            {lang==='es' ? <>Chats y<br/>pedidos,<br/><span style={{ color:'var(--brand)' }}>en un lugar.</span></> : <>Chats &<br/>orders,<br/><span style={{ color:'var(--brand)' }}>in one place.</span></>}
          </div>
          <p style={{ color:'rgba(255,255,255,.66)', maxWidth:380, marginTop:18, fontSize:14.5 }}>{lang==='es'?'Atiende WhatsApp, rutea pedidos entre áreas y mantén todo el historial del cliente — sin perder un solo mensaje.':'Handle WhatsApp, route orders across areas, and keep every customer\'s history — without dropping a single message.'}</p>
          <div className="row gap-3" style={{ marginTop:28 }}>
            {[['chat',lang==='es'?'Bandeja unificada':'Unified inbox'],['orders',lang==='es'?'Pedidos por área':'Orders by area'],['whatsapp',lang==='es'?'WhatsApp en vivo':'Live WhatsApp']].map(([ic,lb])=>(
              <div key={lb} className="row gap-2" style={{ fontSize:12.5, color:'rgba(255,255,255,.8)' }}><span style={{ width:28, height:28, borderRadius:8, background:'rgba(255,255,255,.08)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--brand)' }}><Icon name={ic} size={15}/></span>{lb}</div>
            ))}
          </div>
        </div>
      </div>

      {/* form */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:32, position:'relative' }}>
        <div style={{ position:'absolute', top:20, right:24 }} className="row gap-2">
          <div className="seg" style={{ height:32 }}><button className={lang==='es'?'on':''} onClick={()=>dispatch({ type:'setLang', lang:'es' })}>ES</button><button className={lang==='en'?'on':''} onClick={()=>dispatch({ type:'setLang', lang:'en' })}>EN</button></div>
          <button className="iconbtn" onClick={()=>dispatch({ type:'setTheme', theme: state.theme==='dark'?'light':'dark' })}><Icon name={state.theme==='dark'?'sun':'moon'}/></button>
        </div>
        <form onSubmit={submit} style={{ width:'100%', maxWidth:360, display:'flex', flexDirection:'column', gap:16 }}>
          <div><h1 style={{ fontSize:26 }}>{lang==='es'?'Bienvenido de vuelta':'Welcome back'}</h1><p className="muted" style={{ marginTop:4 }}>{t('login_sub')}</p></div>
          <div><label className="lbl">{t('email')}</label><div className="field field-lg" style={{ height:44 }}><Icon name="mail"/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></div></div>
          <div><label className="lbl">{t('password')}</label><div className="field field-lg" style={{ height:44 }}><Icon name="lock"/><input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} autoComplete="current-password"/></div></div>
          <div className="row" style={{ justifyContent:'space-between' }}>
            <button type="button" className="row gap-2" style={{ background:'none', border:'none', color:'var(--text)', fontSize:13, fontWeight:500 }} onClick={()=>setRemember(r=>!r)}><span className={'switch'+(remember?' on':'')}/>{t('remember')}</button>
            <a href="#" className="t-sm" style={{ color:'var(--brand-700)', fontWeight:600 }} onClick={e=>e.preventDefault()}>{t('forgot')}</a>
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block"><Icon name="arrowr" size={17}/>{t('sign_in')}</button>
          <div className="t-xs muted center" style={{ marginTop:4 }}>{lang==='es'?'Demo — cualquier credencial entra.':'Demo — any credentials work.'}</div>
        </form>
      </div>
    </div>
  );
}
Object.assign(window, { LoginView });
