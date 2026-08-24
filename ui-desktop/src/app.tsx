import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { RTCPage } from './pages/RTCPage';
import { InfoPage } from './pages/InfoPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignalingPage } from './pages/SignalingPage';
import { SignalingClientProvider } from './context/signaling';
import { SignalingMembersPage } from './pages/SignalingMembersPage';

const tabs: Array<{ path: string; label: string }> = [
  { path: '/rtc', label: 'RTC' },
  { path: '/signaling', label: '信令服务器' },
  { path: '/settings', label: '设置' },
];

export function App() {
  const location = useLocation();
  const isIndependentPage = location.pathname === '/members' || location.pathname === '/info' || location.pathname === '/logs';

  return (
    <SignalingClientProvider>
      <main className="min-h-screen bg-slate-50 px-8 py-8 text-slate-950">
        <div className="mx-auto grid gap-4">
          {!isIndependentPage ? (
            <header className="grid gap-3">
              <nav className="flex flex-wrap gap-2 border-b border-slate-200">
                {tabs.map((tab) => (
                  <NavLink
                    className={({ isActive }) =>
                      `border-b-2 px-4 py-2 text-sm font-medium transition ${
                        isActive ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                      }`
                    }
                    key={tab.path}
                    to={tab.path}
                  >
                    {tab.label}
                  </NavLink>
                ))}
              </nav>
            </header>
          ) : null}

          <Routes>
            <Route path="/" element={<Navigate replace to="/rtc" />} />
            <Route path="/rtc" element={<RTCPage />} />
            <Route path="/signaling" element={<SignalingPage />} />
            <Route path="/members" element={<SignalingMembersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/info" element={<InfoPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/info-logs" element={<Navigate replace to="/info" />} />
            <Route path="*" element={<Navigate replace to="/rtc" />} />
          </Routes>
        </div>
      </main>
    </SignalingClientProvider>
  );
}
