import { useState } from 'react'
import OnboardingHub from './onboarding/OnboardingHub'
import SkillDevelopmentHub from './skill-development/SkillDevelopmentHub'
import PersonalDevelopmentHub from './personal-development/PersonalDevelopmentHub'
import IncomeDevelopmentHub from './income-development/IncomeDevelopmentHub'
import NetworkMarketingHub from './network-marketing/NetworkMarketingHub'

const JOURNEY_STAGES = [
  'Onboarding',
  'Personal Development',
  'Skill Development',
  'Income Development',
  'Network Marketing',
]

interface Pillar {
  description: string
  objectives: string[]
  kpis: string[]
  sections: string[]
  roadmap: string[]
}

// Stages that render a real, built component instead of the generic
// PILLARS-driven placeholder — kept separate from PILLARS since they don't
// need placeholder copy (objectives/kpis/roadmap) to be clickable.
const BUILT_STAGES = new Set(['Onboarding', 'Personal Development', 'Skill Development', 'Income Development', 'Network Marketing'])

// Only stages with an actual spec (or a BUILT_STAGES entry) get clicked
// into — the rest still show in the stepper (the full journey is the
// point), they just aren't clickable yet.
const PILLARS: Partial<Record<string, Pillar>> = {
  'Onboarding': {
    description:
      'Prepares new members before they start Network Marketing — a guided sequence through the office’s policy, the business explanation, NeoLife’s Network Varsity training, and final registration.',
    objectives: [
      '1. Review the office policy',
      '2. Business Explanation',
      '3. Complete Network Varsity',
      '4. Fill the registration form',
    ],
    kpis: [
      'Members in Onboarding',
      'Policy Acknowledged',
      'Business Explanation Completed',
      'Network Varsity Completed',
      'Registration Forms Submitted',
    ],
    sections: [
      'Dashboard',
      'Policy',
      'Business Explanation',
      'Network Varsity',
      'Registration Form',
      'Progress Tracker',
      'Settings',
    ],
    roadmap: [
      'Network Varsity Completion Sync',
      'E-Signature for Policy',
      'Automated Registration Submission',
      'Onboarding Reminders',
    ],
  },
  'Network Marketing': {
    description:
      'Helps Virtual Offices build, train, and develop successful network-marketing distributors through structured systems — NeoLife Business is the first program built on this stage.',
    objectives: [
      'Introduce NeoLife',
      'Product Knowledge',
      'Customer Acquisition',
      'Team Building',
      'Leadership Development',
    ],
    kpis: [
      'New Customers',
      'Active Distributors',
      'Team Growth',
      'Leadership Progress',
      'Recent Activities',
    ],
    sections: [
      'Dashboard',
      'Business Journey',
      'Products',
      'Prospecting',
      'Invitation',
      'Presentation',
      'Follow-up',
      'Customer Management',
      'Team Building',
      'Leadership',
      'Recognition',
      'Reports',
      'Settings',
    ],
    roadmap: ['Academy Integration', 'AI Mentor', 'Events', 'Notifications', 'Analytics'],
  },
}

export default function Training() {
  const [activeStage, setActiveStage] = useState('Onboarding')
  const pillar = PILLARS[activeStage]

  return (
    <div className="page">
      <h1>Training</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 28 }}>
        The path every member walks through — from onboarding to leading their own team. This is the
        structure Training will grow into; each stage below gets its own detailed build-out over time.
      </p>

      <div className="journey-stepper">
        {JOURNEY_STAGES.map((stage, idx) => (
          <button
            key={stage}
            type="button"
            className={`journey-step ${stage === activeStage ? 'active' : ''}`}
            disabled={!PILLARS[stage] && !BUILT_STAGES.has(stage)}
            onClick={() => setActiveStage(stage)}
          >
            <span className="journey-step-num">{idx + 1}</span>
            <span className="journey-step-label">{stage}</span>
          </button>
        ))}
      </div>

      {activeStage === 'Onboarding' ? (
        <OnboardingHub />
      ) : activeStage === 'Personal Development' ? (
        <PersonalDevelopmentHub />
      ) : activeStage === 'Skill Development' ? (
        <SkillDevelopmentHub />
      ) : activeStage === 'Income Development' ? (
        <IncomeDevelopmentHub />
      ) : activeStage === 'Network Marketing' ? (
        <NetworkMarketingHub />
      ) : pillar ? (
        <section className="growth-pillar">
          <div className="growth-pillar-head">
            <h2>{activeStage}</h2>
            <span className="badge soon-badge">Soon</span>
          </div>
          <p style={{ color: 'var(--text-dim)' }}>{pillar.description}</p>

          <h4 className="overview-heading" style={{ marginTop: 20 }}>OBJECTIVES</h4>
          <ul className="growth-objectives">
            {pillar.objectives.map((o) => <li key={o}>{o}</li>)}
          </ul>

          <h4 className="overview-heading" style={{ marginTop: 24 }}>KPIS</h4>
          <div className="upcoming-list">
            {pillar.kpis.map((kpi) => (
              <span className="upcoming-pill" key={kpi}>{kpi}<span className="badge soon-badge">Soon</span></span>
            ))}
          </div>

          <h4 className="overview-heading" style={{ marginTop: 24 }}>PLANNED SECTIONS</h4>
          <div className="upcoming-list">
            {pillar.sections.map((s) => (
              <span className="upcoming-pill" key={s}>{s}<span className="badge soon-badge">Soon</span></span>
            ))}
          </div>

          <h4 className="overview-heading" style={{ marginTop: 24 }}>FUTURE ROADMAP</h4>
          <div className="upcoming-list">
            {pillar.roadmap.map((r) => (
              <span className="upcoming-pill" key={r}>{r}<span className="badge soon-badge">Soon</span></span>
            ))}
          </div>
        </section>
      ) : (
        <section className="growth-pillar">
          <div className="growth-pillar-head">
            <h2>{activeStage}</h2>
            <span className="badge soon-badge">Soon</span>
          </div>
          <p style={{ color: 'var(--text-dim)' }}>This stage hasn't been scoped yet.</p>
        </section>
      )}
    </div>
  )
}
