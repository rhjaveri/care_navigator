'use client';

import { useEffect, useState } from 'react';
import { WebSocketService } from '@/services/WebSocketService';

export function SearchProgress() {
  const [status, setStatus] = useState('');
  const [currentAction, setCurrentAction] = useState('');
  
  useEffect(() => {
    const ws = new WebSocketService();
    const socket = ws.connect();

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'status') {
        setStatus(data.message);
      } else if (data.type === 'action') {
        setCurrentAction(data.message);
      }
    };

    return () => ws.disconnect();
  }, []);

  if (!status && !currentAction) return null;

  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
      <h3 className="font-semibold">Search Progress</h3>
      {status && <p className="text-gray-600">{status}</p>}
      {currentAction && (
        <p className="text-sm text-gray-500 mt-2">
          Current action: {currentAction}
        </p>
      )}
    </div>
  );
} 