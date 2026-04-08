// ================================================================
// promptTemplates.js — Built-in templates for Sentry AI
// ================================================================

export const PROMPT_TEMPLATES = [
  {
    id: 'summarize',
    name: 'Summarize',
    prompt: 'Please provide a concise summary of the following text in 3-5 bullet points:\n\n',
    icon: '📝',
    description: 'Boil down long text',
  },
  {
    id: 'explain',
    name: 'Explain Like I\'m 5',
    prompt: 'Explain the following concept in simple terms that a child could understand:\n\n',
    icon: '👶',
    description: 'Simplify complex ideas',
  },
  {
    id: 'code_review',
    name: 'Code Review',
    prompt: 'Review this code for bugs, performance issues, and best practices:\n\n',
    icon: '🔍',
    description: 'Find bugs & optimize',
  },
  {
    id: 'translate',
    name: 'Translate',
    prompt: 'Translate the following text to Spanish/French/etc:\n\n',
    icon: '🌍',
    description: 'Convert language',
  }
];
