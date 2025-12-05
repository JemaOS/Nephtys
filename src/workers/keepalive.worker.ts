// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Keep-Alive Web Worker for PWA
// This worker runs in a separate thread and maintains connection health
// even when the main thread is throttled by Android

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let lastPingTime = Date.now();
let isActive = true;

// Configuration
const HEARTBEAT_INTERVAL = 10000; // 10 seconds - aggressive heartbeat
const STALE_THRESHOLD = 30000; // 30 seconds without response = stale

// Send message to main thread
function postToMain(type: string, data?: any) {
  self.postMessage({ type, ...data });
}

// Start heartbeat
function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  console.log('[KeepAlive Worker] Starting heartbeat...');
  
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastPing = now - lastPingTime;
    
    // Send heartbeat to main thread
    postToMain('HEARTBEAT', { timestamp: now });
    
    // Check if connection seems stale
    if (timeSinceLastPing > STALE_THRESHOLD) {
      console.log('[KeepAlive Worker] Connection seems stale, requesting reconnect');
      postToMain('REQUEST_RECONNECT', { 
        reason: 'stale',
        lastPing: lastPingTime,
        elapsed: timeSinceLastPing 
      });
    }
  }, HEARTBEAT_INTERVAL);
}

// Stop heartbeat
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  console.log('[KeepAlive Worker] Heartbeat stopped');
}

// Handle messages from main thread
self.onmessage = (event) => {
  const { type, ...data } = event.data;
  
  switch (type) {
    case 'START':
      isActive = true;
      lastPingTime = Date.now();
      startHeartbeat();
      postToMain('STARTED');
      break;
      
    case 'STOP':
      isActive = false;
      stopHeartbeat();
      postToMain('STOPPED');
      break;
      
    case 'PONG':
      // Main thread responded to our heartbeat
      lastPingTime = Date.now();
      break;
      
    case 'VISIBILITY_CHANGE':
      if (data.visible) {
        // App became visible - reset ping time and ensure heartbeat is running
        lastPingTime = Date.now();
        if (isActive && !heartbeatInterval) {
          startHeartbeat();
        }
        // Request immediate reconnect check
        postToMain('REQUEST_RECONNECT', { reason: 'visibility' });
      }
      break;
      
    case 'NETWORK_CHANGE':
      if (data.online) {
        // Network came back online
        lastPingTime = Date.now();
        postToMain('REQUEST_RECONNECT', { reason: 'network' });
      }
      break;
      
    default:
      console.log('[KeepAlive Worker] Unknown message type:', type);
  }
};

// Start immediately
console.log('[KeepAlive Worker] Worker initialized');