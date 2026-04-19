// app/login/page.tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const supabase = createClient()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Correo o contraseña incorrectos')
      setLoading(false)
      return
    }

    // Verificar estado del perfil
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles').select('status, role').eq('id', user.id).single()

      if (profile?.status === 'pending') {
        await supabase.auth.signOut()
        setError('Tu cuenta está pendiente de aprobación. Te avisaremos por correo.')
        setLoading(false)
        return
      }
      if (profile?.status === 'rejected') {
        await supabase.auth.signOut()
        setError('Tu solicitud fue rechazada. Contacta al administrador.')
        setLoading(false)
        return
      }

      router.push(profile?.role === 'admin' ? '/admin' : '/dashboard')
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        {/* Header */}
        <div style={S.header}>
          <img src="/logo.png" alt="Speech Psychology" style={S.logo} />
          <h1 style={S.title}>Speech Psychology SpA</h1>
          <p style={S.subtitle}>Sistema de Marcaje · Lo Barnechea 2026</p>
        </div>

        <form onSubmit={handleLogin} style={S.form}>
          <div style={S.field}>
            <label style={S.label}>Correo electrónico</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="tu@correo.com" required style={S.input} autoComplete="email"
            />
          </div>
          <div style={S.field}>
            <label style={S.label}>Contraseña</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required style={S.input} autoComplete="current-password"
            />
          </div>

          {error && <div style={S.error}>{error}</div>}

          <button type="submit" disabled={loading} style={{
            ...S.btn, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer'
          }}>
            {loading ? 'Ingresando...' : 'Iniciar sesión'}
          </button>

          <p style={S.registerLink}>
            ¿Primera vez?{' '}
            <a href="/registro" style={S.link}>Solicitar acceso aquí</a>
          </p>
        </form>
      </div>
      <p style={S.footer}>© 2026 Speech Psychology SpA · RUT 78.254.509-4</p>
    </div>
  )
}

const DARK = '#0D2B5E', BLUE = '#1A4A9A'
const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
    background: `linear-gradient(135deg, ${DARK} 0%, ${BLUE} 60%, #3A7CC1 100%)`,
  },
  card: {
    background: '#fff', borderRadius: 24, width: '100%', maxWidth: 400,
    overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.3)',
  },
  header: {
    background: `linear-gradient(135deg, ${DARK}, ${BLUE})`,
    padding: '36px 32px 28px', textAlign: 'center',
  },
  logo: { width: 64, height: 72, objectFit: 'contain', marginBottom: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 4px' },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: 0 },
  form: { padding: '28px 28px 32px' },
  field: { marginBottom: 18 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
  input: {
    width: '100%', padding: '11px 14px', borderRadius: 10,
    border: '1.5px solid #E5E7EB', fontSize: 14, background: '#FAFAFA', color: '#111',
  },
  error: {
    background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B',
    borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16,
  },
  btn: {
    width: '100%', padding: '13px', border: 'none', borderRadius: 12,
    background: `linear-gradient(135deg, ${DARK}, ${BLUE})`,
    color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: 0.3,
    transition: 'opacity 0.2s',
  },
  registerLink: { textAlign: 'center', marginTop: 16, fontSize: 13, color: '#6B7280' },
  link: { color: BLUE, fontWeight: 700 },
  footer: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 24 },
}
