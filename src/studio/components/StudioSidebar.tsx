type Props = {
  user: { email: string; displayName: string };
  onSignOut: () => void;
  drafts: Array<{ id: string; topic: string; updatedAt: number }>;
  activeDraftId: string;
  onSelectDraft: (id: string) => void;
  onCreateDraft: () => void;
  onShowVideos: () => void;
  activeView: 'studio' | 'library' | 'review';
  onReset: () => void;
  busy?: boolean;
};

export function StudioSidebar({ drafts, activeDraftId, onSelectDraft, onCreateDraft, onShowVideos, activeView, onReset, user, onSignOut, busy = false }: Props) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">✳</div><div><strong>little lessons</strong><small>VIDEO STUDIO</small></div></div>
    <div className="side-label">WORKSPACE</div>
    <nav className="primary-nav" aria-label="Workspace">
      <button className={`nav-item ${activeView === 'studio' ? 'active' : ''}`} disabled={busy} onClick={onCreateDraft}><span>＋</span> New lesson</button>
      <button className={`nav-item ${activeView === 'library' || activeView === 'review' ? 'active' : ''}`} onClick={onShowVideos}><span>▧</span> My videos</button>
    </nav>
    <div className="side-label draft-label">RECENT DRAFTS <b>{drafts.length}</b></div>
    <div className="draft-list">{[...drafts].sort((a, b) => b.updatedAt - a.updatedAt).map(draft => <button key={draft.id} className={`nav-item draft-item ${draft.id === activeDraftId ? 'active' : ''}`} title={draft.topic || 'Untitled lesson'} disabled={busy} onClick={() => onSelectDraft(draft.id)}><span>◷</span><span className="draft-title">{draft.topic || 'Untitled lesson'}</span></button>)}</div>
    <button className="nav-item" disabled={busy} onClick={onReset}><span>↺</span> Restore starter</button>
    <div className="side-spacer" />
    <div className="sidebar-note"><div className="note-icon">✦</div><strong>Little ideas,<br />big discoveries.</strong><p>Make something wonderful today.</p></div>
    <div className="profile"><div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.displayName}</strong><small>{user.email}</small></div><button className="sign-out" onClick={onSignOut} title="Sign out">↗</button></div>
  </aside>;
}
