// Custom keyboards for better UX

const makeReplyMarkup = (keyboard, options = {}) => ({
  reply_markup: {
    keyboard,
    resize_keyboard: true,
    persistent: options.persistent || false,
    one_time_keyboard: options.one_time || false
  }
});

// STATE 1: MAIN / IDLE (NO ACTIVE CHAT)
// User is NOT in a chat - only show Find Partner and Menu
const mainKeyboard = makeReplyMarkup([
  [{ text: "🔍 Find Partner" }],
  [{ text: "☰ Menu" }]
], { persistent: true });

// Menu keyboard (accessed from main)
const menuKeyboard = makeReplyMarkup([
  [{ text: "👤 My Profile" }, { text: "📊 My Stats" }],
  [{ text: "⚙️ Settings" }, { text: "📜 Rules" }],
  [{ text: "⭐ Buy Premium" }, { text: "⭐ Rewards / Redeem" }],
  [{ text: "🔙 Back" }]
], { persistent: true });

// Gender selection keyboard
const genderSelection = makeReplyMarkup([
  [{ text: "👨 Male" }, { text: "👩 Female" }],
  [{ text: "🌈 Other" }]
], { one_time: true });

// VIP Partner Gender Preference keyboard (includes "Any" option)
const vipGenderPreferenceSelection = makeReplyMarkup([
  [{ text: "👨 Male" }, { text: "👩 Female" }],
  [{ text: "🌈 Other" }, { text: "🌐 Any" }]
], { one_time: true });

// STATE 2: ACTIVE CHAT (CONNECTED)
// User IS chatting - show Lock Chat, Next Partner, Stop Chat
const chatActive = makeReplyMarkup([
  [{ text: "🔒 Lock Chat" }, { text: "⏭ Next Partner" }],
  [{ text: "❌ Stop Chat" }]
], { persistent: true });

// Settings menu keyboard (base - will be enhanced for VIP users)
const getSettingsKeyboard = (isVip = false) => {
  const baseButtons = [
    [{ text: "👤 Update Gender" }, { text: "🎂 Update Age" }],
    [{ text: "🖼️ Media Privacy" }],
    [{ text: "📊 View Stats" }, { text: "🔙 Back" }]
  ];
  
  // Add VIP preference options for VIP users
  if (isVip) {
    baseButtons.splice(1, 0, [{ text: "⭐ Partner Gender Preference" }, { text: "🎯 Age Preference" }]);
  }
  
  return makeReplyMarkup(baseButtons, { persistent: true });
};

// VIP Gender Selection (with Any option)
const getVipGenderSelection = () => makeReplyMarkup([
  [{ text: "👨 Male" }, { text: "👩 Female" }],
  [{ text: "🌈 Other" }, { text: "🌐 Any" }],
  [{ text: "🔙 Back" }]
], { one_time: true });

// Backwards compatible
const settingsMenu = getSettingsKeyboard(false);

// Lock duration selection (inline keyboard)
const getLockDurationKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "5 minutes", callback_data: "LOCK_DURATION:5" }],
      [{ text: "10 minutes", callback_data: "LOCK_DURATION:10" }],
      [{ text: "15 minutes", callback_data: "LOCK_DURATION:15" }],
      [{ text: "🔙 Cancel", callback_data: "LOCK_CANCEL" }]
    ]
  }
});

// Buy lock credits prompt (inline keyboard)
const getBuyLockKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "⭐ Buy Lock Credits", callback_data: "STAR_BUY:LOCK:5" }],
      [{ text: "🔙 Cancel", callback_data: "LOCK_CANCEL" }]
    ]
  }
});

// Rate partner inline keyboard
const ratePartner = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "👍 Good Chat", callback_data: "rate_good" },
        { text: "👎 Poor Chat", callback_data: "rate_bad" }
      ],
      [{ text: "⭐ Amazing Chat", callback_data: "rate_amazing" }]
    ]
  }
};

// Remove keyboard
const removeKeyboard = {
  reply_markup: {
    remove_keyboard: true
  }
};

// Helper function: Force keyboard transition by removing old keyboard first
// Use when switching from active chat back to main menu to prevent client-side caching
const getMainKeyboardForceClear = () => removeKeyboard;

module.exports = {
  // Functions for dynamic retrieval (future-proof)
  getMainKeyboard: () => mainKeyboard,
  getMenuKeyboard: () => menuKeyboard,
  getSettingsKeyboard, // Now accepts isVip parameter
  getActiveChatKeyboard: () => chatActive,
  getChatActiveKeyboard: () => chatActive, // backwards compatibility
  getLockDurationKeyboard,
  getBuyLockKeyboard,
  getMainKeyboardForceClear, // Force clear old keyboard before sending new main keyboard
  getVipGenderSelection, // VIP gender preference keyboard
  // Backwards-compatible properties
  mainMenu: mainKeyboard,
  menuKeyboard: menuKeyboard,
  settingsMenu: settingsMenu,
  chatActive: chatActive,
  genderSelection: genderSelection,
  vipGenderPreferenceSelection, // New VIP gender preference keyboard
  ratePartner,
  removeKeyboard
};