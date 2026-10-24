import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { lesson } from '../video/lesson';
import type { LearnerAudience, NarrationTone, Scene, Voiceover } from './types';
import { LessonBrief } from './components/LessonBrief';
import { StoryboardEditor } from './components/StoryboardEditor';
import { StudioSidebar } from './components/StudioSidebar';
import { VideoPreview } from './components/VideoPreview';

type LessonDraft = {
  id: string;
  topic: string;
  audience: LearnerAudience;
  targetDuration: number;
  tone: NarrationTone;
  voiceId: string;
  scenes: Scene[];
  voiceover: Voiceover | null;
  updatedAt: number;
};

const draftsKey = 'little-lessons-drafts';
const activeDraftKey = 'little-lessons-active-draft';

const setting = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};

function savedScenes(): Scene[] {
  try { const value = localStorage.getItem('little-lessons-scenes'); return value ? JSON.parse(value) as Scene[] : []; }
  catch { return []; }
}

function savedVoiceover(): Voiceover | null {
  try { const value = localStorage.getItem('little-lessons-voiceover'); return value ? JSON.parse(value) as Voiceover : null; }
  catch { return null; }
}

function savedDrafts(): LessonDraft[] {
  try {
    const value = localStorage.getItem(draftsKey);
    if (value) {
      const parsed = JSON.parse(value) as LessonDraft[];
      if (Array.isArray(parsed) && parsed.length) return parsed.map(draft => draft.topic === 'A new little lesson' ? { ...draft, topic: '', scenes: [], voiceover: null } : draft);
    }
    return [{
      id: 'starter', topic: setting('little-lessons-topic', ''),
      audience: setting('little-lessons-audience', 'Kids') as LearnerAudience,
      targetDuration: Number(setting('little-lessons-duration', '30')),
      tone: setting('little-lessons-tone', 'friendly') as NarrationTone,
      voiceId: savedVoiceover()?.voiceId ?? '',
      scenes: savedScenes(), voiceover: savedVoiceover(), updatedAt: Date.now(),
    }];
  } catch { return [{ id: 'starter', topic: '', audience: 'Kids', targetDuration: 30, tone: 'friendly', voiceId: '', scenes: [], voiceover: null, updatedAt: Date.now() }]; }
}

export default function App() {
  const [drafts, setDrafts] = useState<LessonDraft[]>(savedDrafts);
  const [voices, setVoices] = useState<Array<{ voiceId: string; name: string }>>([]);
  const [activeDraftId, setActiveDraftId] = useState(() => setting(activeDraftKey, 'starter'));
  const activeDraft = drafts.find(draft => draft.id === activeDraftId) ?? drafts[0];
  const { scenes, audience, topic, targetDuration, tone, voiceover } = activeDraft;
  const voiceId = activeDraft.voiceId || voiceover?.voiceId || voices[0]?.voiceId || '';
  const updateDraft = (changes: Partial<LessonDraft>) => setDrafts(current => current.map(draft => draft.id === activeDraft.id ? { ...draft, ...changes, updatedAt: Date.now() } : draft));
  const setScenes = (value: Scene[] | ((current: Scene[]) => Scene[])) => updateDraft({ scenes: typeof value === 'function' ? value(activeDraft.scenes) : value });
  const setAudience = (value: LearnerAudience) => updateDraft({ audience: value });
  const setTopic = (value: string) => { updateDraft({ topic: value, voiceover: null }); setRenderDownloadUrl(''); };
  const changeTopic = (value: string) => {
    updateDraft({ topic: value, scenes: value.trim() === topic.trim() ? scenes : [], voiceover: null });
    setSelectedScene(0); setRenderDownloadUrl('');
  };
  const setTargetDuration = (value: number) => updateDraft({ targetDuration: value });
  const setTone = (value: NarrationTone) => { updateDraft({ tone: value, voiceover: null }); setRenderDownloadUrl(''); };
  const setVoiceId = (value: string) => { updateDraft({ voiceId: value, voiceover: null }); setRenderDownloadUrl(''); };
  const setVoiceover = (value: Voiceover | null) => updateDraft({ voiceover: value });
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

  useEffect(() => {
    try {
      localStorage.setItem(draftsKey, JSON.stringify(drafts));
      localStorage.setItem(activeDraftKey, activeDraft.id);
    } catch { /* Keep editing when browser storage is unavailable. */ }
  }, [drafts, activeDraft.id]);

  useEffect(() => { if (playing) playerRef.current?.play(); else playerRef.current?.pause(); }, [playing]);
  useEffect(() => {
    void fetch('/api/voices').then(response => response.json()).then((payload: { voices?: Array<{ voiceId: string; name: string }> }) => setVoices(payload.voices ?? [])).catch(() => setVoices([]));
  }, []);

  const updateScene = (index: number, key: 'narration' | 'caption', value: string) => {
    setScenes(current => current.map((scene, i) => i === index ? { ...scene, [key]: value, visualSteps: undefined, ...(key === 'narration' ? { needsFactCheck: true } : {}) } : scene));
    if (key === 'narration') setVoiceover(null);
    setRenderDownloadUrl('');
  };

  const restoreStarter = () => {
    setScenes(lesson.scenes); setTopic(lesson.topic); setAudience('Kids'); setTargetDuration(30);
    setSelectedScene(0); setVoiceover(null); setRenderDownloadUrl(''); setNotice('Starter storyboard restored.');
  };

  const createDraft = () => {
    const draft: LessonDraft = { id: crypto.randomUUID(), topic: '', audience: 'Kids', targetDuration: 30, tone: 'friendly', voiceId: voices[0]?.voiceId ?? '', scenes: [], voiceover: null, updatedAt: Date.now() };
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
    setVoiceover(null); setRenderDownloadUrl('');
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
      const result = await fetch('/api/generate-narration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenes, tone, voiceId }) });
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
      const start = await fetch('/api/render-video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenes: scenesToRender, title: titleToRender, audioId, sceneTimings: voiceoverToRender.sceneTimings, audioDurationSeconds: voiceoverToRender.durationSeconds }) });
      const started = await start.json() as { error?: string; renderId?: string };
      if (!start.ok || !started.renderId) throw new Error(started.error || 'The MP4 export could not be started.');
      while (true) {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`/api/render-video/${started.renderId}`);
        const status = await statusResponse.json() as { status?: string; progress?: number; error?: string; downloadUrl?: string };
        if (!statusResponse.ok) throw new Error(status.error || 'Could not read the export status.');
        setRenderProgress(status.progress ?? 0);
        if (status.status === 'failed') throw new Error(status.error || 'The MP4 export failed.');
        if (status.status === 'complete' && status.downloadUrl) { setRenderDownloadUrl(status.downloadUrl); setNotice('Your vertical MP4 is ready to download.'); return status.downloadUrl; }
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The MP4 export failed.'); throw error; }
    finally { setRenderingVideo(false); }
  };

  const generateVideo = async () => {
    if (topic.trim().length < 3) { setNotice('Add a topic or question first.'); return; }
    setGeneratingVideo(true); setRenderDownloadUrl(''); setNotice(''); setPlaying(false); playerRef.current?.pause();
    try {
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
      const narrationResponse = await fetch('/api/generate-narration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenes: generatedScenes, tone, voiceId }) });
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

  return <div className="studio-shell">
    <StudioSidebar drafts={drafts} activeDraftId={activeDraft.id} busy={generatingVideo} onSelectDraft={id => { setActiveDraftId(id); setSelectedScene(0); setRenderDownloadUrl(''); setNotice(''); setPlaying(false); playerRef.current?.pause(); }} onCreateDraft={createDraft} onReset={restoreStarter} />
    <main className="main-area">
      <header className="topbar"><div className="crumb">My lessons <span>/</span> <strong>{topic}</strong></div><div className="top-actions"><span className="saved"><i /> Saved on this device</span><button className="avatar small">Y</button></div></header>
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
