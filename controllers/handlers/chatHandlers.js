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
    try {
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
    } catch (error) {
      console.error('Error in searchPartner:', error);
      await this.bot.sendMessage(chatId, '❌ Error searching for partner. Please try again.', keyboards.getMainKeyboard()).catch(() => {});
    }
  }

  /**
   * Connect two users together
   */
  async connectUsers(userId1, userId2) {
    try {
      // Set pairing in Redis with 24 hour TTL to prevent orphan pairs
      const PAIR_TTL = 86400;
      await redisClient.setEx(`pair:${userId1}`, PAIR_TTL, String(userId2));
      await redisClient.setEx(`pair:${userId2}`, PAIR_TTL, String(userId1));

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

    // Get VIP status and partner profiles
    const VipService = require('../services/vipService');
    const UserCacheService = require('../services/userCacheService');
    
    const [user1, user2, isVip1, isVip2] = await Promise.all([
      UserCacheService.getUser(userId1),
      UserCacheService.getUser(userId2),
      VipService.isVipActive(userId1),
      VipService.isVipActive(userId2)
    ]);
    
    // Build profile message - only VIP users see age/gender
    const buildProfile = (partnerUser, isViewerVip) => {
      let msg = `⚡️You found a partner🎉\n\n`;
      
      if (isViewerVip) {
        // VIP users see full profile
        msg += `🕵️‍♂️ *Partner Details:*\n`;
        if (partnerUser?.age) msg += `🎂 Age: ${partnerUser.age}\n`;
        if (partnerUser?.gender) {
          const emoji = partnerUser.gender === 'Male' ? '👱‍♂️' : partnerUser.gender === 'Female' ? '👩' : '🌈';
          msg += `👤 Gender: ${partnerUser.gender} ${emoji}`;
        }
        if (!partnerUser?.age && !partnerUser?.gender) msg += `📝 Profile details not set`;
      } else {
        // Regular users see mystery
        msg += `🕵️ Partner profile is *hidden*\n\n`;
        msg += `💎 _Upgrade to VIP to see partner's age & gender!_`;
      }
      return msg;
    };

    // Send connected messages with VIP-gated profile info
    await Promise.all([
      this.bot.sendMessage(userId1, buildProfile(user2, isVip1), {
        parse_mode: 'Markdown',
        ...keyboards.getActiveChatKeyboard()
      }),
      BotRouter.sendMessage(userId2, buildProfile(user1, isVip2), {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getActiveChatKeyboard().reply_markup
      })
    ]).catch(console.error);
    } catch (error) {
      console.error('Error in connectUsers:', error);
      // Try to notify both users
      await this.bot.sendMessage(userId1, '❌ Connection error. Please try again.', keyboards.getMainKeyboard()).catch(() => {});
      await BotRouter.sendMessage(userId2, '❌ Connection error. Please try again.', { reply_markup: keyboards.getMainKeyboard().reply_markup }).catch(() => {});
    }
  }

  /**
   * Stop an active chat
   */
  async stopChat(chatId, skipMessage = null) {
    try {
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

          // Get configurable locked message
          const lockedMsg = await MessagesService.getChatLocked() || '🔒 This chat is locked by your partner.';
          await this.bot.sendMessage(chatId, lockedMsg, keyboards.getActiveChatKeyboard());
          return;
        }
        // Owner is stopping - they can do so, lock will be cleaned up
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
    } catch (error) {
      console.error('Error in stopChat:', error);
      await this.bot.sendMessage(chatId, '❌ Error stopping chat. Please try again.', keyboards.getMainKeyboard()).catch(() => {});
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
   * Handle rating callback - Now uses consistent RATE_ prefix callbacks
   * This handler is deprecated as enhancedChatController handles all callbacks
   */
  async handleRatingCallback(callbackQuery) {
    // All rating callbacks are now handled by enhancedChatController.js
    // This method is kept for backwards compatibility but should not be called
    console.log('handleRatingCallback called - should be handled by enhancedChatController');
    return;
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
