import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { getOfficeSlugFromHost } from './lib/tenant'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import AppSkeleton, { PageSkeleton } from './components/AppSkeleton'

// Public entry points stay eager — no skeleton flash on first paint.
import Login from './pages/auth/Login'
import OfficeLogin from './pages/auth/OfficeLogin'

// Every routed page is code-split: the initial bundle is just the shell,
// and each page (plus its libs) downloads on first visit. Route changes show
// a shimmer via the <Suspense> boundaries below.
const Signup = lazy(() => import('./pages/auth/Signup'))
const Landing = lazy(() => import('./pages/marketing/Landing'))
const Onboarding = lazy(() => import('./pages/onboarding/Onboarding'))
const Dashboard = lazy(() => import('./pages/Dashboard'))

const Exams = lazy(() => import('./pages/quizzes/Exams'))
const ExamDetail = lazy(() => import('./pages/quizzes/ExamDetail'))
const GenerateQuestions = lazy(() => import('./pages/quizzes/GenerateQuestions'))
const ReviewQuestions = lazy(() => import('./pages/quizzes/review/ReviewQuestions'))
const ExamSettingsPage = lazy(() => import('./pages/quizzes/ExamSettings'))
const ExamAnalytics = lazy(() => import('./pages/quizzes/ExamAnalytics'))
const AttemptDetail = lazy(() => import('./pages/quizzes/AttemptDetail'))
const ExamRoster = lazy(() => import('./pages/quizzes/ExamRoster'))

const Settings = lazy(() => import('./pages/settings/Settings'))

const Invites = lazy(() => import('./pages/invites/Invites'))
const AcceptInvite = lazy(() => import('./pages/invites/AcceptInvite'))
const JoinByReferral = lazy(() => import('./pages/join/JoinByReferral'))
const Assign = lazy(() => import('./pages/invites/Assign'))

const MyExams = lazy(() => import('./pages/my-quizzes/MyExams'))
const TakeExam = lazy(() => import('./pages/my-quizzes/TakeExam'))
const Result = lazy(() => import('./pages/my-quizzes/Result'))
const PublicTakeExam = lazy(() => import('./pages/my-quizzes/PublicTakeExam'))

const ReportsInsights = lazy(() => import('./pages/reports/ReportsInsights'))
const Training = lazy(() => import('./pages/growth/Training'))
const ClassDetail = lazy(() => import('./pages/growth/skill-development/ClassDetail'))
const TeamPerformance = lazy(() => import('./pages/teams/TeamPerformance'))
const TeamDetail = lazy(() => import('./pages/teams/TeamDetail'))
const MyTeam = lazy(() => import('./pages/teams/MyTeam'))

const Events = lazy(() => import('./pages/events/Events'))
const EventForm = lazy(() => import('./pages/events/EventForm'))
const EventDetail = lazy(() => import('./pages/events/EventDetail'))
const Leaderboard = lazy(() => import('./pages/leaderboard/Leaderboard'))

const Assignments = lazy(() => import('./pages/assignments/Assignments'))
const NewAssignment = lazy(() => import('./pages/assignments/NewAssignment'))
const AssignmentDetail = lazy(() => import('./pages/assignments/AssignmentDetail'))
const MyAssignments = lazy(() => import('./pages/assignments/MyAssignments'))
const SubmitAssignment = lazy(() => import('./pages/assignments/SubmitAssignment'))

const BusinessPathHub = lazy(() => import('./pages/business-path/BusinessPathHub'))
const RankPathBuilder = lazy(() => import('./pages/business-path/RankPathBuilder'))
const MonthlyGoals = lazy(() => import('./pages/goals/MonthlyGoals'))
const FreelanceWorkspace = lazy(() => import('./pages/freelance/FreelanceWorkspace'))
const GoalsReview = lazy(() => import('./pages/goals/GoalsReview'))
const NotificationCenter = lazy(() => import('./pages/notifications/NotificationCenter'))
const OfficeUpdates = lazy(() => import('./pages/announcements/OfficeUpdates'))
const AnnouncementsAdmin = lazy(() => import('./pages/announcements/AnnouncementsAdmin'))
const MemberProfile360 = lazy(() => import('./pages/members/MemberProfile360'))
const Platform = lazy(() => import('./pages/platform/Platform'))
const HelpCenter = lazy(() => import('./pages/help/HelpCenter'))
const Wallet = lazy(() => import('./pages/wallet/Wallet'))
const FinanceWorkspace = lazy(() => import('./pages/finance/FinanceWorkspace'))

function Protected({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>
        <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
      </Layout>
    </ProtectedRoute>
  )
}

// Old /exams and /cbt links (bookmarks, notifications) still work — swap the
// prefix and keep the rest of the path + query.
function LegacyRedirect({ from, to }: { from: string; to: string }) {
  const loc = useLocation()
  const rest = loc.pathname.startsWith(from) ? loc.pathname.slice(from.length) : ''
  return <Navigate to={`${to}${rest}${loc.search}`} replace />
}

// Reached at the root of an office's own subdomain (blaze-office.bizzlivo.com),
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

  if (loading) return <AppSkeleton />
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
      <Suspense fallback={<PageSkeleton />}>
        <Dashboard />
      </Suspense>
    </Layout>
  )
}

// Root of the main domain. Logged-out visitors get the marketing landing
// page; a signed-in user goes straight to their dashboard.
function RootGate() {
  const { session, loading } = useAuth()
  if (loading) return <AppSkeleton />
  if (!session) {
    return (
      <Suspense fallback={<AppSkeleton />}>
        <Landing />
      </Suspense>
    )
  }
  return (
    <Protected>
      <Dashboard />
    </Protected>
  )
}

export default function App() {
  const hostSlug = getOfficeSlugFromHost(window.location.hostname)

  return (
    <AuthProvider>
      <Suspense fallback={<AppSkeleton />}>
        <Routes>
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/o/:slug/login" element={<OfficeLogin />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="/join/:code" element={<JoinByReferral />} />
          <Route path="/take/:token" element={<PublicTakeExam />} />

          <Route path="/" element={hostSlug ? <OfficeAwareRoot slug={hostSlug} /> : <RootGate />} />
          <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />

          <Route path="/quizzes" element={<Protected><Exams /></Protected>} />
          <Route path="/quizzes/:examId" element={<Protected><ExamDetail /></Protected>} />
          <Route path="/quizzes/:examId/generate" element={<Protected><GenerateQuestions /></Protected>} />
          <Route path="/quizzes/:examId/review" element={<Protected><ReviewQuestions /></Protected>} />
          <Route path="/quizzes/:examId/settings" element={<Protected><ExamSettingsPage /></Protected>} />
          <Route path="/quizzes/:examId/analytics" element={<Protected><ExamAnalytics /></Protected>} />
          <Route path="/quizzes/:examId/analytics/:attemptId" element={<Protected><AttemptDetail /></Protected>} />
          <Route path="/quizzes/:examId/roster" element={<Protected><ExamRoster /></Protected>} />

          {/* Billing now lives inside Settings — keep the old path working. */}
          <Route path="/billing" element={<Navigate to="/settings?tab=billing" replace />} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="/help" element={<Protected><HelpCenter /></Protected>} />

          <Route path="/reports" element={<Protected><ReportsInsights /></Protected>} />
          <Route path="/reports/training" element={<Navigate to="/reports?view=learning" replace />} />
          <Route path="/training" element={<Protected><Training /></Protected>} />
          <Route path="/training/classes/:classId" element={<Protected><ClassDetail /></Protected>} />

          <Route path="/business-path" element={<Protected><BusinessPathHub /></Protected>} />
          <Route path="/business-path/ranks/:rankId" element={<Protected><RankPathBuilder /></Protected>} />
          {/* legacy routes kept as redirects so bookmarks/links don't break */}
          <Route path="/tasks" element={<Navigate to="/business-path" replace />} />
          <Route path="/rank" element={<Navigate to="/business-path" replace />} />
          <Route path="/goals" element={<Protected><MonthlyGoals /></Protected>} />
          <Route path="/goals/review" element={<Protected><GoalsReview /></Protected>} />
          <Route path="/notifications" element={<Protected><NotificationCenter /></Protected>} />
          <Route path="/updates" element={<Protected><OfficeUpdates /></Protected>} />
          <Route path="/office/announcements" element={<Protected><AnnouncementsAdmin /></Protected>} />
          <Route path="/members/:userId" element={<Protected><MemberProfile360 /></Protected>} />
          <Route path="/wallet" element={<Protected><Wallet /></Protected>} />
          <Route path="/finance" element={<Protected><FinanceWorkspace /></Protected>} />

          <Route path="/team" element={<Protected><TeamPerformance /></Protected>} />
          <Route path="/team/:teamId" element={<Protected><TeamDetail /></Protected>} />
          <Route path="/my-team" element={<Protected><MyTeam /></Protected>} />
          <Route path="/freelance" element={<Protected><FreelanceWorkspace /></Protected>} />

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

          <Route path="/my-quizzes" element={<Protected><MyExams /></Protected>} />
          <Route path="/my-quizzes/:assignmentId/take" element={<Protected><TakeExam /></Protected>} />
          <Route path="/my-quizzes/attempts/:attemptId/result" element={<Protected><Result /></Protected>} />

          {/* legacy — Exams → Quizzes, Team Performance → Team */}
          <Route path="/exams/*" element={<LegacyRedirect from="/exams" to="/quizzes" />} />
          <Route path="/cbt/*" element={<LegacyRedirect from="/cbt" to="/my-quizzes" />} />
          <Route path="/team-performance/*" element={<LegacyRedirect from="/team-performance" to="/team" />} />

          <Route path="/platform/*" element={<Suspense fallback={<AppSkeleton />}><Platform /></Suspense>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
