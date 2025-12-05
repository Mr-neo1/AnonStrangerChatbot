// Custom keyboards for better UX
const keyboards = {
  // Main menu keyboard
  mainMenu: {
    reply_markup: {
      keyboard: [
        [{ text: "🔍 Find Partner" }, { text: "❌ Stop Chat" }],
        [{ text: "📊 My Stats" }, { text: "⚙️ Settings" }],
        [{ text: "📋 Rules" }, { text: "🆔 My ID" }]
      ],
      resize_keyboard: true,
      persistent: true
    }
  },

  // Gender selection keyboard
  genderSelection: {
    reply_markup: {
      keyboard: [
        [{ text: "👨 Male" }, { text: "👩 Female" }],
        [{ text: "🌈 Other" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  },

  // Chat active keyboard
  chatActive: {
    reply_markup: {
      keyboard: [
        [{ text: "🔄 Next Partner" }, { text: "❌ Stop Chat" }],
        [{ text: "🔗 Share Profile" }, { text: "📊 My Stats" }]
      ],
      resize_keyboard: true,
      persistent: true
    }
  },

  // Rating keyboard (after chat ends)
  ratePartner: {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "👍 Good Chat", callback_data: "rate_good" },
          { text: "👎 Poor Chat", callback_data: "rate_bad" }
        ],
        [{ text: "⭐ Amazing Chat", callback_data: "rate_amazing" }]
      ]
    }
  },

  // Remove keyboard
  removeKeyboard: {
    reply_markup: {
      remove_keyboard: true
    }
  }
};

module.exports = keyboards;