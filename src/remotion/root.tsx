import React from 'react';
import { Composition } from 'remotion';
import { LessonVideo } from '../video/LessonVideo';
import { lesson } from '../video/lesson';
import '../studio/styles.css';

export const RemotionRoot: React.FC = () => <Composition
  id="LessonVideo"
  component={LessonVideo}
  durationInFrames={lesson.duration * 30}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={{ scenes: lesson.scenes, title: lesson.title }}
  calculateMetadata={({ props }) => {
    const timings = (props as { sceneTimings?: Array<{ endSeconds: number }> }).sceneTimings;
    const scenes = (props as { scenes?: Array<{ seconds: number }> }).scenes ?? lesson.scenes;
    const audioDuration = (props as { audioDurationSeconds?: number }).audioDurationSeconds ?? 0;
    const sceneDuration = timings?.length
      ? Math.max(...timings.map((timing) => timing.endSeconds))
      : scenes.reduce((sum, scene) => sum + scene.seconds, 0);
    return { durationInFrames: Math.ceil(Math.max(sceneDuration, audioDuration) * 30) };
  }}
/>;
