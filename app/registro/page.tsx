// app/registro/page.tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'

type Cargo = 'tens' | 'enfermera' | 'otro'

function formatRut(v: string) {
  const c = v.replace(/[^0-9kK]/g, '').toUpperCase()
  if (c.length < 2) return c
  return `${c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${c.slice(-1)}`
}

export default function RegistroPage() {
  const supabase = createClient()
  const [form, setForm] = useState({
    full_name: '', rut: '', sis_registro: '',
    email: '', password: '', confirm: '', cargo: 'tens' as Cargo,
  })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: k === 'rut' ? formatRut(v) : v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.full_name.trim().split(' ').length < 2) return setError('Ingresa nombre y apellido completos')
    if (!form.rut.includes('-')) return setError('RUT inválido, ej: 12.345.678-9')
    if (!form.sis_registro.trim()) return setError('El registro SIS es requerido')
    if (form.password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres')
    if (form.password !== form.confirm) return setError('Las contraseñas no coinciden')

    setLoading(true); setError(null)
    try {
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email, password: form.password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (authErr) throw new Error(authErr.message)
      if (!authData.user) throw new Error('No se pudo crear el usuario')

      const { error: profErr } = await supabase.from('profiles').insert({
        id: authData.user.id,
        full_name: form.full_name.trim(),
        rut: form.rut, sis_registro: form.sis_registro.trim(),
        email: form.email.toLowerCase(), cargo: form.cargo,
        role: 'professional', status: 'pending',
      })
      if (profErr) throw new Error(profErr.message)
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || 'Error al registrar. Intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  if (success) return (
    <div style={S.page}>
      <div style={S.successCard}>
        <div style={S.checkIcon}>✓</div>
        <h2 style={S.successTitle}>¡Solicitud enviada!</h2>
        <p style={S.successText}>
          Tu registro está <strong>pendiente de aprobación</strong>.<br />
          Recibirás un correo a <strong>{form.email}</strong> cuando tu cuenta sea activada.
        </p>
        <p style={{ fontSize: 13, color: '#6B7280', marginTop: 8 }}>Tiempo estimado: 24–48 horas hábiles.</p>
        <a href="/login" style={S.backBtn}>Volver al inicio</a>
      </div>
    </div>
  )

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.cardHeader}>
          <img src="/logo.png" alt="Logo" style={{ width: 48, height: 54, objectFit: 'contain' }} />
          <div>
            <h1 style={S.cardTitle}>Solicitud de acceso</h1>
            <p style={S.cardSubtitle}>Proceso Vacunatorio Lo Barnechea 2026</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={S.form}>
          <F label="Nombre completo" required>
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
              placeholder="Ej: María González Rojas" style={S.input} />
          </F>

          <div style={S.row}>
            <F label="RUT" required style={{ flex: 1 }}>
              <input value={form.rut} onChange={e => set('rut', e.target.value)}
                placeholder="12.345.678-9" style={S.input} maxLength={12} />
            </F>
            <F label="Registro SIS" required style={{ flex: 1 }}>
              <input value={form.sis_registro} onChange={e => set('sis_registro', e.target.value)}
                placeholder="N° SIS" style={S.input} />
            </F>
          </div>

          <F label="Cargo" required>
            <select value={form.cargo} onChange={e => set('cargo', e.target.value)} style={S.input}>
              <option value="tens">Técnico en Enfermería (TENS)</option>
              <option value="enfermera">Enfermera/o</option>
              <option value="otro">Otro</option>
            </select>
          </F>

          <F label="Correo electrónico" required>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
              placeholder="tu@correo.com" style={S.input} />
          </F>

          <div style={S.row}>
            <F label="Contraseña" required style={{ flex: 1 }}>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                placeholder="Mín. 8 caracteres" style={S.input} />
            </F>
            <F label="Confirmar contraseña" required style={{ flex: 1 }}>
              <input type="password" value={form.confirm} onChange={e => set('confirm', e.target.value)}
                placeholder="Repite la contraseña" style={S.input} />
            </F>
          </div>

          {error && <div style={S.errorBox}>{error}</div>}

          <div style={S.infoBox}>
            <strong>ℹ</strong>&nbsp; Tu cuenta quedará pendiente hasta que el administrador la apruebe.
            Recibirás un correo de confirmación.
          </div>

          <button type="submit" disabled={loading} style={{
            ...S.btn, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer'
          }}>
            {loading ? 'Enviando...' : 'Enviar solicitud de registro'}
          </button>

          <p style={{ textAlign: 'center', marginTop: 14, fontSize: 13, color: '#6B7280' }}>
            ¿Ya tienes cuenta? <a href="/login" style={{ color: '#1A4A9A', fontWeight: 700 }}>Iniciar sesión</a>
          </p>
        </form>
      </div>
      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 20 }}>
        © 2026 Speech Psychology SpA · RUT 78.254.509-4
      </p>
    </div>
  )
}

function F({ label, required, children, style }: {
  label: string; required?: boolean; children: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
        {label}{required && <span style={{ color: '#E8593C' }}> *</span>}
      </label>
      {children}
    </div>
  )
}

const DARK = '#0D2B5E', BLUE = '#1A4A9A'
const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '32px 16px 48px',
    background: `linear-gradient(135deg, ${DARK} 0%, ${BLUE} 60%, #3A7CC1 100%)`,
  },
  card: {
    background: '#fff', borderRadius: 24, width: '100%', maxWidth: 520,
    overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.3)',
  },
  cardHeader: {
    background: `linear-gradient(135deg, ${DARK}, ${BLUE})`,
    padding: '28px 32px', display: 'flex', alignItems: 'center', gap: 14,
  },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: 700, margin: '0 0 4px' },
  cardSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: 0 },
  form: { padding: '28px 32px 32px' },
  row: { display: 'flex', gap: 12 },
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '1.5px solid #E5E7EB', fontSize: 14, background: '#FAFAFA', color: '#111',
    boxSizing: 'border-box' as const,
  },
  errorBox: {
    background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B',
    borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14,
  },
  infoBox: {
    background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF',
    borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 18,
  },
  btn: {
    width: '100%', padding: '13px', border: 'none', borderRadius: 12,
    background: `linear-gradient(135deg, ${DARK}, ${BLUE})`,
    color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: 0.3,
  },
  successCard: {
    background: '#fff', borderRadius: 24, padding: '48px 40px',
    maxWidth: 420, textAlign: 'center', boxShadow: '0 32px 80px rgba(0,0,0,0.3)',
  },
  checkIcon: {
    width: 64, height: 64, background: '#D1FAE5', color: '#065F46',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 28, fontWeight: 700, margin: '0 auto 20px',
  },
  successTitle: { color: '#065F46', fontSize: 22, fontWeight: 700, marginBottom: 12 },
  successText: { color: '#374151', fontSize: 14, lineHeight: 1.7 },
  backBtn: {
    display: 'inline-block', marginTop: 24, padding: '10px 24px',
    background: `linear-gradient(135deg, ${DARK}, ${BLUE})`,
    color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 700,
  },
}
