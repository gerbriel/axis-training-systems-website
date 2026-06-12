type Props = { onClose: () => void }

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: '2.5rem' }}>
    <h3 style={{ color: '#fff', fontWeight: 800, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '1rem', borderBottom: '1px solid #1c3a63', paddingBottom: '.75rem' }}>
      {title}
    </h3>
    <div style={{ color: '#666', fontSize: '.875rem', lineHeight: 1.8 }}>
      {children}
    </div>
  </div>
)

const Li = ({ children }: { children: React.ReactNode }) => (
  <li style={{ marginBottom: '.4rem', paddingLeft: '1rem', position: 'relative' }}>
    <span style={{ position: 'absolute', left: 0, color: '#f5b935' }}>·</span>
    {children}
  </li>
)

export default function PrivacyPolicy({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ background: 'rgba(10,26,51,0.90)', backdropFilter: 'blur(4px)', padding: '2rem 1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative w-full max-w-3xl"
        style={{ background: '#0a1a33', border: '1px solid #1c3a63', borderRadius: '.25rem', padding: '3rem 2.5rem' }}
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
        <p style={{ color: '#f5b935', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1rem' }}>Legal</p>
        <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(1.5rem,4vw,2.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '.75rem' }}>Privacy Policy</h2>
        <p style={{ color: '#444', fontSize: '.8rem', marginBottom: '2.5rem' }}>
          Effective Date: June 10, 2026 &nbsp;·&nbsp; Last Updated: June 10, 2026
        </p>

        <Section title="1. Who We Are">
          <p>Axis Training Systems ("Axis," "we," "us," or "our") is a powerlifting coaching business based in California. We can be reached at:</p>
          <p style={{ marginTop: '.75rem', color: '#888' }}>
            Email: <a href="mailto:coach@axistrainingsystems.com" style={{ color: '#f5b935' }}>coach@axistrainingsystems.com</a><br />
            Instagram: <a href="https://www.instagram.com/axistrainingsystems/" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>@axistrainingsystems</a>
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
          <p style={{ marginTop: '.75rem' }}>Third-party advertising and analytics tools we use (see Section 4 below) may set cookies or collect browsing data such as IP addresses and page-visit events when you visit this website. Axis Training Systems does not directly store this data — it is collected and processed by the respective platforms under their own privacy policies.</p>
        </Section>

        <Section title="3. How We Use Your Information">
          <p style={{ marginBottom: '.75rem' }}>We use the information collected solely to:</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <Li>Evaluate coaching applications and match athletes with coaches</Li>
            <Li>Deliver personalized training programs and coaching services</Li>
            <Li>Communicate with you via WhatsApp and email regarding your program</Li>
            <Li>Improve our coaching methodology and service quality</Li>
          </ul>
          <p style={{ marginTop: '.75rem' }}>We do not use your information for automated decision-making or profiling beyond the direct coaching relationship. Website visitor data collected via tracking technologies described in Section 4 may be used to show Axis Training Systems advertisements to people who have previously visited this site (retargeting) on platforms such as Meta (Facebook/Instagram) and Google.</p>
        </Section>

        <Section title="4. Tracking Technologies, Advertising & Analytics">
          <p style={{ marginBottom: '.75rem' }}>
            Axis Training Systems uses industry-standard advertising and tracking technologies to measure the performance of our marketing campaigns and to show relevant ads to people who have previously visited this website. These technologies include:
          </p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <Li><strong style={{ color: '#aaa' }}>Meta Pixel (Facebook/Instagram Pixel)</strong> — We use the Meta Pixel to track website events (page views, form submissions) and to build custom audiences for retargeting ads on Facebook and Instagram. Meta may use this data in accordance with its{' '}<a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>Data Policy</a>.</Li>
            <Li><strong style={{ color: '#aaa' }}>Google Ads & Google Analytics</strong> — We use Google Ads conversion tracking and remarketing tags (via Google Tag Manager) to measure ad performance and serve retargeting ads across Google Search, YouTube, and the Google Display Network. Governed by{' '}<a href="https://policies.google.com/privacy" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>Google's Privacy Policy</a>.</Li>
            <Li><strong style={{ color: '#aaa' }}>Retargeting & Custom Audiences</strong> — Using data collected by the above pixels, we may build custom audiences (people who visited this site) and lookalike audiences to run paid ad campaigns on Meta and Google platforms. If you visited this website, you may see Axis Training Systems ads on those platforms.</Li>
            <Li><strong style={{ color: '#aaa' }}>Cookies for advertising</strong> — Third-party advertising platforms (Meta, Google) set first-party and third-party cookies on your browser to identify your visit, attribute conversions, and enable retargeting. These cookies persist across browsing sessions as governed by each platform's cookie policies.</Li>
            <Li><strong style={{ color: '#aaa' }}>Session recording & heatmaps</strong> — We do not currently use session-recording tools such as Hotjar, FullStory, or Microsoft Clarity.</Li>
            <Li><strong style={{ color: '#aaa' }}>Email marketing tracking</strong> — We do not currently use marketing automation platforms that track email open rates or click behaviour.</Li>
          </ul>
          <p style={{ marginTop: '.75rem' }}>
            <strong style={{ color: '#fff' }}>Opt out of ad targeting:</strong> You can limit ad tracking through your device settings, your browser's cookie controls, or directly via platform opt-outs:{' '}
            <a href="https://www.facebook.com/settings/?tab=ads" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>Meta Ad Preferences</a>
            {' · '}
            <a href="https://adssettings.google.com/" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>Google Ad Settings</a>
            {' · '}
            <a href="https://optout.aboutads.info/" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>DAA Opt-Out</a>
          </p>
          <p style={{ marginTop: '.75rem' }}>
            This website is hosted on GitHub Pages. GitHub may collect limited server-level data (such as IP addresses) as part of their standard infrastructure operations. Governed by{' '}
            <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>GitHub's Privacy Statement</a>.
          </p>
          <p style={{ marginTop: '.75rem' }}>
            Our social media profiles (Instagram, YouTube) are operated by their respective platforms, which may collect data according to their own policies when you visit or interact with those pages.
          </p>
        </Section>

        <Section title="5. How We Share Your Information">
          <p style={{ marginBottom: '.75rem' }}>We do not sell or rent your personal information. We share data with the following categories of third parties:</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <Li><strong style={{ color: '#aaa' }}>Meta Platforms, Inc.</strong> — website visitor event data is shared with Meta via the Meta Pixel for ad measurement and retargeting. Subject to{' '}<a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>Meta's Data Policy</a>.</Li>
            <Li><strong style={{ color: '#aaa' }}>Google LLC</strong> — website visitor event data is shared with Google via Google Ads tags for conversion tracking and remarketing. Subject to{' '}<a href="https://policies.google.com/privacy" target="_blank" rel="noopener" style={{ color: '#f5b935' }}>Google's Privacy Policy</a>.</Li>
            <Li><strong style={{ color: '#aaa' }}>Formspree</strong> — processes application form submissions on our behalf (formspree.io). Subject to their privacy policy.</Li>
            <Li><strong style={{ color: '#aaa' }}>Zen Planner</strong> — used for billing and client management. Subject to their privacy policy.</Li>
            <Li><strong style={{ color: '#aaa' }}>Assigned Coach</strong> — your application data is shared with your assigned Axis coach to deliver services.</Li>
          </ul>
          <p style={{ marginTop: '.75rem' }}>We do not share your personal information (name, email, application data) with ad platforms. Only anonymized or hashed website event data is shared for advertising purposes. All third parties are required to handle your data securely and only for the purposes described.</p>
        </Section>

        <Section title="6. California Privacy Rights (CCPA / CPRA)">
          <p style={{ marginBottom: '.75rem' }}>
            As a California resident, you have the following rights under the California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA):
          </p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <Li><strong style={{ color: '#aaa' }}>Right to Know</strong> — You may request disclosure of the categories and specific pieces of personal information we have collected about you.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Delete</strong> — You may request deletion of personal information we have collected, subject to certain exceptions.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Correct</strong> — You may request correction of inaccurate personal information we maintain about you.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Opt-Out of Sale / Sharing</strong> — We do not sell your personal information. We do share anonymized website visitor data with Meta and Google for cross-context behavioral advertising (retargeting). California residents have the right to opt out of this sharing. To exercise this right, contact us at <a href="mailto:coach@axistrainingsystems.com" style={{ color: '#f5b935' }}>coach@axistrainingsystems.com</a> or use the platform opt-out links in Section 4.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Non-Discrimination</strong> — We will not discriminate against you for exercising any of your privacy rights.</Li>
            <Li><strong style={{ color: '#aaa' }}>Right to Limit Use of Sensitive Information</strong> — We only use sensitive personal information (health data, etc.) to provide the coaching services you requested.</Li>
          </ul>
          <p style={{ marginTop: '.75rem' }}>
            To exercise any of these rights, contact us at{' '}
            <a href="mailto:coach@axistrainingsystems.com" style={{ color: '#f5b935' }}>coach@axistrainingsystems.com</a>.
            We will respond within 45 days as required by law.
          </p>
        </Section>

        <Section title="7. Data Retention">
          <p>We retain your application data for the duration of the coaching relationship plus 12 months. If your application is not accepted, data is deleted within 90 days. You may request earlier deletion at any time.</p>
        </Section>

        <Section title="8. Security">
          <p>We take reasonable measures to protect your personal information. Application data is transmitted securely via HTTPS. Communication occurs through WhatsApp, which provides end-to-end encryption. However, no method of transmission over the internet is 100% secure.</p>
        </Section>

        <Section title="9. Children's Privacy">
          <p>Our services are not directed to individuals under the age of 18. We do not knowingly collect personal information from minors. If you believe we have inadvertently collected such information, please contact us immediately.</p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>We may update this Privacy Policy periodically. The "Last Updated" date at the top of this page reflects the most recent revision. Continued use of our services after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="11. Contact Us">
          <p>
            For privacy-related questions, requests, or complaints, contact:<br />
            <a href="mailto:coach@axistrainingsystems.com" style={{ color: '#f5b935' }}>coach@axistrainingsystems.com</a>
          </p>
        </Section>

        <button
          onClick={onClose}
          className="w-full text-white text-xs font-black py-4 rounded tracking-widest uppercase mt-2"
          style={{ background: '#bfa162', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#9a7c3a')}
          onMouseLeave={e => (e.currentTarget.style.background = '#bfa162')}
        >
          Close
        </button>
      </div>
    </div>
  )
}
