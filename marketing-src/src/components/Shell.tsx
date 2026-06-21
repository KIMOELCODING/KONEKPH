import { NavLink, useLocation } from 'react-router-dom';
import type { Profile } from '../types';

interface Props {
  profile: Profile;
  onSignOut: () => void;
  children: React.ReactNode;
}

const NAV = [
  { to: '/queue', icon: 'fa-layer-group', label: 'Listing Queue' },
  { to: '/leads', icon: 'fa-inbox', label: 'Buyer Leads' },
];

export default function Shell({ profile, onSignOut, children }: Props) {
  const loc = useLocation();
  const title = NAV.find(n => loc.pathname.startsWith(n.to))?.label ?? 'Marketing';
  const initials = ((profile.first_name?.[0] ?? '') + (profile.last_name?.[0] ?? '')).toUpperCase() || 'M';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="logo-mark">P</div>
          <div className="brand-text">ProList<span>.marketing</span></div>
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
            <div className="user-pill">
              <div className="avatar">{initials}</div>
              <span>{profile.first_name || 'Marketing'} {profile.last_name || ''}</span>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
