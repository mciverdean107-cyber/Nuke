const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
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
    if (command === 'private') {
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

    // Get all channels (text, voice, category, etc.)
    const allChannels = [...message.guild.channels.cache.values()];

    // Filter channels where @everyone currently has View Channel permission
    const everyoneRole = message.guild.roles.everyone;
    const channelsToLock = allChannels.filter(ch => {
      // Check if @everyone has View Channel in this channel (via role or overwrite)
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
        // Deny View Channel for @everyone
        await channel.permissionOverwrites.edit(everyoneRole, {
          ViewChannel: false,
        });
        // Allow View Channel for the specified role
        await channel.permissionOverwrites.edit(role, {
          ViewChannel: true,
        });
        updatedCount++;
        updateEmbed(updatedCount, false);
      } catch (err) {
        console.error(`Failed to update channel ${channel.id}:`, err);
      }
      await new Promise(r => setTimeout(r, 200)); // small delay to avoid rate limits
    }

    updateEmbed(updatedCount, true);
    try {
      await message.channel.send({
        content: `✅ Successfully locked **${updatedCount}** channel(s) to **${role.name}**.`,
        tts: false,
      });
    } catch {}
  }
});

// ─── Login ─────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
