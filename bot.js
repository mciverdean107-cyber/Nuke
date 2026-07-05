const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const PREFIX = '!';
const IMMUNE_GUILD_ID = '1518698079992287242'; // Change or remove as needed

// ─── Helper: check bot permissions and return missing list ─────────
function getMissingPerms(guild, requiredPerms) {
  const botMember = guild.members.me;
  if (!botMember) return requiredPerms;
  const botPerms = botMember.permissions;
  return requiredPerms.filter(perm => !botPerms.has(perm));
}

function checkPermsAndReply(message, requiredPerms) {
  const missing = getMissingPerms(message.guild, requiredPerms);
  if (missing.length > 0) {
    const permNames = missing.map(p => `\`${p}\``).join(', ');
    message.reply(`❌ I am missing the following permissions:\n${permNames}\nPlease grant them and try again.`);
    return false;
  }
  return true;
}

// ─── Ready ─────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ─── Message Commands ─────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // Immune server protection
  if (message.guild && message.guild.id === IMMUNE_GUILD_ID) {
    if (command === 'private' || command === 'chat') {
      await message.reply('nice try buddy 🤣');
      return;
    }
  }

  // ─── PRIVATE ─────────────────────────────────────────────────────
  if (command === 'private') {
    if (!message.guild) return message.reply('❌ This command can only be used in a server.');

    const requiredPerms = [PermissionsBitField.Flags.ManageChannels];
    if (!checkPermsAndReply(message, requiredPerms)) return;

    const roleId = args[1];
    if (!roleId) return message.reply('❌ Usage: `!private <roleId>`');

    const role = message.guild.roles.cache.get(roleId);
    if (!role) return message.reply('❌ Role not found. Make sure you provide a valid role ID.');

    const allChannels = [...message.guild.channels.cache.values()];
    const everyoneRole = message.guild.roles.everyone;
    const channelsToLock = allChannels.filter(ch => {
      return ch.permissionsFor(everyoneRole)?.has(PermissionsBitField.Flags.ViewChannel);
    });

    if (channelsToLock.length === 0) {
      return message.reply('ℹ️ No channels found where @everyone can see.');
    }

    const embed = new EmbedBuilder()
      .setTitle('🔒 Making Channels Private')
      .setColor(0x9b59b6)
      .setDescription(`Locking **${channelsToLock.length}** channel(s) to **${role.name}** only...`)
      .addFields(
        { name: 'Channels Found', value: channelsToLock.length.toString(), inline: true },
        { name: 'Updated', value: '0', inline: true },
        { name: 'Status', value: '🔴 Running', inline: true }
      )
      .setFooter({ text: `Executed by ${message.author.tag}` })
      .setTimestamp();

    const statusMsg = await message.channel.send({ embeds: [embed] });

    let updatedCount = 0;
    const updateEmbed = (count, done) => {
      const updated = EmbedBuilder.from(statusMsg.embeds[0])
        .setDescription(done ? '✅ All channels locked!' : `Locking... (${count}/${channelsToLock.length})`)
        .setColor(done ? 0x00ff00 : 0x9b59b6)
        .spliceFields(0, 3,
          { name: 'Channels Found', value: channelsToLock.length.toString(), inline: true },
          { name: 'Updated', value: count.toString(), inline: true },
          { name: 'Status', value: done ? '✅ Done' : '🔴 Running', inline: true }
        );
      statusMsg.edit({ embeds: [updated] }).catch(() => {});
    };

    for (const channel of channelsToLock) {
      try {
        await channel.permissionOverwrites.edit(everyoneRole, {
          ViewChannel: false,
        });
        await channel.permissionOverwrites.edit(role, {
          ViewChannel: true,
        });
        updatedCount++;
        updateEmbed(updatedCount, false);
      } catch (err) {
        console.error(`Failed to update channel ${channel.id}:`, err);
      }
      await new Promise(r => setTimeout(r, 200));
    }

    updateEmbed(updatedCount, true);
    try {
      await message.channel.send({
        content: `✅ Successfully locked **${updatedCount}** channel(s) to **${role.name}**.`,
        tts: false,
      });
    } catch {}
  }

  // ─── CHAT ────────────────────────────────────────────────────────
  // Usage: !chat <categoryId> <roleId>
  // Restricts sending messages AND creating/using threads in all text
  // channels under the category to only the given role.
  if (command === 'chat') {
    if (!message.guild) return message.reply('❌ This command can only be used in a server.');

    const requiredPerms = [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageRoles];
    if (!checkPermsAndReply(message, requiredPerms)) return;

    const categoryId = args[1];
    const roleId = args[2];

    if (!categoryId || !roleId) {
      return message.reply('❌ Usage: `!chat <categoryId> <roleId>`');
    }

    const category = message.guild.channels.cache.get(categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return message.reply('❌ Category not found. Make sure you provide a valid category ID.');
    }

    const role = message.guild.roles.cache.get(roleId);
    if (!role) return message.reply('❌ Role not found. Make sure you provide a valid role ID.');

    // Get all text-based channels under this category
    const channelsInCategory = [...message.guild.channels.cache.values()].filter(
      ch => ch.parentId === category.id && ch.isTextBased?.()
    );

    if (channelsInCategory.length === 0) {
      return message.reply('ℹ️ No text channels found in that category.');
    }

    const everyoneRole = message.guild.roles.everyone;

    // Permissions that control posting: messages, threads (create + send in them), and reactions
    const lockPerms = {
      SendMessages: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    };
    const unlockPerms = {
      SendMessages: true,
      SendMessagesInThreads: true,
      CreatePublicThreads: true,
      CreatePrivateThreads: true,
    };

    const embed = new EmbedBuilder()
      .setTitle('💬 Restricting Chat Permissions')
      .setColor(0x3498db)
      .setDescription(`Restricting **${channelsInCategory.length}** channel(s) in **${category.name}** so only **${role.name}** can send messages or create/use threads...`)
      .addFields(
        { name: 'Channels Found', value: channelsInCategory.length.toString(), inline: true },
        { name: 'Updated', value: '0', inline: true },
        { name: 'Status', value: '🔴 Running', inline: true }
      )
      .setFooter({ text: `Executed by ${message.author.tag}` })
      .setTimestamp();

    const statusMsg = await message.channel.send({ embeds: [embed] });

    let updatedCount = 0;
    const updateEmbed = (count, done) => {
      const updated = EmbedBuilder.from(statusMsg.embeds[0])
        .setDescription(done ? '✅ All channels updated!' : `Updating... (${count}/${channelsInCategory.length})`)
        .setColor(done ? 0x00ff00 : 0x3498db)
        .spliceFields(0, 3,
          { name: 'Channels Found', value: channelsInCategory.length.toString(), inline: true },
          { name: 'Updated', value: count.toString(), inline: true },
          { name: 'Status', value: done ? '✅ Done' : '🔴 Running', inline: true }
        );
      statusMsg.edit({ embeds: [updated] }).catch(() => {});
    };

    for (const channel of channelsInCategory) {
      try {
        // Deny for @everyone
        await channel.permissionOverwrites.edit(everyoneRole, lockPerms);
        // Allow for the specified role
        await channel.permissionOverwrites.edit(role, unlockPerms);
        updatedCount++;
        updateEmbed(updatedCount, false);
      } catch (err) {
        console.error(`Failed to update channel ${channel.id}:`, err);
      }
      await new Promise(r => setTimeout(r, 200));
    }

    updateEmbed(updatedCount, true);
    try {
      await message.channel.send({
        content: `✅ Only **${role.name}** can now send messages, create threads, or post in threads in **${updatedCount}** channel(s) under **${category.name}**.`,
        tts: false,
      });
    } catch {}
  }
});

// ─── Login ─────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
