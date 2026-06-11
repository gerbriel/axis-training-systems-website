export interface BlogPost {
  slug: string
  title: string
  subtitle: string
  date: string
  author: string
  authorRole: string
  coachSlug?: string
  coachName?: string
  tags: string[]
  coverImage?: string
  summary: string
  content: BlogSection[]
}

export interface BlogSection {
  type: 'heading' | 'subheading' | 'paragraph' | 'list' | 'callout' | 'week' | 'divider'
  text?: string
  items?: string[]
  label?: string   // for callout label or week label
}

export const POSTS: BlogPost[] = [
  {
    slug: 'julien-gaudet-pec-strain-nationals',
    title: 'Pec Strain 9 Weeks Out from Nationals',
    subtitle: 'How strategic loading, rehabilitation, and symptom-guided programming got Julien Gaudet to a 210kg bench press meet PR',
    date: 'June 10, 2026',
    author: 'Seth Burman',
    authorRole: 'Team Axis Coach · DPT, CSCS',
    coachSlug: 'seth-burman',
    coachName: 'Seth Burman',
    tags: ['Case Study', 'Injury Management', 'Meet Prep', 'Bench Press', 'USAPL'],
    coverImage: 'https://static.wixstatic.com/media/e99af3_c6dd9c18b5374a038d9d94d95c94ccc2~mv2.jpg',
    summary: 'A pec strain 9 weeks out from Nationals forced us to rethink Julien\'s entire meet prep. Rather than shutting training down, we used rehabilitation, ascending sets, tempo work, and symptom-guided programming to maintain momentum. Nine weeks later, Julien benched 210kg — a meet PR and the heaviest bench in the 125kg class.',
    content: [
      {
        type: 'paragraph',
        text: 'A pec strain 9 weeks out from Nationals forced us to make some significant adjustments to Julien\'s meet prep. Huge credit to Julien for trusting the process and putting in the work throughout.',
      },
      {
        type: 'paragraph',
        text: 'The goal from day one was to restore range of motion, reduce pain, maintain tissue loading tolerance, and continue exposing him to bench-specific training while managing symptoms. Rather than shutting training down completely, we used a combination of rehabilitation, strategic loading progressions, ascending sets, tempo work, and symptom-guided programming to keep momentum moving forward.',
      },
      {
        type: 'paragraph',
        text: 'The focus was on finding a tolerable starting point, gradually increasing loading, and rebuilding confidence under heavier weights while maintaining as much bench-specific work as possible.',
      },
      { type: 'divider' },
      {
        type: 'heading',
        text: 'Initial Presentation',
      },
      {
        type: 'paragraph',
        text: 'During the second rep of a 200kg double, Julien reported a significant pop and tearing sensation in his pec.',
      },
      {
        type: 'subheading',
        text: 'Assessment Findings',
      },
      {
        type: 'list',
        items: [
          'Pain with horizontal adduction, shoulder flexion, and internal rotation',
          'Approximately 10° loss of shoulder internal and external rotation compared to the opposite side',
        ],
      },
      {
        type: 'subheading',
        text: 'Initial Management',
      },
      {
        type: 'list',
        items: [
          'Same-day consultation',
          'Five days without bench pressing',
          'Immediate initiation of rehabilitation',
        ],
      },
      {
        type: 'subheading',
        text: 'Early Rehabilitation',
      },
      {
        type: 'list',
        items: [
          'Pec wall isometrics: 5 × 10 seconds, 5 times per day',
          'Sleeper stretch: 3 × 30 seconds, twice per day',
          'Wall external rotation stretch: 3 × 30 seconds, twice per day',
        ],
      },
      {
        type: 'subheading',
        text: 'Primary Goals',
      },
      {
        type: 'list',
        items: [
          'Restore range of motion',
          'Reduce pain',
          'Maintain tissue loading tolerance',
        ],
      },
      { type: 'divider' },
      {
        type: 'heading',
        text: 'Programming Considerations',
      },
      {
        type: 'subheading',
        text: 'Ascending Sets',
      },
      {
        type: 'list',
        items: [
          'Gradually assess symptom response',
          'Accumulate volume before the heaviest load',
          'Eliminate the need for backdown sets after a top set if symptoms increased',
        ],
      },
      {
        type: 'subheading',
        text: 'Tempo Work',
      },
      {
        type: 'list',
        items: [
          'Reinforce technical consistency',
          'Limit loading while maintaining training stimulus',
          'Increase time under tension without increasing repetitions',
        ],
      },
      {
        type: 'callout',
        text: 'These strategies allowed continued exposure to bench press-specific training while managing symptoms.',
      },
      { type: 'divider' },
      {
        type: 'heading',
        text: 'Progression Over 9 Weeks',
      },
      {
        type: 'subheading',
        text: 'Starting Point — Block 1',
      },
      {
        type: 'list',
        items: [
          'Progressed from wall isometrics → push-up isometrics',
          'Added chest press isometric holds: 5 × 10 seconds',
        ],
      },
      {
        type: 'week',
        label: 'Week 1',
        items: [
          'Tuesday: 2×5 up to 90kg (pain cap 2/10)',
          'Thursday: 3×4 up to 120kg (pain cap 2/10)',
          'Sunday: 3×6 up to 125kg (pain cap 2/10)',
        ],
      },
      {
        type: 'week',
        label: 'Week 3',
        items: [
          'Tuesday: 3×5 up to 140kg (pain cap 1/10)',
          'Thursday: 3×4 up to 145kg (pain cap 1/10)',
          'Sunday: 1×6, 1×4, 1×2 up to 160kg (pain cap 1/10)',
        ],
      },
      {
        type: 'week',
        label: 'Week 5',
        items: [
          'Tuesday: 3×5 up to 150kg',
          'Thursday: 3×4 up to 155kg',
          'Sunday: 180kg ×1, then 2×4 @ 145kg',
        ],
      },
      {
        type: 'subheading',
        text: 'Block 1 Key Strategies',
      },
      {
        type: 'list',
        items: [
          'Established a pain-free baseline and increased load ~5kg/week on secondary and tertiary days',
          'Maintained Week 3 loading in Week 4 to consolidate adaptations and confirm symptom tolerance',
          'Reduced pain ratings allowed progression toward more competition-specific benching',
          'Primary day evolved from ascending sets → lower rep work → top single + backdowns',
        ],
      },
      { type: 'divider' },
      {
        type: 'heading',
        text: 'Final Block & Meet Day Strategy',
      },
      {
        type: 'subheading',
        text: 'Block 2 Progression',
      },
      {
        type: 'list',
        items: [
          'Week 1: 1×1 — 180kg',
          'Week 2: 1×1 — 190kg',
          'Week 3: 1×1 — 200kg (@7, Pain-Free)',
        ],
      },
      {
        type: 'subheading',
        text: 'Turning Point',
      },
      {
        type: 'paragraph',
        text: 'Taking a pain-free 200kg was a major confidence boost for Julien. We still had plenty of room left in the tank. Julien initially wanted to take more, but I encouraged him to leave it there and take a solid 200kg as a win. The focus remained on executing 210kg on meet day rather than chasing numbers in training.',
      },
      {
        type: 'subheading',
        text: 'Meet Day Strategy',
      },
      {
        type: 'paragraph',
        text: 'The plan was to take 200kg as Julien\'s second attempt, which we did successfully. For his third attempt, we called for 210kg. This was a small competition PR, the heaviest bench press in the 125kg weight class — and Julien absolutely crushed it.',
      },
      {
        type: 'subheading',
        text: 'Outcome',
      },
      {
        type: 'list',
        items: [
          '200kg — successful second attempt',
          '210kg — successful third attempt',
          'Competition PR',
          'Heaviest bench press in the 125kg class',
        ],
      },
      { type: 'divider' },
      {
        type: 'callout',
        text: 'Nine weeks from a significant pec injury to a 210kg meet PR and class record. The result of trusting the process, intelligent programming, and an athlete who showed up every single day.',
      },
    ],
  },
]

export function getPostBySlug(slug: string): BlogPost | undefined {
  return POSTS.find(p => p.slug === slug)
}
