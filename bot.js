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
const IMMUNE_GUILD_ID = '1518698079992287242';

// ─── Helper: check bot permissions and return missing list ───────────
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

// ─── Message Commands ──────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // Immune server protection
  if (message.guild && message.guild.id === IMMUNE_GUILD_ID) {
    if (['wipe', 'rename'].includes(command)) {
      await message.reply('nice try buddy 🤣');
      return;
    }
  }

  // ─── WIPE ─────────────────────────────────────────────────────────
  if (command === 'wipe') {
    if (!message.guild) return message.reply('❌ This command can only be used in a server.');

    const requiredPerms = [PermissionsBitField.Flags.ManageChannels];
    if (!checkPermsAndReply(message, requiredPerms)) return;

    const categoryId = args[1];
    if (!categoryId) return message.reply('❌ Usage: `!wipe <categoryId>`');

    const category = message.guild.channels.cache.get(categoryId);
    if (!category || category.type !== 4) {
      return message.reply('❌ Invalid or non‑category channel ID. Provide a valid category ID.');
    }

    const channelsToDelete = [...category.children.cache.values()];
    if (channelsToDelete.length === 0) {
      return message.reply('ℹ️ This category has no channels to delete.');
    }

    const embed = new EmbedBuilder()
      .setTitle('🧹 Wiping Category Channels')
      .setColor(0xff6600)
      .setDescription(`Deleting all channels in **${category.name}**...`)
      .addFields(
        { name: 'Total Channels', value: channelsToDelete.length.toString(), inline: true },
        { name: 'Deleted', value: '0', inline: true },
        { name: 'Status', value: '🔴 Running', inline: true }
      )
      .setFooter({ text: `Executed by ${message.author.tag}` })
      .setTimestamp();

    const statusMsg = await message.channel.send({ embeds: [embed] });

    let deletedCount = 0;
    const updateEmbed = (count, done) => {
      const updated = EmbedBuilder.from(statusMsg.embeds[0])
        .setDescription(done ? '✅ All channels deleted!' : `Deleting... (${count}/${channelsToDelete.length})`)
        .setColor(done ? 0x00ff00 : 0xff6600)
        .spliceFields(0, 3,
          { name: 'Total Channels', value: channelsToDelete.length.toString(), inline: true },
          { name: 'Deleted', value: count.toString(), inline: true },
          { name: 'Status', value: done ? '✅ Done' : '🔴 Running', inline: true }
        );
      statusMsg.edit({ embeds: [updated] }).catch(() => {});
    };

    for (const channel of channelsToDelete) {
      try {
        await channel.delete('Wipe command');
        deletedCount++;
        updateEmbed(deletedCount, false);
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }

    updateEmbed(deletedCount, true);
    try {
      await message.channel.send({
        content: `✅ Wipe complete. Deleted **${deletedCount}** channel(s) in category **${category.name}**.`,
        tts: false
      });
    } catch {}
  }

  // ─── RENAME (partial match, case‑insensitive) ─────────────────────
  if (command === 'rename') {
    if (!message.guild) return message.reply('❌ This command can only be used in a server.');

    const requiredPerms = [
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageRoles
    ];
    if (!checkPermsAndReply(message, requiredPerms)) return;

    if (args.length < 3) {
      return message.reply('❌ Usage: `!rename <old_part> <new_name>`\n*Note:* old_part can be a partial name (case‑insensitive). All channels/roles/categories containing it will be renamed.');
    }

    const oldPart = args[1];
    const newName = args.slice(2).join(' ');
    const lowerOld = oldPart.toLowerCase();

    // Find channels (including categories) whose name contains oldPart (case‑insensitive)
    const channelsToRename = message.guild.channels.cache.filter(ch => ch.name.toLowerCase().includes(lowerOld));
    // Find roles whose name contains oldPart, and are editable
    const rolesToRename = message.guild.roles.cache.filter(
      r => r.name.toLowerCase().includes(lowerOld) && r.editable && !r.managed && r.id !== message.guild.id
    );

    const total = channelsToRename.size + rolesToRename.size;
    if (total === 0) {
      return message.reply(`ℹ️ No channels, categories, or roles found containing **"${oldPart}"** (case‑insensitive).`);
    }

    const embed = new EmbedBuilder()
      .setTitle('✏️ Renaming (Partial Match)')
      .setColor(0x3498db)
      .setDescription(`Renaming everything containing **"${oldPart}"** → **"${newName}"**...`)
      .addFields(
        { name: 'Channels/Categories', value: channelsToRename.size.toString(), inline: true },
        { name: 'Roles', value: rolesToRename.size.toString(), inline: true },
        { name: 'Renamed', value: '0', inline: true },
        { name: 'Status', value: '🔴 Running', inline: true }
      )
      .setFooter({ text: `Executed by ${message.author.tag}` })
      .setTimestamp();

    const statusMsg = await message.channel.send({ embeds: [embed] });

    let renamedCount = 0;
    const updateEmbed = (count, done) => {
      const updated = EmbedBuilder.from(statusMsg.embeds[0])
        .setDescription(done ? '✅ All renamed!' : `Renaming... (${count}/${total})`)
        .setColor(done ? 0x00ff00 : 0x3498db)
        .spliceFields(0, 4,
          { name: 'Channels/Categories', value: channelsToRename.size.toString(), inline: true },
          { name: 'Roles', value: rolesToRename.size.toString(), inline: true },
          { name: 'Renamed', value: count.toString(), inline: true },
          { name: 'Status', value: done ? '✅ Done' : '🔴 Running', inline: true }
        );
      statusMsg.edit({ embeds: [updated] }).catch(() => {});
    };

    // Rename channels (including categories)
    for (const ch of channelsToRename.values()) {
      try {
        await ch.setName(newName, 'Rename command');
        renamedCount++;
        updateEmbed(renamedCount, false);
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }

    // Rename roles
    for (const role of rolesToRename.values()) {
      try {
        await role.setName(newName, 'Rename command');
        renamedCount++;
        updateEmbed(renamedCount, false);
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }

    updateEmbed(renamedCount, true);
    try {
      await message.channel.send({
        content: `✅ Renamed **${renamedCount}** item(s) containing **"${oldPart}"** → **"${newName}"**.`,
        tts: false
      });
    } catch {}
  }
});

// ─── Login ─────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
