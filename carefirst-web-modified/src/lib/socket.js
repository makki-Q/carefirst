import { io } from 'socket.io-client';

let _socket = null;

export const getSocket = () => {
  if (!_socket) {
    _socket = io({ transports: ['websocket', 'polling'] });
  }
  return _socket;
};

export const disconnectSocket = () => {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
};
