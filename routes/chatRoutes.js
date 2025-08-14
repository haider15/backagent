// routes/chatRoutes.js
import express from 'express';
import {
  handleChat,
  getHistory,
  getConversations,
  createConversation,
  deleteConversation,

} from '../controllers/chatController.js';
import { generateAgentGraph } from '../controllers/generateGraph.js';

const router = express.Router();

router.get('/conversations', getConversations);
router.post('/conversations', createConversation);
router.delete('/conversations/:id', deleteConversation);
router.post('/chat', handleChat);
router.get('/history/:conversationId', getHistory);
router.get('/graph', generateAgentGraph); // 👈 visualisation agent

export default router;
