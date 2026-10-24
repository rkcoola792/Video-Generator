import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { lesson } from '../video/lesson';
import type { LearnerAudience, NarrationTone, Scene, Voiceover } from './types';
import { LessonBrief } from './components/LessonBrief';
import { StoryboardEditor } from './components/StoryboardEditor';
import { StudioSidebar } from './components/StudioSidebar';
import { VideoPreview } from './components/VideoPreview';
import { AuthScreen } from './components/AuthScreen';

type LessonDraft = {
  id: string;
  topic: string;
  audience: LearnerAudience;
  targetDuration: number;
  tone: NarrationTone;
  voiceId: string;
  scenes: Scene[];
  voiceover: Voiceover | null;
  renderId?: string;
  updatedAt: number;
};

type Account = { id: string; email: string; displayName: string };
const blankDraft = (id = crypto.randomUUID()): LessonDraft => ({ id, topic: '', audience: 'Kids', targetDuration: 30, tone: 'friendly', voiceId: '', scenes: [], voiceover: null, updatedAt: Date.now() });

export default function App() {
  const [authState, setAuthState] = useState<'loading' | 'signed_out' | 'signed_in'>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const [projectsReady, setProjectsReady] = useState(false);
  const [drafts, setDrafts] = useState<LessonDraft[]>([]);
  const [voices, setVoices] = useState<Array<{ voiceId: string; name: string }>>([]);
  const [activeDraftId, setActiveDraftId] = useState('');
  const activeDraft = drafts.find(draft => draft.id === activeDraftId) ?? drafts[0] ?? blankDraft('00000000-0000-4000-8000-000000000001');
  const { scenes, audience, topic, targetDuration, tone, voiceover } = activeDraft;
  const voiceId = activeDraft.voiceId || voiceover?.voiceId || voices[0]?.voiceId || '';
  const updateDraft = (changes: Partial<LessonDraft>) => setDrafts(current => current.map(draft => draft.id === activeDraft.id ? { ...draft, ...changes, updatedAt: Date.now() } : draft));
  const setScenes = (value: Scene[] | ((current: Scene[]) => Scene[])) => updateDraft({ scenes: typeof value === 'function' ? value(activeDraft.scenes) : value });
  const setAudience = (value: LearnerAudience) => updateDraft({ audience: value });
  const setTopic = (value: string) => { updateDraft({ topic: value, voiceover: null, renderId: undefined }); setRenderDownloadUrl(''); };
  const changeTopic = (value: string) => {
    updateDraft({ topic: value, scenes: value.trim() === topic.trim() ? scenes : [], voiceover: null, renderId: undefined });
    setSelectedScene(0); setRenderDownloadUrl('');
  };
  const setTargetDuration = (value: number) => updateDraft({ targetDuration: value });
  const setTone = (value: NarrationTone) => { updateDraft({ tone: value, voiceover: null, renderId: undefined }); setRenderDownloadUrl(''); };
  const setVoiceId = (value: string) => { updateDraft({ voiceId: value, voiceover: null, renderId: undefined }); setRenderDownloadUrl(''); };
  const setVoiceover = (value: Voiceover | null) => updateDraft({ voiceover: value, renderId: undefined });
  const [playing, setPlaying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [pipelineStep, setPipelineStep] = useState('');
  const [generatingVoiceover, setGeneratingVoiceover] = useState(false);
  const [renderingVideo, setRenderingVideo] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderDownloadUrl, setRenderDownloadUrl] = useState('');
  const [selectedScene, setSelectedScene] = useState(0);
  const [notice, setNotice] = useState('');
  const playerRef = useRef<PlayerRef>(null);
  const totalSeconds = useMemo(() => scenes.reduce((sum, scene) => sum + scene.seconds, 0), [scenes]);
  const videoDurationSeconds = Math.max(totalSeconds, voiceover?.durationSeconds ?? 0);

  const loadAccountProjects = async (user: Account) => {
    const response = await fetch('/api/v1/projects');
    const payload = await response.json() as { error?: string; projects?: LessonDraft[] };
    if (!response.ok || !payload.projects) throw new Error(payload.error || 'Could not load your lessons.');
    const loaded = payload.projects.length ? payload.projects : [blankDraft()];
    setAccount(user); setDrafts(loaded); setActiveDraftId(loaded[0].id); setProjectsReady(true); setAuthState('signed_in');
  };

  const persistProjects = async (projects = drafts) => {
    const response = await fetch('/api/v1/projects', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects }) });
    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      throw new Error(payload.error || 'Could not save your lessons.');
    }
  };

  useEffect(() => {
    void fetch('/api/v1/auth/session').then(async response => {
      if (!response.ok) throw new Error('signed out');
      const payload = await response.json() as { user: Account };
      await loadAccountProjects(payload.user);
    }).catch(() => { setProjectsReady(false); setAuthState('signed_out'); });
  }, []);

  useEffect(() => {
    if (authState !== 'signed_in' || !projectsReady || drafts.length === 0) return;
    const timer = window.setTimeout(() => {
      void persistProjects(drafts)
        .then(() => undefined)
        .catch(() => setNotice('Could not save your lessons. Check your connection and try again.'));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [drafts, authState, projectsReady]);

  useEffect(() => { if (playing) playerRef.current?.play(); else playerRef.current?.pause(); }, [playing]);
  useEffect(() => { setRenderDownloadUrl(activeDraft.renderId ? `/api/render-video/${activeDraft.renderId}/download` : ''); }, [activeDraft.id, activeDraft.renderId]);
  useEffect(() => {
    void fetch('/api/voices').then(response => response.json()).then((payload: { voices?: Array<{ voiceId: string; name: string }> }) => setVoices(payload.voices ?? [])).catch(() => setVoices([]));
  }, []);

  const signOut = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccount(null); setDrafts([]); setProjectsReady(false); setAuthState('signed_out'); setActiveDraftId('');
  };

  const updateScene = (index: number, key: 'narration' | 'caption', value: string) => {
    setScenes(current => current.map((scene, i) => i === index ? { ...scene, [key]: value, visualSteps: undefined, ...(key === 'narration' ? { needsFactCheck: true } : {}) } : scene));
    if (key === 'narration') setVoiceover(null);
    updateDraft({ renderId: undefined });
    setRenderDownloadUrl('');
  };

  const restoreStarter = () => {
    setScenes(lesson.scenes); setTopic(lesson.topic); setAudience('Kids'); setTargetDuration(30);
    updateDraft({ renderId: undefined }); setSelectedScene(0); setVoiceover(null); setRenderDownloadUrl(''); setNotice('Starter storyboard restored.');
  };

  const createDraft = () => {
    const draft: LessonDraft = { ...blankDraft(), voiceId: voices[0]?.voiceId ?? '' };
    setDrafts(current => [...current, draft]);
    setActiveDraftId(draft.id); setSelectedScene(0); setRenderDownloadUrl(''); setNotice(''); setPlaying(false); playerRef.current?.pause();
  };

  const changeDuration = (duration: number) => {
    setTargetDuration(duration);
    setScenes(current => {
      if (!current.length) return current;
      const previousDuration = current.reduce((sum, scene) => sum + scene.seconds, 0);
      const scaled = current.map(scene => Math.max(1, Math.floor(duration * scene.seconds / previousDuration)));
      scaled[scaled.length - 1] += duration - scaled.reduce((sum, seconds) => sum + seconds, 0);
      return current.map((scene, index) => ({ ...scene, seconds: scaled[index] }));
    });
    setVoiceover(null); updateDraft({ renderId: undefined }); setRenderDownloadUrl('');
  };

  const addScene = () => {
    setScenes(current => [...current, { id: `scene-${Date.now()}`, label: 'New moment', seconds: 5, narration: '', caption: '', visual: 'explain', accent: '#ffbd79' }]);
    setSelectedScene(scenes.length);
    setVoiceover(null); setRenderDownloadUrl('');
  };

  const generateLesson = async () => {
    setGenerating(true); setNotice('');
    try {
      const result = await fetch('/api/generate-lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, audience, targetDurationSeconds: targetDuration }) });
      const payload = await result.json() as { error?: string; title?: string; scenes?: Scene[]; reviewNote?: string };
      if (!result.ok || !payload.scenes) throw new Error(payload.error || 'Could not generate this lesson.');
      setScenes(payload.scenes); if (payload.title) setTopic(payload.title);
      setSelectedScene(0); setVoiceover(null); setRenderDownloadUrl('');
      setNotice(payload.reviewNote || 'Gemini made a draft. Review the lesson and its sources before production.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not reach the lesson service.'); }
    finally { setGenerating(false); }
  };

  const generateVoiceover = async () => {
    setGeneratingVoiceover(true); setNotice(''); setPlaying(false); playerRef.current?.pause();
    try {
      await persistProjects();
      const result = await fetch('/api/generate-narration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: activeDraft.id, scenes, tone, voiceId }) });
      const payload = await result.json() as Voiceover & { error?: string };
      if (!result.ok || !payload.audioUrl || !payload.sceneTimings) throw new Error(payload.error || 'Could not generate the voiceover.');
      setVoiceover(payload); setRenderDownloadUrl('');
      setNotice('Voiceover ready. Play the preview to check the timing.'); playerRef.current?.seekTo(0);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not reach the narration service.'); }
    finally { setGeneratingVoiceover(false); }
  };

  const exportVideo = async (scenesToRender = scenes, titleToRender = topic, voiceoverToRender = voiceover) => {
    if (!voiceoverToRender) throw new Error('Generate the narration first, then export your finished MP4.');
    setRenderingVideo(true); setRenderProgress(0); setRenderDownloadUrl(''); setNotice('Preparing your vertical MP4…');
    try {
      const audioId = voiceoverToRender.audioUrl.match(/\/api\/audio\/([0-9a-f-]{36})/i)?.[1];
      if (!audioId) throw new Error('The narration file could not be found. Generate the voiceover again.');
      const start = await fetch('/api/render-video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: activeDraft.id, scenes: scenesToRender, title: titleToRender, audioId, sceneTimings: voiceoverToRender.sceneTimings, audioDurationSeconds: voiceoverToRender.durationSeconds }) });
      const started = await start.json() as { error?: string; renderId?: string };
      if (!start.ok || !started.renderId) throw new Error(started.error || 'The MP4 export could not be started.');
      while (true) {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`/api/render-video/${started.renderId}`);
        const status = await statusResponse.json() as { status?: string; progress?: number; error?: string; downloadUrl?: string };
        if (!statusResponse.ok) throw new Error(status.error || 'Could not read the export status.');
        setRenderProgress(status.progress ?? 0);
        if (status.status === 'failed') throw new Error(status.error || 'The MP4 export failed.');
        if (status.status === 'complete' && status.downloadUrl) { updateDraft({ renderId: started.renderId }); setRenderDownloadUrl(status.downloadUrl); setNotice('Your vertical MP4 is ready to download.'); return status.downloadUrl; }
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The MP4 export failed.'); throw error; }
    finally { setRenderingVideo(false); }
  };

  const generateVideo = async () => {
    if (topic.trim().length < 3) { setNotice('Add a topic or question first.'); return; }
    setGeneratingVideo(true); setRenderDownloadUrl(''); setNotice(''); setPlaying(false); playerRef.current?.pause();
    try {
      await persistProjects();
      let generatedTitle = topic.trim();
      let generatedScenes = scenes;
      let reviewNote = '';
      if (!generatedScenes.length) {
        setPipelineStep('Finding sources and writing your lesson…');
        const lessonResponse = await fetch('/api/generate-lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, audience, targetDurationSeconds: targetDuration }) });
        const lessonPayload = await lessonResponse.json() as { error?: string; title?: string; scenes?: Scene[]; reviewNote?: string };
        if (!lessonResponse.ok || !lessonPayload.scenes || !lessonPayload.title) throw new Error(lessonPayload.error || 'Could not create the lesson draft.');
        generatedScenes = lessonPayload.scenes;
        generatedTitle = lessonPayload.title;
        reviewNote = lessonPayload.reviewNote ?? '';
        setScenes(generatedScenes); setTopic(generatedTitle); setSelectedScene(0); setVoiceover(null);
      }

      setPipelineStep('Creating narration…');
      const narrationResponse = await fetch('/api/generate-narration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: activeDraft.id, scenes: generatedScenes, tone, voiceId }) });
      const narrationPayload = await narrationResponse.json() as Voiceover & { error?: string };
      if (!narrationResponse.ok || !narrationPayload.audioUrl || !narrationPayload.sceneTimings) throw new Error(narrationPayload.error || 'Could not generate the narration. Your lesson draft is saved.');
      setVoiceover(narrationPayload);

      setPipelineStep('Animating scenes and rendering your video…');
      await exportVideo(generatedScenes, generatedTitle, narrationPayload);
      setNotice(`${reviewNote || 'Your lesson is ready.'} Video complete — preview it and download the MP4.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Video generation stopped. Your lesson draft is saved so you can continue from here.');
    } finally { setGeneratingVideo(false); setPipelineStep(''); }
  };

  if (authState === 'loading') return <div className="auth-shell"><div className="auth-card"><span className="brand-mark">✳</span><h1>Opening your studio…</h1></div></div>;
  if (authState === 'signed_out') return <AuthScreen onAuthenticated={loadAccountProjects} />;

  return <div className="studio-shell">
    <StudioSidebar drafts={drafts} activeDraftId={activeDraft.id} user={account!} onSignOut={() => { void signOut(); }} busy={generatingVideo} onSelectDraft={id => { setActiveDraftId(id); setSelectedScene(0); setRenderDownloadUrl(drafts.find(draft => draft.id === id)?.renderId ? `/api/render-video/${drafts.find(draft => draft.id === id)?.renderId}/download` : ''); setNotice(''); setPlaying(false); playerRef.current?.pause(); }} onCreateDraft={createDraft} onReset={restoreStarter} />
    <main className="main-area">
      <header className="topbar"><div className="crumb">My lessons <span>/</span> <strong>{topic}</strong></div><div className="top-actions"><span className="saved"><i /> Saved to your account</span><button className="avatar small">{account?.displayName.slice(0, 1).toUpperCase()}</button></div></header>
      <div className="studio-content">
        <section className="heading-row"><div><div className="eyebrow">YOUR NEXT LITTLE LESSON</div><h1>Let’s make a video <span>✳</span></h1><p>A tiny question can open up a whole world.</p></div><button className="text-button" onClick={restoreStarter}>↺ <span>Reset draft</span></button></section>
        <LessonBrief topic={topic} audience={audience} duration={targetDuration} generatingVideo={generatingVideo} drafting={generating} disabled={generatingVideo || generating} pipelineStep={pipelineStep} onGenerateVideo={generateVideo} onTopicChange={changeTopic} onAudienceChange={setAudience} onDurationChange={changeDuration} />
        <div className="work-grid">
          <StoryboardEditor scenes={scenes} selected={selectedScene} busy={generatingVideo} onSelect={setSelectedScene} onUpdate={updateScene} onAdd={addScene} onRestore={restoreStarter} />
          <VideoPreview key={activeDraft.id} playerRef={playerRef} scenes={scenes} title={topic} voiceover={voiceover} tone={tone} voiceId={voiceId} voices={voices} playing={playing} durationSeconds={videoDurationSeconds} generatingVoiceover={generatingVoiceover} renderingVideo={renderingVideo} renderProgress={renderProgress} renderDownloadUrl={renderDownloadUrl} notice={notice} generatingVideo={generatingVideo} pipelineStep={pipelineStep} onToneChange={setTone} onVoiceChange={setVoiceId} onPlayToggle={() => setPlaying(value => !value)} onGenerateVoiceover={generateVoiceover} onExport={() => { void exportVideo().catch(() => undefined); }} />
        </div>
        <footer className="page-footer"><span>MADE WITH CURIOSITY <span>✳</span></span><button className="draft-only-button" disabled={generating || generatingVideo} onClick={generateLesson}>{generating ? <>◌ Drafting with Gemini…</> : 'Draft script only'}</button></footer>
      </div>
    </main>
  </div>;
}
