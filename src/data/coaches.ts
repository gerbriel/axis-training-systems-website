export type CoachSlug = 'ronnie-vallejo' | 'seth-burman' | 'lucas-sison' | 'kobe-pham' | 'aedan-nguyen'

export interface CoachTestimonial {
  quote: string
  athlete: string
  result: string
}

export interface CoachService {
  name: string
  price: string
  description: string
}

export interface Coach {
  slug: CoachSlug
  name: string
  firstName: string
  email: string         // used for Supabase auth + routing
  role: string          // short title
  tagline: string       // one-line philosophy
  bio: string[]         // paragraphs
  coachingPhilosophy: string  // pull-quote
  specialties: string[]
  services: CoachService[]
  stats: { label: string; value: string }[]
  testimonials: CoachTestimonial[]
}

export const COACHES: Coach[] = [
  {
    slug: 'ronnie-vallejo',
    name: 'Ronnie Vallejo',
    firstName: 'Ronnie',
    email: 'ronnie@axistrainingsystems.com',
    role: 'Head Coach & Founder',
    tagline: 'Strength built on intention, not ego.',
    bio: [
      'Ronnie Vallejo is the founder of Axis Training Systems and the architect of its coaching philosophy. A competitive powerlifter with over a decade in the sport, he has competed across multiple federations and coached athletes from their first meet all the way to national-level competition.',
      'His approach is grounded in evidence-based programming and honest communication. He believes every athlete deserves a plan that fits their life — not the other way around — and that transparency is the foundation of any great coaching relationship.',
      'Outside the platform, Ronnie is a student of sport science and continues to refine his methods through ongoing research, mentorship, and competition.',
    ],
    coachingPhilosophy: 'The best program is the one you can actually follow. Build the habit, build the lifter.',
    specialties: ['Full meet prep', 'Attempt selection strategy', 'Long-term strength development', 'Technique diagnosis'],
    services: [
      { name: '1:1 Coaching (Full Service)', price: '$180/mo', description: 'Weekly programming, daily check-ins via WhatsApp, video review, full meet prep, and attempt selection.' },
      { name: 'Meet Day Coaching', price: 'Contact for pricing', description: 'In-person or remote coaching on competition day — warm-up timing, attempt strategy, real-time feedback.' },
    ],
    stats: [
      { label: 'Years Competing', value: '10+' },
      { label: 'Athletes Coached', value: '50+' },
      { label: 'Squat PR', value: '600 lbs' },
      { label: 'Bench PR', value: '385 lbs' },
      { label: 'Deadlift PR', value: '650 lbs' },
      { label: 'Meets Attended', value: '20+' },
    ],
    testimonials: [
      { quote: 'Ronnie completely rebuilt my squat in 12 weeks. I hit a 30lb PR on my total at my next meet and finally understood what I was doing wrong mechanically.', athlete: 'Marcus R.', result: '+30 lb total, USAPL SoCal 2025' },
      { quote: 'The programming is the smartest I\'ve ever run. Not just "hard work" — intentional work. Every set has a reason.', athlete: 'Devon K.', result: 'First 600lb squat, 93kg class' },
      { quote: 'He told me things my previous coach never did. Blunt, honest, and exactly what I needed.', athlete: 'Priya M.', result: '4/4 National qualifier, 63kg' },
    ],
  },
  {
    slug: 'seth-burman',
    name: 'Seth Burman',
    firstName: 'Seth',
    email: 'seth@axistrainingsystems.com',
    role: 'Senior Coach',
    tagline: 'Competitive fire, methodical preparation.',
    bio: [
      'Seth Burman is a seasoned competitive powerlifter and one of the most technically precise coaches at Axis. He specializes in meet prep and in-person competition day coaching, having guided dozens of athletes through their first and subsequent meets.',
      'Seth\'s background includes years of competing in the USPA and USAPL, where he developed a deep understanding of attempt selection, federation rules, and the mental side of competition. He translates that experience directly into his athletes\' preparation.',
      'His coaching style is disciplined but personable — he pushes athletes to rise to the occasion while keeping them calm under pressure.',
    ],
    coachingPhilosophy: 'A great meet performance is won in the prep, not on the platform. Prepare obsessively, compete confidently.',
    specialties: ['Meet day logistics', 'Attempt strategy', 'Peaking and tapering', 'Federation rules and equipment'],
    services: [
      { name: '1:1 Coaching (Full Service)', price: '$175/mo', description: 'Weekly programming, WhatsApp coaching, video review, and full meet prep support.' },
      { name: 'Meet Day Coaching', price: 'Contact for pricing', description: 'On-site or remote presence at your competition — full warm-up protocol, attempt calls, handler duties.' },
    ],
    stats: [
      { label: 'Years Competing', value: '8' },
      { label: 'Athletes Coached', value: '40+' },
      { label: 'Squat PR', value: '545 lbs' },
      { label: 'Bench PR', value: '350 lbs' },
      { label: 'Deadlift PR', value: '600 lbs' },
      { label: 'Meets Attended', value: '15+' },
    ],
    testimonials: [
      { quote: 'Seth called every single attempt perfectly at my first meet. I went 8/9 and hit a 20lb PR on my total. Could not have done it without him in my corner.', athlete: 'Jordan T.', result: '8/9 at USPA debut, 83kg' },
      { quote: 'I was a nervous wreck before the meet. Seth kept me grounded and made sure my warm-ups were perfect. Best investment I\'ve made in this sport.', athlete: 'Camille B.', result: 'State record attempt, 69kg' },
      { quote: 'The peaking cycle he wrote got me to the meet feeling the best I ever have. Opener felt like a warm-up.', athlete: 'Tyler N.', result: '1,200lb total at 83kg' },
    ],
  },
  {
    slug: 'lucas-sison',
    name: 'Lucas Sison',
    firstName: 'Lucas',
    email: 'lucas@axistrainingsystems.com',
    role: 'Strength & Movement Coach',
    tagline: 'Fix the movement, free the strength.',
    bio: [
      'Lucas Sison brings a unique blend of movement science and powerlifting coaching to Axis Training Systems. With a background in sports performance and corrective movement, he bridges the gap between athletic health and maximal strength output.',
      'Lucas specializes in diagnosing and correcting technical inefficiencies that hold athletes back — whether that\'s a faulty hip hinge, inconsistent bar path, or a squat that falls apart under load. His athletes don\'t just get stronger; they move better.',
      'He works with intermediate to advanced lifters who want to optimize their technique and build a foundation that will support high-level numbers for years to come.',
    ],
    coachingPhilosophy: 'You can\'t maximize what you haven\'t optimized. Movement quality is the ceiling on your strength.',
    specialties: ['Technical analysis and correction', 'Movement efficiency', 'Injury resilience programming', 'Intermediate to advanced development'],
    services: [
      { name: '1:1 Coaching (Full Service)', price: '$170/mo', description: 'Weekly programming, WhatsApp coaching, detailed video analysis, and technical coaching focus.' },
      { name: 'Movement Coaching', price: 'Contact for pricing', description: 'Targeted analysis of your squat, bench, or deadlift with a corrective action plan — no long-term commitment required.' },
    ],
    stats: [
      { label: 'Years in Sport', value: '9' },
      { label: 'Athletes Coached', value: '35+' },
      { label: 'Squat PR', value: '525 lbs' },
      { label: 'Bench PR', value: '315 lbs' },
      { label: 'Deadlift PR', value: '575 lbs' },
      { label: 'Movement Assessments', value: '100+' },
    ],
    testimonials: [
      { quote: 'Lucas spotted a bar path issue in my bench on the first video review. Six weeks later I hit a 20lb bench PR with zero shoulder pain for the first time in years.', athlete: 'Dylan P.', result: '+20 lb bench, zero injury recurrence' },
      { quote: 'My deadlift always fell apart at the knee. Lucas broke it down, gave me three drills, and in two training cycles it was gone.', athlete: 'Anita W.', result: '+45 lb deadlift over 12 weeks' },
      { quote: 'The movement analysis was worth every penny. I finally understood my squat instead of just grinding through it.', athlete: 'Chris M.', result: 'Technique overhaul, 83kg class' },
    ],
  },
  {
    slug: 'kobe-pham',
    name: 'Kobe Pham',
    firstName: 'Kobe',
    email: 'kobe@axistrainingsystems.com',
    role: 'Performance Coach',
    tagline: 'Consistency compounds. Show up and do the work.',
    bio: [
      'Kobe Pham is a results-driven coach who excels at working with athletes who need structure, accountability, and a programming system that fits a demanding schedule. He has a particular talent for coaching athletes in physically demanding occupations — nurses, teachers, tradespeople — who need intelligent training, not just hard training.',
      'His programming philosophy centers on sustainability: building a body that can train hard for years, not weeks. He understands recovery, fatigue management, and how to get the most out of limited training time.',
      'Kobe is direct, detail-oriented, and deeply invested in his athletes\' progress. He believes no question is too small and that open communication is what separates good coaching from great coaching.',
    ],
    coachingPhilosophy: 'Smart athletes train for decades, not cycles. Every decision I make is with the long game in mind.',
    specialties: ['High-stress lifestyle adaptation', 'Fatigue management', 'Women\'s powerlifting', 'Beginner to intermediate development'],
    services: [
      { name: '1:1 Coaching (Full Service)', price: '$165/mo', description: 'Weekly programming, WhatsApp coaching, video review, and lifestyle-integrated training structure.' },
      { name: 'Movement Coaching', price: 'Contact for pricing', description: 'Targeted technique sessions for athletes who want focused coaching without a full program.' },
    ],
    stats: [
      { label: 'Years Coaching', value: '6' },
      { label: 'Athletes Coached', value: '45+' },
      { label: 'Squat PR', value: '480 lbs' },
      { label: 'Bench PR', value: '295 lbs' },
      { label: 'Deadlift PR', value: '530 lbs' },
      { label: 'Female Athletes', value: '60%' },
    ],
    testimonials: [
      { quote: 'I work 12-hour nursing shifts and Kobe built my training around my actual life. I made more progress in 4 months with him than in the previous year on my own.', athlete: 'Elena M.', result: '700+ total at 63kg, first meet' },
      { quote: 'He checked in every week without fail. Accountability is underrated and Kobe delivers it without being overbearing.', athlete: 'Sam H.', result: 'Consistent PR streak over 6 months' },
      { quote: 'As a woman new to powerlifting, I needed someone patient and technical. Kobe was both. I competed 5 months after starting with him.', athlete: 'Jasmine L.', result: 'First meet at 57kg, 9 months training' },
    ],
  },
  {
    slug: 'aedan-nguyen',
    name: 'Aedan Nguyen',
    firstName: 'Aedan',
    email: 'aedan@axistrainingsystems.com',
    role: 'Development Coach',
    tagline: 'Every elite athlete was once a beginner. Start right.',
    bio: [
      'Aedan Nguyen specializes in developing new and early-intermediate powerlifters into confident, technically sound competitors. He is passionate about the learning curve of the sport and believes the first year of powerlifting training is the most important — and the most often mishandled.',
      'His approach is educational as much as it is physical: athletes leave each training block with a deeper understanding of their own movement, their programming rationale, and their place in the sport.',
      'Aedan competes actively himself, which keeps his coaching grounded in current competitive standards and real-world application.',
    ],
    coachingPhilosophy: 'Teach the athlete, not just the movement. An athlete who understands their training will always outperform one who just follows it.',
    specialties: ['New lifter development', 'Technique fundamentals', 'First meet preparation', 'Educational coaching approach'],
    services: [
      { name: '1:1 Coaching (Full Service)', price: '$165/mo', description: 'Weekly programming, WhatsApp coaching, video review, and heavy emphasis on educational development.' },
      { name: 'Meet Day Coaching', price: 'Contact for pricing', description: 'Competition day support for newer athletes who want an experienced voice in their corner.' },
    ],
    stats: [
      { label: 'Years Competing', value: '5' },
      { label: 'New Lifters Coached', value: '30+' },
      { label: 'Squat PR', value: '445 lbs' },
      { label: 'Bench PR', value: '275 lbs' },
      { label: 'Deadlift PR', value: '500 lbs' },
      { label: 'First-Meet Athletes', value: '25+' },
    ],
    testimonials: [
      { quote: 'I came to Aedan knowing nothing about powerlifting. He didn\'t just give me a program — he taught me how to train. I competed at 9 months and went 7/9.', athlete: 'Aaliyah J.', result: '7/9 at USPA debut, 69kg' },
      { quote: 'He explains the why behind everything. I finally feel like I know what I\'m doing instead of just guessing.', athlete: 'Noah C.', result: 'From zero to 900lb total in 14 months' },
      { quote: 'The most patient and thoughtful coach I\'ve had. He met me exactly where I was and helped me build from there.', athlete: 'Hana S.', result: 'PR total on debut, 52kg class' },
    ],
  },
]

export const COACH_BY_SLUG: Record<CoachSlug, Coach> = Object.fromEntries(
  COACHES.map(c => [c.slug, c])
) as Record<CoachSlug, Coach>

export function getCoachBySlug(slug: string): Coach | undefined {
  return COACHES.find(c => c.slug === slug)
}

export function getCoachByName(name: string): Coach | undefined {
  return COACHES.find(c => c.name === name)
}
