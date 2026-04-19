// app/dashboard/page.tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface Profile { id: string; full_name: string; rut: string; cargo: string; email: string }
interface Location { id: string; name: string; address: string; latitude: number; longitude: number; radius_meters: number }
interface Shift { id: string; check_in: string; check_out: string | null; check_in_within_radius: boolean; amount_earned: number | null }

const CARGO: Record<string, string> = { tens: 'TENS', enfermera: 'Enfermera/o', otro: 'Otro' }

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, d2r = Math.PI / 180
  const dLat = (lat2 - lat1) * d2r, dLng = (lng2 - lng1) * d2r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [activeShift, setActiveShift] = useState<Shift | null>(null)
  const [recentShifts, setRecentShifts] = useState<Shift[]>([])
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [distance, setDistance] = useState<number | null>(null)
  const [inRadius, setInRadius] = useState(false)
  const [marking, setMarking] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7))
  const [tab, setTab] = useState<'marcar' | 'historial'>('marcar')

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 4000) }

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!prof || prof.status !== 'approved') { router.push('/pendiente'); return }
    setProfile(prof)

    const { data: loc } = await supabase.from('locations').select('*').eq('active', true).limit(1).single()
    setLocation(loc)

    const { data: active } = await supabase
      .from('shifts').select('*').eq('user_id', user.id).is('check_out', null)
      .order('check_in', { ascending: false }).limit(1).single()
    setActiveShift(active || null)

    loadHistory(user.id)
    requestGeo(loc)
  }

  async function loadHistory(userId: string) {
    const { data } = await supabase.from('shifts').select('*')
      .eq('user_id', userId).not('check_out', 'is', null)
      .order('check_in', { ascending: false }).limit(20)
    setRecentShifts(data || [])
  }

  function requestGeo(loc: Location | null) {
    setGeoState('loading')
    if (!navigator.geolocation) { setGeoState('error'); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords
        setCoords({ lat, lng })
        if (loc) {
          const d = Math.round(haversine(lat, lng, loc.latitude, loc.longitude))
          setDistance(d)
          setInRadius(d <= loc.radius_meters)
        }
        setGeoState('ok')
      },
      () => setGeoState('error'),
      { enableHighAccuracy: true, timeout: 12000 }
    )
  }

  async function checkIn() {
    if (!profile || !location || !coords) return
    // Verificar que no haya turno abierto hoy
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const { data: existingToday } = await supabase.from('shifts')
      .select('id').eq('user_id', profile.id).gte('check_in', today.toISOString()).limit(1)
    if (existingToday && existingToday.length > 0) {
      flash('⚠ Ya registraste un turno hoy. Solo se permite un turno por día.')
      return
    }

    setMarking(true)
    const { data, error } = await supabase.from('shifts').insert({
      user_id: profile.id, location_id: location.id,
      check_in: new Date().toISOString(),
      check_in_lat: coords.lat, check_in_lng: coords.lng,
      check_in_within_radius: inRadius,
    }).select().single()
    if (!error) { setActiveShift(data); flash('✓ Entrada registrada correctamente') }
    else flash('Error al registrar entrada. Intenta nuevamente.')
    setMarking(false)
  }

  async function checkOut() {
    if (!activeShift || !coords) return
    setMarking(true)
    const { error } = await supabase.from('shifts').update({
      check_out: new Date().toISOString(),
      check_out_lat: coords.lat, check_out_lng: coords.lng,
      check_out_within_radius: inRadius,
    }).eq('id', activeShift.id)
    if (!error) {
      setActiveShift(null)
      flash('✓ Salida registrada. ¡Hasta pronto!')
      loadHistory(profile!.id)
    } else flash('Error al registrar salida.')
    setMarking(false)
  }

  async function downloadPDF() {
    const start = `${reportMonth}-01T00:00:00`
    const end = new Date(reportMonth + '-01')
    end.setMonth(end.getMonth() + 1)

    const { data } = await supabase.from('shifts').select('*')
      .eq('user_id', profile!.id).gte('check_in', start).lt('check_in', end.toISOString())
      .order('check_in')

    if (!data || data.length === 0) { flash('No hay turnos registrados ese mes'); return }

    const monthLabel = new Date(reportMonth + '-01').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
    const total = data.reduce((s, t) => s + (t.amount_earned || 0), 0)
    const fmtMoney = (n: number) => `$${n.toLocaleString('es-CL')}`
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const fmtTime = (d: string) => new Date(d).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })

    const rows = data.map(s => `
      <tr>
        <td>${fmtDate(s.check_in)}</td>
        <td>${fmtTime(s.check_in)}</td>
        <td>${s.check_out ? fmtTime(s.check_out) : '—'}</td>
        <td style="color:${s.check_in_within_radius ? '#065F46' : '#991B1B'}">
          ${s.check_in_within_radius ? '✓ Dentro del radio' : '⚠ Fuera del radio'}
        </td>
        <td style="text-align:right;font-weight:700;color:#065F46">
          ${s.amount_earned ? fmtMoney(s.amount_earned) : '—'}
        </td>
      </tr>`).join('')

    const html = `<!DOCTYPE html><html lang="es"><head>
      <meta charset="utf-8">
      <title>Honorarios ${monthLabel} — ${profile!.full_name}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;padding:40px;color:#111;font-size:12px}
        .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #0D2B5E}
        .company h1{color:#0D2B5E;font-size:18px;margin:0 0 4px}
        .company p{color:#555;font-size:11px;margin:2px 0}
        .professional{text-align:right;font-size:12px;color:#333}
        .professional strong{display:block;font-size:14px;color:#0D2B5E;margin-bottom:4px}
        h2{color:#1A4A9A;font-size:14px;margin:0 0 16px}
        table{width:100%;border-collapse:collapse}
        th{background:#0D2B5E;color:#fff;padding:8px 12px;text-align:left;font-size:11px}
        td{padding:8px 12px;border-bottom:1px solid #F0F0F0}
        tr:nth-child(even) td{background:#F8FAFF}
        .total-row td{background:#EFF6FF;font-weight:700;border-top:2px solid #1A4A9A}
        .footer{margin-top:28px;font-size:10px;color:#999;text-align:center;padding-top:12px;border-top:1px solid #eee}
      </style></head><body>
      <div class="top">
        <div class="company">
          <h1>Speech Psychology SpA</h1>
          <p>RUT: 78.254.509-4</p>
          <p>CESFAM Lo Barnechea · El Rodeo 13533</p>
        </div>
        <div class="professional">
          <strong>${profile!.full_name}</strong>
          RUT: ${profile!.rut}<br>
          Cargo: ${CARGO[profile!.cargo]}<br>
          ${profile!.email}
        </div>
      </div>
      <h2>Reporte de honorarios · ${monthLabel}</h2>
      <table>
        <thead><tr>
          <th>Fecha</th><th>Entrada</th><th>Salida</th><th>Ubicación GPS</th><th>Honorario</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="total-row">
          <td colspan="4">Total turnos: ${data.length}</td>
          <td style="text-align:right">${fmtMoney(total)}</td>
        </tr></tfoot>
      </table>
      <div class="footer">
        Documento generado el ${new Date().toLocaleDateString('es-CL')} · Sistema de Gestión Speech Psychology SpA
      </div>
    </body></html>`

    const w = window.open('', '_blank')!
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 600)
  }

  const geoColors = {
    idle: '#6B7280', loading: '#D97706',
    ok: inRadius ? '#065F46' : '#991B1B', error: '#991B1B'
  }
  const geoColor = geoColors[geoState]

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Buenos días' : now.getHours() < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div style={S.page}>
      {/* HEADER */}
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo.png" alt="Logo" style={{ width: 40, height: 45, objectFit: 'contain' }} />
          <div>
            <div style={S.headerGreeting}>{greeting},</div>
            <div style={S.headerName}>{profile?.full_name || '...'}</div>
            <div style={S.headerRole}>{profile ? CARGO[profile.cargo] : ''}</div>
          </div>
        </div>
        <button onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}
          style={S.logoutBtn}>Salir</button>
      </header>

      <div style={S.body}>
        {/* FEEDBACK BANNER */}
        {feedback && (
          <div style={{
            ...S.banner,
            background: feedback.startsWith('⚠') || feedback.startsWith('Error') ? '#FEF2F2' : '#D1FAE5',
            borderColor: feedback.startsWith('⚠') || feedback.startsWith('Error') ? '#FCA5A5' : '#6EE7B7',
            color: feedback.startsWith('⚠') || feedback.startsWith('Error') ? '#991B1B' : '#065F46',
          }}>{feedback}</div>
        )}

        {/* TABS */}
        <div style={S.tabs}>
          {(['marcar', 'historial'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              ...S.tab, background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? '#0D2B5E' : 'rgba(255,255,255,0.7)',
              fontWeight: tab === t ? 700 : 400,
              boxShadow: tab === t ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
            }}>
              {t === 'marcar' ? '🕐 Marcar turno' : '📋 Mis turnos'}
            </button>
          ))}
        </div>

        {/* ── TAB: MARCAR ── */}
        {tab === 'marcar' && (
          <>
            {/* Punto de trabajo */}
            <div style={S.card}>
              <div style={S.cardLabel}>Punto de trabajo asignado</div>
              <div style={S.locationName}>{location?.name || 'Cargando...'}</div>
              <div style={S.locationAddress}>{location?.address}</div>
            </div>

            {/* GPS */}
            <div style={{ ...S.card, borderLeft: `4px solid ${geoColor}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: geoColor, marginBottom: 4 }}>
                    {geoState === 'idle' && '📍 Esperando ubicación...'}
                    {geoState === 'loading' && '📍 Detectando ubicación...'}
                    {geoState === 'ok' && inRadius && '✓ Estás dentro del área de trabajo'}
                    {geoState === 'ok' && !inRadius && '✗ Estás fuera del área de trabajo'}
                    {geoState === 'error' && '✗ No se pudo obtener tu ubicación'}
                  </div>
                  {distance !== null && (
                    <div style={{ fontSize: 12, color: '#6B7280' }}>
                      Distancia al CESFAM: {distance}m
                      {' '}(radio permitido: {location?.radius_meters}m)
                    </div>
                  )}
                  {geoState === 'error' && (
                    <div style={{ fontSize: 12, color: '#991B1B', marginTop: 4 }}>
                      Activa el GPS en tu dispositivo y vuelve a intentar.
                    </div>
                  )}
                </div>
                <button onClick={() => requestGeo(location)} style={S.refreshBtn} title="Actualizar ubicación">
                  ↺
                </button>
              </div>
            </div>

            {/* Turno activo */}
            {activeShift && (
              <div style={S.activeShiftCard}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#065F46', marginBottom: 4 }}>
                  🟢 Turno en curso
                </div>
                <div style={{ fontSize: 13, color: '#065F46' }}>
                  Entrada registrada: {new Date(activeShift.check_in).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  {new Date(activeShift.check_in).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </div>
              </div>
            )}

            {/* BOTÓN PRINCIPAL */}
            {!activeShift ? (
              <button onClick={checkIn} disabled={marking || geoState !== 'ok' || !inRadius} style={{
                ...S.mainBtn, background: 'linear-gradient(135deg, #065F46, #059669)',
                opacity: (marking || geoState !== 'ok' || !inRadius) ? 0.45 : 1,
                cursor: (marking || geoState !== 'ok' || !inRadius) ? 'not-allowed' : 'pointer',
              }}>
                {marking ? 'Registrando entrada...' : '▶  Marcar entrada'}
              </button>
            ) : (
              <button onClick={checkOut} disabled={marking || geoState !== 'ok'} style={{
                ...S.mainBtn, background: 'linear-gradient(135deg, #7F1D1D, #DC2626)',
                opacity: (marking || geoState !== 'ok') ? 0.45 : 1,
                cursor: (marking || geoState !== 'ok') ? 'not-allowed' : 'pointer',
              }}>
                {marking ? 'Registrando salida...' : '⏹  Marcar salida'}
              </button>
            )}

            {geoState === 'ok' && !inRadius && !activeShift && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#991B1B', marginTop: 8 }}>
                Debes estar dentro del radio del CESFAM para marcar entrada.
              </p>
            )}
          </>
        )}

        {/* ── TAB: HISTORIAL ── */}
        {tab === 'historial' && (
          <>
            {/* Descarga PDF */}
            <div style={S.card}>
              <div style={S.cardLabel}>Descargar reporte mensual de honorarios</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
                <input type="month" value={reportMonth}
                  onChange={e => setReportMonth(e.target.value)}
                  style={{ ...S.monthInput, flex: 1 }} />
                <button onClick={downloadPDF} style={S.downloadBtn}>
                  ⬇ PDF
                </button>
              </div>
            </div>

            {/* Lista de turnos */}
            <div style={S.card}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2B5E', marginBottom: 12 }}>
                Últimos turnos completados
              </div>
              {recentShifts.length === 0 && (
                <p style={{ fontSize: 13, color: '#9CA3AF' }}>No hay turnos completados aún.</p>
              )}
              {recentShifts.map((s, i) => {
                const ci = new Date(s.check_in)
                const co = s.check_out ? new Date(s.check_out) : null
                return (
                  <div key={s.id} style={{
                    ...S.shiftRow,
                    borderBottom: i < recentShifts.length - 1 ? '1px solid #F3F4F6' : 'none'
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 2 }}>
                        {ci.toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: 12, color: '#6B7280' }}>
                        {ci.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        {' → '}
                        {co ? co.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </div>
                      <div style={{ fontSize: 11, marginTop: 2, color: s.check_in_within_radius ? '#065F46' : '#991B1B' }}>
                        {s.check_in_within_radius ? '✓ GPS dentro del radio' : '⚠ Fuera del radio'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#065F46' }}>
                        {s.amount_earned ? `$${Number(s.amount_earned).toLocaleString('es-CL')}` : '—'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const DARK = '#0D2B5E', BLUE = '#1A4A9A'
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#F0F5FF', fontFamily: "'DM Sans', Arial, sans-serif" },
  header: {
    background: `linear-gradient(135deg, ${DARK}, ${BLUE})`,
    padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  headerGreeting: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  headerName: { color: '#fff', fontWeight: 700, fontSize: 15, lineHeight: 1.2 },
  headerRole: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  logoutBtn: {
    background: 'rgba(255,255,255,0.1)', color: '#fff',
    border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
    padding: '7px 14px', fontSize: 12, cursor: 'pointer',
  },
  body: { maxWidth: 480, margin: '0 auto', padding: '20px 16px 40px' },
  banner: {
    borderRadius: 10, border: '1px solid', padding: '10px 16px',
    fontSize: 13, fontWeight: 600, marginBottom: 16,
  },
  tabs: {
    display: 'flex', gap: 6, background: `linear-gradient(135deg, ${DARK}, ${BLUE})`,
    borderRadius: 14, padding: 6, marginBottom: 16,
  },
  tab: {
    flex: 1, padding: '9px', border: 'none', borderRadius: 10,
    fontSize: 13, cursor: 'pointer', transition: 'all 0.2s',
  },
  card: {
    background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB',
    padding: '16px 18px', marginBottom: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
  },
  cardLabel: { fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  locationName: { fontSize: 15, fontWeight: 700, color: '#0D2B5E', marginBottom: 2 },
  locationAddress: { fontSize: 12, color: '#6B7280' },
  activeShiftCard: {
    background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12,
    padding: '12px 16px', marginBottom: 12,
  },
  mainBtn: {
    width: '100%', padding: '16px', color: '#fff', border: 'none',
    borderRadius: 14, fontSize: 17, fontWeight: 800, cursor: 'pointer',
    letterSpacing: 0.4, transition: 'opacity 0.2s', marginBottom: 4,
  },
  refreshBtn: {
    background: '#F3F4F6', border: 'none', borderRadius: 8,
    width: 36, height: 36, fontSize: 18, cursor: 'pointer', color: '#374151',
    flexShrink: 0,
  },
  shiftRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0',
  },
  monthInput: {
    padding: '9px 12px', borderRadius: 10, border: '1.5px solid #E5E7EB',
    fontSize: 14, background: '#FAFAFA', color: '#111',
  },
  downloadBtn: {
    padding: '9px 20px', background: DARK, color: '#fff', border: 'none',
    borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
}
