const { REQUIRED_CHANNEL_1, REQUIRED_CHANNEL_2 } = require("../config/config");

const checkUserJoined = async (bot, userId, chatId) => {
  let member1 = null, member2 = null;
  try {
    member1 = await bot.getChatMember(REQUIRED_CHANNEL_1, userId);
  } catch (error) {
    console.error("Error in getChatMember for REQUIRED_CHANNEL_1:", error);
  }
  try {
    member2 = await bot.getChatMember(REQUIRED_CHANNEL_2, userId);
  } catch (error) {
    console.error("Error in getChatMember for REQUIRED_CHANNEL_2:", error);
  }

  const isMember1 = member1 && ["member", "administrator", "creator"].includes(member1.status);
  const isMember2 = member2 && ["member", "administrator", "creator"].includes(member2.status);

  if (!isMember1 || !isMember2) {
    // Show inline buttons for channels
    await bot.sendMessage(chatId, "❌ You must join the required channels to use this bot:", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Join Channel 1",
              url: `https://t.me/${REQUIRED_CHANNEL_1.replace("@", "")}`,
            },
          ],
          [
            {
              text: "Join Channel 2",
              url: `https://t.me/${REQUIRED_CHANNEL_2.replace("@", "")}`,
            },
          ],
        ],
      },
    });

    await bot.sendMessage(chatId, "After joining, use /start to verify.");
    return false;
  }
  return true;
};

module.exports = { checkUserJoined };
