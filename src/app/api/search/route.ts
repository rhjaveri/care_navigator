import { NextResponse } from 'next/server';
import { PROVIDER_URLS, type ProviderKey } from '@/constants/providers';
import OpenAI from 'openai';
import { WebAgentService } from '@/services/WebAgentService';

interface Location {
  lat: number;
  lng: number;
  address?: string;
}

interface SearchRequest {
  query: string;
  provider: ProviderKey;
  location: Location;
}

function validateRequest(body: any): { isValid: boolean; error?: string } {
  console.log('Validating request body:', body);
  
  // Check if all required fields exist
  if (!body.query || !body.provider || !body.location) {
    console.log('Missing required fields');
    return { 
      isValid: false, 
      error: 'Missing required fields: query, provider, and location are required' 
    };
  }

  // Validate location data
  const location = body.location;
  console.log('Validating location:', location);
  if (!location.lat || !location.lng || !location.address) {
    console.log('Invalid location data:', {
      hasLat: !!location.lat,
      hasLng: !!location.lng,
      hasAddress: !!location.address
    });
    return { 
      isValid: false, 
      error: 'Invalid location: latitude, longitude, and address are required' 
    };
  }

  // Validate provider
  if (!Object.keys(PROVIDER_URLS).includes(body.provider)) {
    return { 
      isValid: false, 
      error: 'Invalid insurance provider selected' 
    };
  }

  return { isValid: true };
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function processQuery(query: string) {
  const systemPrompt = `You are a medical referral specialist. Convert patient descriptions into appropriate specialist referrals.
  Focus on providing THREE specialist types that could handle the patient's condition, ordered from most general to most specific.
  
  If the query is not medical in nature or doesn't describe any symptoms/conditions, respond with "NOT_MEDICAL_QUERY".
  Otherwise, respond with three specialist types separated by '|' characters, no other text.
  
  The first specialist should be the most general option that can handle the condition.
  The second specialist should be more specialized but still general enough to handle the condition.
  The third specialist should be the most specific specialist for the exact condition.
  
  Examples:
  Input: "My back has been hurting for weeks and the pain goes down my leg"
  Output: Primary Care Physician|Orthopedist|Orthopedic Spine Specialist

  Input: "I've been having chest pain and shortness of breath"
  Output: Primary Care Physician|Internal Medicine|Cardiologist

  Input: "What's the weather like today?"
  Output: NOT_MEDICAL_QUERY`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query }
    ],
    temperature: 0.1,
    stream: false,
  });

  const content = response.choices[0].message.content;
  
  if (content === 'NOT_MEDICAL_QUERY') {
    return { isError: true, message: 'Please describe your medical symptoms or health concerns so we can help find the right specialist.' };
  }

  const specialists = content?.split('|') || [];
  return { isError: false, specialists };
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  try {
    const body = await request.json();
    console.log('Request body parsed:', body);

    const validation = validateRequest(body);
    if (!validation.isValid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const result = await processQuery(body.query);
    if (result.isError || !result.specialists?.length) {
      const error = result.isError ? result.message : 'Cannot identify specialist types';
      return NextResponse.json({ error }, { status: 400 });
    }

    // Check Browserbase configuration
    if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
      console.error('Missing Browserbase credentials');
      return NextResponse.json({ error: 'Search service not properly configured' }, { status: 500 });
    }

    // Create response with streaming headers
    const response = new NextResponse(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

    // Start the search process
    (async () => {
      try {
        // Send initial message
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ message: 'Starting provider search...' })}\n\n`)
        );

        const webAgent = new WebAgentService({
          provider: PROVIDER_URLS[body.provider as ProviderKey],
          specialists: result.specialists,
          location: body.location,
          onAction: async (action) => {
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({ action })}\n\n`)
            );
          }
        });

        await webAgent.init();
        const searchResults = await webAgent.executeSearch();
        
        // Send completion message
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ complete: true, results: searchResults })}\n\n`)
        );
      } catch (error) {
        console.error('Search process error:', error);
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ error: 'Search failed' })}\n\n`)
        );
      } finally {
        await writer.close();
      }
    })();

    return response;

  } catch (error) {
    console.error('Request error:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
} 