import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { getOfficeSlugFromHost } from './lib/tenant'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

import Signup from './pages/auth/Signup'
import Login from './pages/auth/Login'
import OfficeLogin from './pages/auth/OfficeLogin'
import Onboarding from './pages/onboarding/Onboarding'
import Dashboard from './pages/Dashboard'

import Exams from './pages/exams/Exams'
import ExamDetail from './pages/exams/ExamDetail'
import GenerateQuestions from './pages/exams/GenerateQuestions'
import ReviewQuestions from './pages/exams/review/ReviewQuestions'
import ExamSettingsPage from './pages/exams/ExamSettings'

import Billing from './pages/billing/Billing'
import Settings from './pages/settings/Settings'

import Invites from './pages/invites/Invites'
import AcceptInvite from './pages/invites/AcceptInvite'
import Assign from './pages/invites/Assign'

import MyExams from './pages/cbt/MyExams'
import TakeExam from './pages/cbt/TakeExam'
import Result from './pages/cbt/Result'
import PublicTakeExam from './pages/cbt/PublicTakeExam'
import ExamAnalytics from './pages/exams/ExamAnalytics'
import AttemptDetail from './pages/exams/AttemptDetail'
import ExamRoster from './pages/exams/ExamRoster'

import TrainingAnalytics from './pages/reports/TrainingAnalytics'
import QuickReports from './pages/reports/QuickReports'
import Training from './pages/growth/Training'
import ClassDetail from './pages/growth/skill-development/ClassDetail'
import TeamPerformance from './pages/teams/TeamPerformance'
import TeamDetail from './pages/teams/TeamDetail'
import MyTeam from './pages/teams/MyTeam'

import Events from './pages/events/Events'
import EventForm from './pages/events/EventForm'
import EventDetail from './pages/events/EventDetail'
import Leaderboard from './pages/leaderboard/Leaderboard'

import Assignments from './pages/assignments/Assignments'
import NewAssignment from './pages/assignments/NewAssignment'
import AssignmentDetail from './pages/assignments/AssignmentDetail'
import MyAssignments from './pages/assignments/MyAssignments'
import SubmitAssignment from './pages/assignments/SubmitAssignment'

import TasksHub from './pages/tasks/TasksHub'

function Protected({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  )
}

// Reached at the root of an office's own subdomain (blaze-office.hq360.space),
// resolved via a wildcard DNS record + Cloudflare Worker in front of Firebase
// Hosting — the app itself just reads the hostname it landed on. Mirrors
// ProtectedRoute's loading/no-session branches, but a logged-out visitor
// here gets that office's own login/join screen instead of the generic one,
// and a logged-in one gets switched into that office automatically rather
// than whichever org they last used.
function OfficeAwareRoot({ slug }: { slug: string }) {
  const { session, loading, memberships, setCurrentOrgId, signOut } = useAuth()
  const navigate = useNavigate()
  const match = memberships.find((m) => m.organization.slug === slug)

  useEffect(() => {
    if (match) setCurrentOrgId(match.org_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.org_id])

  if (loading) return <div className="page-loading">Loading…</div>
  if (!session) return <OfficeLogin slugOverride={slug} />

  if (!match) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Not a member here</h1>
          <p className="form-error">Your account isn't part of this office.</p>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await signOut()
              navigate('/login')
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <Layout>
      <Dashboard />
    </Layout>
  )
}

export default function App() {
  const hostSlug = getOfficeSlugFromHost(window.location.hostname)

  return (
    <AuthProvider>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/o/:slug/login" element={<OfficeLogin />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/take/:token" element={<PublicTakeExam />} />

        <Route path="/" element={hostSlug ? <OfficeAwareRoot slug={hostSlug} /> : <Protected><Dashboard /></Protected>} />
        <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />

        <Route path="/exams" element={<Protected><Exams /></Protected>} />
        <Route path="/exams/:examId" element={<Protected><ExamDetail /></Protected>} />
        <Route path="/exams/:examId/generate" element={<Protected><GenerateQuestions /></Protected>} />
        <Route path="/exams/:examId/review" element={<Protected><ReviewQuestions /></Protected>} />
        <Route path="/exams/:examId/settings" element={<Protected><ExamSettingsPage /></Protected>} />
        <Route path="/exams/:examId/analytics" element={<Protected><ExamAnalytics /></Protected>} />
        <Route path="/exams/:examId/analytics/:attemptId" element={<Protected><AttemptDetail /></Protected>} />
        <Route path="/exams/:examId/roster" element={<Protected><ExamRoster /></Protected>} />

        <Route path="/billing" element={<Protected><Billing /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />

        <Route path="/reports" element={<Protected><QuickReports /></Protected>} />
        <Route path="/reports/training" element={<Protected><TrainingAnalytics /></Protected>} />
        <Route path="/training" element={<Protected><Training /></Protected>} />
        <Route path="/training/classes/:classId" element={<Protected><ClassDetail /></Protected>} />

        <Route path="/tasks" element={<Protected><TasksHub /></Protected>} />

        <Route path="/team-performance" element={<Protected><TeamPerformance /></Protected>} />
        <Route path="/team-performance/:teamId" element={<Protected><TeamDetail /></Protected>} />
        <Route path="/my-team" element={<Protected><MyTeam /></Protected>} />

        <Route path="/events" element={<Protected><Events /></Protected>} />
        <Route path="/events/new" element={<Protected><EventForm /></Protected>} />
        <Route path="/events/:eventId" element={<Protected><EventDetail /></Protected>} />
        <Route path="/events/:eventId/edit" element={<Protected><EventForm /></Protected>} />

        <Route path="/leaderboard" element={<Protected><Leaderboard /></Protected>} />

        <Route path="/invites" element={<Protected><Invites /></Protected>} />
        <Route path="/invites/assign" element={<Protected><Assign /></Protected>} />

        <Route path="/assignments" element={<Protected><Assignments /></Protected>} />
        <Route path="/assignments/new" element={<Protected><NewAssignment /></Protected>} />
        <Route path="/assignments/:assignmentId" element={<Protected><AssignmentDetail /></Protected>} />
        <Route path="/my-assignments" element={<Protected><MyAssignments /></Protected>} />
        <Route path="/my-assignments/:assignmentId" element={<Protected><SubmitAssignment /></Protected>} />

        <Route path="/cbt" element={<Protected><MyExams /></Protected>} />
        <Route path="/cbt/:assignmentId/take" element={<Protected><TakeExam /></Protected>} />
        <Route path="/cbt/attempts/:attemptId/result" element={<Protected><Result /></Protected>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
