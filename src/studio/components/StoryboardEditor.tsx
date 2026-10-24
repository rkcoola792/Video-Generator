import type { Scene } from '../types';

type Props = {
  scenes: Scene[];
  selected: number;
  onSelect: (index: number) => void;
  onUpdate: (index: number, key: 'narration' | 'caption', value: string) => void;
  onAdd: () => void;
  onRestore: () => void;
  busy?: boolean;
};

export function StoryboardEditor({ scenes, selected, onSelect, onUpdate, onAdd, onRestore, busy = false }: Props) {
  const scene = scenes[selected];
  return <section className="storyboard-panel">
    <div className="panel-heading"><div><div className="eyebrow">THE STORY</div><h2>Storyboard <span>{scenes.length ? `${scenes.length} scenes` : 'ready when you are'}</span></h2></div>{scenes.length > 0 && <button className="quiet-button" disabled={busy} onClick={onAdd}>＋ Add scene</button>}</div>
    {scenes.length === 0 ? <div className="story-empty"><span>✦</span><strong>Your lesson plan will appear here</strong><small>Enter a topic above and choose Generate video.</small></div> : <div className="scene-list">{scenes.map((item, index) => <button key={item.id} disabled={busy} className={`scene-row ${selected === index ? 'selected' : ''}`} onClick={() => onSelect(index)}><span className="scene-number">{String(index + 1).padStart(2, '0')}</span><span className="scene-dot" style={{ background: item.accent }} /><span className="scene-name">{item.label}</span><span className="scene-time">{item.seconds}s</span><span className="row-more">···</span></button>)}</div>}
    {scene && <div className="edit-card"><div className="edit-header"><div className="edit-swatch" style={{ background: scene.accent }} /><div><span className="eyebrow">SCENE {String(selected + 1).padStart(2, '0')}</span><strong>{scene.label}</strong></div><span className="edit-time">{scene.seconds}s</span></div><label className="field-label">NARRATION<textarea disabled={busy} value={scene.narration} onChange={event => onUpdate(selected, 'narration', event.target.value)} rows={3} /></label><label className="field-label">ON-SCREEN CAPTION<input disabled={busy} value={scene.caption} onChange={event => onUpdate(selected, 'caption', event.target.value)} /></label><div className={`source-note ${scene.needsFactCheck ? 'needs-check' : 'sources-found'}`}><span>{scene.needsFactCheck ? '◎' : '✓'}</span><div><strong>{scene.needsFactCheck ? 'Review factual claims' : scene.sources?.length ? 'References attached' : 'No factual claim flagged'}</strong>{scene.sources?.length ? <div className="source-links">{scene.sources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">{index + 1}. {source.title}</a>)}</div> : <small>{scene.needsFactCheck ? 'No source was linked to this scene. Check its claims before production.' : 'This scene has no linked factual references.'}</small>}</div></div></div>}
    <div className="story-footer"><span>Changes save automatically on this device.</span><button disabled={busy} onClick={onRestore}>Restore starter story</button></div>
  </section>;
}
