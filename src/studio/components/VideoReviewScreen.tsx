import { useEffect, useMemo, useState } from 'react';

type Review = {
  assetId: string;
  projectId: string;
  title: string;
  audience: string;
  durationSeconds: number;
  caption: string;
  hashtags: string[];
  approved: boolean;
  canApprove: boolean;
  approvalNote?: string;
  createdAt: string;
  updatedAt?: string;
  mediaUrl: string;
  downloadUrl: string;
};

type InstagramAccount = { id: string; username: string; accountType: string; status: string };
type PublishStatus = { postId: string; status: string; platformPostId?: string; error?: string };

type Props = { assetId: string; onBack: () => void };

export function VideoReviewScreen({ assetId, onBack }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [hashtagInput, setHashtagInput] = useState('');
  const [claimsChecked, setClaimsChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [captionGenerating, setCaptionGenerating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const dirty = useMemo(() => Boolean(review && (caption !== review.caption || hashtags.join(',') !== review.hashtags.join(','))), [caption, hashtags, review]);
  const finalPostText = useMemo(() => [caption.trim(), hashtags.map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n\n'), [caption, hashtags]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/videos/${assetId}/review`).then(async response => {
      const payload = await response.json() as { error?: string; review?: Review };
      if (!response.ok || !payload.review) throw new Error(payload.error || 'Could not load this video review.');
      if (cancelled) return;
      setReview(payload.review); setCaption(payload.review.caption); setHashtags(payload.review.hashtags);
    }).catch(problem => {
      if (!cancelled) setError(problem instanceof Error ? problem.message : 'Could not load this video review.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/social/accounts').then(async response => {
      const payload = await response.json() as { error?: string; accounts?: InstagramAccount[] };
      if (!response.ok) throw new Error(payload.error || 'Could not load Instagram accounts.');
      if (cancelled) return;
      setAccounts(payload.accounts ?? []);
      if (payload.accounts?.length) setSelectedAccountId(payload.accounts[0].id);
    }).catch(problem => { if (!cancelled) setError(problem instanceof Error ? problem.message : 'Could not load Instagram accounts.'); });
    const params = new URLSearchParams(window.location.search);
    if (params.get('instagram') === 'connected') setNotice('Instagram connected. Select the account below when you are ready to publish.');
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!publishStatus?.postId || publishStatus.status !== 'PUBLISHING') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/posts/${publishStatus.postId}`);
        const payload = await response.json() as { post?: { status: string; platformPostId?: string; error?: string } };
        if (!response.ok || !payload.post) throw new Error('Could not check publishing status.');
        if (cancelled) return;
        const next = { postId: publishStatus.postId, ...payload.post };
        setPublishStatus(next);
        if (next.status === 'PUBLISHED') setNotice('Your Reel was published to Instagram.');
        else if (next.status === 'FAILED') setError(next.error || 'Instagram could not publish this video.');
        else timer = setTimeout(() => { void poll(); }, 3000);
      } catch (problem) {
        if (!cancelled) { setError(problem instanceof Error ? problem.message : 'Could not check publishing status.'); timer = setTimeout(() => { void poll(); }, 5000); }
      }
    };
    timer = setTimeout(() => { void poll(); }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [publishStatus?.postId, publishStatus?.status]);

  const addHashtags = () => {
    const added = hashtagInput.split(/[\s,]+/).map(tag => tag.trim().replace(/^#+/, '')).filter(tag => /^[\p{L}\p{N}_]+$/u.test(tag));
    if (added.length) setHashtags(current => [...new Set([...current, ...added])]);
    setHashtagInput('');
  };

  const saveReview = async (approve: boolean): Promise<boolean> => {
    if (!review) return false;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/v1/videos/${assetId}/review`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption, hashtags, approve }),
      });
      const payload = await response.json() as { error?: string; approved?: boolean; updatedAt?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not save this review.');
      setReview(current => current ? { ...current, caption, hashtags, approved: payload.approved ?? false, updatedAt: payload.updatedAt } : current);
      setNotice(approve ? 'This video and its post text are approved.' : 'Your review draft is saved.');
      if (approve) setClaimsChecked(false);
      return true;
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save this review.'); }
    finally { setSaving(false); }
    return false;
  };

  const generateCaption = async () => {
    setCaptionGenerating(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/v1/videos/${assetId}/caption-suggestions`, { method: 'POST' });
      const payload = await response.json() as { error?: string; caption?: string; hashtags?: string[] };
      if (!response.ok) throw new Error(payload.error || 'Could not create caption ideas.');
      setCaption(payload.caption ?? ''); setHashtags(payload.hashtags ?? []);
      setNotice('Caption and hashtag ideas are ready. Edit them, then save and approve.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not create caption ideas.'); }
    finally { setCaptionGenerating(false); }
  };

  const connectInstagram = async () => {
    setConnecting(true); setError('');
    try {
      const response = await fetch('/api/v1/social/instagram/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId }) });
      const payload = await response.json() as { error?: string; authorizationUrl?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || 'Could not start Instagram connection.');
      window.location.assign(payload.authorizationUrl);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not start Instagram connection.'); setConnecting(false); }
  };

  const publishNow = async () => {
    if (!review || !selectedAccountId) return;
    setPublishing(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/v1/videos/${assetId}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ socialAccountId: selectedAccountId }),
      });
      const payload = await response.json() as { error?: string; postId?: string; status?: string };
      if (!response.ok || !payload.postId) throw new Error(payload.error || 'Could not start Instagram publishing.');
      setPublishStatus({ postId: payload.postId, status: payload.status ?? 'PUBLISHING' });
      setShowPublishConfirm(false);
      setNotice('Sending your video to Instagram. This can take a minute or two.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not start Instagram publishing.'); }
    finally { setPublishing(false); }
  };

  const disconnectInstagram = async (accountId: string) => {
    setError('');
    try {
      const response = await fetch(`/api/v1/social/accounts/${accountId}`, { method: 'DELETE' });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not disconnect Instagram.');
      setAccounts(current => current.filter(account => account.id !== accountId));
      setSelectedAccountId(current => current === accountId ? '' : current);
      setNotice('Instagram account disconnected.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not disconnect Instagram.'); }
  };

  if (loading) return <div className="review-state"><span className="library-spinner" /> Preparing your review…</div>;
  if (!review) return <div className="review-content"><button className="review-back" onClick={onBack}>← Back to My videos</button><div className="library-error" role="alert">{error || 'This video could not be opened.'}</div></div>;

  return <div className="review-content">
    <button className="review-back" onClick={onBack}>← Back to My videos</button>
    <header className="review-heading">
      <div>
        <div className="eyebrow">PUBLISHING WORKFLOW · STEP 1 OF 2</div>
        <h1>Review your video <span>✳</span></h1>
        <p>Check the final render, refine your post text, then approve it for publishing.</p>
      </div>
      <span className={`review-approval ${review.approved && !dirty ? 'approved' : ''}`}><i />{review.approved && !dirty ? 'Approved' : dirty ? 'Changes not saved' : 'Needs your review'}</span>
    </header>

    <div className="review-layout">
      <section className="review-preview-column">
        <div className="review-panel-heading"><div><span className="eyebrow">FINAL VIDEO</span><h2>{review.title}</h2></div><a className="review-download" href={review.downloadUrl}>↓ Download MP4</a></div>
        <div className="review-video-frame"><video src={review.mediaUrl} controls playsInline preload="metadata" aria-label={`Review video: ${review.title}`} /></div>
        <div className="review-video-meta"><span>▯ 9:16 vertical</span><i /><span>{review.durationSeconds}s</span><i /><span>{review.audience}</span><i /><span>Rendered {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(review.createdAt))}</span></div>
        <div className="review-next-step"><span className="review-next-icon">◎</span><div><strong>{accounts.length ? 'Instagram is connected' : 'Connect your Instagram'}</strong><span>{accounts.length ? 'Your account is ready for approved Reels.' : 'Connect a Professional account to publish your approved video.'}</span></div><span className="review-next-pill">STEP 2</span></div>
      </section>

      <section className="review-form-panel">
        <div className="review-form-heading"><span className="review-music-icon">♫</span><div><h2>Instagram post</h2><p>Suggest a caption, then make it yours.</p></div></div>
        <button className="review-suggest-button" onClick={() => { void generateCaption(); }} disabled={captionGenerating}>{captionGenerating ? 'Creating ideas…' : '✳ Suggest caption & hashtags'}</button>
        <label className="review-label" htmlFor="review-caption">CAPTION
          <textarea id="review-caption" value={caption} maxLength={5000} onChange={event => setCaption(event.target.value)} placeholder="Add a short explanation, a question, or a takeaway for your viewers." />
        </label>
        <div className={`review-character-count ${finalPostText.length > 2200 || hashtags.length > 30 ? 'over-limit' : ''}`}>{finalPostText.length}/2,200 characters · {hashtags.length}/30 hashtags</div>

        <div className="review-label">HASHTAGS</div>
        <div className="review-hashtag-input"><input value={hashtagInput} onChange={event => setHashtagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addHashtags(); } }} placeholder="Add a hashtag, then press Enter" aria-label="Add a hashtag" /><button onClick={addHashtags} disabled={!hashtagInput.trim()}>Add</button></div>
        <div className="review-hashtag-list">{hashtags.length ? hashtags.map(tag => <span className="review-hashtag" key={tag}>#{tag}<button onClick={() => setHashtags(current => current.filter(value => value !== tag))} aria-label={`Remove hashtag ${tag}`}>×</button></span>) : <span className="review-hashtag-hint">No hashtags added yet.</span>}</div>

        <div className="review-claims-card"><label><input type="checkbox" checked={claimsChecked} onChange={event => setClaimsChecked(event.target.checked)} /><span><strong>Educational claims reviewed</strong><small>I checked the lesson and video for accuracy and clarity.</small></span></label></div>
        {review.approvalNote && !review.canApprove && <div className="review-note">{review.approvalNote}</div>}
        {dirty && review.approved && <div className="review-note">Saving changes will clear the previous approval. Approve again after reviewing your edited caption and hashtags.</div>}
        {error && <div className="review-error" role="alert">{error}</div>}
        {notice && <div className="review-success" role="status">{notice}</div>}
        <div className="review-actions">
          <button className="review-save-button" disabled={saving || !dirty} onClick={() => { void saveReview(false); }}>{saving ? 'Saving…' : 'Save review draft'}</button>
          <button className="review-approve-button" disabled={saving || !review.canApprove || !claimsChecked} onClick={() => { void saveReview(true); }}>{saving ? 'Saving…' : review.approved && !dirty ? 'Approved for publishing ✓' : 'Approve video'}</button>
        </div>
        <div className="review-instagram-card">
          <div className="review-instagram-title"><strong>Publish to Instagram</strong>{accounts.length === 0 && <span>Not connected</span>}</div>
          {accounts.length ? <>
            <div className="review-account-row"><select aria-label="Instagram account" value={selectedAccountId} onChange={event => setSelectedAccountId(event.target.value)}>{accounts.map(account => <option key={account.id} value={account.id} disabled={account.status !== 'CONNECTED'}>@{account.username} · {account.accountType}{account.status !== 'CONNECTED' ? ' · reconnect needed' : ''}</option>)}</select><button onClick={() => { void disconnectInstagram(selectedAccountId); }}>Disconnect</button></div>
            {accounts.some(account => account.status !== 'CONNECTED') && <button className="review-connect-button review-reconnect-button" disabled={connecting} onClick={() => { void connectInstagram(); }}>{connecting ? 'Opening Instagram…' : 'Reconnect Instagram'}</button>}
            <button className="review-publish-button" disabled={!review.approved || dirty || saving || !selectedAccountId || accounts.find(account => account.id === selectedAccountId)?.status !== 'CONNECTED' || finalPostText.length > 2200 || hashtags.length > 30 || Boolean(publishStatus?.status === 'PUBLISHING')} onClick={() => setShowPublishConfirm(true)}>{publishStatus?.status === 'PUBLISHING' ? 'Publishing…' : publishStatus?.status === 'PUBLISHED' ? 'Published ✓' : 'Publish Reel now'}</button>
            {(finalPostText.length > 2200 || hashtags.length > 30) && <small>Instagram captions can use up to 2,200 characters and 30 hashtags. Shorten the post text before publishing.</small>}
            {!review.approved && <small>Save and approve this video and its caption first.</small>}
          </> : <button className="review-connect-button" disabled={connecting} onClick={() => { void connectInstagram(); }}>{connecting ? 'Opening Instagram…' : 'Connect Instagram'}</button>}
          {publishStatus?.status === 'FAILED' && <small className="review-publish-failed">Publishing failed. Correct the issue above and publish again.</small>}
        </div>
        <p className="review-approval-help">Publishing sends this approved video and its saved caption and hashtags to the selected Instagram account.</p>
      </section>
    </div>
    {showPublishConfirm && <div className="review-modal-backdrop" role="presentation"><section className="review-publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-confirm-title">
      <div className="eyebrow">FINAL CHECK</div><h2 id="publish-confirm-title">Publish this Reel now?</h2>
      <p>Your approved video and the caption below will be sent to @{accounts.find(account => account.id === selectedAccountId)?.username}. This action posts to your Instagram account.</p>
      <div className="review-confirm-caption">{finalPostText}</div>
      <div className="review-modal-actions"><button className="review-save-button" disabled={publishing} onClick={() => setShowPublishConfirm(false)}>Go back</button><button className="review-publish-button" disabled={publishing} onClick={() => { void publishNow(); }}>{publishing ? 'Starting…' : 'Confirm and publish'}</button></div>
    </section></div>}
    <footer className="library-footer"><span>MADE WITH CURIOSITY <b>✳</b></span><span>Only you can see your lessons</span></footer>
  </div>;
}
