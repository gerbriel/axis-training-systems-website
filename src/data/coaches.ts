export type CoachSlug = 'ronnie-vallejo' | 'seth-burman' | 'lucas-sison' | 'kobe-pham' | 'aedan-nguyen'

export interface CoachTestimonial {
  quote: string
  athlete: string
  result: string
  photo?: string
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
  photo?: string        // headshot URL
  ctaBg?: string        // CTA section background photo
  bookCallUrl?: string  // per-coach consultation booking link
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
    photo: 'https://static.wixstatic.com/media/e99af3_1947a325134d4dff956eb3a7a6436e0e~mv2.jpg/v1/fill/w_432,h_434,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/20240302_201048_edited_edited_edited.jpg',
    ctaBg: 'https://static.wixstatic.com/media/e99af3_78afea37a86d42b59c9a5885e5909905~mv2.jpg',
    bookCallUrl: 'https://calendly.com/ronnie-axistrainingsystems',
    role: 'Head Coach & Founder',
    tagline: 'Strength built on intention, not ego.',
    bio: [
      'Ronnie Vallejo is the founder of Axis Training Systems. He serves as Team USA Coach for Powerlifting America, Head Coach of Fresno State Powerlifting, and is an active Powerlifting America Referee — with a level of involvement in the sport that goes well beyond the gym.',
      'His coaching philosophy centers on building genuine coach-athlete relationships. He believes intrinsic motivation — the kind that comes from trust, transparency, and real investment in the athlete — is what drives every result worth earning.',
      'Axis was founded in 2021 on the belief that every athlete deserves the same standard of care, regardless of level, background, or personality type.',
    ],
    coachingPhilosophy: 'Coaching is more than crunching numbers and critiquing form. We establish strong coach-athlete bonds that give the athlete a sense of intrinsic motivation.',
    specialties: ['Full meet prep', 'Attempt selection strategy', 'Team USA & national-level coaching', 'Coach mentorship & development'],
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
      {
        quote: 'My total before I met him was about 600, it\'s now at 1040 in less than a year — Ronnie added 400+ lbs in 7 months. Not only is he a great coach, he\'s a great athlete, motivator, and he\'s created a family through what he does. He\'s led me to be 7th in the nation for my class.',
        athlete: 'Isaiah Salazar',
        result: '+400+ lbs total in 7 months · 7th in the nation',
        photo: 'https://static.wixstatic.com/media/e99af3_2b17679f70a445c1b3d3f497a6eed428~mv2.jpg',
      },
      {
        quote: 'I immensely appreciate the excellent communication, knowledgeable and specific feedback I receive on my lift videos, the constant upbeat and positive encouraging attitude that Ronnie exudes out as he shares his passion of coaching. I am a stronger, smarter, and more prepared lifter as a result.',
        athlete: 'Zack Scott',
        result: '3 competitions coached & handled · national meet prep',
        photo: 'https://static.wixstatic.com/media/e99af3_0d512540dd3b4d1d8084bbba566931e2~mv2.jpeg',
      },
      {
        quote: 'As an athlete, I have learned small details to become a better powerlifter overall, but as a coach myself, having Ronnie as my coach was invaluable. Since working with Ronnie, I have grown leaps and bounds as a coach. Of any coach I\'ve ever personally met, Ronnie demonstrates the same characteristics I hold dear — knowledge, soft skills, genuine care, and personal investment.',
        athlete: 'Michelle Madruga',
        result: 'Competitive powerlifter & coach',
        photo: 'https://static.wixstatic.com/media/e99af3_cc35fd3c63fc473191f2a3b7385d4bd3~mv2.jpg',
      },
    ],
  },
  {
    slug: 'seth-burman',
    name: 'Seth Burman',
    firstName: 'Seth',
    email: 'seth@axistrainingsystems.com',
    photo: 'https://static.wixstatic.com/media/e99af3_c6dd9c18b5374a038d9d94d95c94ccc2~mv2.jpg/v1/fill/w_432,h_434,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/IMG_6895%20(1).jpg',
    ctaBg: 'https://static.wixstatic.com/media/c0cc37_22d0ada4e59a43e68d265f53b7ff6219~mv2.jpg',
    bookCallUrl: 'https://calendly.com/ronnie-axistrainingsystems',
    role: 'Team Axis Coach',
    tagline: 'Competitive fire, methodical preparation.',
    bio: [
      'Seth Burman is a USAPL 100kg competitor with a Doctorate of Physical Therapy, a BS in Exercise Science, and the CSCS credential. His background spans clinical rehabilitation and strength science — a rare combination that lets him optimize performance while genuinely managing injury risk.',
      'He specializes in meet prep and game day coaching, with experience at national-level Powerlifting America and USAPL events.',
      'Seth brings discipline and calm to high-pressure situations — the qualities that matter most when it\'s time to step on the platform.',
    ],
    coachingPhilosophy: 'A great meet performance is won in the prep, not on the platform. Prepare obsessively, compete confidently.',
    specialties: ['Meet day logistics & attempt strategy', 'DPT & physical therapy background', 'Peaking and tapering', 'National-level competition experience'],
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
    photo: 'https://static.wixstatic.com/media/e99af3_c0aba7590f844eddaf80c5aa96fa99e4~mv2.jpg/v1/fill/w_432,h_434,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Screenshot_20220826-172606_Instagram_edited.jpg',
    ctaBg: 'https://static.wixstatic.com/media/e99af3_8188e795483040e68ca52efc20c469ca~mv2.jpg',
    bookCallUrl: 'https://calendly.com/ronnie-axistrainingsystems',
    role: 'Team Axis Coach',
    tagline: 'Fix the movement, free the strength.',
    bio: [
      'Lucas Sison is a USAPL 75kg national-level competitor and holds a Doctorate of Pharmacy. His clinical background informs a rigorously evidence-based approach that treats the whole athlete — not just their numbers.',
      'His specialty is identifying and correcting the technical inefficiencies that act as a ceiling on strength. Whether that\'s a hip position off the floor, bar path inconsistency, or a squat that breaks down under load — Lucas finds the root and addresses it.',
      'His athletes don\'t just get stronger. They understand exactly why.',
    ],
    coachingPhilosophy: 'You can\'t maximize what you haven\'t optimized. Movement quality is the ceiling on your strength.',
    specialties: ['Technical analysis and correction', 'USAPL 75kg national-level competitor', 'Evidence-based programming (PharmD background)', 'Intermediate to advanced development'],
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
      {
        quote: 'I have been working with Lucas for over a year now and on my first training block with him I was able to gain +115lb to my gym total. Under his wing, I was able to gain +49lb meet total and place 2nd in my division. Lucas isn\'t just a coach — he is also a student of the sport and seeks out knowledge of others in the field.',
        athlete: 'Lex Funtila',
        result: '+115 lb gym total · +49 lb meet total · 2nd place',
        photo: 'https://static.wixstatic.com/media/e99af3_7dd394887fc14c8e971368b4cafc90ee~mv2.jpg',
      },
      {
        quote: 'Throughout my first meet prep block we were able to increase my total from 505kg to 552.5kg. Then in a quick turnaround I was prepping two months later and we increased from 552.5kg all the way up to 597.5kg — including putting 50kgs on my deadlift in 7 months.',
        athlete: 'Dylan Quitoriano',
        result: '505kg → 597.5kg total · +50kg deadlift in 7 months',
        photo: 'https://static.wixstatic.com/media/e99af3_1de65a1aa35548269955b4d8a43a615c~mv2.jpg',
      },
      {
        quote: 'Lucas picked me up off the streets 8 weeks out of my first competition and with such a short amount of time to work together, he did a great job. Having a coach expedites progress and I wish I joined him from the beginning. I love Team Sison and I couldn\'t see another team as my family.',
        athlete: 'Calvin Phan',
        result: 'First meet prep · 2 meets together',
        photo: 'https://static.wixstatic.com/media/e99af3_7411362124364417ad6f848f6f1d7993~mv2.jpg',
      },
    ],
  },
  {
    slug: 'kobe-pham',
    name: 'Kobe Pham',
    firstName: 'Kobe',
    email: 'kobe@axistrainingsystems.com',
    ctaBg: 'https://static.wixstatic.com/media/e99af3_33b79dddeb93448a8e7ddb66b45fd5aa~mv2.jpg',
    bookCallUrl: 'https://calendly.com/ronnie-axistrainingsystems',
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
    ctaBg: 'https://static.wixstatic.com/media/e99af3_c7a9a45668c649ae84984977f3b7603a~mv2.jpg',
    bookCallUrl: 'https://calendly.com/ronnie-axistrainingsystems',
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
