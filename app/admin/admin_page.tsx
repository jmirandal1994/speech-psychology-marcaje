// app/admin/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface Profile { id: string; full_name: string; rut: string; sis_registro: string; email: string; cargo: string; status: string; created_at: string }
interface Shift {
  id: string; user_id: string; check_in: string; check_out: string | null
  check_in_within_radius: boolean; check_out_within_radius: boolean
  amount_earned: number | null; notes: string | null
  profiles: { full_name: string; rut: string; cargo: string; email: string }
}
interface Rate { id: string; cargo: string; amount_per_shift: number }

const CARGO: Record<string, string> = { tens: 'TENS', enfermera: 'Enfermera/o', otro: 'Otro' }

export default function AdminPage() {
  const supabase = createClient()
  const router = useRouter()
  const [tab, setTab] = useState<'pending' | 'shifts' | 'rates' | 'reports'>('pending')
  const [pending, setPending] = useState<Profile[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [rates, setRates] = useState<Rate[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [editingShift, setEditingShift] = useState<string | null>(null)
  const [shiftEdits, setShiftEdits] = useState<Record<string, { check_in?: string; check_out?: string; notes?: string }>>({})
  const [reportUser, setReportUser] = useState('all')
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7))

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3500) }

  useEffect(() => {
    checkAdmin()
  }, [])

  useEffect(() => { loadTab() }, [tab])

  async function checkAdmin() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (prof?.role !== 'admin') { router.push('/dashboard'); return }
  }

  async function loadTab() {
    setLoading(true)
    if (tab === 'pending') {
      const { data } = await supabase.from('profiles').select('*')
        .eq('status', 'pending').order('created_at', { ascending: false })
      setPending(data || [])
    }
    if (tab === 'shifts') {
      const { data } = await supabase.from('shifts')
        .select('*, profiles(full_name, rut, cargo, email)')
        .order('check_in', { ascending: false }).limit(150)
      setShifts(data || [])
    }
    if (tab === 'rates') {
      const { data } = await supabase.from('shift_rates').select('*').order('cargo')
      setRates(data || [])
    }
    if (tab === 'reports') {
      const { data } = await supabase.from('profiles').select('id, full_name, cargo, rut, sis_registro, email, status, created_at')
        .eq('status', 'approved').order('full_name')
      setUsers((data as Profile[]) || [])
    }
    setLoading(false)
  }

  async function approve(userId: string, approved: boolean) {
    await supabase.from('profiles').update({
      status: approved ? 'approved' : 'rejected',
      approved_at: new Date().toISOString(),
    }).eq('id', userId)
    setPending(p => p.filter(u => u.id !== userId))
    flash(approved ? '✓ Usuario aprobado — recibirá acceso por correo' : 'Usuario rechazado')
  }

  async function updateRate(id: string, amount: number) {
    await supabase.from('shift_rates').update({ amount_per_shift: amount, updated_at: new Date().toISOString() }).eq('id', id)
    flash('✓ Tarifa actualizada')
  }

  async function saveShiftEdit(shiftId: string) {
    const edits = shiftEdits[shiftId]
    if (!edits) return
    const update: any = {}
    if (edits.check_in) update.check_in = new Date(edits.check_in).toISOString()
    if (edits.check_out) update.check_out = new Date(edits.check_out).toISOString()
    if (edits.notes !== undefined) update.notes = edits.notes
    update.edited_at = new Date().toISOString()
    await supabase.from('shifts').update(update).eq('id', shiftId)
    setEditingShift(null)
    flash('✓ Marcaje corregido correctamente')
    loadTab()
  }

  async function exportReport(format: 'csv' | 'pdf') {
    const start = `${reportMonth}-01T00:00:00`
    const end = new Date(reportMonth + '-01')
    end.setMonth(end.getMonth() + 1)

    let query = supabase.from('shifts')
      .select('*, profiles(full_name, rut, cargo, email)')
      .gte('check_in', start).lt('check_in', end.toISOString()).order('check_in')
    if (reportUser !== 'all') query = query.eq('user_id', reportUser)

    const { data } = await query
    if (!data || data.length === 0) { flash('No hay datos ese período'); return }

    format === 'csv' ? exportCSV(data) : exportPDF(data)
  }

  function exportCSV(data: any[]) {
    const headers = ['Nombre', 'RUT', 'Cargo', 'Fecha', 'Entrada', 'Salida', 'GPS Entrada', 'Honorario (CLP)', 'Notas']
    const rows = data.map(s => {
      const ci = s.check_in ? new Date(s.check_in) : null
      const co = s.check_out ? new Date(s.check_out) : null
      const fd = (d: Date | null) => d ? d.toLocaleDateString('es-CL') : '-'
      const ft = (d: Date | null) => d ? d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '-'
      return [
        s.profiles?.full_name || '-', s.profiles?.rut || '-', CARGO[s.profiles?.cargo] || '-',
        fd(ci), ft(ci), ft(co),
        s.check_in_within_radius ? 'Dentro del radio' : 'Fuera del radio',
        s.amount_earned ? Number(s.amount_earned) : '-',
        s.notes || '',
      ]
    })
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `honorarios_${reportMonth}_${reportUser === 'all' ? 'todos' : reportUser}.csv`
    a.click()
  }

  function exportPDF(data: any[]) {
    const month = new Date(reportMonth + '-01').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
    const total = data.reduce((s, t) => s + (t.amount_earned || 0), 0)
    const fd = (d: string) => new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const ft = (d: string | null) => d ? new Date(d).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—'
    const fm = (n: number) => `$${n.toLocaleString('es-CL')}`

    const rows = data.map(s => `<tr>
      <td>${s.profiles?.full_name || '-'}</td>
      <td>${s.profiles?.rut || '-'}</td>
      <td>${CARGO[s.profiles?.cargo] || '-'}</td>
      <td>${fd(s.check_in)}</td>
      <td>${ft(s.check_in)}</td>
      <td>${ft(s.check_out)}</td>
      <td style="color:${s.check_in_within_radius ? '#065F46' : '#991B1B'}">${s.check_in_within_radius ? '✓' : '⚠'}</td>
      <td style="text-align:right;font-weight:700">${s.amount_earned ? fm(s.amount_earned) : '—'}</td>
      <td>${s.notes || ''}</td>
    </tr>`).join('')

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>Reporte ${month}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;font-size:11px;color:#111}
      h1{color:#0D2B5E;font-size:17px;margin:0 0 2px}
      h2{color:#1A4A9A;font-size:13px;margin:0 0 20px;font-weight:400}
      table{width:100%;border-collapse:collapse}
      th{background:#0D2B5E;color:#fff;padding:7px 10px;text-align:left;font-size:10px}
      td{padding:6px 10px;border-bottom:1px solid #EFEFEF}
      tr:nth-child(even) td{background:#F8FAFF}
      tfoot td{background:#EFF6FF;font-weight:700;border-top:2px solid #1A4A9A}
      .footer{margin-top:20px;font-size:9px;color:#999;text-align:center;padding-top:10px;border-top:1px solid #eee}
    </style></head><body>
    <h1>Speech Psychology SpA — RUT 78.254.509-4</h1>
    <h2>Reporte de honorarios · ${month}</h2>
    <table><thead><tr>
      <th>Nombre</th><th>RUT</th><th>Cargo</th><th>Fecha</th>
      <th>Entrada</th><th>Salida</th><th>GPS</th><th>Honorario</th><th>Notas</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="7">Total · ${data.length} turno(s)</td>
      <td style="text-align:right">${fm(total)}</td><td></td>
    </tr></tfoot></table>
    <div class="footer">Generado el ${new Date().toLocaleDateString('es-CL')} · Sistema de Gestión Speech Psychology SpA</div>
    </body></html>`

    const w = window.open('', '_blank')!
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 600)
  }

  const fmtDT = (d: string | null) => d
    ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + new Date(d).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    : '—'

  const tabs = [
    { id: 'pending', label: '👤 Pendientes', count: pending.length },
    { id: 'shifts', label: '🕐 Marcajes' },
    { id: 'rates', label: '💰 Tarifas' },
    { id: 'reports', label: '📊 Reportes' },
  ] as const

  return (
    <div style={S.page}>
      {/* SIDEBAR */}
      <aside style={S.sidebar}>
        <div style={S.brand}>
          <img src="/logo.png" alt="Logo" style={{ width: 36, height: 40, objectFit: 'contain' }} />
          <div>
            <div style={S.brandName}>Speech Psychology</div>
            <div style={S.brandSub}>Panel Admin</div>
          </div>
        </div>
        <nav style={{ padding: '8px 0' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              ...S.navBtn,
              background: tab === t.id ? 'rgba(255,255,255,0.15)' : 'transparent',
              color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.55)',
              borderLeft: tab === t.id ? '3px solid #fff' : '3px solid transparent',
            }}>
              {t.label}
              {'count' in t && t.count > 0 && (
                <span style={S.badge}>{t.count}</span>
              )}
            </button>
          ))}
        </nav>
        <button onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}
          style={S.logoutBtn}>Cerrar sesión</button>
      </aside>

      {/* MAIN */}
      <main style={S.main}>
        {feedback && <div style={S.feedback}>{feedback}</div>}

        {loading && <div style={{ color: '#6B7280', fontSize: 14, padding: '20px 0' }}>Cargando...</div>}

        {/* ── PENDIENTES ── */}
        {tab === 'pending' && !loading && (
          <>
            <h2 style={S.sectionTitle}>Solicitudes pendientes de aprobación</h2>
            {pending.length === 0 && (
              <div style={S.empty}>No hay solicitudes pendientes ✓</div>
            )}
            {pending.map(u => (
              <div key={u.id} style={S.card}>
                <div style={S.cardRow}>
                  <div>
                    <div style={S.cardName}>{u.full_name}</div>
                    <div style={S.cardMeta}>{u.rut} · {CARGO[u.cargo]} · SIS: {u.sis_registro}</div>
                    <div style={S.cardMeta}>{u.email}</div>
                    <div style={{ ...S.cardMeta, fontSize: 11 }}>
                      Solicitado: {new Date(u.created_at).toLocaleDateString('es-CL', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      } as any)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => approve(u.id, true)} style={S.approveBtn}>✓ Aprobar</button>
                    <button onClick={() => approve(u.id, false)} style={S.rejectBtn}>✗ Rechazar</button>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── MARCAJES ── */}
        {tab === 'shifts' && !loading && (
          <>
            <h2 style={S.sectionTitle}>Historial de marcajes — últimos 150</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    {['Profesional', 'Cargo', 'Entrada', 'Salida', 'GPS', 'Honorario', 'Corrección'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shifts.map(s => (
                    <tr key={s.id}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{s.profiles?.full_name}</div>
                        <div style={{ fontSize: 11, color: '#9CA3AF' }}>{s.profiles?.rut}</div>
                      </td>
                      <td style={S.td}>
                        <span style={S.pill}>{CARGO[s.profiles?.cargo]}</span>
                      </td>
                      <td style={S.td}>
                        {editingShift === s.id ? (
                          <input type="datetime-local"
                            defaultValue={s.check_in?.slice(0, 16)}
                            onChange={e => setShiftEdits(p => ({ ...p, [s.id]: { ...p[s.id], check_in: e.target.value } }))}
                            style={S.editInput} />
                        ) : (
                          <span style={{ fontSize: 12 }}>{fmtDT(s.check_in)}</span>
                        )}
                      </td>
                      <td style={S.td}>
                        {editingShift === s.id ? (
                          <input type="datetime-local"
                            defaultValue={s.check_out?.slice(0, 16) || ''}
                            onChange={e => setShiftEdits(p => ({ ...p, [s.id]: { ...p[s.id], check_out: e.target.value } }))}
                            style={S.editInput} />
                        ) : (
                          <span style={{ fontSize: 12 }}>{fmtDT(s.check_out)}</span>
                        )}
                      </td>
                      <td style={S.td}>
                        <span style={{ fontSize: 12, color: s.check_in_within_radius ? '#065F46' : '#991B1B', fontWeight: 600 }}>
                          {s.check_in_within_radius ? '✓ OK' : '⚠ Fuera'}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span style={{ fontWeight: 800, color: '#065F46', fontSize: 13 }}>
                          {s.amount_earned ? `$${Number(s.amount_earned).toLocaleString('es-CL')}` : '—'}
                        </span>
                      </td>
                      <td style={S.td}>
                        {editingShift === s.id ? (
                          <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                            <input placeholder="Nota de corrección..."
                              defaultValue={s.notes || ''}
                              onChange={e => setShiftEdits(p => ({ ...p, [s.id]: { ...p[s.id], notes: e.target.value } }))}
                              style={S.editInput} />
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => saveShiftEdit(s.id)} style={S.saveBtn}>Guardar</button>
                              <button onClick={() => setEditingShift(null)} style={S.cancelBtn}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setEditingShift(s.id)} style={S.editBtn}>
                            ✏ Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── TARIFAS ── */}
        {tab === 'rates' && !loading && (
          <>
            <h2 style={S.sectionTitle}>Tarifas de honorario por turno</h2>
            <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 20 }}>
              Edita el valor y haz clic fuera del campo para guardar. Los cambios aplican a nuevos turnos completados.
            </p>
            {rates.map(r => (
              <div key={r.id} style={S.card}>
                <div style={S.cardRow}>
                  <div>
                    <div style={S.cardName}>{CARGO[r.cargo]}</div>
                    <div style={S.cardMeta}>Cargo en sistema: {r.cargo}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, color: '#374151', fontSize: 16 }}>$</span>
                    <input type="number" defaultValue={r.amount_per_shift}
                      onBlur={e => updateRate(r.id, Number(e.target.value))}
                      style={S.rateInput} />
                    <span style={{ color: '#6B7280', fontSize: 13 }}>CLP / turno</span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── REPORTES ── */}
        {tab === 'reports' && !loading && (
          <>
            <h2 style={S.sectionTitle}>Generar reporte de honorarios</h2>
            <div style={S.card}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const, marginBottom: 20 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={S.label}>Profesional</label>
                  <select value={reportUser} onChange={e => setReportUser(e.target.value)} style={S.select}>
                    <option value="all">Todas las profesionales</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} · {u.rut} ({CARGO[u.cargo]})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={S.label}>Mes</label>
                  <input type="month" value={reportMonth}
                    onChange={e => setReportMonth(e.target.value)} style={S.select} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => exportReport('csv')} style={S.exportBtn}>
                  ⬇ Exportar Excel (.csv)
                </button>
                <button onClick={() => exportReport('pdf')} style={{ ...S.exportBtn, background: '#0D2B5E' }}>
                  🖨 Exportar PDF
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

const DARK = '#0D2B5E', BLUE = '#1A4A9A'
const S: Record<string, React.CSSProperties> = {
  page: { display: 'flex', minHeight: '100vh', fontFamily: "'DM Sans', Arial, sans-serif", background: '#F0F5FF' },
  sidebar: {
    width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column',
    background: `linear-gradient(180deg, ${DARK} 0%, ${BLUE} 100%)`,
    minHeight: '100vh', padding: '0 0 20px',
  },
  brand: { display: 'flex', gap: 10, alignItems: 'center', padding: '24px 16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 8 },
  brandName: { color: '#fff', fontWeight: 700, fontSize: 13 },
  brandSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  navBtn: {
    width: '100%', padding: '11px 20px', border: 'none', borderRadius: 0,
    fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left' as const,
    transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
  },
  badge: {
    background: '#DC2626', color: '#fff', borderRadius: 20,
    padding: '1px 7px', fontSize: 11, fontWeight: 700,
  },
  logoutBtn: {
    margin: 'auto 12px 0', padding: '9px 16px',
    background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
    fontSize: 12, cursor: 'pointer',
  },
  main: { flex: 1, padding: '32px 40px', overflowX: 'auto' as const },
  sectionTitle: { fontSize: 20, fontWeight: 800, color: DARK, margin: '0 0 20px' },
  feedback: {
    background: '#D1FAE5', border: '1px solid #6EE7B7', color: '#065F46',
    borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600, marginBottom: 20,
  },
  empty: {
    background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#065F46',
    borderRadius: 12, padding: '20px', fontSize: 14, textAlign: 'center' as const,
  },
  card: {
    background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB',
    padding: '18px 22px', marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
  },
  cardRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const },
  cardName: { fontWeight: 700, fontSize: 15, color: '#111', marginBottom: 4 },
  cardMeta: { fontSize: 13, color: '#6B7280', marginBottom: 2 },
  approveBtn: {
    padding: '9px 18px', background: '#065F46', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  rejectBtn: {
    padding: '9px 18px', background: '#FEF2F2', color: '#991B1B',
    border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13, minWidth: 800 },
  th: { background: DARK, color: '#fff', padding: '9px 14px', textAlign: 'left' as const, fontSize: 11, fontWeight: 700 },
  td: { padding: '10px 14px', borderBottom: '1px solid #F3F4F6', verticalAlign: 'middle' as const },
  pill: { background: '#EFF6FF', color: '#1E40AF', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 },
  editInput: {
    padding: '5px 8px', borderRadius: 6, border: '1.5px solid #CBD5E1',
    fontSize: 12, width: '100%', boxSizing: 'border-box' as const,
  },
  editBtn: {
    padding: '5px 12px', background: '#EFF6FF', color: '#1E40AF',
    border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },
  saveBtn: {
    padding: '5px 10px', background: '#065F46', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },
  cancelBtn: {
    padding: '5px 10px', background: '#F3F4F6', color: '#374151',
    border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },
  rateInput: {
    border: '1.5px solid #E5E7EB', borderRadius: 8, padding: '8px 12px',
    fontSize: 16, fontWeight: 700, width: 130, textAlign: 'right' as const,
  },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
  select: {
    width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #E5E7EB',
    fontSize: 14, background: '#FAFAFA', cursor: 'pointer',
  },
  exportBtn: {
    padding: '12px 24px', background: BLUE, color: '#fff', border: 'none',
    borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
}
