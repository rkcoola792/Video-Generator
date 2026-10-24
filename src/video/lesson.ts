export type Scene = {
  id: string;
  label: string;
  seconds: number;
  narration: string;
  caption: string;
  visual: 'hook' | 'explain' | 'scatter' | 'recap';
  accent: string;
  sources?: SourceReference[];
  needsFactCheck?: boolean;
  imageUrl?: string;
  visualSteps?: string[];
  diagramType?: 'right-triangle' | 'flow' | 'cycle' | 'comparison' | 'cause-effect';
};

export type SourceReference = { title: string; url: string };

export const lesson = {
  title: 'Why is the sky blue?',
  topic: 'Why is the sky blue?',
  audience: 'Kids',
  duration: 30,
  scenes: [
    { id: 'hook', label: 'The question', seconds: 5, narration: 'Have you ever wondered why the sky looks blue?', caption: 'Why is the sky blue?', visual: 'hook', accent: '#ffc857' },
    { id: 'sunlight', label: 'Sunlight', seconds: 7, narration: 'Sunlight looks white, but it is made of every color in a rainbow.', caption: 'Sunlight holds every rainbow color.', visual: 'explain', accent: '#ff9b71' },
    { id: 'air', label: 'Air scatters blue', seconds: 8, narration: 'As sunlight passes through the air, tiny gas molecules scatter blue light in every direction.', caption: 'Air scatters blue light around us.', visual: 'scatter', accent: '#74c6d4' },
    { id: 'eyes', label: 'What we see', seconds: 5, narration: 'Blue light reaches your eyes from all across the sky, so the whole sky seems blue.', caption: 'Blue light reaches your eyes from everywhere.', visual: 'explain', accent: '#8b9fe8' },
    { id: 'recap', label: 'Quick recap', seconds: 5, narration: 'Sunlight meets air. The air scatters blue light. That is why the sky looks blue!', caption: 'Sunlight + air = a blue-looking sky!', visual: 'recap', accent: '#92b88c' },
  ] satisfies Scene[],
};
