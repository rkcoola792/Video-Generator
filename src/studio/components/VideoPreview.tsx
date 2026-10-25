import { useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { LessonVideo } from '../../video/LessonVideo';
import type { NarrationTone, Scene, Voiceover } from '../types';

type Props = {
  playerRef: React.RefObject<PlayerRef>;
  scenes: Scene[];
  title: string;
  voiceover: Voiceover | null;
  tone: NarrationTone;
  voiceId: string;
  voices: Array<{ voiceId: string; name: string }>;
  playing: boolean;
  durationSeconds: number;
  generatingVoiceover: boolean;
  renderingVideo: boolean;
  renderProgress: number;
  renderDownloadUrl: string;
  notice: string;
  generatingVideo: boolean;
  pipelineStep: string;
  onToneChange: (tone: NarrationTone) => void;
  onVoiceChange: (voiceId: string) => void;
  onPlayToggle: () => void;
  onGenerateVoiceover: () => void;
  onExport: () => void;
};

export function VideoPreview(props: Props) {
  const { playerRef, scenes, title, voiceover, tone, voiceId, voices, playing, durationSeconds, generatingVoiceover, renderingVideo, renderProgress, renderDownloadUrl, notice, generatingVideo, pipelineStep, onToneChange, onVoiceChange, onPlayToggle, onGenerateVoiceover, onExport } = props;
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === playerWrapRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    if (!playerWrapRef.current) return;
    if (document.fullscreenElement === playerWrapRef.current) await document.exitFullscreen();
    else await playerWrapRef.current.requestFullscreen();
  };

  return <section className="preview-column">
    <div className="preview-head"><div><div className="eyebrow">A LITTLE SNEAK PEEK</div><h2>Your video</h2></div><button className="export-button" disabled={renderingVideo || !voiceover} onClick={onExport}>{renderingVideo ? `Rendering ${Math.round(renderProgress * 100)}%` : 'Export MP4 ↓'}</button></div>
    <div className="player-wrap" ref={playerWrapRef}>{scenes.length ? <Player ref={playerRef} component={LessonVideo} inputProps={{ scenes, title, audioSrc: voiceover?.audioUrl, sceneTimings: voiceover?.sceneTimings }} durationInFrames={Math.max(1, Math.ceil(durationSeconds * 30))} fps={30} compositionWidth={1080} compositionHeight={1920} loop className="lesson-remotion-player" style={{ width: '100%', height: '100%' }} /> : <div className="empty-video"><span>▯</span><strong>Your video preview</strong><small>Start with a topic. We’ll build the lesson and video here.</small></div>}{scenes.length > 0 && <button className="play-toggle" aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={onPlayToggle}><span>{playing ? 'Ⅱ' : '▶'}</span></button>}<button className="fullscreen-toggle" type="button" aria-label={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'} onClick={() => void toggleFullscreen()}>{isFullscreen ? '×' : '⛶'}</button><div className="preview-badge">✳ &nbsp; VIDEO PREVIEW</div>{generatingVideo && <div className="video-generation-overlay" role="status" aria-live="polite"><span className="loader-ring" /><strong>Making your lesson video</strong><small>{pipelineStep || 'Preparing your lesson…'}</small></div>}</div>
    <div className="preview-meta"><span>▯ &nbsp; 9:16 vertical</span><span>•</span><span>{durationSeconds} sec</span><span>•</span><span>{voiceover ? 'Narration synced' : 'Animated teaching steps'}</span></div>
    {renderingVideo && <div className="render-track"><i style={{ width: `${Math.max(3, renderProgress * 100)}%` }} /></div>}
    {renderDownloadUrl && <a className="render-download" href={renderDownloadUrl} download="little-lessons.mp4">Download finished video (MP4) ↗</a>}
    <div className="voice-panel"><div className="voice-top"><div className="next-icon">♫</div><div className="voice-copy"><strong>{voiceover ? 'Voiceover is ready' : 'Add a voice to this lesson'}</strong><span>{voiceover ? 'ElevenLabs narration with scene timing.' : 'Generate narration for the current storyboard.'}</span></div><label className="tone-select"><span>VOICE</span><select value={voiceId} onChange={event => onVoiceChange(event.target.value)} disabled={!voices.length}>{voices.length ? voices.map(voice => <option key={voice.voiceId} value={voice.voiceId}>{voice.name}</option>) : <option value="">Configure a voice in .env</option>}</select></label><label className="tone-select"><span>TONE</span><select value={tone} onChange={event => onToneChange(event.target.value as NarrationTone)}><option value="friendly">Friendly</option><option value="energetic">Energetic</option><option value="calm">Calm</option></select></label></div><div className="voice-controls"><button className="voice-button" disabled={generatingVoiceover || !voiceId} onClick={onGenerateVoiceover}>{generatingVoiceover ? 'Generating voiceover…' : voiceover ? 'Regenerate voiceover' : 'Generate voiceover'}</button>{voiceover && <a className="download-audio" href={voiceover.audioUrl} download="lesson-narration.mp3">Download MP3 ↗</a>}</div>{voiceover && <div className="audio-preview"><audio controls src={voiceover.audioUrl}>Your browser does not support audio playback.</audio></div>}</div>
    {notice && <div className="notice">{notice}</div>}
  </section>;
}
