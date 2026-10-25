import type { Scene } from './lesson';

export type AnimationStyle = 'doodle' | 'whiteboard';

const whiteboardTopics = /\b(math|mathematics|algebra|geometry|equation|fraction|percentage|pythag|physics|chemistry|biology|science|scientific|atom|molecule|cell|photosynthesis|gravity|force|energy|electricity|circuit|coding|programming|algorithm|computer|engineering|geography|history|timeline|economics|finance|statistics|data|grammar|language|process|system|how does|how do)\b/i;
const whiteboardScenes = /(?:\d\s*[+\-×÷=^]|\b(?:formula|equation|proof|cycle|process|steps|compare|cause|effect|structure|system|diagram|parts|stages)\b)/i;

export function resolveAnimationStyle(topic: string, scene: Scene): AnimationStyle {
  if (scene.animationStyle === 'doodle' || scene.animationStyle === 'whiteboard') return scene.animationStyle;
  if (scene.diagramType === 'right-triangle' || whiteboardTopics.test(topic) || whiteboardScenes.test(`${scene.label} ${scene.caption} ${scene.narration}`)) {
    return 'whiteboard';
  }
  return 'doodle';
}
