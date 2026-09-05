interface Section {
  title: string
  items: string[]
}

const SECTIONS: Section[] = [
  { title: 'MEMBER LEADERBOARD', items: ['Top Members', 'XP Points', 'Learning Progress', 'Daily Missions'] },
  { title: 'TEAM LEADER LEADERBOARD', items: ['Team Growth', 'Team Performance', 'Leadership Score'] },
  { title: 'TEAM LEADERBOARD', items: ['Team Rankings', 'Team Activity', 'Completion Rate'] },
  { title: 'RECOGNITION', items: ['Member of the Month', 'Team of the Month', 'Leader of the Month'] },
  { title: 'FILTERS', items: ['Today', 'This Week', 'This Month', 'This Year', 'All Time'] },
  { title: 'REWARDS', items: ['XP', 'Badges', 'Certificates', 'Achievement Titles'] },
]

const OTHER_SECTIONS = ['AI Insights', 'Notifications']

const FUTURE_FEATURES = ['Seasonal Rankings', 'Office Competitions', 'Reward Store', 'Gamification']

export default function Leaderboard() {
  return (
    <div className="page">
      <h1>Leaderboard</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 28 }}>
        Motivating members through healthy competition, recognition, and measurable progress — this is
        the structure it'll grow into as scoring, XP, and rankings get built out.
      </p>

      {SECTIONS.map((section) => (
        <div key={section.title} style={{ marginBottom: 24 }}>
          <h4 className="overview-heading">{section.title}</h4>
          <div className="upcoming-list">
            {section.items.map((item) => (
              <span className="upcoming-pill" key={item}>{item}<span className="badge soon-badge">Soon</span></span>
            ))}
          </div>
        </div>
      ))}

      <h4 className="overview-heading" style={{ marginTop: 8 }}>COMING SOON</h4>
      <div className="upcoming-list">
        {[...OTHER_SECTIONS, ...FUTURE_FEATURES].map((item) => (
          <span className="upcoming-pill" key={item}>{item}<span className="badge soon-badge">Soon</span></span>
        ))}
      </div>
    </div>
  )
}
