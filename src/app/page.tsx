'use client';

import { useState, useRef, useEffect } from 'react';
import { PROVIDER_URLS, type ProviderKey } from '@/constants/providers';
import { useLoadScript, Autocomplete } from '@react-google-maps/api';

interface Location {
  lat: number;
  lng: number;
  address?: string;
}

const libraries = ['places'];
const ENABLE_AUTOCOMPLETE = process.env.NEXT_PUBLIC_ENABLE_AUTOCOMPLETE === 'true';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey>('unitedhealthcare');
  const [isLoading, setIsLoading] = useState(false);
  const [specialistType, setSpecialistType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [isLocationSet, setIsLocationSet] = useState(false);
  const [actions, setActions] = useState<string[]>([]);

  const { isLoaded } = useLoadScript(
    ENABLE_AUTOCOMPLETE ? {
      googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
      libraries: libraries as ['places'],
    } : {
      googleMapsApiKey: '',
      libraries: [] as never[],
    }
  );

  const handleAddressInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocation(prev => prev ? {
      ...prev,
      address: e.target.value
    } : {
      lat: 0,
      lng: 0,
      address: e.target.value
    });
  };

  const handleGetCurrentLocation = () => {
    console.log('Starting location fetch...');
    setIsLoadingLocation(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          console.log('Raw coords:', position.coords);
          try {
            const response = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?latlng=${position.coords.latitude},${position.coords.longitude}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
            );
            const data = await response.json();
            console.log('Geocoding response:', data);
            const address = data.results[0]?.formatted_address;
            
            const locationData = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              address,
            };
            console.log('Setting location to:', locationData);
            setLocation(locationData);
            setIsLocationSet(true);
            setError(null);
          } catch (err) {
            console.error('Geocoding error:', err);
            setError('Failed to get address from coordinates');
            setIsLocationSet(false);
          } finally {
            setIsLoadingLocation(false);
          }
        },
        (err) => {
          console.error('Geolocation error:', err);
          setError('Failed to get your location');
          setIsLocationSet(false);
          setIsLoadingLocation(false);
        }
      );
    }
  };

  const handlePlaceSelect = (place: google.maps.places.PlaceResult) => {
    if (place.geometry?.location) {
      setLocation({
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        address: place.formatted_address || '',
      });
      setIsLocationSet(true);
      setError(null);
    }
  };

  const handleSearch = async () => {
    setActions([]); // Clear previous actions
    if (!location) {
      setError('Please enter your location or use current location');
      return;
    }

    try {
      setIsLoading(true);
      setSpecialistType('');
      setError(null);
      console.log('Fetching search results...');
      
      // Create fetch request with correct headers for streaming
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',  // Add this to indicate we want SSE
        },
        body: JSON.stringify({
          query: searchQuery,
          provider: selectedProvider,
          location,
        }),
      });

      // Get the response body as a ReadableStream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      // Create a TextDecoder to convert chunks to text
      const decoder = new TextDecoder();
      let buffer = ''; // Buffer for incomplete chunks

      // Read the stream
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        // Convert the chunk to text and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Split on double newlines (SSE format)
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep the last incomplete chunk

        // Process complete messages
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix
              console.log('Received data:', data);

              if (data.message) {
                setActions(prev => [...prev, data.message]);
              } else if (data.action) {
                setActions(prev => [...prev, data.action]);
              } else if (data.complete) {
                setSpecialistType(data.results.specialists.join(' → '));
              } else if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Search error:', error);
      setError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const renderAddressInput = () => {
    if (!ENABLE_AUTOCOMPLETE) {
      return (
        <input
          type="text"
          placeholder="Enter your address"
          className="w-full p-4 text-lg border rounded-full shadow-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          value={location?.address || ''}
          onChange={handleAddressInput}
        />
      );
    }

    return (
      <Autocomplete
        onLoad={(autocomplete) => {
          autocomplete.setOptions({
            componentRestrictions: { country: 'us' },
            types: ['address']
          });
        }}
        onPlaceChanged={() => {
          const autocomplete = document.querySelector('input') as HTMLInputElement;
          const place = (autocomplete as any).getPlace() as google.maps.places.PlaceResult;
          handlePlaceSelect(place);
        }}
      >
        <input
          type="text"
          placeholder="Enter your address"
          className="w-full p-4 text-lg border rounded-full shadow-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          value={location?.address || ''}
          onChange={handleAddressInput}
        />
      </Autocomplete>
    );
  };

  if (ENABLE_AUTOCOMPLETE && !isLoaded) return <div>Loading...</div>;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-3xl space-y-6 text-center">
        <h1 className="text-6xl mb-4">Referral Coordination Agent</h1>
        <p className="text-xl text-gray-600 mb-12">
          Find care in just a few moments
        </p>
        
        <div className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Describe your symptoms or condition..."
              className="w-full p-6 pr-16 text-xl border rounded-full shadow-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              {renderAddressInput()}
            </div>
            <button
              onClick={handleGetCurrentLocation}
              disabled={isLoadingLocation || isLocationSet}
              className={`px-6 py-4 rounded-full transition-colors duration-200 whitespace-nowrap flex items-center gap-2
                ${isLocationSet 
                  ? 'bg-green-500 text-white cursor-default' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {isLoadingLocation ? 'Getting location...' : isLocationSet ? (
                <>
                  <CheckIcon />
                  <span>Location Set</span>
                </>
              ) : 'Use Current Location'}
            </button>
          </div>

          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value as ProviderKey)}
            className="w-full p-4 text-lg border rounded-full shadow-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer"
          >
            <option value="unitedhealthcare">UnitedHealthcare</option>
            <option value="aetna">Aetna</option>
            <option value="cigna">Cigna</option>
          </select>

          <button
            onClick={handleSearch}
            disabled={isLoading}
            className="w-full p-4 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors duration-200 disabled:bg-blue-300 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-100">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {specialistType && !error && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg">
            <p className="text-blue-800">Recommended specialists: {specialistType}</p>
          </div>
        )}

        {actions.length > 0 && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg w-full max-w-3xl">
            <h3 className="font-semibold mb-2">Search Progress</h3>
            <ul className="space-y-2">
              {actions.map((action: string, index: number) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">{index + 1}.</span>
                  <span className="text-gray-700">{action}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

const CheckIcon = () => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    fill="none" 
    viewBox="0 0 24 24" 
    strokeWidth={2} 
    stroke="currentColor" 
    className="w-6 h-6"
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      d="M4.5 12.75l6 6 9-13.5" 
    />
  </svg>
);