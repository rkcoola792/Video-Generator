import type { LearnerAudience } from '../types';

type Props = {
  topic: string;
  audience: LearnerAudience;
  duration: number;
  onTopicChange: (topic: string) => void;
  onAudienceChange: (audience: LearnerAudience) => void;
  onDurationChange: (duration: number) => void;
  generatingVideo: boolean;
  drafting: boolean;
  disabled: boolean;
  pipelineStep: string;
  onGenerateVideo: () => void;
};

export function LessonBrief({ topic, audience, duration, onTopicChange, onAudienceChange, onDurationChange, generatingVideo, drafting, disabled, pipelineStep, onGenerateVideo }: Props) {
  return <section className="idea-card">
    <div className="idea-main"><div className="idea-icon">✎</div><div className="idea-copy"><div className="eyebrow">WHAT SHOULD YOUR VIDEO EXPLAIN?</div><input className="idea-title-input" aria-label="Lesson topic" placeholder="e.g. Explain the Pythagorean theorem" value={topic} disabled={disabled} onChange={event => onTopicChange(event.target.value)} /></div></div>
    <div className="idea-options">
      <label><span>MADE FOR</span><select value={audience} disabled={disabled} onChange={event => onAudienceChange(event.target.value as LearnerAudience)}><option>Kids</option><option>Teens</option><option>Adult beginners</option></select></label>
      <div className="option-divider" />
      <label><span>VIDEO LENGTH</span><select value={duration} disabled={disabled} onChange={event => onDurationChange(Number(event.target.value))}><option value={30}>30 seconds</option><option value={45}>45 seconds</option><option value={60}>60 seconds</option></select></label>
      <div className="option-divider" />
      <div className="format-option"><span>FORMAT</span><strong>▯ &nbsp; Vertical video</strong></div>
      <button className="generate-video-button brief-generate-button" disabled={generatingVideo || drafting} onClick={onGenerateVideo}>
        {generatingVideo ? <><span className="button-loader" aria-hidden="true">◌</span> Generating video…</> : drafting ? <><span className="button-loader" aria-hidden="true">◌</span> Drafting lesson…</> : <>✦ Generate video</>}
        {!generatingVideo && !drafting && <span aria-hidden="true">↗</span>}
      </button>
    </div>
    {pipelineStep && <div className="pipeline-status brief-pipeline-status">◌ &nbsp; {pipelineStep}</div>}
  </section>;
}
