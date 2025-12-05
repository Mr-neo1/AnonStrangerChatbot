const User = require("../models/userModel");

class AdminController {
  constructor(bot) {
    this.bot = bot;
    this.initializeAdminCommands();
  }

  initializeAdminCommands() {
    // /ban <userId>
    this.bot.onText(/\/ban (\d+)/, async (msg, match) => {
      const userIdToBan = match[1];
      try {
        const [user] = await User.findOrCreate({ where: { userId: userIdToBan } });
        await user.update({ banned: true });
        this.bot.sendMessage(msg.chat.id, `✅ User ${userIdToBan} has been banned.`);
      } catch (error) {
        console.error("Error in /ban:", error);
        this.bot.sendMessage(msg.chat.id, "Error banning user.");
      }
    });

    // /unban <userId>
    this.bot.onText(/\/unban (\d+)/, async (msg, match) => {
      const userIdToUnban = match[1];
      try {
        const user = await User.findOne({ where: { userId: userIdToUnban } });
        if (user) {
          await user.update({ banned: false });
          this.bot.sendMessage(msg.chat.id, `✅ User ${userIdToUnban} has been unbanned.`);
        } else {
          this.bot.sendMessage(msg.chat.id, "User not found.");
        }
      } catch (error) {
        console.error("Error in /unban:", error);
        this.bot.sendMessage(msg.chat.id, "Error unbanning user.");
      }
    });

    // /broadcast <message>
    this.bot.onText(/\/broadcast (.+)/, async (msg, match) => {
      const broadcastMsg = match[1];
      try {
        const users = await User.findAll();
        for (const user of users) {
          this.bot.sendMessage(user.userId, `📢 Admin Broadcast: ${broadcastMsg}`);
        }
        this.bot.sendMessage(msg.chat.id, "✅ Broadcast sent to all users.");
      } catch (error) {
        console.error("Error in /broadcast:", error);
        this.bot.sendMessage(msg.chat.id, "Error sending broadcast.");
      }
    });
  }
}

module.exports = AdminController;
