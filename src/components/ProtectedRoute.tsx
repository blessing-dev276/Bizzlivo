import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import AppSkeleton from './AppSkeleton'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) return <AppSkeleton />
  if (!session) return <Navigate to="/login" replace />

  return <>{children}</>
}
