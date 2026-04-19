// app/pendiente/page.tsx
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'

export default async function PendientePage() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('full_name, email, status').eq('id', user.id).single()
  if (profile?.status === 'approved') redirect('/dashboard')

  const isRejected = profile?.status === 'rejected'

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px',
      background: 'linear-gradient(135deg, #0D2B5E 0%, #1A4A9A 60%, #3A7CC1 100%)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, padding: '48px 40px',
        maxWidth: 440, textAlign: 'center', boxShadow: '0 32px 80px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
          background: isRejected ? '#FEF2F2' : '#FEF3C7',
        }}>
          {isRejected ? '✗' : '⏳'}
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0D2B5E', margin: '0 0 12px' }}>
          {isRejected ? 'Solicitud rechazada' : 'Cuenta pendiente de aprobación'}
        </h2>
        <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 8 }}>
          {isRejected
            ? 'Tu solicitud de acceso fue rechazada. Para más información contacta al administrador.'
            : `Hola ${profile?.full_name?.split(' ')[0] || ''}. Tu solicitud está siendo revisada. Recibirás un correo en ${profile?.email} cuando tu cuenta sea activada.`
          }
        </p>
        {!isRejected && (
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Tiempo estimado: 24–48 horas hábiles.</p>
        )}
        <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
          <a href="/login" style={{
            display: 'inline-block', padding: '10px 28px',
            background: 'linear-gradient(135deg, #0D2B5E, #1A4A9A)',
            color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 700,
          }}>Volver al inicio</a>
        </form>
      </div>
    </div>
  )
}
