// app/admin/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface Profile { id: string; full_name: string; rut: string; sis_registro: string; email: string; cargo: string; status: string; created_at: string }
interface Shift { id: string; user_id: string; check_in: string; check_out: string | null; check_in_within_radius: boolean; check_out_within_radius: boolean; amount_earned: number | null; notes: string | null; profiles: any }
interface Rate { id: string; cargo: string; amount_per_shift: number }
interface ActiveWorker { shift_id: string; user_id: string; full_name: string; rut: string; cargo: string; check_in: string; check_in_within_radius: boolean }

const CARGO: Record<string, string> = { tens: 'TENS', enfermera: 'Enfermera/o', otro: 'Otro' }
const CARGO_COLOR: Record<string, string> = { tens: '#3B82F6', enfermera: '#8B5CF6', otro: '#F59E0B' }

function elapsed(from: string) {
  const diff = Math.floor((Date.now() - new Date(from).getTime()) / 1000)
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`
}
function fmtTime(d: string | null) { return d ? new Date(d).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—' }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—' }
function fmtMoney(n: number | null) { return n ? `$${Number(n).toLocaleString('es-CL')}` : '—' }

export default function AdminPage() {
  const supabase = createClient()
  const router = useRouter()
  const [tab, setTab] = useState<'live' | 'pending' | 'shifts' | 'rates' | 'reports'>('live')
  const [pending, setPending] = useState<Profile[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [rates, setRates] = useState<Rate[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [activeWorkers, setActiveWorkers] = useState<ActiveWorker[]>([])
  const [approvedCount, setApprovedCount] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null)
  const [editingShift, setEditingShift] = useState<string | null>(null)
  const [shiftEdits, setShiftEdits] = useState<Record<string, any>>({})
  const [reportUser, setReportUser] = useState('all')
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7))
  const [adminName, setAdminName] = useState('')
  const [tick, setTick] = useState(0)

  const flash = (msg: string, ok = true) => { setFeedback({ msg, ok }); setTimeout(() => setFeedback(null), 3500) }

  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(i) }, [])

  useEffect(() => {
    checkAdmin()
  }, [])

  useEffect(() => {
    loadTab()
    if (tab === 'live') {
      const i = setInterval(loadLive, 30000)
      return () => clearInterval(i)
    }
  }, [tab])

  async function checkAdmin() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: prof } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
    if (prof?.role !== 'admin') { router.push('/dashboard'); return }
    setAdminName(prof?.full_name || '')
  }

  async function loadLive() {
    const { data: active } = await supabase.from('shifts')
      .select('id, user_id, check_in, check_in_within_radius, profiles(full_name, rut, cargo)')
      .is('check_out', null).order('check_in', { ascending: false })
    setActiveWorkers((active || []).map((s: any) => ({
      shift_id: s.id, user_id: s.user_id, full_name: s.profiles?.full_name,
      rut: s.profiles?.rut, cargo: s.profiles?.cargo,
      check_in: s.check_in, check_in_within_radius: s.check_in_within_radius,
    })))
    const { count: approved } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'approved')
    setApprovedCount(approved || 0)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const { count: todayShifts } = await supabase.from('shifts').select('*', { count: 'exact', head: true }).gte('check_in', today.toISOString())
    setTodayCount(todayShifts || 0)
    const { data: pend } = await supabase.from('profiles').select('*').eq('status', 'pending')
    setPending(pend || [])
  }

  async function loadTab() {
    setLoading(true)
    if (tab === 'live') await loadLive()
    if (tab === 'pending') {
      const { data } = await supabase.from('profiles').select('*').eq('status', 'pending').order('created_at', { ascending: false })
      setPending(data || [])
    }
    if (tab === 'shifts') {
      const { data } = await supabase.from('shifts').select('*, profiles(full_name, rut, cargo, email)').order('check_in', { ascending: false }).limit(200)
      setShifts(data || [])
    }
    if (tab === 'rates') {
      const { data } = await supabase.from('shift_rates').select('*').order('cargo')
      setRates(data || [])
    }
    if (tab === 'reports') {
      const { data } = await supabase.from('profiles').select('id, full_name, cargo, rut').eq('status', 'approved').order('full_name')
      setUsers(data || [])
    }
    setLoading(false)
  }

  async function approve(userId: string, approved: boolean) {
    await supabase.from('profiles').update({ status: approved ? 'approved' : 'rejected', approved_at: new Date().toISOString() }).eq('id', userId)
    setPending(p => p.filter(u => u.id !== userId))
    flash(approved ? '✓ Usuario aprobado' : 'Usuario rechazado', approved)
  }

  async function updateRate(id: string, amount: number) {
    await supabase.from('shift_rates').update({ amount_per_shift: amount, updated_at: new Date().toISOString() }).eq('id', id)
    flash('✓ Tarifa actualizada')
  }

  async function saveShiftEdit(shiftId: string) {
    const edits = shiftEdits[shiftId]; if (!edits) return
    const update: any = { edited_at: new Date().toISOString() }
    if (edits.check_in) update.check_in = new Date(edits.check_in).toISOString()
    if (edits.check_out) update.check_out = new Date(edits.check_out).toISOString()
    if (edits.notes !== undefined) update.notes = edits.notes
    await supabase.from('shifts').update(update).eq('id', shiftId)
    setEditingShift(null); flash('✓ Marcaje corregido'); loadTab()
  }

  async function exportReport(format: 'csv' | 'pdf') {
    const start = `${reportMonth}-01T00:00:00`
    const end = new Date(reportMonth + '-01'); end.setMonth(end.getMonth() + 1)
    let query = supabase.from('shifts').select('*, profiles(full_name, rut, cargo, email)').gte('check_in', start).lt('check_in', end.toISOString()).order('check_in')
    if (reportUser !== 'all') query = query.eq('user_id', reportUser)
    const { data } = await query
    if (!data || data.length === 0) { flash('No hay datos ese período', false); return }
    format === 'csv' ? exportCSV(data) : exportPDF(data)
  }

  function exportCSV(data: any[]) {
    const headers = ['Nombre', 'RUT', 'Cargo', 'Fecha', 'Entrada', 'Salida', 'GPS', 'Honorario CLP', 'Notas']
    const rows = data.map(s => [s.profiles?.full_name || '-', s.profiles?.rut || '-', CARGO[s.profiles?.cargo] || '-', fmtDate(s.check_in), fmtTime(s.check_in), fmtTime(s.check_out), s.check_in_within_radius ? 'Dentro' : 'Fuera', s.amount_earned ? Number(s.amount_earned) : '-', s.notes || ''])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })); a.download = `honorarios_${reportMonth}.csv`; a.click()
  }

  function exportPDF(data: any[]) {
    const month = new Date(reportMonth + '-01').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
    const total = data.reduce((s, t) => s + (t.amount_earned || 0), 0)
    const rows = data.map(s => `<tr><td>${s.profiles?.full_name||'-'}</td><td>${s.profiles?.rut||'-'}</td><td>${CARGO[s.profiles?.cargo]||'-'}</td><td>${fmtDate(s.check_in)}</td><td>${fmtTime(s.check_in)}</td><td>${fmtTime(s.check_out)}</td><td style="color:${s.check_in_within_radius?'#065F46':'#991B1B'}">${s.check_in_within_radius?'✓':'⚠'}</td><td style="text-align:right;font-weight:700">${fmtMoney(s.amount_earned)}</td><td>${s.notes||''}</td></tr>`).join('')
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Honorarios ${month}</title><style>body{font-family:Arial,sans-serif;padding:32px;font-size:11px}h1{color:#0D2B5E;font-size:17px;margin:0 0 2px}h2{color:#1A4A9A;font-size:13px;margin:0 0 20px;font-weight:400}table{width:100%;border-collapse:collapse}th{background:#0D2B5E;color:#fff;padding:7px 10px;text-align:left;font-size:10px}td{padding:6px 10px;border-bottom:1px solid #EFEFEF}tr:nth-child(even) td{background:#F8FAFF}tfoot td{background:#EFF6FF;font-weight:700;border-top:2px solid #1A4A9A}.footer{margin-top:20px;font-size:9px;color:#999;text-align:center}</style></head><body><h1>Speech Psychology SpA — RUT 78.254.509-4</h1><h2>Reporte de honorarios · ${month}</h2><table><thead><tr><th>Nombre</th><th>RUT</th><th>Cargo</th><th>Fecha</th><th>Entrada</th><th>Salida</th><th>GPS</th><th>Honorario</th><th>Notas</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="7">Total · ${data.length} turno(s)</td><td style="text-align:right">$${total.toLocaleString('es-CL')}</td><td></td></tr></tfoot></table><div class="footer">Generado el ${new Date().toLocaleDateString('es-CL')} · Sistema de Gestión Speech Psychology SpA</div></body></html>`
    const w = window.open('', '_blank')!; w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600)
  }

  const navItems = [
    { id: 'live', label: '⬤  Tiempo real', badge: activeWorkers.length > 0 ? activeWorkers.length : null, green: true },
    { id: 'pending', label: '○  Solicitudes', badge: pending.length || null, green: false },
    { id: 'shifts', label: '◷  Marcajes', badge: null, green: false },
    { id: 'rates', label: '◈  Tarifas', badge: null, green: false },
    { id: 'reports', label: '◫  Reportes', badge: null, green: false },
  ] as const

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fadeIn .25s ease}
        .live-dot{animation:pulse 2s infinite}
        .nav-btn:hover{background:rgba(255,255,255,.08)!important}
        .card-h:hover{transform:translateY(-1px);box-shadow:0 8px 28px rgba(0,0,0,.1)!important}
        input:focus,select:focus{outline:none;border-color:#3B82F6!important;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:2px}
      `}</style>

      {/* SIDEBAR */}
      <aside style={S.sidebar}>
        <div style={S.sTop}>
          <img src="/logo.png" alt="Logo" style={{ width: 42, height: 48, objectFit: 'contain' }} />
          <div>
            <div style={S.sBrand}>Speech Psychology</div>
            <div style={S.sSub}>Panel de Control</div>
          </div>
        </div>

        <div style={S.adminChip}>
          <div style={S.dot} /><div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{adminName}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)' }}>Administrador</div>
          </div>
        </div>

        <div style={S.stats}>
          {[{ n: activeWorkers.length, l: 'Activas ahora' }, { n: todayCount, l: 'Turnos hoy' }, { n: approvedCount, l: 'Profesionales' }].map(s => (
            <div key={s.l} style={S.statBox}>
              <div style={S.statN}>{s.n}</div>
              <div style={S.statL}>{s.l}</div>
            </div>
          ))}
        </div>

        <nav style={{ padding: '8px 12px', flex: 1 }}>
          {navItems.map(item => (
            <button key={item.id} className="nav-btn" onClick={() => setTab(item.id)} style={{
              ...S.navBtn,
              background: tab === item.id ? 'rgba(255,255,255,.12)' : 'transparent',
              borderLeft: tab === item.id ? '3px solid #60A5FA' : '3px solid transparent',
              color: tab === item.id ? '#fff' : 'rgba(255,255,255,.5)',
            }}>
              <span style={{ color: item.green && activeWorkers.length > 0 ? '#4ADE80' : 'inherit' }}>{item.label}</span>
              {item.badge !== null && item.badge !== undefined && item.badge > 0 && (
                <span style={{ background: item.green ? '#4ADE80' : '#EF4444', color: item.green ? '#052e16' : '#fff', borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{item.badge}</span>
              )}
            </button>
          ))}
        </nav>

        <button onClick={async () => { await supabase.auth.signOut(); router.push('/login') }} style={S.logout}>Cerrar sesión</button>
      </aside>

      {/* MAIN */}
      <main style={S.main}>
        {feedback && <div className="fade-in" style={{ ...S.toast, background: feedback.ok ? '#065F46' : '#991B1B' }}>{feedback.msg}</div>}

        {/* TIEMPO REAL */}
        {tab === 'live' && (
          <div className="fade-in">
            <div style={S.hdr}>
              <div><h1 style={S.hTitle}>Control en tiempo real</h1><p style={S.hSub}>Se actualiza cada 30 segundos automáticamente</p></div>
              <button onClick={loadLive} style={S.refreshBtn}>↺ Actualizar</button>
            </div>

            {activeWorkers.length === 0 ? (
              <div style={S.empty}><div style={{ fontSize: 40, marginBottom: 12, opacity: .3 }}>◌</div><div style={{ fontWeight: 700, color: '#374151' }}>Sin profesionales activas ahora</div></div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 16, marginBottom: 32 }}>
                {activeWorkers.map(w => (
                  <div key={w.shift_id} className="card-h" style={S.liveCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div style={{ ...S.av, background: (CARGO_COLOR[w.cargo] || '#6B7280') + '22', color: CARGO_COLOR[w.cargo] || '#6B7280' }}>{w.full_name?.charAt(0)}</div>
                        <div><div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{w.full_name}</div><div style={{ fontSize: 12, color: '#6B7280' }}>{w.rut}</div></div>
                      </div>
                      <span style={{ ...S.cbadge, background: (CARGO_COLOR[w.cargo] || '#6B7280') + '18', color: CARGO_COLOR[w.cargo] || '#6B7280' }}>{CARGO[w.cargo] || w.cargo}</span>
                    </div>
                    {[
                      { l: 'Entrada', v: fmtTime(w.check_in), c: '#111' },
                      { l: 'Tiempo trabajado', v: elapsed(w.check_in), c: '#059669' },
                      { l: 'GPS', v: w.check_in_within_radius ? '✓ Dentro del radio' : '⚠ Fuera del radio', c: w.check_in_within_radius ? '#059669' : '#DC2626' },
                    ].map(row => (
                      <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F3F4F6' }}>
                        <span style={{ fontSize: 12, color: '#9CA3AF' }}>{row.l}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: row.c }}>{row.v}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="live-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ADE80' }} />
                      <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>Turno activo</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, textTransform: 'uppercase', margin: '24px 0 14px' }}>Resumen del día</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
              {[{ l: 'Profesionales activas', v: activeWorkers.length, c: '#059669' }, { l: 'Turnos completados', v: Math.max(0, todayCount - activeWorkers.length), c: '#3B82F6' }, { l: 'Total turnos hoy', v: todayCount, c: '#8B5CF6' }].map(s => (
                <div key={s.l} style={S.sumCard}><div style={{ fontSize: 40, fontWeight: 800, color: s.c, fontFamily: 'Syne,sans-serif' }}>{s.v}</div><div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{s.l}</div></div>
              ))}
            </div>
          </div>
        )}

        {/* PENDIENTES */}
        {tab === 'pending' && (
          <div className="fade-in">
            <div style={S.hdr}><div><h1 style={S.hTitle}>Solicitudes de acceso</h1><p style={S.hSub}>{pending.length} solicitud(es) pendiente(s)</p></div></div>
            {pending.length === 0 && <div style={S.empty}><div style={{ fontSize: 32, marginBottom: 10 }}>✓</div><div style={{ fontWeight: 700, color: '#374151' }}>Sin solicitudes pendientes</div></div>}
            {pending.map(u => (
              <div key={u.id} className="card-h" style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{ ...S.av, width: 48, height: 48, fontSize: 18, background: '#EFF6FF', color: '#3B82F6' }}>{u.full_name?.charAt(0)}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#111', marginBottom: 3 }}>{u.full_name}</div>
                      <div style={{ fontSize: 13, color: '#6B7280' }}>{u.rut} · SIS: {u.sis_registro} · <span style={{ color: CARGO_COLOR[u.cargo], fontWeight: 600 }}>{CARGO[u.cargo]}</span></div>
                      <div style={{ fontSize: 13, color: '#6B7280' }}>{u.email}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Solicitado: {fmtDate(u.created_at)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => approve(u.id, true)} style={S.approveBtn}>✓ Aprobar</button>
                    <button onClick={() => approve(u.id, false)} style={S.rejectBtn}>✗ Rechazar</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* MARCAJES */}
        {tab === 'shifts' && (
          <div className="fade-in">
            <div style={S.hdr}><div><h1 style={S.hTitle}>Historial de marcajes</h1><p style={S.hSub}>Últimos 200 · Puedes corregir errores directamente</p></div></div>
            <div style={{ overflowX: 'auto', borderRadius: 16, border: '1px solid #E5E7EB' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
                <thead><tr>{['Profesional', 'Cargo', 'Fecha', 'Entrada', 'Salida', 'GPS', 'Honorario', 'Corrección'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {shifts.map((s, i) => (
                    <tr key={s.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAFBFF' }}>
                      <td style={S.td}><div style={{ fontWeight: 700, color: '#111' }}>{s.profiles?.full_name}</div><div style={{ fontSize: 11, color: '#9CA3AF' }}>{s.profiles?.rut}</div></td>
                      <td style={S.td}><span style={{ ...S.cbadge, background: (CARGO_COLOR[s.profiles?.cargo] || '#6B7280') + '18', color: CARGO_COLOR[s.profiles?.cargo] || '#6B7280' }}>{CARGO[s.profiles?.cargo] || '—'}</span></td>
                      <td style={S.td}>{fmtDate(s.check_in)}</td>
                      <td style={S.td}>{editingShift === s.id ? <input type="datetime-local" defaultValue={s.check_in?.slice(0, 16)} onChange={e => setShiftEdits(p => ({ ...p, [s.id]: { ...p[s.id], check_in: e.target.value } }))} style={S.editInput} /> : <span style={{ fontWeight: 600 }}>{fmtTime(s.check_in)}</span>}</td>
                      <td style={S.td}>{editingShift === s.id ? <input type="datetime-local" defaultValue={s.check_out?.slice(0, 16) || ''} onChange={e => setShiftEdits(p => ({ ...p, [s.id]: { ...p[s.id], check_out: e.target.value } }))} style={S.editInput} /> : <span style={{ color: s.check_out ? '#111' : '#9CA3AF' }}>{fmtTime(s.check_out)}</span>}</td>
                      <td style={S.td}><span style={{ fontWeight: 600, color: s.check_in_within_radius ? '#059669' : '#DC2626' }}>{s.check_in_within_radius ? '✓ OK' : '⚠ Fuera'}</span></td>
                      <td style={S.td}><span style={{ fontWeight: 800, color: '#059669' }}>{fmtMoney(s.amount_earned)}</span></td>
                      <td style={S.td}>
                        {editingShift === s.id ? (
                          <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                            <input placeholder="Nota..." defaultValue={s.notes || ''} onChange={e => setShiftEdits(p => ({ ...p, [s.id]: { ...p[s.id], notes: e.target.value } }))} style={S.editInput} />
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => saveShiftEdit(s.id)} style={S.saveBtn}>✓</button>
                              <button onClick={() => setEditingShift(null)} style={S.cancelBtn}>✕</button>
                            </div>
                          </div>
                        ) : <button onClick={() => setEditingShift(s.id)} style={S.editBtn}>✏ Editar</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TARIFAS */}
        {tab === 'rates' && (
          <div className="fade-in">
            <div style={S.hdr}><div><h1 style={S.hTitle}>Tarifas por turno</h1><p style={S.hSub}>Edita el monto y haz clic fuera para guardar automáticamente</p></div></div>
            {rates.map(r => (
              <div key={r.id} className="card-h" style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                  <div><div style={{ fontWeight: 700, fontSize: 16, color: '#111', marginBottom: 4 }}>{CARGO[r.cargo]}</div><div style={{ fontSize: 13, color: '#9CA3AF' }}>cargo: {r.cargo}</div></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#374151' }}>$</span>
                    <input type="number" defaultValue={r.amount_per_shift} onBlur={e => updateRate(r.id, Number(e.target.value))} style={{ ...S.editInput, width: 160, fontSize: 22, fontWeight: 800, textAlign: 'right', padding: '10px 14px' }} />
                    <span style={{ color: '#6B7280', fontSize: 14 }}>CLP / turno</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* REPORTES */}
        {tab === 'reports' && (
          <div className="fade-in">
            <div style={S.hdr}><div><h1 style={S.hTitle}>Reportes de honorarios</h1><p style={S.hSub}>Exporta por profesional y mes en Excel o PDF</p></div></div>
            <div style={S.card}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={S.label}>Profesional</label>
                  <select value={reportUser} onChange={e => setReportUser(e.target.value)} style={S.select}>
                    <option value="all">Todas las profesionales</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.full_name} · {u.rut} ({CARGO[u.cargo]})</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={S.label}>Mes</label>
                  <input type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)} style={S.select} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => exportReport('csv')} style={S.exportBtn}>⬇ Excel (.csv)</button>
                <button onClick={() => exportReport('pdf')} style={{ ...S.exportBtn, background: '#0D2B5E' }}>🖨 PDF</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', minHeight: '100vh', fontFamily: "'DM Sans',Arial,sans-serif", background: '#F0F4FF' },
  sidebar: { width: 256, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'linear-gradient(180deg,#0A1628 0%,#0D2B5E 60%,#1A4A9A 100%)', minHeight: '100vh', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' },
  sTop: { display: 'flex', gap: 12, alignItems: 'center', padding: '24px 18px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' },
  sBrand: { color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'Syne,sans-serif' },
  sSub: { color: 'rgba(255,255,255,.4)', fontSize: 11 },
  adminChip: { display: 'flex', alignItems: 'center', gap: 10, margin: '14px 18px', background: 'rgba(255,255,255,.06)', borderRadius: 10, padding: '10px 12px' },
  dot: { width: 8, height: 8, borderRadius: '50%', background: '#4ADE80', flexShrink: 0 },
  stats: { display: 'flex', gap: 8, padding: '0 18px 14px', borderBottom: '1px solid rgba(255,255,255,.08)' },
  statBox: { flex: 1, background: 'rgba(255,255,255,.06)', borderRadius: 10, padding: '10px 6px', textAlign: 'center' },
  statN: { color: '#fff', fontWeight: 800, fontSize: 22, fontFamily: 'Syne,sans-serif' },
  statL: { color: 'rgba(255,255,255,.4)', fontSize: 10, marginTop: 2, lineHeight: 1.2 },
  navBtn: { width: '100%', padding: '11px 14px', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left', transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  logout: { margin: '12px 18px 20px', padding: '10px', background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.5)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, fontSize: 12, cursor: 'pointer', textAlign: 'center' },
  main: { flex: 1, padding: '32px 36px', overflowX: 'auto', position: 'relative' },
  hdr: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  hTitle: { fontSize: 26, fontWeight: 800, color: '#0A1628', margin: 0, fontFamily: 'Syne,sans-serif' },
  hSub: { fontSize: 13, color: '#6B7280', margin: '4px 0 0' },
  toast: { position: 'fixed', top: 24, right: 24, color: '#fff', borderRadius: 12, padding: '12px 20px', fontSize: 13, fontWeight: 600, zIndex: 999, boxShadow: '0 8px 32px rgba(0,0,0,.2)' },
  refreshBtn: { padding: '10px 18px', background: '#fff', color: '#0D2B5E', border: '1.5px solid #E5E7EB', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  empty: { background: '#fff', borderRadius: 20, padding: '60px 40px', textAlign: 'center', border: '1px solid #E5E7EB' },
  liveCard: { background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', padding: '18px', boxShadow: '0 2px 12px rgba(0,0,0,.05)', transition: 'all .2s' },
  sumCard: { background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', padding: '22px', boxShadow: '0 2px 8px rgba(0,0,0,.04)' },
  card: { background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', padding: '20px 24px', marginBottom: 12, boxShadow: '0 2px 8px rgba(0,0,0,.04)', transition: 'all .2s' },
  av: { width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, flexShrink: 0 },
  cbadge: { borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700 },
  th: { background: '#0A1628', color: '#fff', padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: .5 },
  td: { padding: '11px 16px', borderBottom: '1px solid #F3F4F6', verticalAlign: 'middle' },
  editInput: { padding: '6px 10px', borderRadius: 8, border: '1.5px solid #E5E7EB', fontSize: 13, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  editBtn: { padding: '5px 12px', background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  saveBtn: { padding: '5px 12px', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 700 },
  cancelBtn: { padding: '5px 10px', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  approveBtn: { padding: '10px 20px', background: '#059669', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  rejectBtn: { padding: '10px 20px', background: '#FEF2F2', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 },
  select: { width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #E5E7EB', fontSize: 14, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' },
  exportBtn: { padding: '12px 28px', background: '#1A4A9A', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
}
