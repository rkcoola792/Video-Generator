import { useMemo, useState } from 'react';

export type VideoLibraryItem = {
  id: string;
  kind: 'video' | 'draft';
  projectId: string;
  assetId?: string;
  title: string;
  audience: string;
  durationSeconds: number;
  createdAt?: string;
  updatedAt?: string;
  mediaUrl?: string;
  downloadUrl?: string;
};

type Props = {
  items: VideoLibraryItem[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onCreateLesson: () => void;
  onOpenProject: (projectId: string) => void;
  onReviewVideo: (assetId: string) => void;
};

const formatDate = (value?: string) => value
  ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
  : 'Recently';

export function VideoLibrary({ items, loading, error, onRetry, onCreateLesson, onOpenProject, onReviewVideo }: Props) {
  const [filter, setFilter] = useState<'all' | 'video' | 'draft'>('all');
  const [search, setSearch] = useState('');
  const counts = useMemo(() => ({
    all: items.length,
    video: items.filter(item => item.kind === 'video').length,
    draft: items.filter(item => item.kind === 'draft').length,
  }), [items]);
  const visibleItems = useMemo(() => items.filter(item => {
    const matchesFilter = filter === 'all' || item.kind === filter;
    const matchesSearch = item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    return matchesFilter && matchesSearch;
  }), [filter, items, search]);

  return <div className="library-content">
    <section className="library-heading">
      <div>
        <div className="eyebrow">YOUR CREATIVE LIBRARY</div>
        <h1>My videos <span>✳</span></h1>
        <p>Your lessons and finished videos, all in one place.</p>
      </div>
      <button className="library-create-button" onClick={onCreateLesson}><span>＋</span> Create a lesson</button>
    </section>

    <div className="library-toolbar">
      <div className="library-filters" role="tablist" aria-label="Filter your videos">
        {(['all', 'video', 'draft'] as const).map(value => <button
          key={value}
          className={`library-filter ${filter === value ? 'selected' : ''}`}
          role="tab"
          aria-selected={filter === value}
          onClick={() => setFilter(value)}
        >{value === 'all' ? 'All lessons' : value === 'video' ? 'Videos ready' : 'Drafts'}<span>{counts[value]}</span></button>)}
      </div>
      <label className="library-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search your lessons" aria-label="Search your lessons" /></label>
    </div>

    {error && <div className="library-error" role="alert"><span>{error}</span><button onClick={onRetry}>Try again</button></div>}
    {loading ? <div className="library-state"><span className="library-spinner" /> Gathering your lessons…</div> : visibleItems.length > 0 ? <div className="library-grid">
      {visibleItems.map(item => <article className="library-card" key={item.id}>
        {item.kind === 'video' && item.mediaUrl ? <div className="library-video-frame">
          <video src={item.mediaUrl} controls playsInline preload="metadata" aria-label={`Preview ${item.title}`} />
          <span className="library-status ready"><i /> Video ready</span>
        </div> : <button className="library-draft-art" onClick={() => onOpenProject(item.projectId)} aria-label={`Open ${item.title}`}>
          <span className="draft-art-sun">✳</span><span className="draft-art-title">{item.title}</span><span className="draft-art-caption">A LITTLE LESSON IN THE MAKING</span>
          <span className="library-status draft"><i /> In draft</span>
        </button>}
        <div className="library-card-body">
          <div className="library-card-title-row"><h2 title={item.title}>{item.title}</h2><button className="library-more" title="Open in studio" aria-label={`Open ${item.title} in studio`} onClick={() => onOpenProject(item.projectId)}>↗</button></div>
          <div className="library-meta"><span>{item.audience}</span><i /> <span>{item.durationSeconds}s</span><i /> <span>{formatDate(item.createdAt ?? item.updatedAt)}</span></div>
          <div className="library-card-actions">
            {item.kind === 'video' && item.downloadUrl ? <a className="library-download" href={item.downloadUrl}>↓ <span>Download MP4</span></a> : <span className="library-draft-note">Your idea is saved</span>}
            {item.kind === 'video' && item.assetId ? <button className="library-review-link" onClick={() => onReviewVideo(item.assetId!)}>Review & publish <span>→</span></button>
              : <button className="library-open" onClick={() => onOpenProject(item.projectId)}>Continue editing <span>→</span></button>}
          </div>
        </div>
      </article>)}
    </div> : <div className="library-empty">
      <div className="library-empty-mark">✳</div>
      <h2>{search ? 'No lessons match that search' : filter === 'video' ? 'Your finished videos will show up here' : filter === 'draft' ? 'No drafts to pick up' : 'Your library is ready for its first lesson'}</h2>
      <p>{search ? 'Try another title or clear the search.' : filter === 'video' ? 'Once a video finishes rendering, you can preview and download it here.' : 'Start with a question you would love to explain.'}</p>
      {!search && filter !== 'video' && <button className="library-create-button" onClick={onCreateLesson}>＋ Create a lesson</button>}
    </div>}
    <footer className="library-footer"><span>MADE WITH CURIOSITY <b>✳</b></span><span>Only you can see your lessons</span></footer>
  </div>;
}
