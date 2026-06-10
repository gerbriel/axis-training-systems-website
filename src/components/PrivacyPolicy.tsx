type Props = { onClose: () => void }

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: '2.5rem' }}>
    <h3 style={{ color: '#fff', fontWeight: 800, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '1rem', borderBottom: '1px solid #1a1a1a', paddingBottom: '.75rem' }}>
      {title}
    </h3>
    <div style={{ color: '#666', fontSize: '.875rem', lineHeight: 1.8 }}>
      {children}
    </div>
  </div>
)

const Li = ({ children }: { children: React.ReactNode }) => (
  <li style={{ marginBottom: '.4rem', paddingLeft: '1rem', position: 'relative' }}>
    <span style={{ position: 'absolute', left: 0, color: '#e63e3e' }}>·</span>
    {children}
  </li>
)

export default function PrivacyPolicy({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', padding: '2rem 1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative w-full max-w-3xl"
        style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '.25rem', padding: '3rem 2.5rem' }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close privacy policy"
          className="absolute top-5 right-5 text-white"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '.25rem' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* Header */}
        <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1rem' }}>Legal</p>
        <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(1.5rem,4vw,2.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '.75rem' }}>Privacy Policy</h2>
        <p style={{ color: '#444', fontSize: '.8rem', marginBottom: '2.5rem' }}>
          Effective Date: June 10, 2026 &nbsp;·&nbsp; Last Updated: June 10, 2026
        </p>

        <Section title="1. Who We Are">
          <p>Axis Training Systems ("Axis," "we," "us," or "our") is a powerlifting coaching business based in California. We can be reached at:</p>
          <p style={{ marginTop: '.75rem', color: '#888' }}>
            Email: <a href="mailto:coach@axistrainingsystems.com" style={{ color: '#e63e3e' }}>coach@axistrainingsystems.com</a><br />
            Instagram: <a href="https://www.instagram.com/axistrainingsystems/" target="_blank" rel="noopener" style={{ color: '#e63e3e' }}>@axistrainingsystems</a>
          </p>
        </Section>

        <Section title="2. Information We Collect">
          <p style={{ marginBottom: '.75rem' }}>When you submit a coaching application, we collect the following personal information:</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <Li>Identifiers: first name, last name, email address, Instagram/Facebook handle</Li>
            <Li>Physical characteristics: age, height, body weight, weight class</Li>
            <Li>Training data: current maxes, weekly frequencies, competition style, program history</Li>
            <Li>Health-related information: injuries, sleep, recovery, nutrition habits, stress levels</Li>
            <Li>Professional/occupational information: employment type and schedule</Li>
            <Li>Goals and expectations: coaching goals, weak points, areas for improvement</Li>
          </ul>
          <p style={{ marginTop: '.75rem' }}>We do not collect payment information directly. Billing is handled by Zen Planner under their own privacy policy.</p>
        </Section>

        <Section title="3. How We Use Your Information">
          <p style={{ marginBottom: '.75rem' }}>We use the information collected solely to:</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <Li>Evaluate coaching applications and match athletes with coaches</Li>
            <Li>Deliver personalized training programs and coaching services</Li>
            <Li>Communicate with you via WhatsApp and email regarding your program</Li>
            <Li>Improve our coaching methodology and service quality</Li>
          </ul>
          <p style={{ marginTop: '.75rem' }}>We do not use your information for automated decision-making or profiling beyond the direct coaching relationship.</p>
        </Section>

        <Section title="4. How We Share Your Information">
          <p style={{ marginBottom: '.75rem' }}>We do not sell, rent, or trade your personal information. We share data only with:</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <Li><strong style={{ color: '#aaa' }}>Formspree</strong> — processes application form submissions on our behalf (formspree.io). Subject to their privacy policy.</Li>
            <Li><strong style={{ color: '#aaa' }}>Zen Planner</strong> — used for billing and client management. Subject to their privacy policy.</Li>
            <Li><strong style={{ color: '#aaa' }}>Assigned Coach</strong> — your application data is shared with your assigned Axis coach to deliver services.</Li>
          </ul>
          <p style={{ marginTop: '.75rem' }}>All third parties are required to handle your data securely and only for the purposes described above.</p>
        </Section>

        <Section title="5. California Privacy Rights (CCPA / CPRA)">
          <p style={{ marginBottom: '.75rem' }}>
            As a California resident, you have the following rights under the California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA):
          </p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <Li><strong style={{ color: '#aaa' }}>Right to Know</strong> — You may request disclosure of the categories and specific pieces of personal information we have collected about you.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Delete</strong> — You may request deletion of personal information we have collected, subject to certain exceptions.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Correct</strong> — You may request correction of inaccurate personal information we maintain about you.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Opt-Out of Sale</strong> — We do not sell your personal information. No opt-out is required.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Non-Discrimination</strong> — We will not discriminate against you for exercising any of your privacy rights.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Limit Use of Sensitive Information</strong> — We only use sensitive personal information (health data, etc.) to provide the coaching services you requested.</Li>
          </ul>
          <p style={{ marginTop: '.75rem' }}>
            To exercise any of these rights, contact us at{' '}
            <a href="mailto:coach@axistrainingsystems.com" style={{ color: '#e63e3e' }}>coach@axistrainingsystems.com</a>.
            We will respond within 45 days as required by law.
          </p>
        </Section>

        <Section title="6. Data Retention">
          <p>We retain your application data for the duration of the coaching relationship plus 12 months. If your application is not accepted, data is deleted within 90 days. You may request earlier deletion at any time.</p>
        </Section>

        <Section title="7. Security">
          <p>We take reasonable measures to protect your personal information. Application data is transmitted securely via HTTPS. Communication occurs through WhatsApp, which provides end-to-end encryption. However, no method of transmission over the internet is 100% secure.</p>
        </Section>

        <Section title="8. Children's Privacy">
          <p>Our services are not directed to individuals under the age of 18. We do not knowingly collect personal information from minors. If you believe we have inadvertently collected such information, please contact us immediately.</p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>We may update this Privacy Policy periodically. The "Last Updated" date at the top of this page reflects the most recent revision. Continued use of our services after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="10. Contact Us">
          <p>
            For privacy-related questions, requests, or complaints, contact:<br />
            <a href="mailto:coach@axistrainingsystems.com" style={{ color: '#e63e3e' }}>coach@axistrainingsystems.com</a>
          </p>
        </Section>

        <button
          onClick={onClose}
          className="w-full text-white text-xs font-black py-4 rounded tracking-widest uppercase mt-2"
          style={{ background: '#e63e3e', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#c42e2e')}
          onMouseLeave={e => (e.currentTarget.style.background = '#e63e3e')}
        >
          Close
        </button>
      </div>
    </div>
  )
}
