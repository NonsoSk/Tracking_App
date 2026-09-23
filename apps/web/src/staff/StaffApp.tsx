import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { Notifications } from '@/member/Other';
import { StaffShell } from './shell';
import { Dashboard, OfficerHome } from './Dashboard';
import { GrievanceList } from './Grievances';
import { Workspace } from './Workspace';
import { Codes, NewGrievance } from './Codes';
import { AuditLog, Categories, Communities, ImportPage, Reports, SettingsPage, Users } from './Admin';

/** Staff workspace (lazy-loaded). Every screen is also guarded by the database; these guards only tidy the UI. */
export default function StaffApp() {
  const { can, hasRole } = useAuth();
  const home = hasRole('officer') ? <OfficerHome />
    : can('dashboard.view') ? <Dashboard />
    : can('grievance.create.assisted') ? <Navigate to="/new" replace />
    : <Navigate to="/grievances" replace />;
  const guard = (ok: boolean, el: JSX.Element) => (ok ? el : <Navigate to="/" replace />);
  return (
    <StaffShell>
      <Routes>
        <Route path="/" element={home} />
        <Route path="/overview" element={guard(can('dashboard.view'), <Dashboard />)} />
        <Route path="/grievances" element={<GrievanceList />} />
        <Route path="/grievances/:id" element={<Workspace />} />
        <Route path="/new" element={guard(can('grievance.create.assisted'), <NewGrievance />)} />
        <Route path="/codes" element={guard(can('codes.manage'), <Codes />)} />
        <Route path="/reports" element={guard(can('dashboard.view'), <Reports />)} />
        <Route path="/notifications" element={<Notifications basePath="/grievances" />} />
        <Route path="/admin/communities" element={guard(can('masterdata.manage'), <Communities />)} />
        <Route path="/admin/categories" element={guard(can('masterdata.manage'), <Categories />)} />
        <Route path="/admin/users" element={guard(can('users.manage'), <Users />)} />
        <Route path="/admin/import" element={guard(can('import.run'), <ImportPage />)} />
        <Route path="/admin/audit" element={guard(can('audit.view'), <AuditLog />)} />
        <Route path="/admin/settings" element={guard(can('settings.manage'), <SettingsPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StaffShell>
  );
}
