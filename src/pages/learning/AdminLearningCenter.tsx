import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { LEARNING_AREAS, type AreaDef } from '../../lib/learningCenter'
import CurriculumBuilder from './CurriculumBuilder'
import OnboardingBuilder from './OnboardingBuilder'
import ProductsCatalog from './ProductsCatalog'
import PdResourceLibrary from './PdResourceLibrary'

export default function AdminLearningCenter() {
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership?.role === 'admin'
  const [params, setParams] = useSearchParams()
  const activeKey = params.get('area') ?? 'onboarding'
  const area: AreaDef = LEARNING_AREAS.find((a) => a.key === activeKey) ?? LEARNING_AREAS[0]
  const [subTab, setSubTab] = useState(0)

  function selectArea(key: string) {
    setParams((p) => {
      p.set('area', key)
      return p
    })
    setSubTab(0)
  }

  return (
    <div className="page lc">
      <div className="lc-head">
        <h1>Learning Center</h1>
        <p>Build and organize your office's learning experience.</p>
      </div>

      <div className="lc-tabs" role="tablist">
        {LEARNING_AREAS.map((a) => (
          <button
            key={a.key}
            type="button"
            role="tab"
            aria-selected={a.key === area.key}
            className={`lc-tab ${a.key === area.key ? 'active' : ''}`}
            onClick={() => selectArea(a.key)}
            style={{ ['--_t' as string]: a.tint }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {area.tabs && (
        <div className="view-tabs" style={{ marginBottom: 20 }}>
          {area.tabs.map((t, i) => (
            <button key={t} type="button" className={`view-tab ${subTab === i ? 'active' : ''}`} onClick={() => setSubTab(i)}>
              {t}
            </button>
          ))}
        </div>
      )}

      {area.key === 'onboarding' && <OnboardingBuilder readOnly={!isAdmin} />}

      {area.key === 'network_marketing' && (subTab === 0
        ? <CurriculumBuilder area="network_marketing" showLegacyImport />
        : <ProductsCatalog readOnly={!isAdmin} />)}

      {area.key === 'freelancing' && <CurriculumBuilder area="freelancing" />}

      {area.key === 'personal_development' && (subTab === 0
        ? <CurriculumBuilder area="personal_development" />
        : <PdResourceLibrary readOnly={!isAdmin} />)}

      {area.key === 'income_development' && <CurriculumBuilder area="income_development" />}
    </div>
  )
}
