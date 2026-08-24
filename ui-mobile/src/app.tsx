import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { RTCPage } from './pages/RTCPage';
import { InfoPage } from './pages/InfoPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignalingPage } from './pages/SignalingPage';
import { SignalingClientProvider } from './context/signaling';
import { SignalingMembersPage } from './pages/SignalingMembersPage';

const tabs: Array<{ path: string; label: string }> = [
  { path: '/rtc', label: '传输' },
  { path: '/signaling', label: '信令服务' },
  { path: '/settings', label: '设置' },
];

export function App() {
  const location = useLocation();
  const isIndependentPage = ['/members', '/info', '/logs'].includes(location.pathname);

  return (
    <SignalingClientProvider>
      <div className="app-shell">
        <main className={`app-content ${isIndependentPage ? '' : 'app-content-with-nav'}`}>
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
        </main>

        {!isIndependentPage ? (
          <nav className="bottom-nav" aria-label="主导航">
            {tabs.map((tab) => (
              <NavLink className={({ isActive }) => `bottom-nav-item ${isActive ? 'bottom-nav-item-active' : ''}`} key={tab.path} replace to={tab.path}>
                {tab.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </div>
    </SignalingClientProvider>
  );
}
