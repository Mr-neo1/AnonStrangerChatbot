/**
 * Chat Handlers Module
 * Handles core chat functionality (search, connect, disconnect)
 */

const { redisClient } = require('../database/redisClient');
const keyboards = require('../utils/keyboards');
const enhancedMessages = require('../utils/enhancedMessages');
const MessagesService = require('../services/messagesService');
const MatchingService = require('../services/matchingService');
const LockChatService = require('../services/lockChatService');
const AbuseService = require('../services/abuseService');
const ChatRatingService = require('../services/chatRatingService');
const BotRouter = require('../utils/botRouter');
const stateManager = require('../utils/stateManager');
const config = require('../config/config');

// Rotating search messages
const SEARCH_MESSAGES = [
  'Searching for a partner🔎',
  '🔍 Matching.....',
  '🔍 Looking for partner...👀'
];

class ChatHandlers {
  constructor(bot, controller) {
    this.bot = bot;
    this.controller = controller;
  }

  /**
   * Search for a partner
   */
  async searchPartner(chatId) {
    const botId = this.bot.botId || 'default';

    // Clear any existing search interval before starting new search
    stateManager.clearSearchInterval(chatId);

    // Start match attempt
    const match = await MatchingService.matchNextUser(botId, chatId);

    if (match) {
      // Clear any search messages
      const searchMsgId = stateManager.getSearchMessageId(chatId);
      if (searchMsgId) {
        try {
          await this.bot.deleteMessage(chatId, searchMsgId);
        } catch (e) {}
      }

      // Connect both users
      await this.connectUsers(chatId, match);
    } else {
      // Enqueue and show rotating search message
      await MatchingService.enqueueUser(botId, chatId);

      let msgIndex = 0;
      const searchMsgId = stateManager.getSearchMessageId(chatId);

      // Set up rotating message interval
      const intervalId = setInterval(async () => {
        msgIndex = (msgIndex + 1) % SEARCH_MESSAGES.length;

        try {
          const currentMsgId = stateManager.getSearchMessageId(chatId);
          if (currentMsgId) {
            await this.bot.editMessageText(SEARCH_MESSAGES[msgIndex], {
              chat_id: chatId,
              message_id: currentMsgId,
              parse_mode: 'Markdown'
            });
          }
        } catch (e) {
          // Message may have been deleted
        }
      }, 2000);

      stateManager.setSearchInterval(chatId, intervalId);
    }
  }

  /**
   * Connect two users together
   */
  async connectUsers(userId1, userId2) {
    // Set pairing in Redis
    await redisClient.set(`pair:${userId1}`, String(userId2));
    await redisClient.set(`pair:${userId2}`, String(userId1));

    // Clear search intervals for both
    stateManager.clearSearchInterval(userId1);
    stateManager.clearSearchInterval(userId2);

    // Increment chat counts
    const User = require('../models/userModel');
    await User.increment('totalChats', { where: { userId: userId1 } }).catch(() => {});
    await User.increment('totalChats', { where: { userId: userId2 } }).catch(() => {});

    // Track chat start time for rating
    stateManager.startSession(userId1, { partnerId: userId2, startTime: Date.now() });
    stateManager.startSession(userId2, { partnerId: userId1, startTime: Date.now() });

    // Send connected messages
    const connectedMsg = await MessagesService.getConnected() || enhancedMessages.connected;

    await Promise.all([
      this.bot.sendMessage(userId1, connectedMsg, {
        parse_mode: 'Markdown',
        ...keyboards.getActiveChatKeyboard()
      }),
      BotRouter.sendMessage(userId2, connectedMsg, {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getActiveChatKeyboard().reply_markup
      })
    ]).catch(console.error);
  }

  /**
   * Stop an active chat
   */
  async stopChat(chatId, skipMessage = null) {
    const partnerId = await redisClient.get(`pair:${chatId}`);

    // Check for lock
    let lockedRoom = null;
    if (await LockChatService.isChatLocked(chatId)) lockedRoom = String(chatId);
    else if (partnerId && await LockChatService.isChatLocked(partnerId)) lockedRoom = String(partnerId);

    if (lockedRoom) {
      const owners = await LockChatService.getLockOwners(lockedRoom);
      const ownerId = owners && owners.length > 0 ? owners[0] : null;

      if (String(chatId) !== String(ownerId)) {
        // Record abuse and deny
        try {
          await AbuseService.recordLockAbuse({
            chatId: lockedRoom,
            offenderId: chatId,
            ownerId,
            botId: config.BOT_ID || 'default'
          });
        } catch (_) {}

        await this.bot.sendMessage(chatId, '🔒 This chat is locked by your partner.', keyboards.getActiveChatKeyboard());
        return;
      }
    }

    // Get session info for rating
    const session = stateManager.getSession(chatId);
    let chatDuration = 0;
    if (session && session.startTime) {
      chatDuration = Math.floor((Date.now() - session.startTime) / 1000);
    }

    // Disconnect both users
    if (partnerId) {
      // Set pending rating for both users
      ChatRatingService.setPendingRating(chatId, {
        partnerId: partnerId,
        chatDuration,
        endedBy: 'self'
      });

      ChatRatingService.setPendingRating(partnerId, {
        partnerId: chatId,
        chatDuration,
        endedBy: 'partner'
      });

      // Clear pairing
      await redisClient.del(`pair:${chatId}`);
      await redisClient.del(`pair:${partnerId}`);

      // Clear any locks
      await LockChatService.clearAllLocks(chatId);
      await LockChatService.clearAllLocks(partnerId);

      // End sessions
      stateManager.endSession(chatId);
      stateManager.endSession(partnerId);

      // Get messages
      const chatEndedMsg = await MessagesService.getChatEnded() || '💬 You stopped the chat\n\n/next — find a new partner\n/report — send a complaint';
      const partnerLeftMsg = await MessagesService.getPartnerLeft() || '💬 Your partner has stopped the chat.\n\n/next — find a new partner\n/report — send a complaint';

      // Send "You stopped the chat" to the user who stopped
      await this.bot.sendMessage(chatId, chatEndedMsg, {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      }).catch(console.error);

      // Send "Partner stopped the chat" to the partner
      await BotRouter.sendMessage(partnerId, partnerLeftMsg, {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getMainKeyboard().reply_markup
      }).catch(console.error);
    } else {
      // Not in a chat
      const notPairedMsg = await MessagesService.getNotPaired() || '❗️ You are not in a dialogue\n\nUse 🎲 Find a partner to start chatting.';
      if (!skipMessage) {
        await this.bot.sendMessage(chatId, notPairedMsg, {
          parse_mode: 'Markdown',
          ...keyboards.getMainKeyboard()
        });
      }
    }
  }

  /**
   * Show rating prompt after chat ends
   */
  async _showRatingPrompt(userId) {
    const ratingMessage = `_If you wish, leave your feedback about your partner. It will help us find better partners for you in the future_`;

    try {
      await this.bot.sendMessage(userId, ratingMessage, {
        parse_mode: 'Markdown',
        reply_markup: ChatRatingService.getReportKeyboard()
      });
    } catch (error) {
      console.error(`Error showing rating prompt to ${userId}:`, error);
      // Fallback to main keyboard
      await this.bot.sendMessage(userId, '👋 Chat ended.', keyboards.getMainKeyboard()).catch(() => {});
    }
  }

  /**
   * Handle rating callback
   */
  async handleRatingCallback(callbackQuery) {
    const userId = callbackQuery.from.id;
    const chatId = callbackQuery.message?.chat?.id || userId;
    const data = callbackQuery.data;

    await this.bot.answerCallbackQuery(callbackQuery.id).catch(() => {});

    // Parse rating action
    if (data.startsWith('RATE:')) {
      const action = data.replace('RATE:', '');

      if (action === 'positive') {
        await ChatRatingService.submitPositiveRating(userId, this.bot.botId);
        await this._deleteAndShowMenu(chatId, callbackQuery.message?.message_id, '👍 Thanks for your feedback!');
      } else if (action === 'negative') {
        // Show detailed report menu
        await this.bot.editMessageReplyMarkup(ChatRatingService.getDetailedReportKeyboard(), {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id
        }).catch(() => {});
      }
    } else if (data.startsWith('REPORT:')) {
      const reason = data.replace('REPORT:', '');

      if (reason === 'menu') {
        // Show detailed report menu
        await this.bot.editMessageReplyMarkup(ChatRatingService.getDetailedReportKeyboard(), {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id
        }).catch(() => {});
      } else if (reason === 'back') {
        // Go back to main rating menu
        await this.bot.editMessageReplyMarkup(ChatRatingService.getReportKeyboard(), {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id
        }).catch(() => {});
      } else if (reason === 'other') {
        // Ask for custom description
        stateManager.setConversationState(userId, 'awaiting_report_details');
        await this._deleteAndShowMenu(chatId, callbackQuery.message?.message_id, '📝 Please describe the issue:');
      } else {
        // Submit report with specific reason
        await ChatRatingService.submitNegativeRating(userId, reason, null, this.bot.botId);
        await this._deleteAndShowMenu(chatId, callbackQuery.message?.message_id, '⚠️ Report submitted. Thank you for helping keep our community safe!');
      }
    }
  }

  /**
   * Delete message and show main menu
   */
  async _deleteAndShowMenu(chatId, messageId, text) {
    if (messageId) {
      try {
        await this.bot.deleteMessage(chatId, messageId);
      } catch (e) {}
    }

    await this.bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      ...keyboards.getMainKeyboard()
    });
  }
}

module.exports = ChatHandlers;
