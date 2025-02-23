import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config";
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const ProviderSchema = z.object({
  name: z.string(),
  specialty: z.string(),
  address: z.string(),
  phone: z.string().optional(),
});

const SearchResultsSchema = z.object({
  providers: z.array(ProviderSchema)
});

const ActionSchema = z.object({
  text: z.string(),
  reasoning: z.string(),
  tool: z.enum([
    "GOTO",
    "ACT",
    "EXTRACT",
    "OBSERVE",
    "CLOSE",
    "WAIT",
    "NAVBACK",
  ]),
  instruction: z.string(),
});

interface WebAgentConfig {
  provider: string;
  specialists: string[];
  location: {
    lat: number;
    lng: number;
    address: string;
  };
  onAction?: (action: string) => Promise<void>;
}

export class WebAgentService {
  private stagehand: Stagehand;
  private config: WebAgentConfig;
  private maxRetries = 3;
  private actionTimeout = 10000;
  private actionHistory: string[] = [];

  constructor(agentConfig: WebAgentConfig) {
    this.stagehand = new Stagehand(StagehandConfig);
    this.config = agentConfig;
  }

  async init() {
    try {
      console.log('Initializing Stagehand');
      await this.stagehand.init();
      console.log('Stagehand initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Stagehand:', error);
      throw new Error('Failed to initialize web agent');
    }
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    errorMessage: string
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        console.error(`Attempt ${i + 1} failed:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
    
    throw new Error(`${errorMessage}: ${lastError?.message}`);
  }

  async getNextAction(currentState: string): Promise<string> {
    return this.retryOperation(async () => {
      console.log('Getting next action, current state:', currentState);
      
      const systemPrompt = `You are a care navigation assistant. Your goal is to find healthcare providers based on the following criteria:
      Specialist Types (in order of preference): ${this.config.specialists.join(', ')}
      Location: ${this.config.location.address}

      At a high level, You are navigating health insurance provider directories to find 3 in-network providers for the specialist types and location provided.
      The insurance directory website may be difficult to navigate, so you may need to take multiple actions to find the providers.
      You do not have access to any login or account, so utilize the guest user access wherever you can.

      Based on the current state of the page, determine the next Stagehand action to take. This can take one of the following forms:
      - ACT: allows Stagehand to interact with a web page. Perform a single interaction with the page (click, type, select)
      - OBSERVE: used to get a list of actions that can be taken on the current page. It's useful for adding context to your planning step, or if you unsure of what page you're on.
      - GOTO: allows Stagehand to navigate to a specific URL.
      - CLOSE: End the session when the goal is complete
      - WAIT: Wait for a specified amount of time
      - NAVBACK: Navigate back to the previous page
      - EXTRACT: indicates that the results should be extracted from the page. Grabs structured text from the current page using zod.

      Important guidelines:
      1. Break down complex actions into individual atomic steps
      2. For ACT commands, use only one action at a time, such as:
        - Single click on a specific element
        - Type into a single input field
        - Select a single option
      3. Avoid combining multiple actions in one instruction
      4. If multiple actions are needed, they should be separate steps

      You must respond with:
      1. A reasoning explaining your thought process
      2. The tool you want to use (from the list above)
      3. A specific instruction for that tool

      Previous actions taken:
      ${this.actionHistory.map((action, index) => `${index + 1}. ${action}`).join('\n')}
      
      Current page state:
      ${currentState}`;

      console.log('System prompt prepared');

      const result = await generateObject({
        messages: [{
          role: 'system',
          content: systemPrompt
        }],
        schema: ActionSchema,
        model: openai('gpt-4o')
      });

      console.log('LLM response received:', result);

      // Format the action string
      const action = `${result.object.tool}: ${result.object.instruction}`;
      console.log('Action formatted:', action);
      
      this.actionHistory.push(action);
      await this.config.onAction?.(action);
      console.log('Action processed and sent');

      return action;
    }, 'Failed to get next action from LLM');
  }
  // where the Stagehand action is executed
  private async executeAction(action: string) {
    return this.retryOperation(async () => {
      const page = this.stagehand.page;
      await Promise.race([
        page.act({ action }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Action timeout')), this.actionTimeout)
        )
      ]);
    }, `Failed to execute action: ${action}`);
  }

  async executeSearch() {
    try {
      const page = this.stagehand.page;
      
      // Start at the provider's website (predefined in the providers.ts file)
      await page.goto(this.config.provider);

      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;

      while (true) {
        try {
          // Observe the current state of the page
          const pageState = await page.observe({
            instruction: "Describe the current state of the provider search page"
          });

          // Get next action from LLM
          const nextAction = await this.getNextAction(JSON.stringify(pageState));

          if (nextAction.toLowerCase().includes('complete') || nextAction.toLowerCase().includes('finished')) {
            break;
          }

          // Execute the action
          await this.executeAction(nextAction);
          consecutiveErrors = 0; // Reset error counter on success

          // Add delay for visibility
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          consecutiveErrors++;
          console.error(`Error during search (attempt ${consecutiveErrors}):`, error);
          
          if (consecutiveErrors >= maxConsecutiveErrors) {
            throw new Error('Too many consecutive errors');
          }
          
          // Take screenshot on error
          await page.screenshot({ 
            path: `error-${Date.now()}.png`,
            fullPage: true 
          });
          
          continue; // Try next action
        }
      }

      // Extract final results
      const results = await page.extract({
        instruction: "Extract the list of providers found",
        schema: SearchResultsSchema
      });

      return SearchResultsSchema.parse(results);

    } catch (error) {
      console.error('Web agent error:', error);
      throw error;
    } finally {
      // Cleanup
      await this.close();
    }
  }

  async close() {
    await this.stagehand.close();
  }
} 