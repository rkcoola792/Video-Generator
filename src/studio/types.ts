import type { Scene } from '../video/lesson';

export type { Scene };

export type Voiceover = {
  audioUrl: string;
  durationSeconds: number;
  tone: string;
  voiceId: string;
  sceneTimings: Array<{ sceneId: string; startSeconds: number; endSeconds: number }>;
};

export type LearnerAudience = 'Kids' | 'Teens' | 'Adult beginners';
export type NarrationTone = 'friendly' | 'energetic' | 'calm';
