import { useState, useEffect } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Philosophy from './components/Philosophy'
import Services from './components/Services'
import HowItWorks from './components/HowItWorks'
import Coaches from './components/Coaches'
import InstagramFeed from './components/InstagramFeed'
import Apply from './components/Apply'
import Footer from './components/Footer'
import PrivacyPolicy from './components/PrivacyPolicy'
import AdminPortal from './pages/AdminPortal'

export default function App() {
  const isAdmin = window.location.pathname.includes('/admin')
  if (isAdmin) return <AdminPortal />

  const [showPrivacy, setShowPrivacy] = useState(false)

  useEffect(() => {
    const handler = () => setShowPrivacy(true)
    window.addEventListener('open-privacy', handler)
    return () => window.removeEventListener('open-privacy', handler)
  }, [])

  return (
    <div style={{ background: '#080808', minHeight: '100vh' }}>
      <Navbar />
      <Hero />
      <Philosophy />
      <Services />
      <HowItWorks />
      <Coaches />
      <InstagramFeed />
      <Apply />
      <Footer />
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
    </div>
  )
}
