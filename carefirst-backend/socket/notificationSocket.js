let io = null;

const initSocket = (ioInstance) => {
  io = ioInstance;

  io.on('connection', (socket) => {
    // Each client sends their userId immediately after connecting
    // so the server can route notifications to them
    socket.on('join', (userId) => {
      if (userId) {
        socket.join(userId.toString());
        console.log(`[Socket] User ${userId} joined room`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
    });
  });
};

// Called from controllers to push a notification to a specific user in real time
const sendNotification = (userId, notification) => {
  if (io && userId) {
    io.to(userId.toString()).emit('notification:new', notification);
  }
};

module.exports = { initSocket, sendNotification };
