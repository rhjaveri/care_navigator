import { OpenAI } from 'openai';

// Initialize the OpenAI client directly
export const LLMClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}); 