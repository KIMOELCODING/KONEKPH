import { NavLink, useLocation } from 'react-router-dom';
import type { Profile } from '../types';
import NotifBell from './NotifBell';

interface Props {
  profile: Profile;
  onSignOut: () => void;
  children: React.ReactNode;
}

const NAV = [
  { to: '/brokers', icon: 'fa-user-check', label: 'Broker Approvals' },
  { to: '/listings', icon: 'fa-clipboard-check', label: 'Listing Approvals' },
  { to: '/articles', icon: 'fa-newspaper', label: 'Articles' },
  { to: '/promotions', icon: 'fa-bullhorn', label: 'Promotions' },
];

export default function Shell({ profile, onSignOut, children }: Props) {
  const loc = useLocation();
  const title = NAV.find(n => loc.pathname.startsWith(n.to))?.label ?? 'Admin';
  const initials = ((profile.first_name?.[0] ?? '') + (profile.last_name?.[0] ?? '')).toUpperCase() || 'A';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="logo-mark">K</div>
          <div className="brand-text">Konek<span>.admin</span></div>
        </div>
        <ul className="sb-nav">
          {NAV.map(n => (
            <li key={n.to}>
              <NavLink to={n.to} className={({ isActive }) => 'sb-link' + (isActive ? ' active' : '')}>
                <i className={'fa-solid ' + n.icon}></i>
                <span className="label">{n.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sb-foot">
          <div className="sb-link" onClick={onSignOut} style={{ cursor: 'pointer' }}>
            <i className="fa-solid fa-arrow-right-from-bracket"></i>
            <span className="label">Sign out</span>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="page-title">{title}</div>
          <div className="topbar-right">
            <NotifBell userId={profile.id} />
            <div className="user-pill">
              <div className="avatar">{initials}</div>
              <span>{profile.first_name || 'Admin'} {profile.last_name || ''}</span>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
