import { Server } from 'socket.io';
import config from '../config/env.js';

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.cors.origin,
      credentials: config.cors.credentials
    }
  });

  io.on('connection', (socket) => {
    console.log(`[SOCKET] Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[SOCKET] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function emitIngestionUpdate(payload) {
  if (!io) {
    return false;
  }

  io.emit('ingestion:update', {
    emittedAt: new Date().toISOString(),
    ...payload
  });

  return true;
}