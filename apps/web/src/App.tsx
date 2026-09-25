import { lazy, Suspense, useCallback } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/auth';
import { useAutoSync, useMasterData } from '@/app/hooks';
import { Spinner, useToast } from '@/design/ui';
import { hasOnboarded, SetPassword, SignIn, SignUp, Welcome } from '@/auth/screens';
import { MemberShell } from '@/member/shell';
import { Home } from '@/member/Home';
import { Submit, SubmitDone } from '@/member/Submit';
import { GrievanceDetail, MyGrievances, Track } from '@/member/Grievances';
import { Help, Notifications, Profile } from '@/member/Other';
import { UpdatePrompt } from '@/app/UpdatePrompt';

// Staff screens are a separate download: community phones never load dashboard code.
const StaffApp = lazy(() => import('@/staff/StaffApp'));

export default function App() {
  const { ready, session, isStaff, access, profile } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner label="Opening" />;

  if (!session) {
    return (
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="*" element={<Navigate to={hasOnboarded() ? '/signin' : '/welcome'} replace state={{ from: loc.pathname }} />} />
      </Routes>
    );
  }
  if (access && !access.is_active) return <Disabled />;
  // Invited staff choose their password before anything else.
  if (profile?.must_set_password) return <SetPassword />;
  if (isStaff) {
    return (
      <Suspense fallback={<Spinner label="Opening workspace" />}>
        <StaffApp />
        <UpdatePrompt />
      </Suspense>
    );
  }
  return <MemberApp />;
}

function MemberApp() {
  const { userId } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const onSynced = useCallback((n: number) => {
    toast(n === 1 ? 'Your saved grievance has been submitted.' : `${n} saved grievances have been submitted.`);
    qc.invalidateQueries();
  }, [toast, qc]);
  useAutoSync(userId, onSynced);
  // Load communities/categories now, while there is signal, so the submit
  // wizard works fully later even with no connection.
  useMasterData();
  return (
    <MemberShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/submit/done/:localId" element={<SubmitDone />} />
        <Route path="/grievances" element={<MyGrievances />} />
        <Route path="/grievances/:id" element={<GrievanceDetail />} />
        <Route path="/track" element={<Track />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/help" element={<Help />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdatePrompt />
    </MemberShell>
  );
}

function Disabled() {
  const { signOut } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div><h1 className="text-xl font-bold">This account is disabled</h1><p className="mt-2 text-ink-700">Please contact the Community Relations office.</p>
        <button className="mt-4 font-semibold text-brand-700" onClick={() => signOut()}>Sign out</button></div>
    </div>
  );
}
